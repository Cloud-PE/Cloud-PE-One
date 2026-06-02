import { getAppConfigDir, readTextFile, writeTextFile, exists, createDir } from './tauriApiWrapper';

export type ThemeMode = 'system' | 'light' | 'dark';
export type DownloadThreads = 8 | 16 | 32 | 64 | 128 ;

export interface AppConfig {
  themeMode: ThemeMode;
  downloadThreads: DownloadThreads;
  enablePluginWebSearch?: boolean;
  userNickname?: string;
  enablePersonalizedGreeting?: boolean;
  // PE 缓存目录（为空时使用软件目录下的默认目录）
  peCachePath?: string;
  // 最后一次联网时获取到的最新 PE 版本号（用于离线判断缓存是否过时）
  lastKnownLatestPeVersion?: string;
}

// 默认配置
const defaultConfig: AppConfig = {
  themeMode: 'system',
  downloadThreads: 16,
  enablePluginWebSearch: false,
  userNickname: '',
  enablePersonalizedGreeting: false,
  peCachePath: '',
  lastKnownLatestPeVersion: '',
};

// 获取配置文件路径
export const getConfigPath = async (): Promise<string> => {
  try {
    const appDir = await getAppConfigDir();
    return `${appDir}config.json`;
  } catch (error) {
    console.error('获取配置路径失败:', error);
    return './config.json'; // 开发环境下的回退路径
  }
};

// 加载配置
export const loadConfig = async (): Promise<AppConfig> => {
  try {
    const configPath = await getConfigPath();
    
    try {
      const configExists = await exists(configPath);
      
      if (!configExists) {
        await saveConfig(defaultConfig);
        return defaultConfig;
      }
      
      const configContent = await readTextFile(configPath);
      const loadedConfig = JSON.parse(configContent) as AppConfig;

      // 确保新配置项有默认值（兼容旧配置文件）
      return {
        ...defaultConfig,
        ...loadedConfig,
        enablePluginWebSearch: loadedConfig.enablePluginWebSearch ?? false,
        enablePersonalizedGreeting: loadedConfig.enablePersonalizedGreeting ?? false,
      };
    } catch (error) {
      // 开发环境下的回退方案
      console.warn('使用默认配置:', error);
      const savedConfig = localStorage.getItem('app-config');
      if (savedConfig) {
        const parsedConfig = JSON.parse(savedConfig) as AppConfig;

        // 确保新配置项有默认值
        return {
          ...defaultConfig,
          ...parsedConfig,
          enablePluginWebSearch: parsedConfig.enablePluginWebSearch ?? false,
          enablePersonalizedGreeting: parsedConfig.enablePersonalizedGreeting ?? false,
        };
      }
      return defaultConfig;
    }
  } catch (error) {
    console.error('加载配置失败:', error);
    return defaultConfig;
  }
};

// 保存配置
export const saveConfig = async (config: AppConfig): Promise<void> => {
  try {
    const configPath = await getConfigPath();
    
    try {
      const dirPath = configPath.substring(0, configPath.lastIndexOf('/'));
      const dirExists = await exists(dirPath);
      
      if (!dirExists) {
        await createDir(dirPath, { recursive: true });
      }
      
      await writeTextFile(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      // 开发环境下可能无法写入文件系统
      console.warn('无法保存配置到文件系统:', error);
      localStorage.setItem('app-config', JSON.stringify(config));
    }
  } catch (error) {
    console.error('保存配置失败:', error);
  }
};

// 获取当前系统主题
export const getSystemTheme = (): 'light' | 'dark' => {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

// 应用主题
export const applyTheme = (mode: ThemeMode): void => {
  const theme = mode === 'system' ? getSystemTheme() : mode;

  if (theme === 'dark') {
    document.body.setAttribute('theme-mode', 'dark');
    document.body.classList.add('dark');
    document.body.classList.add('semi-always-dark');
    document.body.classList.remove('semi-always-light');
  } else {
    document.body.setAttribute('theme-mode', 'light');
    document.body.classList.remove('dark');
    document.body.classList.add('semi-always-light');
    document.body.classList.remove('semi-always-dark');
  }
};