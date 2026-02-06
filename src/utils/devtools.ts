import { invoke } from '@tauri-apps/api/core';

/**
 * 打开开发者工具
 */
export async function openDevTools(): Promise<void> {
  try {
    await invoke('open_devtools');
  } catch (error) {
    console.error('打开开发者工具失败:', error);
    throw error;
  }
}