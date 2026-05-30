import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

// 与 Rust 端 PeCacheMeta 对应（serde camelCase）
export interface PeCacheMeta {
  peVersion: string;
  isoFileName: string;
  isoMd5: string;
  isoSize: number;
  pluginFileName: string;
  pluginMd5: string;
  updatedAt: string;
}

export interface CopyProgressInfo {
  progress: string;
  speed: string;
  copying: boolean;
}

export const getDefaultPeCacheDir = (): Promise<string> =>
  invoke<string>('get_default_pe_cache_dir');

export const getDefaultPeCacheDirName = (): Promise<string> =>
  invoke<string>('get_default_pe_cache_dir_name');

export const preparePeCacheDir = (path: string): Promise<void> =>
  invoke<void>('prepare_pe_cache_dir', { path });

export const getPathFreeSpace = (path: string): Promise<number> =>
  invoke<number>('get_path_free_space', { path });

export const computeFileMd5 = (path: string): Promise<string> =>
  invoke<string>('compute_file_md5', { path });

export const readPeCacheMeta = (dir: string): Promise<PeCacheMeta | null> =>
  invoke<PeCacheMeta | null>('read_pe_cache_meta', { dir });

export const writePeCacheMeta = (dir: string, meta: PeCacheMeta): Promise<void> =>
  invoke<void>('write_pe_cache_meta', { dir, meta });

export const deleteCacheFile = (path: string): Promise<void> =>
  invoke<void>('delete_cache_file', { path });

export const getFileSize = (path: string): Promise<number> =>
  invoke<number>('get_file_size', { path });

export const copyFileWithProgress = (src: string, dest: string): Promise<string> =>
  invoke<string>('copy_file_with_progress', { src, dest });

const INITIAL_COPY: CopyProgressInfo = {
  progress: '0%',
  speed: '0.00MB/s',
  copying: false,
};

let latestCopy: CopyProgressInfo = INITIAL_COPY;
let copyUnlisten: UnlistenFn | null = null;
let copyPending: Promise<void> | null = null;
const copySubscribers = new Set<(info: CopyProgressInfo) => void>();

function broadcastCopy(info: CopyProgressInfo): void {
  latestCopy = info;
  copySubscribers.forEach((cb) => {
    try {
      cb(info);
    } catch (err) {
      console.error('copy subscriber threw:', err);
    }
  });
}

async function ensureCopyListening(): Promise<void> {
  if (copyUnlisten) return;
  if (!copyPending) {
    copyPending = listen<CopyProgressInfo>('cache://copy-progress', (event) => {
      broadcastCopy(event.payload);
    })
      .then((handle) => {
        copyUnlisten = handle;
      })
      .catch((err) => {
        copyPending = null;
        throw err;
      });
  }
  await copyPending;
}

void ensureCopyListening().catch((err) => {
  console.error('订阅复制进度事件失败:', err);
});

export const useCopyProgress = (): CopyProgressInfo => {
  const [info, setInfo] = useState<CopyProgressInfo>(latestCopy);

  useEffect(() => {
    copySubscribers.add(setInfo);
    void ensureCopyListening();
    setInfo(latestCopy);
    return () => {
      copySubscribers.delete(setInfo);
    };
  }, []);

  return info;
};
