import { useMemo, useState } from 'react';
import type { AppConfig } from '../utils/theme';
import type { CacheStep } from '../components/CacheSteps';
import type { PeCacheMeta } from '../api/peCacheApi';
import { useDownloadProgress } from '../api/downloadApi';
import { useCopyProgress } from '../api/peCacheApi';
import {
  acquireCache,
  acquireLabelFor,
  copyIsoToTarget,
  ensureCacheDir,
  getCacheMeta,
  getCachedPluginPath,
  hasCache,
  resolveCacheDir,
  verifyCache,
  type CacheState,
} from '../utils/peCache';

export type PipelinePhase =
  | 'idle'
  | 'verify'
  | 'acquire'
  | 'copy'
  | 'deploy'
  | 'done'
  | 'error';

export interface CacheSource {
  isoUrl?: string;
  pluginUrl?: string;
  version?: string;
  serverMd5?: string;
}

export interface RunParams {
  config: AppConfig;
  online: boolean;
  withDeploy: boolean;
  targetPath: string;
  threads: number;
  source?: CacheSource;
}

export interface RunResult {
  dir: string;
  meta: PeCacheMeta | null;
  cachedPluginPath?: string;
}

const parsePercent = (progress: string): number => {
  const match = progress.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
};

export const usePeCachePipeline = () => {
  const [phase, setPhase] = useState<PipelinePhase>('idle');
  const [acquireNeeded, setAcquireNeeded] = useState(false);
  const [acquireLabel, setAcquireLabel] = useState('下载缓存');
  const [withDeploy, setWithDeploy] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadInfo = useDownloadProgress();
  const copyInfo = useCopyProgress();

  const steps = useMemo<CacheStep[]>(() => {
    const list: CacheStep[] = [];
    // 仅当本地已有缓存时才需要"验证缓存"这一步；首次下载（无缓存）不显示。
    if (showVerify) {
      list.push({ key: 'verify', label: '验证缓存' });
    }
    if (acquireNeeded) {
      list.push({ key: 'acquire', label: acquireLabel });
    }
    list.push({ key: 'copy', label: '复制到目标位置' });
    if (withDeploy) {
      list.push({ key: 'deploy', label: '部署 Cloud-PE' });
    }
    return list;
  }, [showVerify, acquireNeeded, acquireLabel, withDeploy]);

  const currentIndex = useMemo(() => {
    const indexOf = (key: string) => steps.findIndex((s) => s.key === key);
    switch (phase) {
      case 'verify':
        return indexOf('verify');
      case 'acquire':
        return indexOf('acquire');
      case 'copy':
        return indexOf('copy');
      case 'deploy':
        return indexOf('deploy');
      case 'done':
        return steps.length;
      default:
        return 0;
    }
  }, [phase, steps]);

  // 只有下载/复制阶段才有真实的进度与速度可展示；验证、部署等阶段不显示进度条与速度。
  const showProgress = phase === 'acquire' || phase === 'copy';

  const percent = useMemo(() => {
    if (phase === 'acquire') return parsePercent(downloadInfo.progress);
    if (phase === 'copy') return parsePercent(copyInfo.progress);
    return 0;
  }, [phase, downloadInfo.progress, copyInfo.progress]);

  const speed = useMemo(() => {
    if (phase === 'acquire') return downloadInfo.speed;
    if (phase === 'copy') return copyInfo.speed;
    return '0.00MB/s';
  }, [phase, downloadInfo.speed, copyInfo.speed]);

  const statusText = useMemo(() => {
    switch (phase) {
      case 'verify':
        return '正在验证缓存';
      case 'acquire':
        return acquireLabel + '中';
      case 'copy':
        return '正在复制到目标位置';
      case 'deploy':
        return '正在部署';
      default:
        return '';
    }
  }, [phase, acquireLabel]);

  const reset = () => {
    setPhase('idle');
    setAcquireNeeded(false);
    setWithDeploy(false);
    setShowVerify(false);
    setError(null);
  };

  // 运行缓存流水线：验证 →（下载/更新/修复）→ 复制到目标
  const run = async (params: RunParams): Promise<RunResult> => {
    const { config, online, targetPath, threads, source } = params;
    setError(null);
    setAcquireNeeded(false);
    setWithDeploy(params.withDeploy);

    const dir = await resolveCacheDir(config);
    await ensureCacheDir(dir);

    // 1. 验证缓存（仅当本地已存在缓存时；首次下载没有缓存可验证，跳过该步）
    const existing = await hasCache(dir);
    setShowVerify(existing);

    const latestVersion = online ? source?.version : config.lastKnownLatestPeVersion;
    const serverMd5 = online ? source?.serverMd5 : undefined;
    let state: CacheState;
    if (existing) {
      setPhase('verify');
      state = await verifyCache(dir, latestVersion, serverMd5);
    } else {
      state = 'missing';
    }

    // 2. 按需下载 / 更新 / 修复
    if (state !== 'valid') {
      if (!online) {
        // 离线：缺失或损坏无法自愈，过时则继续使用现有缓存
        if (state === 'missing' || state === 'corrupted') {
          setPhase('error');
          throw new Error('当前处于离线状态，且没有可用的本地缓存');
        }
      } else {
        if (!source?.isoUrl) {
          setPhase('error');
          throw new Error('无法获取镜像下载链接');
        }
        setAcquireNeeded(true);
        setAcquireLabel(acquireLabelFor(state));
        setPhase('acquire');
        await acquireCache({
          dir,
          isoUrl: source.isoUrl,
          pluginUrl: source.pluginUrl,
          version: source.version || latestVersion || '',
          serverMd5: source.serverMd5,
          threads,
          repair: state === 'corrupted',
        });
      }
    }

    // 3. 复制到目标位置
    setPhase('copy');
    await copyIsoToTarget(dir, targetPath);

    // 4. 读取元数据，准备部署所需的缓存插件路径
    const meta = await getCacheMeta(dir);
    const cachedPluginPath = getCachedPluginPath(dir, meta);

    if (params.withDeploy) {
      setPhase('deploy');
    } else {
      setPhase('done');
    }

    return { dir, meta, cachedPluginPath };
  };

  const markDone = () => setPhase('done');
  const markError = (msg?: string) => {
    if (msg) setError(msg);
    setPhase('error');
  };

  return {
    phase,
    steps,
    currentIndex,
    percent,
    speed,
    showProgress,
    statusText,
    error,
    acquireLabel,
    run,
    reset,
    markDone,
    markError,
  };
};
