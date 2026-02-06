import { useState, useEffect } from 'react';
import { getUpdateInfo, checkNeedsUpdate, isUpdateSkippable, getUpdateLog, getUpdateLink, getAppExecutableName } from '../api/updateApi';

// 当前应用版本
const CURRENT_VERSION = 'v1.6';

interface UseUpdateCheckResult {
  isUpdateAvailable: boolean;
  isCheckingUpdate: boolean;
  updateInfo: {
    version: string;
    updateLog: string;
    downloadLink: string;
    appExecutableName: string;
    canSkip: boolean;
  } | null;
  error: string | null;
}

export const useUpdateCheck = (): UseUpdateCheckResult => {
  const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(true);
  const [updateInfo, setUpdateInfo] = useState<UseUpdateCheckResult['updateInfo']>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        setIsCheckingUpdate(true);
        setError(null);

        // 获取更新信息
        const info = await getUpdateInfo();
        
        // 获取最新版本号
        const latestVersion = info.hub_new.hub_ver;
        
        // 检查是否需要更新
        const needsUpdate = checkNeedsUpdate(CURRENT_VERSION, latestVersion);
        
        if (needsUpdate) {
          // 设置更新信息
          setUpdateInfo({
            version: latestVersion,
            updateLog: getUpdateLog(info),
            downloadLink: getUpdateLink(info),
            appExecutableName: getAppExecutableName(info),
            canSkip: isUpdateSkippable(info)
          });
          setIsUpdateAvailable(true);
        }
      } catch (err) {
        console.error('检查更新失败:', err);
        setError('检查更新失败，请检查网络连接后重试。');
      } finally {
        setIsCheckingUpdate(false);
      }
    };

    checkUpdate();
  }, []);

  return {
    isUpdateAvailable,
    isCheckingUpdate,
    updateInfo,
    error
  };
};

