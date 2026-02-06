import React, { useState, useEffect, useRef } from 'react';
import { Globe, Disc } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { toastManager } from '@/components/ui/toast';
import { cacheService } from '../utils/cacheService';
import { saveFileDialog } from '../utils/tauriApiWrapper';
import { downloadFileToPath, getDownloadInfo, DownloadInfo } from '../api/downloadApi';
import { useAppContext } from '../utils/AppContext';

const CreateIsoPage: React.FC = () => {
  const { config, setIsGeneratingIso } = useAppContext();
  const [downloading, setDownloading] = useState<boolean>(false);
  const [buttonLoading, setButtonLoading] = useState<boolean>(false);
  const [downloadInfo, setDownloadInfo] = useState<DownloadInfo>({
    progress: "0%",
    speed: "0.00MB/s",
    downloading: false,
  });
  const [savePath, setSavePath] = useState<string>('');

  // 使用 ref 来存储最新的状态，避免闭包问题
  const downloadingRef = useRef<boolean>(false);
  const savePathRef = useRef<string>('');
  const completeHandledRef = useRef<boolean>(false);

  // 新增：记录最高进度，防止进度倒退
  const maxProgressRef = useRef<number>(0);

  // 更新 ref 当状态改变时
  useEffect(() => {
    downloadingRef.current = downloading;
  }, [downloading]);

  useEffect(() => {
    savePathRef.current = savePath;
  }, [savePath]);

  // 单一的轮询 effect，处理所有逻辑
  useEffect(() => {
    if (!downloading) {
      completeHandledRef.current = false;
      maxProgressRef.current = 0; // 重置最大进度
      return;
    }

    let intervalId: number | null = null;

    const checkProgress = async () => {
      try {
        const info = await getDownloadInfo();
        console.log('轮询获取到的信息:', info);

        // 解析当前进度
        const progressMatch = info.progress.match(/(\d+(?:\.\d+)?)/);
        const currentProgress = progressMatch ? parseFloat(progressMatch[1]) : 0;

        // 确保进度不会倒退
        if (currentProgress >= maxProgressRef.current) {
          maxProgressRef.current = currentProgress;
          setDownloadInfo(info);
        } else {
          // 如果新进度小于最大进度，保持最大进度但更新其他信息
          setDownloadInfo({
            ...info,
            progress: `${maxProgressRef.current.toFixed(1)}%`
          });
        }

        // 检查是否完成
        if (!completeHandledRef.current &&
            info.progress === "100%" &&
            !info.downloading &&
            downloadingRef.current) {

          console.log('检测到下载完成，执行完成逻辑');
          completeHandledRef.current = true; // 防止重复执行

          // 清除定时器
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }

          // 执行完成逻辑
          setTimeout(() => {
            setDownloading(false);
            setButtonLoading(false);
            setIsGeneratingIso(false);

            toastManager.add({
              title: '镜像生成成功！',
              description: `生成镜像已保存至：${savePathRef.current}`,
              type: 'success'
            });
          }, 100);
        }
      } catch (error) {
        console.error("获取下载信息失败:", error);
      }
    };

    // 立即执行一次
    checkProgress();

    // 设置定时器
    intervalId = window.setInterval(checkProgress, 500);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [downloading, setIsGeneratingIso]);

  // 处理窗口关闭和页面切换事件
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (downloading) {
        e.preventDefault();
        e.returnValue = '当前正在生成ISO镜像，确定要离开吗？';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [downloading]);

  // 获取进度百分比数值
  const getProgressPercent = (): number => {
    const match = downloadInfo.progress.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  };

  const handleStartGenerate = async () => {
    if (downloading || buttonLoading) {
      toastManager.add({
        title: '提示',
        description: '已有下载任务在进行中',
        type: 'warning'
      });
      return;
    }

    setButtonLoading(true);

    try {
      // 打开文件保存对话框
      const filePath = await saveFileDialog('Cloud-PE.iso');
      if (!filePath) {
        setButtonLoading(false);
        return;
      }

      // 从缓存获取下载链接
      const downloadLink = cacheService.getIsoDownloadLink();

      if (!downloadLink) {
        setButtonLoading(false);
        toastManager.add({
          title: '获取下载链接失败',
          description: '无法获取ISO镜像下载链接，请检查网络连接',
          type: 'error'
        });
        return;
      }

      // 设置下载状态，初始就显示下载中
      setSavePath(filePath);
      setDownloading(true);
      setIsGeneratingIso(true);
      completeHandledRef.current = false;
      maxProgressRef.current = 0;

      // 立即设置初始下载状态，确保显示"下载中"
      setDownloadInfo({
        progress: "0%",
        speed: "0.00MB/s",
        downloading: true  // 确保初始状态是下载中
      });

      // 显示开始通知
      toastManager.add({
        title: '开始生成ISO镜像',
        description: '镜像生成任务已在后台运行',
        type: 'info'
      });

      // 开始下载
      try {
        await downloadFileToPath(
          downloadLink,
          filePath,
          config.downloadThreads
        );
        console.log('downloadFileToPath 调用完成');
      } catch (error) {
        console.error('下载失败:', error);

        // 重置状态
        setDownloading(false);
        setButtonLoading(false);
        setIsGeneratingIso(false);
        setSavePath('');
        maxProgressRef.current = 0;

        toastManager.add({
          title: '下载失败',
          description: error instanceof Error ? error.message : '下载ISO镜像时发生错误',
          type: 'error'
        });
      }

    } catch (error) {
      console.error('生成ISO镜像失败:', error);
      setButtonLoading(false);
      setDownloading(false);
      setIsGeneratingIso(false);

      toastManager.add({
        title: '生成失败',
        description: '生成ISO镜像时发生未知错误，请重试',
        type: 'error'
      });
    }
  };

  if (downloading) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 box-border mt-[100px]">
        <Globe className="size-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">正在生成ISO镜像</h2>

        <div className="w-full max-w-[400px] mb-6">
          <Progress value={getProgressPercent()}>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium">进度</span>
              <span className="text-sm tabular-nums">{getProgressPercent().toFixed(1)}%</span>
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
      <Button
        disabled={buttonLoading}
        onClick={handleStartGenerate}
      >
        {buttonLoading && <Spinner className="mr-2" />}
        开始生成
      </Button>
    </div>
  );
};

export default CreateIsoPage;
