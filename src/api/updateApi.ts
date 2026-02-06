import { unifiedApiService, UnifiedApiResponse } from './unifiedApi';

// 使用统一API的响应类型
export type UpdateInfo = UnifiedApiResponse;

// 获取更新信息的API
export const getUpdateInfo = async (): Promise<UpdateInfo> => {
  try {
    return await unifiedApiService.getData();
  } catch (error) {
    console.error('获取更新信息失败:', error);
    throw new Error('获取更新信息失败');
  }
};

// 比较版本号，判断是否需要更新
export const checkNeedsUpdate = (currentVersion: string, latestVersion: string): boolean => {
  // 移除版本号前的'v'字符
  const current = currentVersion.replace('v', '');
  const latest = latestVersion.replace('v', '');
  
  // 将版本号拆分为数字数组
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);
  
  // 比较版本号的每一部分
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;
    
    if (latestPart > currentPart) {
      return true; // 需要更新
    } else if (latestPart < currentPart) {
      return false; // 不需要更新
    }
  }
  
  return false; // 版本相同，不需要更新
};

// 检查更新是否可跳过
export const isUpdateSkippable = (updateInfo: UpdateInfo): boolean => {
  const latestVersion = updateInfo.hub_new.hub_ver;
  const canSkip = updateInfo.hub_new.log[latestVersion]?.can_skip;
  
  return canSkip === 'true';
};

// 获取更新日志
export const getUpdateLog = (updateInfo: UpdateInfo): string => {
  const latestVersion = updateInfo.hub_new.hub_ver;
  return updateInfo.hub_new.log[latestVersion]?.log || '';
};

// 获取更新下载链接
export const getUpdateLink = (updateInfo: UpdateInfo): string => {
  return updateInfo.hub_new.hub_updata_link;
};

// 获取应用程序可执行文件名
export const getAppExecutableName = (updateInfo: UpdateInfo): string => {
  return updateInfo.hub_new.app_name_exe;
};