// downloadApi.ts

import { invoke } from '@tauri-apps/api/core';
import { listen, Event } from '@tauri-apps/api/event';
import React from 'react';

// 下载信息接口
export interface DownloadInfo {
  progress: string;
  speed: string;
  downloading: boolean;
}

// 扩展的下载信息接口，包含初始化标记
export interface DownloadInfoWithInit extends DownloadInfo {
  initialized: boolean;
}

// 定义一个模块级变量来存储最新的下载状态
let latestDownloadInfo: DownloadInfoWithInit = {
  progress: "0%",
  speed: "0.00MB/s",
  downloading: false,
  initialized: false, // 添加初始化标记，表示尚未收到真实的进度事件
};

// 在模块加载时立即启动事件监听器
// 使用IIFE（立即调用函数表达式）来处理异步监听
(async () => {
  try {
    await listen<DownloadInfo>('download://progress', (event: Event<DownloadInfo>) => {
      // 当从后端接收到事件时，更新本地状态
      latestDownloadInfo = {
        ...event.payload,
        initialized: true, // 标记已接收到真实数据
      };
      
      // 日志输出，方便调试
      console.log('Received download progress event:', event.payload);
    });
    console.log("Successfully listening for 'download://progress' events.");
  } catch (e) {
    console.error("Failed to set up download progress listener:", e);
  }
})();

// 下载文件到指定路径
export const downloadFileToPath = async (
  url: string,
  savePath: string,
  thread?: number
): Promise<string> => {
  try {
    // 在开始下载前，重置初始化标记
    latestDownloadInfo = {
      progress: "0%",
      speed: "0.00MB/s",
      downloading: false,
      initialized: false,
    };
    
    // 前端调用签名不变，Tauri会自动处理AppHandle的注入
    const result = await invoke<string>("download_file_to_path", {
      url,
      savePath,
      thread: thread || 8,
    });
    
    return result;
  } catch (error) {
    console.error("下载文件失败:", error);
    throw error;
  }
};

// 获取下载进度信息 - 返回带初始化标记的信息
export const getDownloadInfo = async (): Promise<DownloadInfo> => {
  // 如果还未初始化且标记为正在下载，返回一个临时的下载中状态
  // 这样可以避免"一秒生成"的问题
  if (!latestDownloadInfo.initialized && latestDownloadInfo.downloading === false) {
    return {
      progress: "0%",
      speed: "0.00MB/s",
      downloading: false, // 保持为 false，让前端判断是否真正开始
    };
  }
  
  // 返回时不包含 initialized 字段，保持接口兼容性
  const { initialized, ...downloadInfo } = latestDownloadInfo;
  return Promise.resolve(downloadInfo);
};

// 监听下载进度的钩子类
export class DownloadProgressListener {
  private intervalId: number | null = null;
  private callback: (info: DownloadInfo) => void;

  constructor(callback: (info: DownloadInfo) => void) {
    this.callback = callback;
  }

  start(): void {
    if (this.intervalId) {
      this.stop();
    }

    this.intervalId = window.setInterval(async () => {
      try {
        const info = await getDownloadInfo();
        this.callback(info);
      } catch (error) {
        console.error("监听下载进度失败:", error);
      }
    }, 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

// React Hook 用于监听下载进度
export const useDownloadProgress = () => {
  const [downloadInfo, setDownloadInfo] = React.useState<DownloadInfo>({
    progress: "0%",
    speed: "0.00MB/s",
    downloading: false,
  });

  React.useEffect(() => {
    const listener = new DownloadProgressListener((info) => {
      setDownloadInfo(info);
    });

    listener.start();

    return () => {
      listener.stop();
    };
  }, []);

  return downloadInfo;
};