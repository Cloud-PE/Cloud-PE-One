// 新引入的统一的缓存逻辑 防止S-主播疯狂请求攻击我服务器
import { invoke } from '@tauri-apps/api/core';
import { unifiedApiService } from '../api/unifiedApi';
import { getPlugins } from '../api/pluginsApi';
import type { DriveInfo } from './system';
import type { PluginCategory } from '../api/pluginsApi';

// 扩展 DriveInfo 接口以包含版本信息
interface DriveInfoWithVersion extends DriveInfo {
  version?: string | null;
}

// 缓存数据接口
interface CacheData {
  // 系统相关
  micaSupport: boolean | null;
  currentUsername: string | null;
  networkConnected: boolean | null;
  
  // 启动盘相关
  bootDrive: DriveInfoWithVersion | null;
  bootDriveVersion: string | null;
  bootDriveUpdateInfo: {
    cloudPeVersion: string;
    cloudPeUpdateList: string[];
  } | null;
  
  // 应用更新相关
  updateInfo: any | null;
  
  // 插件相关
  pluginCategories: PluginCategory[] | null;
  hasPlugins: boolean;  // 新增：是否有插件
  
  // 通知相关
  notification: any | null;
  
  // ISO下载链接
  isoDownloadLink: string | null;
  
  // 新增：所有启动盘列表（包含版本信息）
  allBootDrives: DriveInfoWithVersion[] | null;
}

// 缓存管理类
class CacheService {
  private cache: CacheData = {
    micaSupport: null,
    currentUsername: null,
    networkConnected: null,
    bootDrive: null,
    bootDriveVersion: null,
    bootDriveUpdateInfo: null,
    updateInfo: null,
    pluginCategories: null,
    hasPlugins: false,  // 默认无插件
    notification: null,
    isoDownloadLink: null,
    allBootDrives: null, // 新增
  };
  
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  
  // 初始化所有缓存数据
  async initialize(): Promise<void> {
    // 如果已经在初始化中，返回现有的Promise
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    // 如果已经初始化完成，直接返回
    if (this.isInitialized) {
      return Promise.resolve();
    }
    
    // 开始初始化
    this.initializationPromise = this._doInitialize();
    
    try {
      await this.initializationPromise;
      this.isInitialized = true;
    } finally {
      this.initializationPromise = null;
    }
  }
  
  private async _doInitialize(): Promise<void> {
    console.log('开始初始化缓存数据...');
    
    // 首先检查网络连接（这个必须先执行，因为后续请求依赖网络）
    await this.loadNetworkConnection();
    
    // 如果没有网络连接，只加载本地数据
    if (!this.cache.networkConnected) {
      console.log('无网络连接，只加载本地数据');
      // 只加载不需要网络的数据
      await Promise.allSettled([
        this.loadMicaSupport(),
        this.loadCurrentUsername(),
        this.loadAllBootDrivesWithVersion(), // 修改：加载所有启动盘及版本
      ]);
    } else {
      // 有网络连接，加载所有数据
      const promises = [
        // 系统相关
        this.loadMicaSupport(),
        this.loadCurrentUsername(),
        
        // 启动盘相关
        this.loadAllBootDrivesWithVersion(), // 修改：加载所有启动盘及版本
        
        // 统一API数据（包含更新信息、通知、启动盘更新信息、ISO链接）
        this.loadUnifiedApiData(),
        
        // 插件相关
        this.loadPluginCategories(),
      ];
      
      await Promise.allSettled(promises);
    }
    
    console.log('缓存数据初始化完成');
  }
  
  // 加载网络连接状态
  private async loadNetworkConnection(): Promise<void> {
    console.log('检查网络连接...');
    const testUrl = 'https://api.cloud-pe.cn/Hub/connecttest/';
    const timeout = 5000;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await window.fetch(testUrl, {
        method: 'GET',
        cache: 'no-store',
        mode: 'cors',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // 检查响应状态和内容
      if (response.ok) {
        const text = await response.text();
        if (text.trim() !== '') {
          this.cache.networkConnected = true;
          console.log('网络连接检测成功');
          return;
        }
      }
      
      this.cache.networkConnected = false;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('网络检测超时');
      } else {
        console.warn('网络检测失败:', error);
      }
      this.cache.networkConnected = false;
    }
  }
  
