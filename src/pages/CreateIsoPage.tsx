import React, { useState, useEffect, useRef } from 'react';
import { Globe, Disc } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { toastManager } from '@/components/ui/toast';
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
import { cacheService } from '../utils/cacheService';
import { saveFileDialog } from '../utils/tauriApiWrapper';
import { cancelDownload } from '../api/downloadApi';
import { useAppContext } from '../utils/AppContext';
import { usePeCachePipeline } from '../hooks/usePeCachePipeline';
import CacheSteps from '../components/CacheSteps';
import {
  getOnlineCacheSource,
  resolveCacheDir,
  checkOldVersionPrompt,
} from '../utils/peCache';

const CreateIsoPage: React.FC = () => {
  const { config, setIsGeneratingIso } = useAppContext();
  const [buttonLoading, setButtonLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const [showOldVersion, setShowOldVersion] = useState(false);
  const [oldVersionInfo, setOldVersionInfo] = useState<{ cached?: string; latest?: string }>({});
  const pendingPathRef = useRef<string | null>(null);

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

  const startPipeline = async (filePath: string) => {
    setRunning(true);
    setIsGeneratingIso(true);

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

    toastManager.add({
      title: '开始生成ISO镜像',
      description: effectiveOnline ? '正在准备最新的 PE 缓存' : '正在使用本地缓存生成镜像',
      type: 'info',
    });

    try {
      await pipeline.run({
        config,
        online: effectiveOnline,
        withDeploy: false,
        targetPath: filePath,
        threads: config.downloadThreads,
        source,
      });
      pipeline.markDone();
      setRunning(false);
      setIsGeneratingIso(false);
      setIsCompleted(true);
      toastManager.add({
        title: '镜像生成成功！',
        description: `生成镜像已保存至：${filePath}`,
        type: 'success',
      });
    } catch (err) {
      console.error('生成ISO失败:', err);
      pipeline.markError();
      setRunning(false);
      setIsGeneratingIso(false);
      toastManager.add({
        title: '生成失败',
        description: err instanceof Error ? err.message : String(err ?? '生成ISO镜像时发生错误'),
        type: 'error',
      });
    }
  };

  const handleStartGenerate = async () => {
    if (running || buttonLoading) {
      toastManager.add({
        title: '提示',
        description: '已有任务在进行中',
        type: 'warning',
      });
      return;
    }

    setButtonLoading(true);
    const filePath = await saveFileDialog('Cloud-PE.iso').catch(() => null);
    if (!filePath) {
      setButtonLoading(false);
      return;
    }

    // 离线时检查是否需要提示接受旧版本缓存
    const online = cacheService.getNetworkConnected();
    if (!online) {
      try {
        const dir = await resolveCacheDir(config);
        const check = await checkOldVersionPrompt(config, dir);
        if (!check.hasCache) {
          setButtonLoading(false);
          toastManager.add({
            title: '无法生成',
            description: '当前处于离线状态，且没有可用的本地 PE 缓存',
            type: 'error',
          });
          return;
        }
        if (check.need) {
          pendingPathRef.current = filePath;
          setOldVersionInfo({ cached: check.cachedVersion, latest: check.latestVersion });
          setShowOldVersion(true);
          setButtonLoading(false);
          return;
        }
      } catch (err) {
        console.error('检查缓存状态失败:', err);
      }
    }

    setButtonLoading(false);
    await startPipeline(filePath);
  };

  const handleAcceptOldVersion = async () => {
    setShowOldVersion(false);
    const filePath = pendingPathRef.current;
    pendingPathRef.current = null;
    if (filePath) {
      await startPipeline(filePath);
    }
  };

  const handleRejectOldVersion = () => {
    setShowOldVersion(false);
    pendingPathRef.current = null;
  };

  if (isCompleted) {
    return (
      <div className="w-full flex flex-col items-center overflow-hidden px-6 box-border mt-24">
        <CheckCircle className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">镜像生成成功</h2>
      </div>
    );
  }

  if (running) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 box-border mt-12">
        <CacheSteps steps={pipeline.steps} current={pipeline.currentIndex} />
        <Globe className="size-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">{pipeline.statusText || '正在生成ISO镜像'}</h2>

        {pipeline.showProgress && (
          <>
            <div className="w-full max-w-[400px] mb-6">
              <Progress value={pipeline.percent}>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">进度</span>
                  <span className="text-sm tabular-nums">{pipeline.percent.toFixed(1)}%</span>
                </div>
                <ProgressTrack className="h-2">
                  <ProgressIndicator />
                </ProgressTrack>
              </Progress>
            </div>

            <div className="flex justify-between w-full max-w-[400px] mt-4">
              <span className="text-muted-foreground text-sm font-medium">速度: {pipeline.speed}</span>
              <span className="text-muted-foreground text-sm font-medium">状态: {pipeline.statusText}</span>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center overflow-hidden px-6 box-border mt-[100px]">
      <Disc className="size-16 mb-6" />

      <h2 className="text-2xl font-semibold mb-8 text-center">生成ISO镜像</h2>
      <Button disabled={buttonLoading} onClick={handleStartGenerate}>
        {buttonLoading && <Spinner className="mr-2" />}
        开始生成
      </Button>

      <AlertDialog open={showOldVersion} onOpenChange={setShowOldVersion}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>使用较旧的缓存版本？</AlertDialogTitle>
            <AlertDialogDescription>
              当前处于离线状态，本地缓存为 Cloud-PE v{oldVersionInfo.cached}，而最近一次联网时检测到的最新版本为
              v{oldVersionInfo.latest}。是否继续使用这个较旧的缓存版本生成镜像？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" onClick={handleRejectOldVersion} />}>
              取消
            </AlertDialogClose>
            <Button onClick={handleAcceptOldVersion}>使用旧版本</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
};

export default CreateIsoPage;
