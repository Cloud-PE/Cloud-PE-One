// 导入真实的Tauri API
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { appConfigDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readTextFile as fsReadTextFile, writeTextFile as fsWriteTextFile, exists as fsExists, mkdir as fsMkdir } from "@tauri-apps/plugin-fs";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";

// 获取当前用户名
export const getCurrentUsername = async (): Promise<string> => {
  try {
    const username = await invoke<string>('get_current_username');
    return username;
  } catch (error) {
    console.error('获取用户名失败:', error);
    return '用户';
  }
};

// 定义通用的命令参数和结果类型，如果你的 invoke 命令有特定类型，可以更精确地定义
type CommandArgs = Record<string, unknown>;
type CommandResult<T> = T;

// 定义驱动器信息类型
export interface DriveInfo {
  letter: string;
  isBootDrive: boolean;
}

// 导出API函数
export const invoke = async <T = unknown>(
  command: string,
  args?: CommandArgs
): Promise<CommandResult<T>> => {
  try {
    return await tauriInvoke(command, args);
  } catch (error) {
    console.error(`调用 ${command} 失败:`, error);
    throw error;
  }
};

// 导出path模块
export const getAppConfigDir = async (): Promise<string> => {
  try {
    return await appConfigDir();
  } catch (error) {
    console.error("获取配置目录失败:", error);
    // 抛出错误而不是返回默认值，让调用者处理
    throw error;
  }
};

// 导出fs模块
export const readTextFile = async (path: string): Promise<string> => {
  try {
    return await fsReadTextFile(path);
  } catch (error) {
    console.error(`读取文件 ${path} 失败:`, error);
    throw error;
  }
};

export const writeTextFile = async (
  path: string,
  content: string
): Promise<void> => {
  try {
    await fsWriteTextFile(path, content);
  } catch (error) {
    console.error(`写入文件 ${path} 失败:`, error);
    throw error;
  }
};

export const exists = async (path: string): Promise<boolean> => {
  try {
    return await fsExists(path);
  } catch (error) {
    console.error(`检查文件 ${path} 是否存在失败:`, error);
    // 抛出错误而不是返回默认值
    throw error;
  }
};

export const createDir = async (
  path: string,
  options?: { recursive: boolean }
): Promise<void> => {
  try {
    await fsMkdir(path, options);
  } catch (error) {
    console.error(`创建目录 ${path} 失败:`, error);
    throw error;
  }
};

// 导出shell模块
export const openUrl = async (url: string): Promise<void> => {
  try {
    await invoke('open_link_os', { url }); 
  } catch (error) {
    console.error(`打开链接 ${url} 失败:`, error);
    // 移除 window.open 回退方案，确保只通过 Tauri 外部打开
    throw error;
  }
};

// 导出window模块
export const minimizeWindow = async (): Promise<void> => {
  try {
    const appWindow = getCurrentWindow();
    await appWindow.minimize();
  } catch (error) {
    console.error("最小化窗口失败:", error);
    throw error; // 抛出错误以便调用者处理
  }
};

export const closeWindow = async (): Promise<void> => {
  try {
    const appWindow = getCurrentWindow();
    await appWindow.close();
  } catch (error) {
    console.error("关闭窗口失败:", error);
    throw error; // 抛出错误以便调用者处理
  }
};

// 读取启动盘版本信息
export const readBootDriveVersion = async (
  driveLetter: string
): Promise<string> => {
  try {
    return await tauriInvoke("read_boot_drive_version", { driveLetter });
  } catch (error) {
    console.error(`读取启动盘版本失败:`, error);
    throw error;
  }
};

// 获取驱动器信息
export const getDriveInfo = async (
  driveLetter: string
): Promise<DriveInfo> => {
  try {
    return await tauriInvoke("get_drive_info", { driveLetter });
  } catch (error) {
    console.error(`获取驱动器信息失败:`, error);
    throw error;
  }
};

// 文件保存对话框
export const saveFileDialog = async (
  defaultFilename: string
): Promise<string | null> => {
  try {
    return await dialogSave({
      defaultPath: `%USERPROFILE%\\Downloads\\${defaultFilename}`, // 示例路径，可能需要根据实际情况调整
      filters: [
        {
          name: "镜像文件",
          extensions: ["iso"],
        },
      ],
    });
  } catch (error) {
    console.error("打开文件保存对话框失败:", error);
    throw error;
  }
};

// 下载文件到指定路径
export const downloadFileToPath = async (
  url: string,
  savePath: string
): Promise<void> => {
  try {
    return await tauriInvoke("download_file_to_path", { url, savePath });
  } catch (error) {
    console.error("下载文件失败:", error);
    throw error;
  }
};