  // 加载统一API数据
  private async loadUnifiedApiData(): Promise<void> {
    try {
      // 并行请求两个不同的配置
      const [defaultData, isoData] = await Promise.all([
        unifiedApiService.getData(false),
        unifiedApiService.getData(true)
      ]);
      
      // 保存更新信息
      this.cache.updateInfo = defaultData;
      
      // 保存启动盘更新信息
      this.cache.bootDriveUpdateInfo = {
        cloudPeVersion: defaultData.data.cloud_pe,
        cloudPeUpdateList: defaultData.data.cloudpe_updata || []
      };
      
      // 保存通知信息
      const content = defaultData.hub_new.hub_tip;
      let type = defaultData.hub_new.hub_tip_type as 'info' | 'warning' | 'danger' | 'success';
      if (!['info', 'warning', 'danger', 'success'].includes(type)) {
        type = 'info';
      }
      
      if (content) {
        this.cache.notification = { content, type };
      } else {
        this.cache.notification = null;
      }
      
      // 保存ISO下载链接
      this.cache.isoDownloadLink = isoData.down_link || null;
      
      console.log('统一API数据加载完成');
    } catch (error) {
      console.error('加载统一API数据失败:', error);
    }
  }
  
  // 加载Mica支持状态
  private async loadMicaSupport(): Promise<void> {
    try {
      this.cache.micaSupport = await invoke('check_mica_support') as boolean;
      console.log('Mica支持状态:', this.cache.micaSupport);
    } catch (error) {
      console.error('检测Mica支持失败:', error);
      this.cache.micaSupport = false;
    }
  }
  
  // 加载当前用户名
  private async loadCurrentUsername(): Promise<void> {
    try {
      this.cache.currentUsername = await invoke('get_current_username') as string;
      console.log('当前用户名:', this.cache.currentUsername);
    } catch (error) {
      console.error('获取用户名失败:', error);
      this.cache.currentUsername = '用户';
    }
  }
  
  // 新增：加载所有启动盘（包含版本信息）
  private async loadAllBootDrivesWithVersion(): Promise<void> {
    try {
      const result = await invoke('check_all_boot_drives') as any[];
      if (result && result.length > 0) {
        // 为每个启动盘加载版本信息
        const drivesWithVersion = await Promise.all(
          result.map(async (drive) => {
            try {
              const version = await invoke('read_boot_drive_version', { 
                driveLetter: drive.letter 
              }) as string;
              return {
                ...drive,
                version
              };
            } catch (error) {
              console.error(`获取启动盘 ${drive.letter} 版本失败:`, error);
              return {
                ...drive,
                version: null
              };
            }
          })
        );
        
        this.cache.allBootDrives = drivesWithVersion;
        
        // 如果只有一个启动盘，直接设置为当前启动盘
        if (drivesWithVersion.length === 1) {
          this.cache.bootDrive = drivesWithVersion[0];
          this.cache.bootDriveVersion = drivesWithVersion[0].version;
        }
      } else {
        this.cache.allBootDrives = [];
        this.cache.bootDrive = null;
        this.cache.bootDriveVersion = null;
      }
    } catch (error) {
      console.error('检查启动盘失败:', error);
      this.cache.allBootDrives = [];
      this.cache.bootDrive = null;
    }
  }
  
  // 设置当前选中的启动盘
  async setSelectedBootDrive(driveLetter: string): Promise<void> {
    const drive = this.cache.allBootDrives?.find(d => d.letter === driveLetter);
    if (drive) {
      this.cache.bootDrive = drive;
      this.cache.bootDriveVersion = drive.version || null;
    }
  }

