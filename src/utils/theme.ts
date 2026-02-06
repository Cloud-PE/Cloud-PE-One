import { getAppConfigDir, readTextFile, writeTextFile, exists, createDir } from './tauriApiWrapper';
import { checkMicaSupport } from './system';

export type ThemeMode = 'system' | 'light' | 'dark';
export type DownloadThreads = 8 | 16 | 32 | 64 | 128 ;
export type WindowEffectsMode = 'off' | 'partial' | 'full'; // 新增类型

export interface AppConfig {
  themeMode: ThemeMode;
  downloadThreads: DownloadThreads;
  enablePluginWebSearch?: boolean;
  userNickname?: string;
  enablePersonalizedGreeting?: boolean;
  enableWindowEffects?: WindowEffectsMode; // 修改为新类型
}

// 默认配置
const defaultConfig: AppConfig = {
  themeMode: 'system',
  downloadThreads: 16,
  enablePluginWebSearch: false,
  userNickname: '',
  enablePersonalizedGreeting: false,
  enableWindowEffects: 'partial', // 默认为"开（局部）"
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
      
      // 兼容旧的布尔值配置
      let windowEffectsMode: WindowEffectsMode = 'partial';
      if (typeof loadedConfig.enableWindowEffects === 'boolean') {
        windowEffectsMode = loadedConfig.enableWindowEffects ? 'partial' : 'off';
      } else if (typeof loadedConfig.enableWindowEffects === 'string') {
        windowEffectsMode = loadedConfig.enableWindowEffects as WindowEffectsMode;
      }
      
      // 确保新配置项有默认值（兼容旧配置文件）
      return {
        ...defaultConfig,
        ...loadedConfig,
        enablePluginWebSearch: loadedConfig.enablePluginWebSearch ?? false,
        enablePersonalizedGreeting: loadedConfig.enablePersonalizedGreeting ?? false,
        enableWindowEffects: windowEffectsMode
      };
    } catch (error) {
      // 开发环境下的回退方案
      console.warn('使用默认配置:', error);
      const savedConfig = localStorage.getItem('app-config');
      if (savedConfig) {
        const parsedConfig = JSON.parse(savedConfig) as AppConfig;
        
        // 兼容旧的布尔值配置
        let windowEffectsMode: WindowEffectsMode = 'partial';
        if (typeof parsedConfig.enableWindowEffects === 'boolean') {
          windowEffectsMode = parsedConfig.enableWindowEffects ? 'partial' : 'off';
        } else if (typeof parsedConfig.enableWindowEffects === 'string') {
          windowEffectsMode = parsedConfig.enableWindowEffects as WindowEffectsMode;
        }
        
        // 确保新配置项有默认值
        return {
          ...defaultConfig,
          ...parsedConfig,
          enablePluginWebSearch: parsedConfig.enablePluginWebSearch ?? false,
          enablePersonalizedGreeting: parsedConfig.enablePersonalizedGreeting ?? false,
          enableWindowEffects: windowEffectsMode
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

// 窗口效果CSS样式
const WINDOW_EFFECTS_CSS = `
.semi-layout-header, .semi-always-dark, .semi-always-light {
  background: transparent !important;
}

.semi-layout-sider, .semi-navigation {
  background: transparent !important;
}
`;

const WINDOW_EFFECTS_CSS_MORE = `
.plugins-market-nav, .semi-layout-content, .plugins-market-list, .plugins-info {
  background: transparent !important;
}
`;

// 应用窗口效果
export const applyWindowEffects = async (mode: WindowEffectsMode): Promise<void> => {
  const styleId = 'window-effects-styles';
  let styleElement = document.getElementById(styleId);

  if (mode !== 'off') {
    // 检查系统是否支持Mica效果
    const isMicaSupported = await checkMicaSupport();
    
    if (!isMicaSupported) {
      console.warn('当前系统版本不支持Mica效果，忽略窗口效果设置');
      // 移除样式元素（如果存在）
      if (styleElement) {
        styleElement.remove();
      }
      return;
    }
    
    // 创建或更新样式元素
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }
    
    // 根据模式应用不同的样式
    if (mode === 'partial') {
      styleElement.textContent = WINDOW_EFFECTS_CSS;
    } else if (mode === 'full') {
      styleElement.textContent = WINDOW_EFFECTS_CSS + WINDOW_EFFECTS_CSS_MORE;
    }
  } else {
    // 移除样式元素
    if (styleElement) {
      styleElement.remove();
    }
  }
};