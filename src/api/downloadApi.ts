import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

export interface DownloadInfo {
  progress: string;
  speed: string;
  downloading: boolean;
}

const INITIAL: DownloadInfo = {
  progress: '0%',
  speed: '0.00MB/s',
  downloading: false,
};

let latest: DownloadInfo = INITIAL;
let unlisten: UnlistenFn | null = null;
let pendingListen: Promise<void> | null = null;
const subscribers = new Set<(info: DownloadInfo) => void>();

function broadcast(info: DownloadInfo): void {
  latest = info;
  subscribers.forEach((cb) => {
    try {
      cb(info);
    } catch (err) {
      console.error('download subscriber threw:', err);
    }
  });
}

async function ensureListening(): Promise<void> {
  if (unlisten) return;
  if (!pendingListen) {
    pendingListen = listen<DownloadInfo>('download://progress', (event) => {
      broadcast(event.payload);
    }).then((handle) => {
      unlisten = handle;
    }).catch((err) => {
      pendingListen = null;
      throw err;
    });
  }
  await pendingListen;
}

void ensureListening().catch((err) => {
  console.error('订阅下载进度事件失败:', err);
});

export const downloadFileToPath = async (
  url: string,
  savePath: string,
  thread?: number,
): Promise<string> => {
  await ensureListening();
  broadcast({ progress: '0%', speed: '0.00MB/s', downloading: true });
  try {
    return await invoke<string>('download_file_to_path', {
      url,
      savePath,
      thread: thread ?? 8,
    });
  } catch (err) {
    broadcast({ progress: latest.progress, speed: '0.00MB/s', downloading: false });
    throw err;
  }
};

export const cancelDownload = async (): Promise<void> => {
  try {
    await invoke('cancel_download');
  } catch (err) {
    console.error('取消下载请求失败:', err);
  }
};

export const getDownloadInfo = async (): Promise<DownloadInfo> => latest;

export const useDownloadProgress = (): DownloadInfo => {
  const [info, setInfo] = useState<DownloadInfo>(latest);

  useEffect(() => {
    subscribers.add(setInfo);
    void ensureListening();
    setInfo(latest);
    return () => {
      subscribers.delete(setInfo);
    };
  }, []);

  return info;
};
