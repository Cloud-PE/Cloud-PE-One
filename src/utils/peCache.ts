import type { AppConfig } from './theme';
import { checkNeedsUpdate } from '../api/updateApi';
import { downloadFileToPath } from '../api/downloadApi';
import { invoke } from '@tauri-apps/api/core';
import { unifiedApiService } from '../api/unifiedApi';
import {
  type PeCacheMeta,
  computeFileMd5,
  copyFileWithProgress,
  deleteCacheFile,
  getDefaultPeCacheDir,
  getFileSize,
  preparePeCacheDir,
  readPeCacheMeta,
  writePeCacheMeta,
} from '../api/peCacheApi';

export const ISO_FILE_NAME = 'Cloud-PE.iso';

export type CacheState = 'valid' | 'missing' | 'outdated' | 'corrupted';

let cachedDefaultDir: string | null = null;

// 去掉版本号前缀的 'v'，与启动盘 config 中存储的版本格式保持一致
export const normalizeVersion = (version: string): string =>
  (version || '').replace(/^v/i, '').trim();

// 解析当前生效的缓存目录（配置为空时使用软件目录下的默认目录）
export const resolveCacheDir = async (config: AppConfig): Promise<string> => {
  const configured = config.peCachePath?.trim();
  if (configured) {
    return configured;
  }
  if (!cachedDefaultDir) {
    cachedDefaultDir = await getDefaultPeCacheDir();
  }
  return cachedDefaultDir;
};

// 取缓存目录名（用于升级时排除该目录，避免误删）
export const getCacheDirName = (dir: string): string => {
  const cleaned = dir.replace(/[\\/]+$/, '');
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || 'cache';
};

export const joinPath = (dir: string, name: string): string => {
  const cleaned = dir.replace(/[\\/]+$/, '');
  return `${cleaned}\\${name}`;
};

export const isoCachePath = (dir: string): string => joinPath(dir, ISO_FILE_NAME);

export const ensureCacheDir = async (dir: string): Promise<void> => {
  await preparePeCacheDir(dir);
};

// 校验缓存状态（验证缓存）
export const verifyCache = async (
  dir: string,
  latestVersion?: string,
  serverMd5?: string,
): Promise<CacheState> => {
  const meta = await readPeCacheMeta(dir);
  if (!meta || !meta.isoFileName) {
    return 'missing';
  }

  const isoPath = joinPath(dir, meta.isoFileName);

  let fileMd5: string;
  try {
    fileMd5 = await computeFileMd5(isoPath);
  } catch {
    // 文件缺失或无法读取，视为缓存缺失
    return 'missing';
  }

  // 实际文件与记录不符 → 缓存损坏
  if (meta.isoMd5 && fileMd5.toLowerCase() !== meta.isoMd5.toLowerCase()) {
    return 'corrupted';
  }

  // 服务端有更新的构建（同版本号但 md5 变化，或版本号更新）
  if (serverMd5 && meta.isoMd5 && meta.isoMd5.toLowerCase() !== serverMd5.toLowerCase()) {
    return 'outdated';
  }

  if (latestVersion && checkNeedsUpdate(normalizeVersion(meta.peVersion), normalizeVersion(latestVersion))) {
    return 'outdated';
  }

  return 'valid';
};

export const acquireLabelFor = (state: CacheState): string => {
  switch (state) {
    case 'outdated':
      return '更新缓存';
    case 'corrupted':
      return '修复缓存';
    case 'missing':
    default:
      return '下载缓存';
  }
};

export interface AcquireOptions {
  dir: string;
  isoUrl: string;
  pluginUrl?: string;
  version: string;
  serverMd5?: string;
  threads: number;
  // 修复时先删除旧文件
  repair?: boolean;
}

