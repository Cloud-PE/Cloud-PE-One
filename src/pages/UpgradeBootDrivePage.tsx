import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress';
import { toastManager } from '@/components/ui/toast';
import { Globe, Play } from 'lucide-react';
import CheckCircle from '@/components/icon/CheckCircle';
import { invoke } from '@tauri-apps/api/core';
import { useAppContext } from '../utils/AppContext';
import { cacheService } from '../utils/cacheService';
import { downloadFileToPath, getDownloadInfo, DownloadInfo } from '../api/downloadApi';

interface UpgradeBootDrivePageProps {
  onNavigate: (page: string) => void;
}

const UpgradeBootDrivePage: React.FC<UpgradeBootDrivePageProps> = ({ onNavigate }) => {
  const { config, setIsUpgradingBootDrive, setBootDriveUpdateAvailable, setBootDriveVersion, setBootDrive, bootDrive } = useAppContext();
  const [isDeploying, setIsDeploying] = useState(false);
  const [downloadInfo, setDownloadInfo] = useState<DownloadInfo>({
    progress: "0%",
    speed: "0.00MB/s",
    downloading: false,
  });
  const [isCompleted, setIsCompleted] = useState(false);
  const monitorIntervalRef = useRef<number | null>(null);

  // 使用官方 Tauri API 调用函数
  const safeTauriInvoke = async (command: string, args?: any): Promise<any> => {
    try {
      console.log(`调用 Tauri 命令: ${command}`, args);
      const result = await invoke(command, args || {});
      console.log(`命令 ${command} 执行结果:`, result);
      return result;
    } catch (error) {
      console.error(`命令 ${command} 执行失败:`, error);
      throw error;
    }
  };

  // 启动下载进度监听
  const startProgressMonitoring = () => {
    console.log('启动下载进度监听...');

    // 清除可能存在的旧监听
    if (monitorIntervalRef.current) {
      clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }

    // 启动新的监听，减少间隔到500ms提高响应速度
    monitorIntervalRef.current = window.setInterval(async () => {
      try {
        const info = await getDownloadInfo();
        console.log('下载信息:', info);

        // 防止进度倒退显示：只有新进度大于等于当前进度时才更新
        setDownloadInfo(prevInfo => {
          const prevPercent = parseFloat(prevInfo.progress.match(/(\d+(?:\.\d+)?)/)?.[1] || '0');
          const newPercent = parseFloat(info.progress.match(/(\d+(?:\.\d+)?)/)?.[1] || '0');

          // 如果新进度小于当前进度，保持当前进度不变
          if (newPercent < prevPercent && info.downloading) {
            return prevInfo;
          }

          return info;
        });
      } catch (error) {
        console.error("获取下载信息失败:", error);
      }
    }, 500); // 从1000ms改为500ms，提高响应速度
  };

  // 停止下载进度监听
  const stopProgressMonitoring = () => {
    console.log('停止下载进度监听');
    if (monitorIntervalRef.current) {
      clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }
  };

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopProgressMonitoring();
    };
  }, []);

  // 获取进度百分比数值
  const getProgressPercent = (): number => {
    const match = downloadInfo.progress.match(/(\d+(?:\.\d+)?)%/);
    return match ? parseFloat(match[1]) : 0;
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

    setIsDeploying(true);
    setIsUpgradingBootDrive(true);

    try {
      console.log('开始升级流程...');
      console.log('使用驱动器:', bootDrive.letter);

      // 从缓存获取下载链接
      const downloadLink = cacheService.getIsoDownloadLink();

      if (!downloadLink) {
        console.error('缓存中没有下载链接');
        setIsDeploying(false);
        setIsUpgradingBootDrive(false);
        setDownloadInfo({
          progress: "0%",
          speed: "0.00MB/s",
          downloading: false,
        });

        toastManager.add({
          type: 'error',
          title: '获取下载链接失败',
          description: '无法获取ISO镜像下载链接，请检查网络连接',
        });
        return;
      }

      const downloadPath = bootDrive.letter + "\\Cloud-PE.iso";
      console.log('下载路径:', downloadPath);

      setDownloadInfo({
        progress: "0%",
        speed: "0.00MB/s",
        downloading: true,
      });

      console.log('开始下载文件...');
      toastManager.add({
        type: 'info',
        title: '开始升级 Cloud-PE',
        description: `正在下载 Cloud-PE 镜像到 ${bootDrive.letter} 驱动器`,
      });

      // 启动进度监听
      startProgressMonitoring();

      try {
        // 下载文件
        await downloadFileToPath(
          downloadLink,
          downloadPath,
          config.downloadThreads
        );

        console.log('下载完成');

        // 停止监听
        stopProgressMonitoring();

        // 获取最终下载状态
        const finalInfo = await getDownloadInfo();
        console.log('最终下载信息:', finalInfo);
        setDownloadInfo(finalInfo);

        // 执行部署
        await performDeploy();

      } catch (downloadError) {
        console.error('下载文件失败:', downloadError);
        stopProgressMonitoring();
        setIsDeploying(false);
        setIsUpgradingBootDrive(false);
        setDownloadInfo({
          progress: "0%",
          speed: "0.00MB/s",
          downloading: false,
        });

        toastManager.add({
          type: 'error',
          title: '下载失败',
          description: downloadError instanceof Error ? downloadError.message : '下载ISO镜像时发生错误',
        });
      }

    } catch (error) {
      console.error('升级失败 - 未预期的错误:', error);
      stopProgressMonitoring();
      setIsDeploying(false);
      setIsUpgradingBootDrive(false);
      setDownloadInfo({
        progress: "0%",
        speed: "0.00MB/s",
        downloading: false,
      });

      toastManager.add({
        type: 'error',
        title: '升级失败',
        description: '升级过程中发生未知错误，请重试',
      });
    }
  };

  const performDeploy = async () => {
    try {
      console.log('开始部署到USB...');
      const result = await safeTauriInvoke('deploy_to_usb', {
        driveLetter: bootDrive?.letter
      });

      console.log('部署完成，返回结果:', result);

      // 从返回结果中获取新版本号
      const newVersion = result?.data?.pe?.version;
      console.log('部署后的新版本:', newVersion);

      // 升级完成后，直接设置不需要更新（因为已经升级到最新版本）
      console.log('升级完成，设置不需要更新');
      setBootDriveUpdateAvailable(false);

      // 更新显示的版本号
      if (newVersion && bootDrive?.letter) {
        console.log('更新版本号显示:', newVersion);

        // 1. 更新缓存
        cacheService.updateBootDriveVersion(bootDrive.letter, newVersion);

        // 2. 更新状态
        setBootDriveVersion(newVersion);
        setBootDrive({
          ...bootDrive,
          version: newVersion
        });
      }

      setIsDeploying(false);
      setIsCompleted(true);
      setIsUpgradingBootDrive(false);

      toastManager.add({
        type: 'success',
        title: '升级成功',
        description: result.message || '启动盘升级完成！',
      });
    } catch (error) {
      console.error('部署失败:', error);
      setIsDeploying(false);
      setIsUpgradingBootDrive(false);

      toastManager.add({
        type: 'error',
        title: '升级失败',
        description: `启动盘升级过程中发生错误: ${error}`,
      });
    }
  };

  const handleNavigateHome = () => {
    console.log('返回首页');
    onNavigate('home');
  };

  // 完成页面
  if (isCompleted) {
    return (
      <div className="w-full flex flex-col items-center overflow-hidden px-6 box-border mt-24">
        <CheckCircle className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">升级成功</h2>
        <div className="flex gap-4">
          <Button onClick={handleNavigateHome}>
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  // 升级进行中页面
  if (isDeploying) {
    const percent = getProgressPercent();
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
            状态: {downloadInfo.downloading ? '下载中' : '部署中'}
          </span>
        </div>
      </div>
    );
  }

  // 初始页面
  return (
    <div className="w-full flex flex-col items-center overflow-hidden px-6 box-border mt-24">
      <Play className="w-16 h-16 mb-6" />
      <h2 className="text-2xl font-semibold mb-8 text-center">升级启动盘</h2>

      {!bootDrive?.letter && (
        <p className="mb-8 text-center">
          未检测到启动盘，请确保启动盘已正确连接
        </p>
      )}

      <Button
        onClick={handleStartUpgrade}
        disabled={!bootDrive?.letter}
      >
        立即升级
      </Button>
    </div>
  );
};

export default UpgradeBootDrivePage;
