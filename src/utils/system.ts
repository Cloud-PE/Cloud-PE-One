import { invoke } from '@tauri-apps/api/core';

// 检查启动盘
export interface DriveInfo {
  letter: string;
  isBootDrive: boolean;
}

export const checkBootDrive = async (): Promise<DriveInfo | null> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await invoke('check_boot_drive') as any;
    if (result) {
      // 转换字段名称以匹配前端接口
      return {
        letter: result.letter,
        isBootDrive: result.is_boot_drive
      };
    }
    return null;
  } catch (error) {
    console.error('启动盘检查失败:', error);
    return null;
  }
};

// 检查Mica效果支持
export const checkMicaSupport = async (): Promise<boolean> => {
  try {
    const isSupported = await invoke('check_mica_support') as boolean;
    console.log('Mica效果支持状态:', isSupported);
    return isSupported;
  } catch (error) {
    console.error('检测Mica效果支持失败:', error);
    // 出错时默认不支持
    return false;
  }
};

// 检查是否已开启透明效果
export const checkTransparencyEnabled = async (): Promise<boolean> => {
  try {
    const isSupported = await invoke('check_transparency_enabled') as boolean;
    console.log('透明效果支持状态:', isSupported);
    return isSupported;
  } catch (error) {
    console.error('检测透明效果开启失败:', error);
    // 出错时默认不支持
    return false;
  }
};

// 获取所有驱动器
export const getAllDrives = async (): Promise<string[]> => {
  try {
    return await invoke('get_all_drives') as string[];
  } catch (error) {
    console.error('获取驱动器列表失败:', error);
    return [];
  }
};

// 退出应用
export const exitApp = async (): Promise<void> => {
  try {
    await invoke('exit_app');
  } catch (error) {
    console.error('退出应用失败:', error);
  }
};

// 打开开发者工具
export const openDevTools = async (): Promise<void> => {
  try {
    await invoke('open_devtools');
  } catch (error) {
    console.error('打开开发者工具失败:', error);
  }
};