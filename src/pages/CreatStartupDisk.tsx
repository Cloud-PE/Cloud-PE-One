import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppContext } from '../utils/AppContext';
import { getIsoDownloadLink } from '../api/isoApi';
import {
  downloadFileToPath,
  cancelDownload,
  useDownloadProgress,
} from '../api/downloadApi';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from '@/components/ui/select';
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

const parsePercent = (progress: string): number => {
  const match = progress.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
};

const extractDriveLetter = (name: string): string | null => {
  const match = name.match(/([A-Z]:)/);
  return match ? match[1] : null;
};

const CreateUsbPage: React.FC<CreateUsbPageProps> = ({ onNavigate }) => {
  const { config, setIsCreatingBootDrive, reloadBootDrive } = useAppContext();
  const [currentStep, setCurrentStep] = useState(0);
  const [devices, setDevices] = useState<UsbDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<number | undefined>(undefined);
  const [bootMode, setBootMode] = useState<string>('UEFI');
  const [downloading, setDownloading] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isInstallingVentoy, setIsInstallingVentoy] = useState(false);
  const [isInDeploymentProcess, setIsInDeploymentProcess] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectKey, setSelectKey] = useState(0);
  const [showFirstWarning, setShowFirstWarning] = useState(false);
  const [showSecondWarning, setShowSecondWarning] = useState(false);

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

  const safeInvoke = async <T = any>(command: string, args?: any): Promise<T> => {
    try {
      return await invoke<T>(command, args || {});
    } catch (err) {
      console.error(`命令 ${command} 执行失败:`, err);
      throw err;
    }
  };

  const getUsbDevices = async (): Promise<UsbDevice[]> => {
    setIsLoading(true);
    try {
      const list = await safeInvoke<UsbDevice[]>('get_usb_devices');
      return Array.isArray(list) ? list : [];
    } catch (err) {
      toastManager.add({
        title: '错误',
        description: `获取USB设备列表失败: ${err}`,
        type: 'error',
      });
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const getSystemBootMode = async () => {
    try {
      const mode = await safeInvoke<string>('get_system_boot_mode');
      setBootMode(mode);
    } catch {
      setBootMode('UEFI');
    }
  };

  const refreshDevices = async () => {
    const deviceList = await getUsbDevices();
    setDevices(deviceList);
    setSelectKey((prev) => prev + 1);

    if (selectedDevice !== undefined && !deviceList.some((d) => d.phydrive === selectedDevice)) {
      setSelectedDevice(undefined);
    }

    if (deviceList.length === 0) {
      toastManager.add({
        title: '提示',
        description: '未检测到任何USB设备，请确保U盘已正确连接',
        type: 'warning',
      });
    }
  };

  useEffect(() => {
    if (currentStep === 1) {
      void getSystemBootMode();
    }
  }, [currentStep]);

  const selectedDeviceInfo = devices.find((d) => d.phydrive === selectedDevice);
  const shouldShowBootMode = !selectedDeviceInfo?.skipSelect;

  const resetFlow = () => {
    setDownloading(false);
    setIsDeploying(false);
    setIsInDeploymentProcess(false);
    setIsCreatingBootDrive(false);
    setIsInstallingVentoy(false);
  };

  const handleStartCreate = async () => {
    if (downloadingRef.current) {
      await cancelDownload();
    }
    resetFlow();
    setIsCompleted(false);
    setCurrentStep(1);
    setIsCreatingBootDrive(true);
    await refreshDevices();
  };

  const handleDeploy = () => {
    if (selectedDevice === undefined) {
      toastManager.add({
        title: '提示',
        description: '请先选择一个设备',
        type: 'warning',
      });
      return;
    }
    const info = devices.find((d) => d.phydrive === selectedDevice);
    if (!info) return;
    if (info.skipSelect) {
      void startDeployment();
    } else {
      setShowFirstWarning(true);
    }
  };

  const handleFirstWarningConfirm = () => {
    setShowFirstWarning(false);
    setShowSecondWarning(true);
  };

  const handleSecondWarningConfirm = () => {
    setShowSecondWarning(false);
    void startDeployment();
  };

  const installVentoyIfNeeded = async (skipSelect: boolean): Promise<boolean> => {
    if (skipSelect) return true;

    setIsInstallingVentoy(true);
    try {
      await safeInvoke('install_ventoy', {
        physicalDrive: selectedDevice,
        bootMode,
      });
      setIsInstallingVentoy(false);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      setDevices(await getUsbDevices());
      return true;
    } catch (err) {
      setIsInstallingVentoy(false);
      resetFlow();
      toastManager.add({
        title: 'Ventoy安装失败',
        description: `无法安装Ventoy: ${err}`,
        type: 'error',
      });
      return false;
    }
  };

  const resolveDownloadPath = async (
    skipSelect: boolean,
  ): Promise<{ path: string; drive: string } | null> => {
    const detect = (list: UsbDevice[]) => {
      const info = list.find((d) => d.phydrive === selectedDevice);
      if (!info) return null;
      const drive = extractDriveLetter(info.name);
      return drive ? { path: `${drive}\\Cloud-PE.iso`, drive } : null;
    };

    let found = detect(devices.length > 0 ? devices : await getUsbDevices());
    if (!found && !skipSelect) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      found = detect(await getUsbDevices());
    }
    return found;
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

    setCurrentStep(2);
    setIsInDeploymentProcess(true);
    setIsCreatingBootDrive(true);

    const info = devices.find((d) => d.phydrive === selectedDevice);
    const skipSelect = !!info?.skipSelect;

    if (!(await installVentoyIfNeeded(skipSelect))) return;

    let downloadLink: string;
    try {
      downloadLink = await getIsoDownloadLink();
    } catch (err) {
      console.error('获取下载链接失败:', err);
      resetFlow();
      toastManager.add({
        title: '获取下载链接失败',
        description: '无法获取ISO镜像下载链接，请检查网络连接',
        type: 'error',
      });
      return;
    }

    const target = await resolveDownloadPath(skipSelect);
    if (!target) {
      resetFlow();
      toastManager.add({
        title: '错误',
        description: '软件遇到严重错误，请联系开发者处理',
        type: 'error',
      });
      return;
    }

    setDownloading(true);

    toastManager.add({
      title: '开始部署 Cloud-PE',
      description: `正在下载 Cloud-PE 镜像到: ${target.drive}`,
      type: 'info',
    });

    try {
      await downloadFileToPath(downloadLink, target.path, config.downloadThreads);
      setDownloading(false);
      setIsDeploying(true);
      await performDeploy(target.drive);
    } catch (err) {
      console.error('下载失败:', err);
      resetFlow();
      toastManager.add({
        title: '下载失败',
        description: err instanceof Error ? err.message : String(err ?? '下载ISO镜像时发生错误'),
        type: 'error',
      });
    }
  };

  const performDeploy = async (drive: string) => {
    try {
      const result: any = await safeInvoke('deploy_to_usb', { driveLetter: drive });

      setIsDeploying(false);
      setIsInDeploymentProcess(false);
      setIsCreatingBootDrive(false);
      setIsCompleted(true);

      toastManager.add({
        title: '部署成功',
        description: result?.message || '启动盘制作完成！',
        type: 'success',
      });

      setTimeout(async () => {
        try {
          await reloadBootDrive(drive, true);
          onNavigate('home');
        } catch (err) {
          console.error('自动导航到主页失败:', err);
        }
      }, 1000);
    } catch (err) {
      console.error('部署失败:', err);
      resetFlow();
      toastManager.add({
        title: '部署失败',
        description: `启动盘制作过程中发生错误: ${err}`,
        type: 'error',
      });
    }
  };

  const StepsIndicator = ({ current }: { current: number }) => (
    <div className="flex items-center justify-center gap-4 mb-10 w-full max-w-[600px]">
      <div className="flex items-center gap-2">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
            current >= 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          {current > 0 ? <CheckCircle className="w-4 h-4" /> : '1'}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{current > 0 ? '已完成' : '进行中'}</span>
          <span className="text-xs text-muted-foreground">选择安装设备</span>
        </div>
      </div>
      <div className={`flex-1 h-0.5 ${current > 0 ? 'bg-primary' : 'bg-muted'}`} />
      <div className="flex items-center gap-2">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
            current >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          2
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{current >= 1 ? '进行中' : '等待中'}</span>
          <span className="text-xs text-muted-foreground">部署Cloud-PE</span>
        </div>
      </div>
    </div>
  );

  if (currentStep === 0) {
    return (
      <div className="w-full flex flex-col items-center overflow-hidden px-6 mt-24">
        <Play className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">制作启动盘</h2>
        <Button onClick={handleStartCreate}>开始制作</Button>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="w-full flex flex-col items-center overflow-hidden px-6 mt-24">
        <CheckCircle className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">部署成功</h2>
      </div>
    );
  }

  if (isInDeploymentProcess && isInstallingVentoy) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 mt-12">
        <StepsIndicator current={1} />
        <Spinner className="w-10 h-10 mb-6" />
        <h3 className="text-xl font-semibold mb-8 text-center">正在安装Ventoy中</h3>
      </div>
    );
  }

  if (isInDeploymentProcess && (downloading || isDeploying)) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 mt-12">
        <StepsIndicator current={1} />
        <Globe className="w-16 h-16 mb-6" />
        <h2 className="text-2xl font-semibold mb-8 text-center">部署中</h2>

        <div className="w-full max-w-[400px] mb-6">
          <Progress value={percent}>
            <div className="flex justify-between text-sm mb-2">
              <span>进度</span>
              <span className="text-sm tabular-nums">{percent.toFixed(1)}%</span>
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

  if (isInDeploymentProcess) {
    return (
      <div className="w-full flex flex-col items-center justify-center overflow-hidden px-6 mt-12">
        <StepsIndicator current={1} />
        <Spinner className="w-10 h-10 mb-6" />
        <h3 className="text-xl font-semibold mb-8 text-center">准备部署中...</h3>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center overflow-hidden px-6 mt-12">
      <StepsIndicator current={0} />

      <h3 className="text-xl font-semibold mb-6 text-center">选择要制作启动盘的USB设备</h3>

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
                <SelectValue>{selectedDeviceInfo?.name || '选择USB设备'}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {isLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Spinner className="w-4 h-4" />
                  </div>
                ) : (
                  devices.map((device) => (
                    <SelectItem key={device.phydrive} value={device.phydrive}>
                      {device.name}
                    </SelectItem>
                  ))
                )}
              </SelectPopup>
            </Select>
            <Button variant="ghost" size="icon" onClick={refreshDevices} disabled={isLoading}>
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
          <Button onClick={handleDeploy} disabled={selectedDevice === undefined}>
            立即部署
          </Button>
        </div>
      </div>

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

      <AlertDialog open={showSecondWarning} onOpenChange={setShowSecondWarning}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>警告</AlertDialogTitle>
            <AlertDialogDescription>确认要继续执行这个操作吗？（防误触）</AlertDialogDescription>
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
