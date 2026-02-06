import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AppConfig, loadConfig, saveConfig, applyTheme, applyWindowEffects, WindowEffectsMode } from './theme';
import type { DriveInfo } from './system';
import { cacheService } from './cacheService';
import { compareVersions } from '../api/bootDriveUpdateApi';
import { isUpdateSkippable, getUpdateLog, getUpdateLink, getAppExecutableName, checkNeedsUpdate } from '../api/updateApi';
import type { PluginCategory } from '../api/pluginsApi';

// 当前应用版本
const CURRENT_VERSION = 'v1.6';

interface UpdateInfo {
  version: string;
  updateLog: string;
  downloadLink: string;
  appExecutableName: string;
  canSkip: boolean;
}

interface NotificationInfo {
  content: string;
  type: 'info' | 'warning' | 'danger' | 'success';
}

interface DriveInfoWithVersion extends DriveInfo {
  version?: string | null;
}

interface AppContextType {
  config: AppConfig;
  bootDrive: DriveInfoWithVersion | null;
  bootDriveVersion: string | null;
  isLoadingBootDriveVersion: boolean;
  bootDriveUpdateAvailable: boolean;
  setBootDriveUpdateAvailable: (available: boolean) => void;
  bootDriveUpdateCanSkip: boolean;
  isCheckingBootDriveUpdate: boolean;
  isNetworkConnected: boolean;
  isLoading: boolean;
  updateInfo: UpdateInfo | null;
  isUpdateAvailable: boolean;
  isCheckingUpdate: boolean;
  updateError: string | null;
  updateDialogVisible: boolean;
  // 新增Mica支持状态
  isMicaSupported: boolean;
  isCheckingMicaSupport: boolean;
  // 新增插件数据相关状态
  pluginCategories: PluginCategory[];
  isLoadingPlugins: boolean;
  pluginsError: string | null;
  // 新增通知数据相关状态
  notification: NotificationInfo | null;
  isLoadingNotification: boolean;
  notificationError: string | null;
  notificationClosed: boolean;
  setNotificationClosed: (closed: boolean) => void;
  // 新增搜索相关状态
  searchKeyword: string;
  searchResults: PluginCategory | null;
  setSearchKeyword: (keyword: string) => void;
  // 新增ISO生成状态
  isGeneratingIso: boolean;
  setIsGeneratingIso: (generating: boolean) => void;
  // 新增启动盘制作状态
  isCreatingBootDrive: boolean;
  setIsCreatingBootDrive: (creating: boolean) => void;
  // 新增启动盘升级状态
  isUpgradingBootDrive: boolean;
  setIsUpgradingBootDrive: (upgrading: boolean) => void;
  // 新增：插件下载状态管理
  downloadingPlugins: Record<string, boolean>;
  setPluginDownloading: (pluginId: string, isDownloading: boolean) => void;
  clearAllDownloadingPlugins: () => void;
  // 新增：插件列表刷新触发器
  pluginListRefreshTrigger: number;
  triggerPluginListRefresh: () => void;
  // 新增：重新加载启动盘函数
  reloadBootDrive: (driveLetter: string, skipCheck?: boolean) => Promise<void>;
  // 新增：所有启动盘列表
  allBootDrives: DriveInfoWithVersion[];
  // 新增：切换启动盘
  switchBootDrive: (driveLetter: string) => Promise<void>;
  // 原有方法
  setUpdateDialogVisible: (visible: boolean) => void;
  updateConfig: (newConfig: Partial<AppConfig>) => Promise<void>;
  setBootDrive: (drive: DriveInfoWithVersion | null) => void;
  setBootDriveVersion: (version: string | null) => void; // 新增这个方法
  setNetworkConnected: (connected: boolean) => void;
  setIsLoading: (loading: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppProviderProps {
  children: ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const [config, setConfig] = useState<AppConfig>({
    themeMode: 'system',
    downloadThreads: 8,
  });
  const [bootDrive, setBootDrive] = useState<DriveInfoWithVersion | null>(null);
  const [bootDriveVersion, setBootDriveVersion] = useState<string | null>(null);
  const [isLoadingBootDriveVersion] = useState<boolean>(false);
  const [bootDriveUpdateAvailable, setBootDriveUpdateAvailable] = useState<boolean>(false);
  const [bootDriveUpdateCanSkip, setBootDriveUpdateCanSkip] = useState<boolean>(true);
  const [isCheckingBootDriveUpdate] = useState<boolean>(false);
  const [isNetworkConnected, setNetworkConnected] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [updateDialogVisible, setUpdateDialogVisible] = useState<boolean>(false);
  // 新增：Mica支持状态
  const [isMicaSupported, setIsMicaSupported] = useState<boolean>(false);
  const [isCheckingMicaSupport] = useState<boolean>(false);
  
  // 插件数据相关状态
  const [pluginCategories, setPluginCategories] = useState<PluginCategory[]>([]);
  const [isLoadingPlugins] = useState<boolean>(false);
  const [pluginsError] = useState<string | null>(null);
  
  // 通知数据相关状态
  const [notification, setNotification] = useState<NotificationInfo | null>(null);
  const [isLoadingNotification] = useState<boolean>(false);
  const [notificationError] = useState<string | null>(null);
  const [notificationClosed, setNotificationClosed] = useState<boolean>(false);
  
  // 搜索相关状态
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [searchResults, setSearchResults] = useState<PluginCategory | null>(null);
  
  // ISO生成状态
  const [isGeneratingIso, setIsGeneratingIso] = useState<boolean>(false);
  
  // 启动盘制作状态
  const [isCreatingBootDrive, setIsCreatingBootDrive] = useState<boolean>(false);
  
  // 启动盘升级状态
  const [isUpgradingBootDrive, setIsUpgradingBootDrive] = useState<boolean>(false);
  
  // 应用更新相关状态
  const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false);
  const [isCheckingUpdate] = useState<boolean>(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateError] = useState<string | null>(null);
  
  // 新增：插件列表刷新触发器
  const [pluginListRefreshTrigger, setPluginListRefreshTrigger] = useState<number>(0);
  
  // 新增：所有启动盘列表
  const [allBootDrives, setAllBootDrives] = useState<DriveInfoWithVersion[]>([]);
  
  // 新增：下载状态管理（持久化到 localStorage）
  const [downloadingPlugins, setDownloadingPlugins] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('downloadingPlugins');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // 初始化时从缓存服务获取数据
  useEffect(() => {
    const initializeFromCache = async () => {
      // 等待缓存服务初始化完成
      await cacheService.initialize();
      
      // 从缓存获取数据
      setIsMicaSupported(cacheService.getMicaSupport());
      setPluginCategories(cacheService.getPluginCategories() || []);
      
      // 获取所有启动盘
      const allDrives = cacheService.getAllBootDrives();
      setAllBootDrives(allDrives);
      
      // 处理通知
      const cachedNotification = cacheService.getNotification();
      setNotification(cachedNotification);
      
      if (cachedNotification && typeof cachedNotification.content === 'string' && cachedNotification.content.length > 0) {
        const lastClosedNotificationContent = localStorage.getItem('lastClosedNotificationContent');
        if (lastClosedNotificationContent === cachedNotification.content) {
          setNotificationClosed(true);
        } else {
          setNotificationClosed(false);
        }
      } else {
        setNotificationClosed(true);
      }
      
      // 处理应用更新
      const cachedUpdateInfo = cacheService.getUpdateInfo();
      if (cachedUpdateInfo) {
        const latestVersion = cachedUpdateInfo.hub_new.hub_ver;
        const needsUpdate = checkNeedsUpdate(CURRENT_VERSION, latestVersion);
        
        if (needsUpdate) {
          setUpdateInfo({
            version: latestVersion,
            updateLog: getUpdateLog(cachedUpdateInfo),
            downloadLink: getUpdateLink(cachedUpdateInfo),
            appExecutableName: getAppExecutableName(cachedUpdateInfo),
            canSkip: isUpdateSkippable(cachedUpdateInfo)
          });
          setIsUpdateAvailable(true);
        }
      }
      
      // 从缓存获取启动盘相关信息
      const cachedBootDrive = cacheService.getBootDrive();
      const cachedBootDriveVersion = cacheService.getBootDriveVersion();
      const cachedBootDriveUpdateInfo = cacheService.getBootDriveUpdateInfo();
      
      if (cachedBootDrive) {
        setBootDrive(cachedBootDrive);
        setBootDriveVersion(cachedBootDriveVersion);
        
        // 检查启动盘升级
        if (cachedBootDriveVersion && cachedBootDriveUpdateInfo) {
          const needsUpdate = compareVersions(cachedBootDriveVersion, cachedBootDriveUpdateInfo.cloudPeVersion);
          setBootDriveUpdateAvailable(needsUpdate);
          
          const currentVersionWithoutV = cachedBootDriveVersion.replace(/^v/i, '');
          const isCurrentVersionInUpdateList = cachedBootDriveUpdateInfo.cloudPeUpdateList.some(item => {
            const itemVersionWithoutV = item.replace(/^v/i, '');
            return itemVersionWithoutV === currentVersionWithoutV;
          });
          
          setBootDriveUpdateCanSkip(!isCurrentVersionInUpdateList);
        }
      }
    };
    
    initializeFromCache();
  }, []);

  // 同步下载状态到 localStorage
  useEffect(() => {
    localStorage.setItem('downloadingPlugins', JSON.stringify(downloadingPlugins));
  }, [downloadingPlugins]);

  // 设置插件下载状态
  const setPluginDownloading = (pluginId: string, isDownloading: boolean) => {
    setDownloadingPlugins(prev => {
      const updated = { ...prev };
      if (isDownloading) {
        updated[pluginId] = true;
      } else {
        delete updated[pluginId];
      }
      return updated;
    });
  };

  // 清除所有下载状态
  const clearAllDownloadingPlugins = () => {
    setDownloadingPlugins({});
  };

  // 触发插件列表刷新
  const triggerPluginListRefresh = () => {
    setPluginListRefreshTrigger(prev => prev + 1);
  };

  // 初始化配置
  useEffect(() => {
    const initConfig = async () => {
      try {
        const loadedConfig = await loadConfig();
        
        // 确保新配置项有默认值
        if (loadedConfig.enablePersonalizedGreeting === undefined) {
          loadedConfig.enablePersonalizedGreeting = false;
        }
        if (loadedConfig.enableWindowEffects === undefined) {
          loadedConfig.enableWindowEffects = 'partial';
        }
        
        // 如果用户称呼为空，使用缓存的系统用户名
        if (!loadedConfig.userNickname) {
          loadedConfig.userNickname = cacheService.getCurrentUsername();
          await saveConfig(loadedConfig);
        }
        
        setConfig(loadedConfig);
        applyTheme(loadedConfig.themeMode);
        
        // 应用窗口效果
        const windowEffectsMode = loadedConfig.enableWindowEffects || 'off';
        const shouldApplyEffects = windowEffectsMode !== 'off' && 
                                 loadedConfig.themeMode === 'system' && 
                                 isMicaSupported;
        if (shouldApplyEffects) {
          applyWindowEffects(windowEffectsMode as WindowEffectsMode);
        } else {
          applyWindowEffects('off');
        }
      } catch (error) {
        console.error('初始化配置失败:', error);
      }
    };

    initConfig();
  }, [isMicaSupported]);

  // 监听搜索关键词变化，实时更新搜索结果
  useEffect(() => {
    if (!searchKeyword.trim()) {
      setSearchResults(null);
      return;
    }

    // 搜索逻辑
    const keyword = searchKeyword.toLowerCase().trim();
    const allPlugins = pluginCategories.flatMap(category => category.list);
    
    // 根据关键词筛选插件
    const filteredPlugins = allPlugins.filter(plugin => {
      const name = plugin.name.toLowerCase();
      const author = plugin.author.toLowerCase();
      
      return name.includes(keyword) || 
             keyword.includes(name) || 
             author.includes(keyword) || 
             keyword.includes(author);
    });
    
    // 创建搜索结果分类
    if (filteredPlugins.length > 0) {
      setSearchResults({
        class: '搜索',
        list: filteredPlugins
      });
    } else {
      setSearchResults({
        class: '搜索',
        list: []
      });
    }
  }, [searchKeyword, pluginCategories]);

  // 监听系统主题变化
  useEffect(() => {
    if (config.themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      const handleChange = () => {
        applyTheme('system');
        // 当系统主题变化时，重新应用窗口效果
        const windowEffectsMode = config.enableWindowEffects || 'off';
        const shouldApplyEffects = windowEffectsMode !== 'off' && 
                                 config.themeMode === 'system' && 
                                 isMicaSupported;
        if (shouldApplyEffects) {
          applyWindowEffects(windowEffectsMode as WindowEffectsMode);
        } else {
          applyWindowEffects('off');
        }
      };
      
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [config.themeMode, config.enableWindowEffects, isMicaSupported]);

  // 当检测到更新时，显示更新对话框
  useEffect(() => {
    if (isUpdateAvailable && updateInfo) {
      const skippedVersion = localStorage.getItem("skippedUpdateVersion");
      if (skippedVersion === updateInfo.version) {
        setUpdateDialogVisible(false);
        return;
      }
      // 如果更新不可跳过，立即显示更新对话框
      if (!updateInfo.canSkip) {
        setUpdateDialogVisible(true);
      } else {
        // 可跳过的更新，延迟显示对话框，给用户一些时间先看到应用界面
        const timer = setTimeout(() => {
          setUpdateDialogVisible(true);
        }, 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [isUpdateAvailable, updateInfo]);

// 重新加载指定启动盘和版本信息
const reloadBootDrive = async (driveLetter: string, skipCheck: boolean = false) => {
  try {
    console.log('reloadBootDrive: 开始重新加载启动盘信息, driveLetter:', driveLetter, 'skipCheck:', skipCheck);
    
    // 调用缓存服务重新加载启动盘信息
    await cacheService.reloadBootDriveInfo(driveLetter, skipCheck);
    
    // 从缓存获取最新数据
    const updatedBootDrive = cacheService.getBootDrive();
    const updatedBootDriveVersion = cacheService.getBootDriveVersion();
    const updatedBootDriveUpdateInfo = cacheService.getBootDriveUpdateInfo();
    const updatedAllBootDrives = cacheService.getAllBootDrives();
    
    console.log('reloadBootDrive: 获取到的数据:', {
      bootDrive: updatedBootDrive,
      version: updatedBootDriveVersion,
      updateInfo: updatedBootDriveUpdateInfo
    });
    
    // 更新状态
    setBootDrive(updatedBootDrive);
    setBootDriveVersion(updatedBootDriveVersion);
    setAllBootDrives(updatedAllBootDrives);
    
    // 检查启动盘升级
    if (updatedBootDriveVersion && updatedBootDriveUpdateInfo) {
      const needsUpdate = compareVersions(updatedBootDriveVersion, updatedBootDriveUpdateInfo.cloudPeVersion);
      console.log('reloadBootDrive: 版本比较结果 -', {
        currentVersion: updatedBootDriveVersion,
        latestVersion: updatedBootDriveUpdateInfo.cloudPeVersion,
        needsUpdate
      });
      setBootDriveUpdateAvailable(needsUpdate);
      
      const currentVersionWithoutV = updatedBootDriveVersion.replace(/^v/i, '');
      const isCurrentVersionInUpdateList = updatedBootDriveUpdateInfo.cloudPeUpdateList.some(item => {
        const itemVersionWithoutV = item.replace(/^v/i, '');
        return itemVersionWithoutV === currentVersionWithoutV;
      });
      
      setBootDriveUpdateCanSkip(!isCurrentVersionInUpdateList);
      console.log('reloadBootDrive: 更新状态已设置 - bootDriveUpdateAvailable:', needsUpdate);
    } else {
      // 如果没有更新信息，默认设置为false（不需要更新）
      console.log('reloadBootDrive: 没有版本或更新信息，设置为不需要更新');
      setBootDriveUpdateAvailable(false);
      setBootDriveUpdateCanSkip(true);
    }
    
    console.log('reloadBootDrive: 完成');
  } catch (error) {
    console.error('重新加载启动盘失败:', error);
    setBootDrive(null);
    setBootDriveVersion(null);
    setBootDriveUpdateAvailable(false);
    setBootDriveUpdateCanSkip(true);
  }
};

  // 新增：切换启动盘
  const switchBootDrive = async (driveLetter: string) => {
    try {
      // 调用缓存服务设置选中的启动盘
      await cacheService.setSelectedBootDrive(driveLetter);
      
      // 从缓存获取启动盘信息
      const selectedDrive = cacheService.getBootDrive();
      const driveVersion = cacheService.getBootDriveVersion();
      const updateInfo = cacheService.getBootDriveUpdateInfo();
      
      // 更新状态
      setBootDrive(selectedDrive);
      setBootDriveVersion(driveVersion);
      
      // 检查启动盘升级
      if (driveVersion && updateInfo) {
        const needsUpdate = compareVersions(driveVersion, updateInfo.cloudPeVersion);
        setBootDriveUpdateAvailable(needsUpdate);
        
        const currentVersionWithoutV = driveVersion.replace(/^v/i, '');
        const isCurrentVersionInUpdateList = updateInfo.cloudPeUpdateList.some(item => {
          const itemVersionWithoutV = item.replace(/^v/i, '');
          return itemVersionWithoutV === currentVersionWithoutV;
        });
        
        setBootDriveUpdateCanSkip(!isCurrentVersionInUpdateList);
      } else {
        setBootDriveUpdateAvailable(false);
        setBootDriveUpdateCanSkip(true);
      }
    } catch (error) {
      console.error('切换启动盘失败:', error);
    }
  };

  // 更新配置
  const updateConfig = async (newConfig: Partial<AppConfig>) => {
    const updatedConfig = { ...config, ...newConfig };
    setConfig(updatedConfig);
    await saveConfig(updatedConfig);
  
    if (newConfig.themeMode) {
      applyTheme(newConfig.themeMode);
      // 当主题模式变化时，重新评估窗口效果
      const windowEffectsMode = updatedConfig.enableWindowEffects || 'off';
      const shouldApplyEffects = windowEffectsMode !== 'off' && 
                               newConfig.themeMode === 'system' && 
                               isMicaSupported;
      if (shouldApplyEffects) {
        applyWindowEffects(windowEffectsMode as WindowEffectsMode);
      } else {
        applyWindowEffects('off');
      }
    }
  
    // 新增：如果更新了窗口效果设置，应用对应样式
    if (newConfig.enableWindowEffects !== undefined) {
      // 只有在系统主题模式下且系统支持Mica时才应用窗口效果
      const windowEffectsMode = newConfig.enableWindowEffects as WindowEffectsMode;
      const shouldApplyEffects = windowEffectsMode !== 'off' && 
                               updatedConfig.themeMode === 'system' && 
                               isMicaSupported;
      if (shouldApplyEffects) {
        applyWindowEffects(windowEffectsMode);
      } else {
        applyWindowEffects('off');
      }
    }
  };

  const value = {
    config,
    bootDrive,
    bootDriveVersion,
    isLoadingBootDriveVersion,
    bootDriveUpdateAvailable,
    setBootDriveUpdateAvailable,
    bootDriveUpdateCanSkip,
    isCheckingBootDriveUpdate,
    isNetworkConnected,
    isLoading,
    updateInfo,
    isUpdateAvailable,
    isCheckingUpdate,
    updateError,
    updateDialogVisible,
    // 新增Mica支持状态
    isMicaSupported,
    isCheckingMicaSupport,
    // 新增插件数据相关状态
    pluginCategories,
    isLoadingPlugins,
    pluginsError,
    // 新增通知数据相关状态
    notification,
    isLoadingNotification,
    notificationError,
    notificationClosed,
    setNotificationClosed,
    // 新增搜索相关状态
    searchKeyword,
    searchResults,
    setSearchKeyword,
    // 新增ISO生成状态
    isGeneratingIso,
    setIsGeneratingIso,
    // 新增启动盘制作状态
    isCreatingBootDrive,
    setIsCreatingBootDrive,
    // 新增启动盘升级状态
    isUpgradingBootDrive,
    setIsUpgradingBootDrive,
    // 新增插件下载状态管理
    downloadingPlugins,
    setPluginDownloading,
    clearAllDownloadingPlugins,
    // 新增插件列表刷新触发器
    pluginListRefreshTrigger,
    triggerPluginListRefresh,
    // 新增重新加载启动盘函数
    reloadBootDrive,
    // 新增所有启动盘列表
    allBootDrives,
    // 新增切换启动盘
    switchBootDrive,
    // 原有方法
    setUpdateDialogVisible,
    updateConfig,
    setBootDrive,
    setBootDriveVersion, // 新增这个方法
    setNetworkConnected,
    setIsLoading,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};