// 将最新 PE（ISO + 默认插件）下载到缓存并写入元数据（下载/更新/修复缓存）
export const acquireCache = async (opts: AcquireOptions): Promise<PeCacheMeta> => {
  const { dir, isoUrl, pluginUrl, version, serverMd5, threads, repair } = opts;
  await ensureCacheDir(dir);

  const isoPath = isoCachePath(dir);

  if (repair) {
    await deleteCacheFile(isoPath).catch(() => undefined);
  }

  // 下载 ISO 到缓存目录（指定确定的文件名，便于后续校验与复制）
  await downloadFileToPath(isoUrl, isoPath, threads);

  const isoMd5 = await computeFileMd5(isoPath);

  // 若服务端提供了 md5，校验下载正确性
  if (serverMd5 && isoMd5.toLowerCase() !== serverMd5.toLowerCase()) {
    await deleteCacheFile(isoPath).catch(() => undefined);
    throw new Error('缓存校验失败：下载的镜像 MD5 与服务器不一致');
  }

  let pluginFileName = '';
  let pluginMd5 = '';
  if (pluginUrl) {
    try {
      const downloadedPath = await invoke<string>('download_plugin', {
        url: pluginUrl,
        path: dir,
        threads,
      });
      pluginFileName = getCacheDirName(downloadedPath);
      pluginMd5 = await computeFileMd5(downloadedPath).catch(() => '');
    } catch (err) {
      console.error('下载默认插件到缓存失败:', err);
    }
  }

  const isoSize = await getFileSize(isoPath).catch(() => 0);

  const meta: PeCacheMeta = {
    peVersion: normalizeVersion(version),
    isoFileName: ISO_FILE_NAME,
    isoMd5,
    isoSize,
    pluginFileName,
    pluginMd5,
    updatedAt: new Date().toISOString(),
  };

  await writePeCacheMeta(dir, meta);
  return meta;
};

// 从缓存复制 ISO 到目标位置（复制步骤）
export const copyIsoToTarget = async (dir: string, targetPath: string): Promise<string> => {
  return copyFileWithProgress(isoCachePath(dir), targetPath);
};

// 取缓存中默认插件的完整路径（供 deploy 复制）
export const getCachedPluginPath = (dir: string, meta: PeCacheMeta | null): string | undefined => {
  if (meta && meta.pluginFileName) {
    return joinPath(dir, meta.pluginFileName);
  }
  return undefined;
};

export const getCacheMeta = async (dir: string): Promise<PeCacheMeta | null> => {
  try {
    return await readPeCacheMeta(dir);
  } catch {
    return null;
  }
};

// 判断当前是否存在可用的本地缓存（元数据 + ISO 文件均存在）。
// 用于决定是否需要展示"验证缓存"这一步：首次下载（无缓存）时不应出现验证缓存。
export const hasCache = async (dir: string): Promise<boolean> => {
  const meta = await getCacheMeta(dir);
  if (!meta || !meta.isoFileName) {
    return false;
  }
  const size = await getFileSize(joinPath(dir, meta.isoFileName)).catch(() => 0);
  return size > 0;
};

export interface OldVersionCheck {
  need: boolean;
  cachedVersion?: string;
  latestVersion?: string;
  hasCache: boolean;
}

// 离线场景下判断是否需要提示用户"接受旧版本"：
// 当缓存版本低于最后一次联网记录的最新版本时返回 need=true。
export const checkOldVersionPrompt = async (
  config: AppConfig,
  dir: string,
): Promise<OldVersionCheck> => {
  const meta = await getCacheMeta(dir);
  if (!meta || !meta.isoFileName) {
    return { need: false, hasCache: false };
  }
  const latest = normalizeVersion(config.lastKnownLatestPeVersion || '');
  const cached = normalizeVersion(meta.peVersion);
  const need = !!latest && checkNeedsUpdate(cached, latest);
  return { need, cachedVersion: cached, latestVersion: latest, hasCache: true };
};

export interface OnlineCacheSource {
  isoUrl?: string;
  pluginUrl?: string;
  version?: string;
  serverMd5?: string;
}

// 联网状态下从统一 API 获取缓存所需的下载信息（ISO 链接、默认插件、版本）
// v2 聚合接口未提供 ISO 的服务端 MD5，损坏校验依赖本地重算的 MD5。
export const getOnlineCacheSource = async (): Promise<OnlineCacheSource> => {
  const [info, download] = await Promise.all([
    unifiedApiService.getInfo(),
    unifiedApiService.getDownload(),
  ]);
  return {
    isoUrl: download.download_link || undefined,
    pluginUrl: download.default_plugin_link || undefined,
    version: info.data?.cloud_pe_version,
    serverMd5: undefined,
  };
};
