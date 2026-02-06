import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppContext } from '../utils/AppContext';
import { getIsoDownloadLink } from '../api/isoApi';
import { downloadFileToPath, getDownloadInfo, DownloadInfo } from '../api/downloadApi';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress';
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from '@/components/ui/select';
import { RadioGroup, Radio } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
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
import { RefreshCw, Globe, Play } from 'lucide-react';
import CheckCircle from '@/components/icon/CheckCircle';

interface UsbDevice {
  phydrive: number;
  name: string;
  skipSelect: boolean;
}

interface CreateUsbPageProps {
  onNavigate: (page: string) => void;
}

const CreateUsbPage: React.FC<CreateUsbPageProps> = ({ onNavigate }) => {
  const { config, setIsCreatingBootDrive, reloadBootDrive } = useAppContext();
  const [currentStep, setCurrentStep] = useState(0);
  const [devices, setDevices] = useState<UsbDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<number | undefined>(undefined);
  const [bootMode, setBootMode] = useState<string>('UEFI');
  const [downloading, setDownloading] = useState<boolean>(false);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [selectedDrive, setSelectedDrive] = useState<string>('');
  const [isInstallingVentoy, setIsInstallingVentoy] = useState(false);
  const [isInDeploymentProcess, setIsInDeploymentProcess] = useState(false);

  const [downloadInfo, setDownloadInfo] = useState<DownloadInfo>({
    progress: "0%",
    speed: "0.00MB/s",
    downloading: false,
  });
  const [isCompleted, setIsCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const downloadingRef = useRef<boolean>(false);
  const completeHandledRef = useRef<boolean>(false);
  const maxProgressRef = useRef<number>(0);

  const [selectKey, setSelectKey] = useState(0);

  // Warning dialog states
  const [showFirstWarning, setShowFirstWarning] = useState(false);
  const [showSecondWarning, setShowSecondWarning] = useState(false);

  useEffect(() => {
    downloadingRef.current = downloading;
  }, [downloading]);

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

  const cancelDownload = async () => {
    try {
      console.log('取消下载任务...');
     
      setDownloading(false);
      setIsDeploying(false);
      setIsInDeploymentProcess(false);
      downloadingRef.current = false;
      completeHandledRef.current = false;
      maxProgressRef.current = 0;
      setDownloadInfo({
        progress: "0%",
        speed: "0.00MB/s",
        downloading: false,
      });
    } catch (error) {
      console.error('取消下载失败:', error);
    }
  };

  useEffect(() => {
    return () => {
      if (downloadingRef.current) {
        cancelDownload();
      }
    };
  }, []);

  useEffect(() => {
    if (!downloading) {
      completeHandledRef.current = false;
      maxProgressRef.current = 0;
      return;
    }

    let intervalId: number | null = null;

    const checkProgress = async () => {
      try {
        const info = await getDownloadInfo();
        console.log('轮询获取到的信息:', info);

        const progressMatch = info.progress.match(/(\d+(?:\.\d+)?)/);
        const currentProgress = progressMatch ? parseFloat(progressMatch[1]) : 0;

        if (currentProgress >= maxProgressRef.current) {
          maxProgressRef.current = currentProgress;
          setDownloadInfo(info);
        } else {
          setDownloadInfo({
            ...info,
            progress: `${maxProgressRef.current.toFixed(1)}%`
          });
        }

        if (!completeHandledRef.current &&
            info.progress === "100%" &&
            !info.downloading &&
            downloadingRef.current) {

          console.log('检测到下载完成，执行完成逻辑');
          completeHandledRef.current = true;

          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }

          setTimeout(() => {
            setDownloading(false);
            setIsDeploying(true);
            performDeploy();
          }, 100);
        }
      } catch (error) {
        console.error("获取下载信息失败:", error);
      }
    };

    checkProgress();

    intervalId = window.setInterval(checkProgress, 500);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [downloading]);

  const getUsbDevices = async (): Promise<UsbDevice[]> => {
    try {
      setIsLoading(true);
      const devices = await safeTauriInvoke('get_usb_devices');
      console.log('获取到USB设备:', devices);
      return Array.isArray(devices) ? devices : [];
    } catch (error) {
      console.error('获取USB设备列表失败:', error);
      toastManager.add({
        title: '错误',
        description: `获取USB设备列表失败: ${error}`,
        type: 'error',
      });
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const getSystemBootMode = async () => {
    try {
      const mode = await safeTauriInvoke('get_system_boot_mode');
      console.log('系统引导方式:', mode);
      setBootMode(mode);
    } catch (error) {
      console.error('获取系统引导方式失败:', error);
      setBootMode('UEFI');
    }
  };

  const refreshDevices = async () => {
    try {
      const deviceList = await getUsbDevices();
      setDevices(deviceList);

      setSelectKey(prevKey => prevKey + 1);

      if (selectedDevice !== undefined) {
        const deviceStillExists = deviceList.some(d => d.phydrive === selectedDevice);
        if (!deviceStillExists) {
          setSelectedDevice(undefined);
        }
      }

      if (deviceList.length === 0) {
        toastManager.add({
          title: '提示',
          description: '未检测到任何USB设备，请确保U盘已正确连接',
          type: 'warning',
        });
      }
    } catch (error) {
      console.error('刷新设备列表失败:', error);
    }
  };

  useEffect(() => {
    if (currentStep === 1) {
      getSystemBootMode();
    }
  }, [currentStep]);

  const selectedDeviceInfo = devices.find(d => d.phydrive === selectedDevice);
  const shouldShowBootMode = !selectedDeviceInfo?.skipSelect;

  const handleStartCreate = async () => {
    if (downloadingRef.current || isDeploying) {
      await cancelDownload();
    }

    setIsCompleted(false);
    setCurrentStep(1);
    setIsCreatingBootDrive(true);
    setIsInDeploymentProcess(false);
    await refreshDevices();
  };

  const getProgressPercent = (): number => {
    const match = downloadInfo.progress.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  };

  const handleDeploy = async () => {
    if (selectedDevice === undefined) {
      toastManager.add({
        title: '提示',
        description: '请先选择一个设备',
        type: 'warning',
      });
      return;
    }

    const selectedDeviceInfo = devices.find(d => d.phydrive === selectedDevice);
    if (!selectedDeviceInfo) return;

    if (!selectedDeviceInfo.skipSelect) {
      setShowFirstWarning(true);
    } else {
      startDeployment();
    }
  };

  const handleFirstWarningConfirm = () => {
    setShowFirstWarning(false);
    setShowSecondWarning(true);
  };

  const handleSecondWarningConfirm = () => {
    setShowSecondWarning(false);
    startDeployment();
  };

  const startDeployment = async () => {
    if (downloading) {
      toastManager.add({
        title: '提示',
        description: '已有下载任务在进行中',
        type: 'warning',
      });
      return;
    }

    await cancelDownload();

    setCurrentStep(2);
    setIsInDeploymentProcess(true);

    try {
      console.log('开始部署流程...');
      console.log('选择的设备 phydrive:', selectedDevice);

      const selectedDeviceInfo = devices.find(d => d.phydrive === selectedDevice);

      if (!selectedDeviceInfo?.skipSelect) {
        setIsInstallingVentoy(true);

        try {
          console.log('开始安装Ventoy...');
          console.log('引导方式:', bootMode);

          await safeTauriInvoke('install_ventoy', {
            physicalDrive: selectedDevice,
            bootMode: bootMode
          });

          console.log('Ventoy安装完成');
          setIsInstallingVentoy(false);

          await new Promise(resolve => setTimeout(resolve, 3000));

          const latestDevices = await getUsbDevices();
          setDevices(latestDevices);

        } catch (ventoyError) {
          console.error('Ventoy安装失败:', ventoyError);
          setIsInstallingVentoy(false);
          setIsInDeploymentProcess(false);
          setIsCreatingBootDrive(false);

          toastManager.add({
            title: 'Ventoy安装失败',
            description: `无法安装Ventoy: ${ventoyError}`,
            type: 'error',
          });
          return;
        }
      }

      console.log('获取下载链接...');
      let downloadLink: string;
      try {
        downloadLink = await getIsoDownloadLink();
        console.log('下载链接获取成功:', downloadLink);
      } catch (linkError) {
        console.error('获取下载链接失败:', linkError);
        setIsInDeploymentProcess(false);
        setIsCreatingBootDrive(false);

        toastManager.add({
          title: '获取下载链接失败',
          description: '无法获取ISO镜像下载链接，请检查网络连接',
          type: 'error',
        });
        return;
      }

      let downloadPath: string = "";
      let driveLetter: string = '';

      const currentDevices = devices.length > 0 ? devices : await getUsbDevices();
      const currentDeviceInfo = currentDevices.find(d => d.phydrive === selectedDevice);

      if (currentDeviceInfo) {
        const driveMatch = currentDeviceInfo.name.match(/([A-Z]:)/);
        if (driveMatch) {
          driveLetter = driveMatch[1];
          downloadPath = `${driveLetter}\\Cloud-PE.iso`;
          console.log('设备下载路径:', downloadPath);
        }
      }

      if (!downloadPath) {
        if (!selectedDeviceInfo?.skipSelect) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const retryDevices = await getUsbDevices();
          const retryDeviceInfo = retryDevices.find(d => d.phydrive === selectedDevice);

          if (retryDeviceInfo) {
            const driveMatch = retryDeviceInfo.name.match(/^([A-Z]:)/);
            if (driveMatch) {
              driveLetter = driveMatch[1];
              downloadPath = `${driveLetter}\\Cloud-PE.iso`;
              console.log('重试后获取到下载路径:', downloadPath);
            }
          }
        }

        if (!downloadPath) {
          setIsInDeploymentProcess(false);
          toastManager.add({
            title: '错误',
            description: '软件遇到严重错误，请联系开发者处理',
            type: 'error',
          });
          return;
        }
      }

      setSelectedDrive(driveLetter);
      completeHandledRef.current = false;
      maxProgressRef.current = 0;

      setDownloading(true);
      setIsCreatingBootDrive(true);

      setDownloadInfo({
        progress: "0%",
        speed: "0.00MB/s",
        downloading: true
      });

      toastManager.add({
        title: '开始部署 Cloud-PE',
        description: `正在下载 Cloud-PE 镜像到: ${driveLetter}`,
        type: 'info',
      });

      try {
        await downloadFileToPath(
          downloadLink,
          downloadPath,
          config.downloadThreads
        );
        console.log('downloadFileToPath 调用完成');
      } catch (error) {
        console.error('下载失败:', error);

        setDownloading(false);
        setIsDeploying(false);
        setIsInDeploymentProcess(false);
        setIsCreatingBootDrive(false);
        setSelectedDrive('');
        maxProgressRef.current = 0;

        toastManager.add({
          title: '下载失败',
          description: error instanceof Error ? error.message : '下载ISO镜像时发生错误',
          type: 'error',
        });
      }

    } catch (error) {
      console.error('部署失败 - 未预期的错误:', error);
      setDownloading(false);
      setIsDeploying(false);
      setIsInDeploymentProcess(false);
      setIsCreatingBootDrive(false);
      setIsInstallingVentoy(false);

      toastManager.add({
        title: '部署失败',
        description: '部署过程中发生未知错误，请重试',
        type: 'error',
      });
    }
  };

  const performDeploy = async () => {
    try {
      console.log("选择的盘符：", selectedDrive);
      const result = await safeTauriInvoke('deploy_to_usb', {
        driveLetter: selectedDrive
      });

      setIsDeploying(false);
      setIsInDeploymentProcess(false);
      setIsCreatingBootDrive(false);
      setIsCompleted(true);

      const successMessage = result.message || '启动盘制作完成！';

      toastManager.add({
        title: '部署成功',
        description: successMessage,
        type: 'success',
      });

      setTimeout(async () => {
        try {
          await reloadBootDrive(selectedDrive, true);
          onNavigate('home');
        } catch (error) {
          console.error('自动导航到主页失败:', error);
          setIsCompleted(true);
        }
      }, 1000);

    } catch (error) {
      console.error('部署失败:', error);

      setIsDeploying(false);
      setIsInDeploymentProcess(false);
      setIsCreatingBootDrive(false);

      toastManager.add({
        title: '部署失败',
        description: `启动盘制作过程中发生错误: ${error}`,
        type: 'error',
      });
    }
  };

  // Steps component
  const StepsIndicator = ({ current }: { current: number }) => (
    <div className="flex items-center justify-center gap-4 mb-10 w-full max-w-[600px]">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
          current >= 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}>
          {current > 0 ? <CheckCircle className="w-4 h-4" /> : '1'}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{current > 0 ? '已完成' : '进行中'}</span>
          <span className="text-xs text-muted-foreground">选择安装设备</span>
        </div>
      </div>
      <div className={`flex-1 h-0.5 ${current > 0 ? 'bg-primary' : 'bg-muted'}`} />
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
          current >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}>
          2
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{current >= 1 ? '进行中' : '等待中'}</span>
          <span className="text-xs text-muted-foreground">部署Cloud-PE</span>
        </div>
      </div>
    </div>
  );

  // 初始页面
  if (currentStep === 0) {
    return (
      <div className="w-full flex flex-col items-center overflow-hidden px-6 mt-24">
        <Play className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">制作启动盘</h2>
        <Button onClick={handleStartCreate}>
          开始制作
        </Button>
      </div>
    );
  }

  // 完成页面
  if (isCompleted) {
    return (
      <div className="w-full flex flex-col items-center overflow-hidden px-6 mt-24">
        <CheckCircle className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">部署成功</h2>
      </div>
    );
  }

  // 正在安装Ventoy
  if (isInDeploymentProcess && isInstallingVentoy) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 mt-12">
        <StepsIndicator current={1} />
        <Spinner className="w-10 h-10 mb-6" />
        <h3 className="text-xl font-semibold mb-8 text-center">
          正在安装Ventoy中
        </h3>
      </div>
    );
  }

  // 正在下载或部署
  if (isInDeploymentProcess && (downloading || isDeploying)) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 mt-12">
        <StepsIndicator current={1} />
        <Globe className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">部署中</h2>

        <div className="w-full max-w-[400px] mb-6">
          <Progress value={getProgressPercent()}>
            <div className="flex justify-between text-sm mb-2">
              <span>进度</span>
              <span className="text-sm tabular-nums">{(getProgressPercent() ?? 0).toFixed(1)}%</span>
            </div>
            <ProgressTrack className="h-2">
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
        </div>

        <div className="flex justify-between w-full max-w-[400px] mt-4">
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

  // 部署流程中的等待状态
  if (isInDeploymentProcess) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 mt-12">
        <StepsIndicator current={1} />
        <Spinner className="w-10 h-10 mb-6" />
        <h3 className="text-xl font-semibold mb-8 text-center">
          准备部署中...
        </h3>
      </div>
    );
  }

  // 选择设备步骤页面
  return (
    <div className="w-full flex flex-col items-center overflow-hidden px-6 mt-12">
      <StepsIndicator current={0} />

      <h3 className="text-xl font-semibold mb-6 text-center">
        选择要制作启动盘的USB设备
      </h3>

      <div className="w-full max-w-[500px]">
        <div className="mb-6">
          <div className="flex items-center mb-4 gap-3">
            <Label className="text-sm font-medium">设备：</Label>
            <Select
              key={selectKey}
              value={selectedDevice}
              onValueChange={(value) => setSelectedDevice(value as number)}
            >
              <SelectTrigger className="flex-1">
                <SelectValue>{selectedDeviceInfo?.name || "选择USB设备"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {isLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Spinner className="w-4 h-4" />
                  </div>
                ) : (
                  devices.map(device => (
                    <SelectItem key={device.phydrive} value={device.phydrive}>
                      {device.name}
                    </SelectItem>
                  ))
                )}
              </SelectPopup>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={refreshDevices}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {selectedDeviceInfo?.skipSelect && (
            <p className="text-sm text-muted-foreground mb-4">
              检测到当前设备已安装Ventoy，将直接部署 Cloud-PE 镜像到设备根目录
            </p>
          )}

          {shouldShowBootMode && (
            <div className="flex items-center gap-3 mb-2">
              <Label className="text-sm font-medium">引导方式：</Label>
              <RadioGroup
                value={bootMode}
                onValueChange={(value) => setBootMode(value as string)}
                className="flex flex-row gap-4"
              >
                <div className="flex items-center gap-2">
                  <Radio value="MBR" />
                  <Label>MBR</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Radio value="UEFI" />
                  <Label>UEFI</Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>

        {devices.length === 0 && !isLoading && (
          <p className="text-sm text-yellow-600 mb-6">
            未检测到任何USB设备，请确保U盘已正确连接并点击刷新按钮
          </p>
        )}

        <div className="flex gap-3 justify-center">
          <Button
            onClick={handleDeploy}
            disabled={selectedDevice === undefined}
          >
            立即部署
          </Button>
        </div>
      </div>

      {/* First Warning Dialog */}
      <AlertDialog open={showFirstWarning} onOpenChange={setShowFirstWarning}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>警告</AlertDialogTitle>
            <AlertDialogDescription>
              这个操作将使您U盘内所有的数据被清空，确定要继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>取消</AlertDialogClose>
            <Button variant="destructive" onClick={handleFirstWarningConfirm}>
              确定
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {/* Second Warning Dialog */}
      <AlertDialog open={showSecondWarning} onOpenChange={setShowSecondWarning}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>警告</AlertDialogTitle>
            <AlertDialogDescription>
              确认要继续执行这个操作吗？（防误触）
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>取消</AlertDialogClose>
            <Button variant="destructive" onClick={handleSecondWarningConfirm}>
              确定
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
};

export default CreateUsbPage;
