import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress';
import { toastManager } from '@/components/ui/toast';
import { Globe, Play } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from '@/components/ui/alert-dialog';
import CheckCircle from '@/components/icon/CheckCircle';
import { invoke } from '@tauri-apps/api/core';
import { useAppContext } from '../utils/AppContext';
import { cacheService } from '../utils/cacheService';
import { cancelDownload } from '../api/downloadApi';
import { usePeCachePipeline } from '../hooks/usePeCachePipeline';
import CacheSteps from '../components/CacheSteps';
import {
  getOnlineCacheSource,
  resolveCacheDir,
  checkOldVersionPrompt,
} from '../utils/peCache';

interface UpgradeBootDrivePageProps {
  onNavigate: (page: string) => void;
}

const UpgradeBootDrivePage: React.FC<UpgradeBootDrivePageProps> = ({ onNavigate }) => {
  const {
    config,
    setIsUpgradingBootDrive,
    setBootDriveUpdateAvailable,
    setBootDriveVersion,
    setBootDrive,
    bootDrive,
  } = useAppContext();

  const [running, setRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [showOldVersion, setShowOldVersion] = useState(false);
  const [oldVersionInfo, setOldVersionInfo] = useState<{ cached?: string; latest?: string }>({});

  const pipeline = usePeCachePipeline();
  const runningRef = useRef(false);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    return () => {
      if (runningRef.current) {
        void cancelDownload();
      }
    };
  }, []);

  const performDeploy = async (cachedPluginPath?: string) => {
    try {
      const result: any = await invoke('deploy_to_usb', {
        driveLetter: bootDrive?.letter,
        cachedPluginPath,
      });

      const newVersion = result?.data?.pe?.version;

      setBootDriveUpdateAvailable(false);

      if (newVersion && bootDrive?.letter) {
        cacheService.updateBootDriveVersion(bootDrive.letter, newVersion);
        setBootDriveVersion(newVersion);
        setBootDrive({ ...bootDrive, version: newVersion });
      }

      pipeline.markDone();
      setRunning(false);
      setIsCompleted(true);
      setIsUpgradingBootDrive(false);

      toastManager.add({
        type: 'success',
        title: '升级成功',
        description: result?.message || '启动盘升级完成！',
      });
    } catch (err) {
      console.error('部署失败:', err);
      pipeline.markError();
      setRunning(false);
      setIsUpgradingBootDrive(false);

      toastManager.add({
        type: 'error',
        title: '升级失败',
        description: `启动盘升级过程中发生错误: ${err}`,
      });
    }
  };

  const startUpgrade = async () => {
    if (!bootDrive?.letter) return;

    setRunning(true);
    setIsUpgradingBootDrive(true);

    const online = cacheService.getNetworkConnected();
    let source;
    let effectiveOnline = online;
    if (online) {
      try {
        source = await getOnlineCacheSource();
        if (!source.isoUrl) {
          effectiveOnline = false;
        }
      } catch (err) {
        console.error('获取在线缓存信息失败，尝试使用本地缓存:', err);
        effectiveOnline = false;
      }
    }

    const downloadPath = `${bootDrive.letter}\\Cloud-PE.iso`;

    toastManager.add({
      type: 'info',
      title: '开始升级 Cloud-PE',
      description: effectiveOnline ? '正在准备最新的 PE 缓存' : '正在使用本地缓存升级启动盘',
    });

    try {
      const result = await pipeline.run({
        config,
        online: effectiveOnline,
        withDeploy: true,
        targetPath: downloadPath,
        threads: config.downloadThreads,
        source,
      });
      await performDeploy(result.cachedPluginPath);
    } catch (err) {
      console.error('升级失败:', err);
      pipeline.markError();
      setRunning(false);
      setIsUpgradingBootDrive(false);
      toastManager.add({
        type: 'error',
        title: '升级失败',
        description: err instanceof Error ? err.message : String(err ?? '升级过程中发生错误'),
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

    const online = cacheService.getNetworkConnected();
    if (!online) {
      try {
        const dir = await resolveCacheDir(config);
        const check = await checkOldVersionPrompt(config, dir);
        if (!check.hasCache) {
          toastManager.add({
            type: 'error',
            title: '无法升级',
            description: '当前处于离线状态，且没有可用的本地 PE 缓存',
          });
          return;
        }
        if (check.need) {
          setOldVersionInfo({ cached: check.cachedVersion, latest: check.latestVersion });
          setShowOldVersion(true);
          return;
        }
      } catch (err) {
        console.error('检查缓存状态失败:', err);
      }
    }

    await startUpgrade();
  };

  const handleAcceptOldVersion = async () => {
    setShowOldVersion(false);
    await startUpgrade();
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

  if (running) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 box-border mt-12">
        <CacheSteps steps={pipeline.steps} current={pipeline.currentIndex} />
        <Globe className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">{pipeline.statusText || '升级中'}</h2>

        {pipeline.showProgress && (
          <>
            <div className="w-full max-w-md mb-4">
              <Progress value={pipeline.percent} max={100}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">进度</span>
                  <span className="text-sm tabular-nums">{pipeline.percent.toFixed(1)}%</span>
                </div>
                <ProgressTrack className="h-2">
                  <ProgressIndicator />
                </ProgressTrack>
              </Progress>
            </div>

            <div className="flex justify-between w-full max-w-md mt-4">
              <span className="text-sm text-muted-foreground font-medium">速度: {pipeline.speed}</span>
              <span className="text-sm text-muted-foreground font-medium">状态: {pipeline.statusText}</span>
            </div>
          </>
        )}
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

      <AlertDialog open={showOldVersion} onOpenChange={setShowOldVersion}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>使用较旧的缓存版本？</AlertDialogTitle>
            <AlertDialogDescription>
              当前处于离线状态，本地缓存为 Cloud-PE v{oldVersionInfo.cached}，而最近一次联网时检测到的最新版本为
              v{oldVersionInfo.latest}。是否继续使用这个较旧的缓存版本升级启动盘？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>取消</AlertDialogClose>
            <Button onClick={handleAcceptOldVersion}>使用旧版本</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
};

export default UpgradeBootDrivePage;
