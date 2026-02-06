import { unifiedApiService } from './unifiedApi';

// 获取ISO下载链接
export const getIsoDownloadLink = async (): Promise<string> => {
  try {
    // 使用统一API服务获取数据（带m=1参数）
    const response = await unifiedApiService.getData(true);
    
    if (response.down_link) {
      return response.down_link;
    } else {
      throw new Error('响应中没有下载链接');
    }
  } catch (error) {
    console.error('获取ISO下载链接失败:', error);
    throw error;
  }
};