  /*
  // 加载启动盘版本
  private async loadBootDriveVersion(driveLetter: string): Promise<void> {
    try {
      this.cache.bootDriveVersion = await invoke('read_boot_drive_version', { driveLetter }) as string;
      console.log('启动盘版本:', this.cache.bootDriveVersion);
    } catch (error) {
      console.error('读取启动盘版本失败:', error);
      this.cache.bootDriveVersion = null;
    }
  }
  */
  
  // 加载插件分类
  private async loadPluginCategories(): Promise<void> {
    try {
      const pluginData = await getPlugins();
      
      // 判断是否有插件
      // data数组为空或者所有分类下的list都为空，则认为没有插件
      const hasPlugins = pluginData && pluginData.length > 0 && 
        pluginData.some(category => category.list && category.list.length > 0);
      
      this.cache.pluginCategories = pluginData;
      this.cache.hasPlugins = hasPlugins;
      
      console.log('插件分类已加载，数量:', this.cache.pluginCategories?.length);
      console.log('是否有插件:', this.cache.hasPlugins);
    } catch (error) {
      console.error('获取插件列表失败:', error);
      this.cache.pluginCategories = null;
      this.cache.hasPlugins = false;
    }
  }
  
  // 重新加载启动盘信息（用于制作启动盘成功后）
async reloadBootDriveInfo(driveLetter?: string, skipCheck: boolean = false): Promise<void> {
  console.log('重新加载启动盘信息...');
  
  if (driveLetter) {
    // 如果提供了盘符
    if (skipCheck) {
      // 跳过检查，直接标记为启动盘（用于刚制作完成的情况）
      try {
        // 获取版本信息
        const version = await invoke('read_boot_drive_version', { driveLetter }) as string;
        const driveWithVersion = {
          letter: driveLetter,
          version,
          isBootDrive: true // 直接标记为启动盘
        };
        
        this.cache.bootDrive = driveWithVersion;
        this.cache.bootDriveVersion = version;
        
        // 更新 allBootDrives 列表
        if (this.cache.allBootDrives) {
          const existingIndex = this.cache.allBootDrives.findIndex(d => d.letter === driveLetter);
          if (existingIndex >= 0) {
            this.cache.allBootDrives[existingIndex] = driveWithVersion;
          } else {
            this.cache.allBootDrives.push(driveWithVersion);
          }
        } else {
          this.cache.allBootDrives = [driveWithVersion];
        }
        
        // 如果有网络连接，重新加载统一API数据以获取最新的升级信息
        if (this.cache.networkConnected) {
          await this.loadUnifiedApiData();
        }
        
        console.log('启动盘信息已成功加载（跳过检查）');
        return;
      } catch (error) {
        console.error('获取版本信息失败:', error);
        // 如果版本获取失败，至少设置基本信息
        const driveWithVersion = {
          letter: driveLetter,
          version: null,
          isBootDrive: true
        };
        
        this.cache.bootDrive = driveWithVersion;
        this.cache.bootDriveVersion = null;
        
        if (this.cache.allBootDrives) {
          const existingIndex = this.cache.allBootDrives.findIndex(d => d.letter === driveLetter);
          if (existingIndex >= 0) {
            this.cache.allBootDrives[existingIndex] = driveWithVersion;
          } else {
            this.cache.allBootDrives.push(driveWithVersion);
          }
        } else {
          this.cache.allBootDrives = [driveWithVersion];
        }
      }
    } else {
      // 正常流程，调用get_drive_info检查
      try {
        const driveInfo = await invoke('get_drive_info', { driveLetter }) as any;
        
        if (driveInfo && driveInfo.is_boot_drive) {
          // 获取版本信息
          try {
            const version = await invoke('read_boot_drive_version', { driveLetter }) as string;
            const driveWithVersion = {
              ...driveInfo,
              version
            };
            
            this.cache.bootDrive = driveWithVersion;
            this.cache.bootDriveVersion = version;
            
            // 更新 allBootDrives 列表
            if (this.cache.allBootDrives) {
              const existingIndex = this.cache.allBootDrives.findIndex(d => d.letter === driveLetter);
              if (existingIndex >= 0) {
                this.cache.allBootDrives[existingIndex] = driveWithVersion;
              } else {
                this.cache.allBootDrives.push(driveWithVersion);
              }
            }
          } catch (error) {
            console.error('获取版本信息失败:', error);
          }
        }
        
        // 如果有网络连接，重新加载统一API数据以获取最新的升级信息
        if (this.cache.networkConnected) {
          await this.loadUnifiedApiData();
        }
      } catch (error) {
        console.error('获取驱动器信息失败:', error);
        await this.loadAllBootDrivesWithVersion();
      }
    }
  } else {
    // 否则重新扫描所有驱动器
    await this.loadAllBootDrivesWithVersion();
    // 如果有网络连接，重新加载统一API数据
    if (this.cache.networkConnected) {
      await this.loadUnifiedApiData();
    }
  }
}
  
