import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '../utils/AppContext';
import type { ThemeMode, DownloadThreads } from '../utils/theme';
import { openUrl } from '../utils/tauriApiWrapper';
import { openDevTools } from '../utils/devtools';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardPanel } from '@/components/ui/card';
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from '@/components/ui/accordion';
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from '@/components/ui/select';
import { AlertDialog, AlertDialogPopup, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogClose } from '@/components/ui/alert-dialog';
import { toastManager } from '@/components/ui/toast';
import { Github } from 'lucide-react';

const SettingsPage: React.FC = () => {
  const {
    config,
    updateConfig,
    allBootDrives,
    bootDrive,
    switchBootDrive
  } = useAppContext();
  const [userNickname, setUserNickname] = useState(config.userNickname || '');
  const saveTimeoutRef = useRef<number | null>(null);

  // 新增：启动盘切换相关状态
  const [selectedBootDrive, setSelectedBootDrive] = useState<string>(bootDrive?.letter || '');
  const [showBootDriveModal, setShowBootDriveModal] = useState(false);
  const [pendingBootDrive, setPendingBootDrive] = useState<string>('');

  // 监听配置变化，同步用户称呼
  useEffect(() => {
    setUserNickname(config.userNickname || '');
  }, [config.userNickname]);

  // 监听启动盘变化
  useEffect(() => {
    if (bootDrive?.letter) {
      setSelectedBootDrive(bootDrive.letter);
    }
  }, [bootDrive]);

  // 自定义防抖保存函数
  const debouncedSave = useCallback((nickname: string) => {
    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // 设置新的定时器
    saveTimeoutRef.current = window.setTimeout(async () => {
      if (nickname.trim() && nickname.trim() !== config.userNickname) {
        try {
          await updateConfig({ userNickname: nickname.trim() });
        } catch (error) {
          console.error('保存用户称呼失败:', error);
        }
      }
    }, 500); // 500ms 防抖延迟
  }, [config.userNickname, updateConfig]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleThemeChange = (value: string) => {
    updateConfig({ themeMode: value as ThemeMode });
  };

  const handleThreadsChange = (value: number) => {
    updateConfig({ downloadThreads: value as DownloadThreads });
  };

  const handleWebSearchToggle = (checked: boolean) => {
    updateConfig({ enablePluginWebSearch: checked });
  };

  const handleUserNicknameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUserNickname(value);
    // 如果个性化欢迎语已启用，触发自动保存
    if (config.enablePersonalizedGreeting) {
      debouncedSave(value);
    }
  };

  const handlePersonalizedGreetingToggle = (checked: boolean) => {
    updateConfig({ enablePersonalizedGreeting: checked });
  };


  // 处理启动盘选择变化
  const handleBootDriveChange = async (value: string) => {
    const driveLetter = value;
    if (driveLetter !== bootDrive?.letter) {
      // 检查选择的启动盘是否已经是默认的
      const defaultDriveLetter = localStorage.getItem('defaultBootDrive');

      if (defaultDriveLetter === driveLetter) {
        // 如果已经是默认的，直接切换，不显示模态框
        await switchBootDrive(driveLetter);
        setSelectedBootDrive(driveLetter);

        toastManager.add({
          title: '成功',
          description: `已切换到启动盘 ${driveLetter}`,
          type: 'success',
        });
      } else {
        // 如果不是默认的，显示模态框询问
        setPendingBootDrive(driveLetter);
        setShowBootDriveModal(true);
      }
    }
  };

  // 处理模态框确认
  const handleBootDriveModalOk = async () => {
    if (pendingBootDrive) {
      // 保存为默认启动盘
      localStorage.setItem('defaultBootDrive', pendingBootDrive);

      // 切换启动盘
      await switchBootDrive(pendingBootDrive);
      setSelectedBootDrive(pendingBootDrive);

      toastManager.add({
        title: '成功',
        description: `已切换到启动盘 ${pendingBootDrive}`,
        type: 'success',
      });
    }
    setShowBootDriveModal(false);
    setPendingBootDrive('');
  };

  // 处理模态框取消
  const handleBootDriveModalCancel = async () => {
    if (pendingBootDrive) {
      // 不保存为默认，但仍然切换
      await switchBootDrive(pendingBootDrive);
      setSelectedBootDrive(pendingBootDrive);

      toastManager.add({
        title: '成功',
        description: `已切换到启动盘 ${pendingBootDrive}（未设为默认）`,
        type: 'success',
      });
    }
    setShowBootDriveModal(false);
    setPendingBootDrive('');
  };

  // 这个函数已经存在，用于在外部浏览器打开URL
  const handleOpenLink = async (url: string) => {
    await openUrl(url);
  };

  // 处理打开开发者工具
  const handleOpenDevTools = async () => {
    try {
      await openDevTools();
      toastManager.add({
        title: '成功',
        description: '已成功打开开发人员工具',
        type: 'success',
      });
    } catch (error) {
      toastManager.add({
        title: '失败',
        description: '打开开发人员工具失败',
        type: 'error',
      });
    }
  };

  // 处理测试通知
  const handleTestNotification = () => {
    toastManager.add({
      title: '信息',
      description: '已成功完成此操作',
      type: 'info',
    });
  };


  return (
    <div className="h-[92vh] overflow-auto p-0">
      <div className="p-4 max-w-[800px] mx-auto min-h-[calc(100vh-32px)] box-border">
        <Accordion defaultValue={['client-settings', 'about']} multiple>
          <AccordionItem value="client-settings">
            <AccordionTrigger>客户端设置</AccordionTrigger>
            <AccordionPanel>
              <div className="py-2">
                {/* 用户称呼设置 */}
                <div className="mb-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Label>用户称呼：</Label>
                    <Input
                      value={userNickname}
                      onChange={handleUserNicknameChange}
                      placeholder="请输入您的称呼"
                      className="w-[180px]"
                      maxLength={20}
                      disabled={!config.enablePersonalizedGreeting}
                    />
                  </div>
                </div>

                {/* 启用个性化欢迎语设置 */}
                <div className="mb-4 flex items-center gap-3">
                  <Label>启用个性化欢迎语：</Label>
                  <Switch
                    checked={config.enablePersonalizedGreeting}
                    onCheckedChange={handlePersonalizedGreetingToggle}
                  />
                </div>

                <div className="mb-4 flex items-center gap-3">
                  <Label>下载线程数：</Label>
                  <Select value={config.downloadThreads} onValueChange={(val) => handleThreadsChange(val as number)}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value={8}>8</SelectItem>
                      <SelectItem value={16}>16</SelectItem>
                      <SelectItem value={32}>32</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>

                <div className="mb-4 flex items-center gap-3">
                  <Label>颜色模式：</Label>
                  <Select value={config.themeMode} onValueChange={handleThemeChange}>
                    <SelectTrigger className="w-[120px]">
                      <span className="flex-1 truncate">
                        {config.themeMode === 'system' ? '跟随系统' : config.themeMode === 'light' ? '浅色模式' : '深色模式'}
                      </span>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="system">跟随系统</SelectItem>
                      <SelectItem value="light">浅色模式</SelectItem>
                      <SelectItem value="dark">深色模式</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>

                {/* 新增：启动盘选择（仅在有多个启动盘时显示） */}
                {allBootDrives.length > 1 && (
                  <div className="mb-4 flex items-center gap-3">
                    <Label>使用启动盘：</Label>
                    <Select value={selectedBootDrive} onValueChange={handleBootDriveChange}>
                      <SelectTrigger className="w-[90px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        {allBootDrives.map(drive => (
                          <SelectItem key={drive.letter} value={drive.letter}>
                            {drive.letter}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                )}


                <div className="flex items-center gap-3">
                  <Label>开启插件市场"搜索"按钮：</Label>
                  <Switch
                    checked={config.enablePluginWebSearch}
                    onCheckedChange={handleWebSearchToggle}
                  />
                </div>
              </div>
            </AccordionPanel>
          </AccordionItem>

          <AccordionItem value="about">
            <AccordionTrigger>关于</AccordionTrigger>
            <AccordionPanel>
              <div className="py-3">
                <div className="flex gap-4 mb-4 flex-wrap">
                  <Card className="flex-1 min-w-[300px] h-auto">
                    <CardHeader>
                      <CardTitle>关于 Cloud-PE One</CardTitle>
                    </CardHeader>
                    <CardPanel>
                      <div className="mb-2">
                        <span>由开发者 <strong>dddffgg</strong> 与 <strong>Hello,World!</strong> 共同开发并发布</span>
                      </div>
                      <div className="mb-2">
                        <span className="font-semibold">技术栈:</span>
                        <span> Tauri, Rust, TypeScript, Vite, React, Coss UI</span>
                      </div>
                      <div>
                        <span className="font-semibold">Copyright © 2025-Present Cloud-PE Dev.</span>
                      </div>
                    </CardPanel>
                  </Card>

                  <Card className="flex-1 min-w-[300px] max-h-[180px]">
                    <CardHeader>
                      <CardTitle>相关链接</CardTitle>
                    </CardHeader>
                    <CardPanel>
                      <div className="flex flex-col justify-center items-center h-full gap-2">
                        <span
                          className="cursor-pointer underline text-primary hover:text-primary/80"
                          onClick={() => handleOpenLink('https://cloud-pe.cn/')}
                        >
                          Cloud-PE 官方网站
                        </span>
                        <span
                          className="cursor-pointer underline text-primary hover:text-primary/80"
                          onClick={() => handleOpenLink('https://docs.cloud-pe.cn/')}
                        >
                          相关文档
                        </span>
                        <span
                          className="cursor-pointer underline text-primary hover:text-primary/80"
                          onClick={() => handleOpenLink('https://blog.cloud-pe.cn/')}
                        >
                          dddffggの博客
                        </span>
                      </div>
                    </CardPanel>
                  </Card>
                </div>

                <Card className="mb-4">
                  <CardHeader>
                    <CardTitle>工具</CardTitle>
                  </CardHeader>
                  <CardPanel>
                    <div className="flex gap-3">
                      <Button onClick={handleOpenDevTools}>
                        开发人员工具
                      </Button>
                      <Button onClick={handleTestNotification}>
                        测试
                      </Button>
                    </div>
                  </CardPanel>
                </Card>

                <Card className="mb-4">
                  <CardHeader>
                    <CardTitle>开源</CardTitle>
                  </CardHeader>
                  <CardPanel>
                    <div className="mb-2">
                      开源协议：Apache 2.0
                    </div>
                    <div className="mt-3">
                      <Button
                        onClick={() => handleOpenLink('https://github.com/Cloud-PE/Cloud-PE-One')}
                      >
                        <Github className="size-4 mr-2" />
                        在 GitHub 上浏览
                      </Button>
                    </div>
                  </CardPanel>
                </Card>
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>

        {/* 启动盘切换确认模态框 */}
        <AlertDialog open={showBootDriveModal} onOpenChange={setShowBootDriveModal}>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>切换启动盘</AlertDialogTitle>
              <AlertDialogDescription>
                是否将此启动盘设置为默认启动盘？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose>
                <Button variant="outline" onClick={handleBootDriveModalCancel}>
                  否
                </Button>
              </AlertDialogClose>
              <Button onClick={handleBootDriveModalOk}>
                是
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </div>
    </div>
  );
};

export default SettingsPage;
