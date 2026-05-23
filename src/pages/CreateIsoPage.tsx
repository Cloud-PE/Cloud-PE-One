import React, { useState, useEffect, useRef } from 'react';
import { Globe, Disc } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { toastManager } from '@/components/ui/toast';
import { cacheService } from '../utils/cacheService';
import { saveFileDialog } from '../utils/tauriApiWrapper';
import {
  downloadFileToPath,
  cancelDownload,
  useDownloadProgress,
} from '../api/downloadApi';
import { useAppContext } from '../utils/AppContext';

const parsePercent = (progress: string): number => {
  const match = progress.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
};

const CreateIsoPage: React.FC = () => {
  const { config, setIsGeneratingIso } = useAppContext();
  const [downloading, setDownloading] = useState(false);
  const [buttonLoading, setButtonLoading] = useState(false);
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

  useEffect(() => {
    if (!downloading) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '当前正在生成ISO镜像，确定要离开吗？';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [downloading]);

  const percent = downloading ? parsePercent(downloadInfo.progress) : 0;

  const handleStartGenerate = async () => {
    if (downloading || buttonLoading) {
      toastManager.add({
        title: '提示',
        description: '已有下载任务在进行中',
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

    const downloadLink = cacheService.getIsoDownloadLink();
    if (!downloadLink) {
      setButtonLoading(false);
      toastManager.add({
        title: '获取下载链接失败',
        description: '无法获取ISO镜像下载链接，请检查网络连接',
        type: 'error',
      });
      return;
    }

    setDownloading(true);
    setIsGeneratingIso(true);

    toastManager.add({
      title: '开始生成ISO镜像',
      description: '镜像生成任务已在后台运行',
      type: 'info',
    });

    try {
      await downloadFileToPath(downloadLink, filePath, config.downloadThreads);
      toastManager.add({
        title: '镜像生成成功！',
        description: `生成镜像已保存至：${filePath}`,
        type: 'success',
      });
    } catch (err) {
      console.error('下载失败:', err);
      toastManager.add({
        title: '下载失败',
        description: err instanceof Error ? err.message : String(err ?? '下载ISO镜像时发生错误'),
        type: 'error',
      });
    } finally {
      setDownloading(false);
      setButtonLoading(false);
      setIsGeneratingIso(false);
    }
  };

  if (downloading) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 box-border mt-[100px]">
        <Globe className="size-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">正在生成ISO镜像</h2>

        <div className="w-full max-w-[400px] mb-6">
          <Progress value={percent}>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium">进度</span>
              <span className="text-sm tabular-nums">{percent.toFixed(1)}%</span>
            </div>
            <ProgressTrack className="h-2">
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
        </div>

        <div className="flex justify-between w-full max-w-[400px] mt-4">
          <span className="text-muted-foreground text-sm font-medium">
            下载速度: {downloadInfo.speed}
          </span>
          <span className="text-muted-foreground text-sm font-medium">
            状态: {downloadInfo.downloading ? '下载中' : '完成'}
          </span>
        </div>
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
    </div>
  );
};

export default CreateIsoPage;