  // 获取缓存数据的方法
  getMicaSupport(): boolean {
    return this.cache.micaSupport ?? false;
  }
  
  // 修改后的 getTransparencyEnabled 方法
  async getTransparencyEnabled(): Promise<boolean> {
    // 如果不支持 Mica，直接返回 false
    if (!this.cache.micaSupport) {
      return false;
    }
    
    // 如果支持 Mica，每次都实时检查
    try {
      return await invoke('check_transparency_enabled') as boolean;
    } catch (error) {
      console.error('检测透明效果失败:', error);
      return false;
    }
  }
  
  getCurrentUsername(): string {
    return this.cache.currentUsername ?? '用户';
  }
  
  getNetworkConnected(): boolean {
    return this.cache.networkConnected ?? false;
  }
  
  getBootDrive(): DriveInfoWithVersion | null {
    return this.cache.bootDrive;
  }
  
  getBootDriveVersion(): string | null {
    return this.cache.bootDriveVersion;
  }
  
  getBootDriveUpdateInfo(): { cloudPeVersion: string; cloudPeUpdateList: string[] } | null {
    return this.cache.bootDriveUpdateInfo;
  }
  
  getUpdateInfo(): any | null {
    return this.cache.updateInfo;
  }
  
  getPluginCategories(): PluginCategory[] {
    return this.cache.pluginCategories ?? [];
  }
  
  hasPlugins(): boolean {
    return this.cache.hasPlugins;
  }
  
  getNotification(): any | null {
    return this.cache.notification;
  }
  
  getIsoDownloadLink(): string | null {
    return this.cache.isoDownloadLink;
  }
  
  // 新增：获取所有启动盘
  getAllBootDrives(): DriveInfoWithVersion[] {
    return this.cache.allBootDrives ?? [];
  }
  
  // 新增：直接更新启动盘版本（用于升级后立即更新，无需重新读取文件）
  updateBootDriveVersion(driveLetter: string, newVersion: string): void {
    console.log('cacheService: 直接更新启动盘版本:', driveLetter, '->', newVersion);
    
    // 更新当前启动盘版本
    if (this.cache.bootDrive && this.cache.bootDrive.letter === driveLetter) {
      this.cache.bootDrive.version = newVersion;
      this.cache.bootDriveVersion = newVersion;
    }
    
    // 更新allBootDrives列表中的版本
    if (this.cache.allBootDrives) {
      const driveIndex = this.cache.allBootDrives.findIndex(d => d.letter === driveLetter);
      if (driveIndex >= 0) {
        this.cache.allBootDrives[driveIndex].version = newVersion;
      }
    }
    
    console.log('cacheService: 版本更新完成');
  }
  
  // 清除所有缓存
  clearCache(): void {
    // 清除统一API服务的缓存
    unifiedApiService.clearCache();
    
    // 清除本地缓存
    this.cache = {
      micaSupport: null,
      currentUsername: null,
      networkConnected: null,
      bootDrive: null,
      bootDriveVersion: null,
      bootDriveUpdateInfo: null,
      updateInfo: null,
      pluginCategories: null,
      hasPlugins: false,
      notification: null,
      isoDownloadLink: null,
      allBootDrives: null,
    };
    this.isInitialized = false;
  }
}

// 导出单例实例
export const cacheService = new CacheService();