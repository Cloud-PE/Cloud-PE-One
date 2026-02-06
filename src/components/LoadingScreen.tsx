import React, { useState, useEffect, useRef } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useAppContext } from '../utils/AppContext';
import { cacheService } from '../utils/cacheService';

interface LoadingScreenProps {
  onLoadingComplete: () => void;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ onLoadingComplete }) => {
  const { setBootDrive, setNetworkConnected, setIsLoading, setBootDriveVersion } = useAppContext();
  const [loadingText, setLoadingText] = useState<string>('正在启动: 检查环境');
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(false);
  const [showBootDriveModal, setShowBootDriveModal] = useState<boolean>(false);
  const [selectedDriveLetter, setSelectedDriveLetter] = useState<string>('');
  const [bootDrives, setBootDrives] = useState<Array<{ letter: string; isBootDrive: boolean }>>([]);
  const [saveAsDefault, setSaveAsDefault] = useState<boolean>(false);

  // 添加一个ref来跟踪是否已经初始化
  const isInitialized = useRef<boolean>(false);
  // 添加一个ref来跟踪是否正在处理中
  const isProcessing = useRef<boolean>(false);

  useEffect(() => {
    // 如果已经初始化或正在处理中，直接返回
    if (isInitialized.current || isProcessing.current) {
      return;
    }

    const initializeApp = async () => {
      // 标记正在处理
      isProcessing.current = true;

      try {
        // 如果已经是离线模式，跳过网络检查
        if (isOfflineMode) {
          await handleOfflineModeInit();
          return;
        }

        // 初始化缓存服务（包含网络检查）
        setLoadingText('正在启动: 检查网络连接');
        await cacheService.initialize();

        // 从缓存获取网络连接状态
        const isConnected = cacheService.getNetworkConnected();
        setNetworkConnected(isConnected);

        if (!isConnected) {
          setShowErrorModal(true);
          isProcessing.current = false;
          return;
        }

        // 处理启动盘
        await handleBootDriveInit();
      } finally {
        isProcessing.current = false;
      }
    };

    const handleOfflineModeInit = async () => {
      setNetworkConnected(false);
      await handleBootDriveInit();
    };

    const handleBootDriveInit = async () => {
      // 从缓存获取所有启动盘信息
      setLoadingText('正在启动: 检查启动盘');
      const allBootDrives = cacheService.getAllBootDrives();

      if (allBootDrives.length === 0) {
        // 没有检测到启动盘
        setBootDrive(null);
        completeLoading();
      } else if (allBootDrives.length === 1) {
        // 只有一个启动盘，直接使用
        const bootDriveInfo = cacheService.getBootDrive();
        const bootDriveVersion = cacheService.getBootDriveVersion();
        setBootDrive(bootDriveInfo);
        setBootDriveVersion(bootDriveVersion);
        completeLoading();
      } else {
        // 多个启动盘，检查是否有默认选择
        const defaultDriveLetter = localStorage.getItem('defaultBootDrive');
        const defaultDrive = defaultDriveLetter ? allBootDrives.find(d => d.letter === defaultDriveLetter) : undefined;

        if (defaultDrive && defaultDriveLetter) {
          // 使用默认启动盘
          await cacheService.setSelectedBootDrive(defaultDriveLetter);
          const bootDriveInfo = cacheService.getBootDrive();
          const bootDriveVersion = cacheService.getBootDriveVersion();
          setBootDrive(bootDriveInfo);
          setBootDriveVersion(bootDriveVersion);
          completeLoading();
        } else {
          // 显示选择模态框
          setBootDrives(allBootDrives);
          setShowBootDriveModal(true);
          isProcessing.current = false; // 等待用户选择时，解除处理锁
        }
      }
    };

    const completeLoading = () => {
      // 标记已完成初始化
      isInitialized.current = true;

      setLoadingText('正在启动: 加载完成');
      setTimeout(() => {
        setIsLoading(false);
        onLoadingComplete();
      }, 500);
    };

    initializeApp();
  }, []); // 移除所有依赖项，只在组件挂载时执行一次

  // 处理跳过按钮点击
  const handleSkipOffline = async () => {
    setShowErrorModal(false);
    setIsOfflineMode(true);

    // 在离线模式下，设置网络状态为 false 但允许应用继续运行
    setNetworkConnected(false);

    // 标记正在处理
    isProcessing.current = true;

    try {
      // 从缓存获取启动盘信息（离线模式下cacheService已经初始化了本地数据）
      const allBootDrives = cacheService.getAllBootDrives();

      if (allBootDrives.length === 0) {
        setBootDrive(null);
        completeLoadingOffline();
      } else if (allBootDrives.length === 1) {
        const bootDriveInfo = cacheService.getBootDrive();
        const bootDriveVersion = cacheService.getBootDriveVersion();
        setBootDrive(bootDriveInfo);
        setBootDriveVersion(bootDriveVersion);
        completeLoadingOffline();
      } else {
        // 多个启动盘，检查是否有默认选择
        const defaultDriveLetter = localStorage.getItem('defaultBootDrive');
        const defaultDrive = defaultDriveLetter ? allBootDrives.find(d => d.letter === defaultDriveLetter) : undefined;

        if (defaultDrive && defaultDriveLetter) {
          await cacheService.setSelectedBootDrive(defaultDriveLetter);
          const bootDriveInfo = cacheService.getBootDrive();
          const bootDriveVersion = cacheService.getBootDriveVersion();
          setBootDrive(bootDriveInfo);
          setBootDriveVersion(bootDriveVersion);
          completeLoadingOffline();
        } else {
          setBootDrives(allBootDrives);
          setShowBootDriveModal(true);
          isProcessing.current = false; // 等待用户选择时，解除处理锁
        }
      }
    } finally {
      if (!showBootDriveModal) {
        isProcessing.current = false;
      }
    }
  };

  const completeLoadingOffline = () => {
    // 标记已完成初始化
    isInitialized.current = true;
    isProcessing.current = false;

    // 完成加载
    setLoadingText('正在启动: 加载完成');
    setTimeout(() => {
      setIsLoading(false);
      onLoadingComplete();
    }, 500);
  };

  // 处理启动盘选择
  const handleBootDriveSelect = async () => {
    if (!selectedDriveLetter) {
      return;
    }

    if (saveAsDefault) {
      localStorage.setItem('defaultBootDrive', selectedDriveLetter);
    }

    await cacheService.setSelectedBootDrive(selectedDriveLetter);
    const bootDriveInfo = cacheService.getBootDrive();
    const bootDriveVersion = cacheService.getBootDriveVersion();
    setBootDrive(bootDriveInfo);
    setBootDriveVersion(bootDriveVersion);

    setShowBootDriveModal(false);

    // 标记已完成初始化
    isInitialized.current = true;
    isProcessing.current = false;

    // 完成加载
    setLoadingText('正在启动: 加载完成');
    setTimeout(() => {
      setIsLoading(false);
      onLoadingComplete();
    }, 500);
  };

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background">
      <Spinner className="size-8" />
      <p className="mt-4 text-sm text-foreground">{loadingText}</p>

      {/* 网络错误模态框 */}
      <Dialog open={showErrorModal}>
        <DialogPopup showCloseButton={false} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center gap-2">
              <TriangleAlertIcon className="size-6 text-destructive" />
              <span>已离线</span>
            </DialogTitle>
            <DialogDescription>
              未连接互联网，无法使用相关功能。您可以选择关闭应用或进入离线模式。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 px-6 pb-6">
            <Button
              variant="outline"
              onClick={handleSkipOffline}
            >
              进入离线模式
            </Button>
            <Button
              variant="destructive"
              onClick={() => window.close()}
            >
              关闭应用
            </Button>
          </div>
        </DialogPopup>
      </Dialog>

      {/* 启动盘选择模态框 */}
      <Dialog open={showBootDriveModal}>
        <DialogPopup showCloseButton={false} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>您想使用哪个启动盘？</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6">
            <Select
              value={selectedDriveLetter}
              onValueChange={(value) => setSelectedDriveLetter(value as string)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{selectedDriveLetter || "请选择一个启动盘"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {bootDrives.map(drive => (
                  <SelectItem key={drive.letter} value={drive.letter}>
                    {drive.letter}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <div className="mt-5">
              <Label>
                <Checkbox
                  checked={saveAsDefault}
                  onCheckedChange={(checked) => setSaveAsDefault(checked as boolean)}
                />
                把这项选择设为默认值
              </Label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                onClick={handleBootDriveSelect}
                disabled={!selectedDriveLetter}
              >
                继续
              </Button>
            </div>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
};

export default LoadingScreen;
