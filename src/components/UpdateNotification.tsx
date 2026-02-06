import React, { useState } from 'react';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertCircle, PartyPopper, Frown } from 'lucide-react';
import { invoke } from '../utils/tauriApiWrapper';
import ReactMarkdown from 'react-markdown';

interface UpdateNotificationProps {
  visible: boolean;
  onClose: () => void;
  version: string;
  updateLog: string;
  downloadLink: string;
  appExecutableName: string;
  canSkip: boolean;
}

const UpdateNotification: React.FC<UpdateNotificationProps> = ({
  visible,
  onClose,
  version,
  updateLog,
  downloadLink,
  appExecutableName,
  canSkip
}) => {
  const [downloading, setDownloading] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [, setDownloadSpeed] = useState<string>('0.00');
  const [error, setError] = useState<string | null>(null);

  // 处理更新按钮点击
  const handleUpdate = async () => {
    try {
      setDownloading(true);
      setError(null);

      // 调用Rust下载函数，并将返回值保存到script_path变量
      const script_path: string = await invoke('download_update', {
        url: downloadLink,
        appName: appExecutableName
      });

      // 启动下载进度监控
      const progressInterval = setInterval(async () => {
        try {
          const status = await invoke('get_app_download_status');
          if (status) {
            const { progress, speed } = status as { progress: number; speed: string };
            setDownloadProgress(progress);
            setDownloadSpeed(speed);

            // 如果下载完成，清除定时器
            if (progress === 100) {
              clearInterval(progressInterval);
              // 下载完成后，调用安装函数，传入scriptPath参数
              await invoke('install_update', {
                scriptPath: script_path
              });
              // 安装后应用会重启，不需要额外处理
            }
          }
        } catch (err) {
          console.error('获取下载状态失败:', err);
        }
      }, 1000);

    } catch (err) {
      console.error('更新失败:', err);
      setError('更新过程中出现错误，请稍后重试。');
      setDownloading(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem("skippedUpdateVersion", version);
    onClose();
  };

  // 格式化更新日志，处理换行符（Markdown需要双换行才能换行）
  const formattedUpdateLog = updateLog.split('\\n').join('\n').split('\n').join('\n\n');

  return (
    <Dialog open={visible} onOpenChange={canSkip ? onClose : undefined}>
      <DialogPopup className="max-w-[500px]" showCloseButton={canSkip}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {canSkip ? (
              <>
                <PartyPopper className="w-5 h-5 flex-shrink-0" />
                Cloud-PE One 有可用的更新，是否立即升级？
              </>
            ) : (
              <>
                <Frown className="w-6 h-6 flex-shrink-0" />
                <span className="text-base">看起来您目前所使用的 Cloud-PE One 版本已被放弃，请立即升级至新版本以继续使用该软件</span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 px-6">
          <p className="mb-4 text-sm">发现新版本: Cloud-PE One {version}</p>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {formattedUpdateLog.trim() && (
            <div className="max-h-[300px] overflow-y-auto border border-border rounded p-4">
              <h6 className="text-base font-semibold mb-2">更新日志:</h6>
              <div className="prose prose-xs max-w-none dark:prose-invert text-sm">
                <ReactMarkdown>{formattedUpdateLog}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {canSkip && !downloading && (
            <Button variant="ghost" onClick={handleSkip}>
              跳过此版本
            </Button>
          )}
          {canSkip && !downloading && (
            <Button variant="ghost" onClick={onClose}>
              稍后再说
            </Button>
          )}
          <Button
            onClick={handleUpdate}
            disabled={downloading}
          >
            {downloading ? `正在更新 (${downloadProgress}%)` : '立即升级'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

export default UpdateNotification;
