import { unifiedApiService } from './unifiedApi';

// 获取ISO下载链接
export const getIsoDownloadLink = async (): Promise<string> => {
  try {
    // 使用统一API服务获取下载链接数据
    const response = await unifiedApiService.getDownload();

    if (response.download_link) {
      return response.download_link;
    } else {
      throw new Error('响应中没有下载链接');
    }
  } catch (error) {
    console.error('获取ISO下载链接失败:', error);
    throw error;
  }
};