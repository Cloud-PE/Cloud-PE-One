import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress';
import { toastManager } from '@/components/ui/toast';
import { Globe, Play } from 'lucide-react';
import CheckCircle from '@/components/icon/CheckCircle';
import { invoke } from '@tauri-apps/api/core';
import { useAppContext } from '../utils/AppContext';
import { cacheService } from '../utils/cacheService';
import {
  downloadFileToPath,
  cancelDownload,
  useDownloadProgress,
} from '../api/downloadApi';

interface UpgradeBootDrivePageProps {
  onNavigate: (page: string) => void;
}

const parsePercent = (progress: string): number => {
  const match = progress.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
};

const UpgradeBootDrivePage: React.FC<UpgradeBootDrivePageProps> = ({ onNavigate }) => {
  const {
    config,
    setIsUpgradingBootDrive,
    setBootDriveUpdateAvailable,
    setBootDriveVersion,
    setBootDrive,
    bootDrive,
  } = useAppContext();

  const [isDeploying, setIsDeploying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const downloadInfo = useDownloadProgress();
  const downloadingRef = useRef(false);

  useEffect(() => {
    downloadingRef.current = downloading;
  }, [downloading]);

  useEffect(() => {
    return () => {
      if (downloadingRef.current) {
        void cancelDownload();
      }
    };
  }, []);

  const percent = downloading ? parsePercent(downloadInfo.progress) : 0;

  const performDeploy = async () => {
    try {
      const result: any = await invoke('deploy_to_usb', {
        driveLetter: bootDrive?.letter,
      });

      const newVersion = result?.data?.pe?.version;

      setBootDriveUpdateAvailable(false);

      if (newVersion && bootDrive?.letter) {
        cacheService.updateBootDriveVersion(bootDrive.letter, newVersion);
        setBootDriveVersion(newVersion);
        setBootDrive({ ...bootDrive, version: newVersion });
      }

      setIsDeploying(false);
      setIsCompleted(true);
      setIsUpgradingBootDrive(false);

      toastManager.add({
        type: 'success',
        title: '升级成功',
        description: result?.message || '启动盘升级完成！',
      });
    } catch (err) {
      console.error('部署失败:', err);
      setIsDeploying(false);
      setIsUpgradingBootDrive(false);

      toastManager.add({
        type: 'error',
        title: '升级失败',
        description: `启动盘升级过程中发生错误: ${err}`,
      });
    }
  };

  const handleStartUpgrade = async () => {
    if (!bootDrive?.letter) {
      toastManager.add({
        type: 'error',
        title: '错误',
        description: '未检测到启动盘，请确保启动盘已正确连接',
      });
      return;
    }

    const downloadLink = cacheService.getIsoDownloadLink();
    if (!downloadLink) {
      toastManager.add({
        type: 'error',
        title: '获取下载链接失败',
        description: '无法获取ISO镜像下载链接，请检查网络连接',
      });
      return;
    }

    const downloadPath = `${bootDrive.letter}\\Cloud-PE.iso`;

    setIsDeploying(true);
    setDownloading(true);
    setIsUpgradingBootDrive(true);

    toastManager.add({
      type: 'info',
      title: '开始升级 Cloud-PE',
      description: `正在下载 Cloud-PE 镜像到 ${bootDrive.letter} 驱动器`,
    });

    try {
      await downloadFileToPath(downloadLink, downloadPath, config.downloadThreads);
      setDownloading(false);
      await performDeploy();
    } catch (err) {
      console.error('下载文件失败:', err);
      setDownloading(false);
      setIsDeploying(false);
      setIsUpgradingBootDrive(false);

      toastManager.add({
        type: 'error',
        title: '下载失败',
        description: err instanceof Error ? err.message : String(err ?? '下载ISO镜像时发生错误'),
      });
    }
  };

  if (isCompleted) {
    return (
      <div className="w-full flex flex-col items-center overflow-hidden px-6 box-border mt-24">
        <CheckCircle className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">升级成功</h2>
        <div className="flex gap-4">
          <Button onClick={() => onNavigate('home')}>返回首页</Button>
        </div>
      </div>
    );
  }

  if (isDeploying) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 box-border mt-24">
        <Globe className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">升级中</h2>

        <div className="w-full max-w-md mb-4">
          <Progress value={percent} max={100}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">下载进度</span>
              <span className="text-sm tabular-nums">{percent.toFixed(1)}%</span>
            </div>
            <ProgressTrack className="h-2">
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
        </div>

        <div className="flex justify-between w-full max-w-md mt-4">
          <span className="text-sm text-muted-foreground font-medium">
            下载速度: {downloadInfo.speed}
          </span>
          <span className="text-sm text-muted-foreground font-medium">
            状态: {downloading ? '下载中' : '部署中'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center overflow-hidden px-6 box-border mt-24">
      <Play className="w-16 h-16 mb-6" />
      <h2 className="text-2xl font-semibold mb-8 text-center">升级启动盘</h2>

      {!bootDrive?.letter && (
        <p className="mb-8 text-center">未检测到启动盘，请确保启动盘已正确连接</p>
      )}

      <Button onClick={handleStartUpgrade} disabled={!bootDrive?.letter}>
        立即升级
      </Button>
    </div>
  );
};

export default UpgradeBootDrivePage;
