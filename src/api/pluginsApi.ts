import axios from 'axios';
import { invoke } from '@tauri-apps/api/core';

// 插件信息接口
export interface Plugin {
  name: string;
  size: string;
  version: string;
  author: string;
  describe: string;
  file: string;
  link: string;
  id?: string;
}

// 插件分类接口
export interface PluginCategory {
  class: string;
  list: Plugin[];
}

// 插件API响应接口
export interface PluginsResponse {
  code: number;
  message: string;
  data: PluginCategory[];
}

// 生成插件唯一ID
export const generatePluginId = (name: string, author: string): string => {
  return `${name}|${author}`;
};

// 版本比较函数
export const compareVersions = (version1: string, version2: string): number => {
  const v1 = version1.replace(/^v/i, '').split('.').map(Number);
  const v2 = version2.replace(/^v/i, '').split('.').map(Number);
  
  const maxLength = Math.max(v1.length, v2.length);
  
  for (let i = 0; i < maxLength; i++) {
    const num1 = v1[i] || 0;
    const num2 = v2[i] || 0;
    
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  
  return 0;
};

// 获取插件列表（移除缓存）
export const getPlugins = async (): Promise<PluginCategory[]> => {
  const url = 'https://api.cloud-pe.cn/GetPlugins/';
  
  try {
    const response = await axios.get<PluginsResponse>(url);
    return response.data.data;
  } catch (error) {
    console.error('获取插件列表失败:', error);
    throw new Error('获取插件列表失败');
  }
};

// 下载插件
export const downloadPlugin = async (
  url: string,
  fileName: string,
  bootDriveLetter: string | null,
  threads: number = 8
): Promise<string> => {
  try {
    // 构建下载路径 - 使用启动盘盘符 + \\ce-apps
    const downloadPath = `${bootDriveLetter}\\ce-apps`;
    
    console.log('下载路径:', downloadPath);
    console.log('开始下载插件:', { url, fileName, downloadPath, threads });

    // 开始下载，传递线程数
    const filePath = await invoke('download_plugin', {
      url,
      path: downloadPath,
      fileName,
      threads
    });
    
    return filePath as string;
  } catch (error) {
    console.error('下载插件失败:', error);
    throw new Error(`下载插件失败: ${error}`);
  }
};

// 更新插件
export const updatePlugin = async (
  url: string,
  oldFileName: string,
  newFileName: string,
  bootDriveLetter: string | null,
  threads: number = 8
): Promise<string> => {
  try {
    // 构建下载路径 - 使用启动盘盘符 + \\ce-apps
    const downloadPath = `${bootDriveLetter}\\ce-apps`;
    
    console.log('更新插件:', { url, oldFileName, newFileName, downloadPath, threads });

    // 调用更新命令
    const filePath = await invoke('update_plugin', {
      url,
      path: downloadPath,
      oldFileName,
      newFileName,
      threads
    });
    
    return filePath as string;
  } catch (error) {
    console.error('更新插件失败:', error);
    throw new Error(`更新插件失败: ${error}`);
  }
};

// 获取插件文件列表
export const getPluginFiles = async (driveLetter: string): Promise<{enabled: Plugin[], disabled: Plugin[]}> => {
  try {
    const result = await invoke('get_plugin_files', {
      driveLetter
    }) as {
      enabled: Plugin[],
      disabled: Plugin[]
    };
    
    return result;
  } catch (error) {
    console.error('获取插件文件列表失败:', error);
    throw new Error('获取插件文件列表失败');
  }
};

// 启用插件
export const enablePlugin = async (driveLetter: string, fileName: string): Promise<boolean> => {
  try {
    const result = await invoke('enable_plugin', {
      driveLetter,
      fileName
    }) as boolean;
    
    return result;
  } catch (error) {
    console.error('启用插件失败:', error);
    throw new Error('启用插件失败');
  }
};

// 禁用插件
export const disablePlugin = async (driveLetter: string, fileName: string): Promise<boolean> => {
  try {
    const result = await invoke('disable_plugin', {
      driveLetter,
      fileName
    }) as boolean;
    
    return result;
  } catch (error) {
    console.error('禁用插件失败:', error);
    throw new Error('禁用插件失败');
  }
};
