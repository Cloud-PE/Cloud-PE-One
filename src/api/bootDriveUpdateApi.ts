import { unifiedApiService } from './unifiedApi';

interface BootDriveUpdateInfo {
  cloudPeVersion: string;
  cloudPeUpdateList: string[];
}

// 获取启动盘升级信息
export const getBootDriveUpdateInfo = async (): Promise<BootDriveUpdateInfo> => {
  try {
    const response = await unifiedApiService.getData();
    
    return {
      cloudPeVersion: response.data.cloud_pe,
      cloudPeUpdateList: response.data.cloudpe_updata || []
    };
  } catch (error) {
    console.error('获取启动盘升级信息失败:', error);
    throw error;
  }
};

// 比较版本号
export const compareVersions = (currentVersion: string, latestVersion: string): boolean => {
  // 移除版本号前的 'v' 前缀
  const current = currentVersion.replace(/^v/, '');
  const latest = latestVersion.replace(/^v/, '');
  
  return current !== latest;
};