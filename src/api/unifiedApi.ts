import axios from 'axios';

// info 段（整个 data.json，含 cloud_pe_one）
export interface InfoResponse {
  code: number;
  message: string;
  data: {
    cloud_pe_version: string;
    force_update_versions: string[];
    iso_version?: string;
    iso_important_updata?: string[];
    iso_second_version?: string;
    iso_s_important_updata?: string[];
    hub_version?: string;
  };
  cloud_pe_one: {
    version: string;
    tip: string;
    tip_type: string;
    update_link: string;
    app_exe: string;
    logs: {
      [version: string]: {
        can_skip: boolean;
        log: string;
        md5: string;
      };
    };
  };
}

// download 段（整个 down.json）
export interface DownloadResponse {
  code: number;
  message: string;
  download_link: string;
  default_plugin_link: string;
  legacy_downloads?: {
    [version: string]: {
      download_link: string;
    };
  };
}

// plugins 段中的单个插件（v2 字段名）
export interface RawPlugin {
  name: string;
  size: string;
  version: string;
  author: string;
  description: string;
  file: string;
  link: string;
  id?: string;
}

// plugins 段中的分类（v2 字段名）
export interface RawPluginCategory {
  category: string;
  list: RawPlugin[];
}

// plugins 段（整个 plugins.json）
export interface PluginsResponse {
  code: number;
  message: string;
  data: RawPluginCategory[];
}

// Cloud-PE One 专用聚合接口 /v2/cloud-pe-one.json
export interface CloudPeOneResponse {
  code: number;
  message: string;
  server_ok: boolean;
  data: {
    info: InfoResponse;
    download: DownloadResponse;
    plugins: PluginsResponse;
  };
}

// 兼容旧引用：更新信息使用 info 段类型
export type UnifiedApiResponse = InfoResponse;

// 统一的API请求服务
// Cloud-PE One 专用：只请求一次 /v2/cloud-pe-one.json，info / download / plugins 全部来自这一次请求
class UnifiedApiService {
  private url = 'https://api.cloud-pe.cn/v2/cloud-pe-one.json';
  private cache: CloudPeOneResponse | null = null;
  private pending: Promise<CloudPeOneResponse> | null = null;

  // 获取聚合数据（带缓存 + 并发去重，全局只请求一次）
  async getCloudPeOne(): Promise<CloudPeOneResponse> {
    if (this.cache) {
      return this.cache;
    }

    // 已有请求在途时，复用同一个 Promise，避免并发重复请求
    if (this.pending) {
      return this.pending;
    }

    this.pending = (async () => {
      try {
        const response = await axios.get<CloudPeOneResponse>(this.url, {
          timeout: 10000,
        });

        if (response.data.code === 200) {
          this.cache = response.data;
          return response.data;
        } else {
          throw new Error(`API返回错误: ${response.data.message || '未知错误'}`);
        }
      } catch (error) {
        console.error('统一API请求失败:', error);
        throw error;
      } finally {
        this.pending = null;
      }
    })();

    return this.pending;
  }

  // 获取主信息数据（含 cloud_pe_one）
  async getInfo(): Promise<InfoResponse> {
    return (await this.getCloudPeOne()).data.info;
  }

  // 获取下载链接数据（ISO / 默认插件）
  async getDownload(): Promise<DownloadResponse> {
    return (await this.getCloudPeOne()).data.download;
  }

  // 获取插件列表数据（v2 原始字段）
  async getPluginsRaw(): Promise<PluginsResponse> {
    return (await this.getCloudPeOne()).data.plugins;
  }

  // 获取服务器健康状态
  async getServerOk(): Promise<boolean> {
    return (await this.getCloudPeOne()).server_ok === true;
  }

  // 清除缓存
  clearCache(): void {
    this.cache = null;
  }
}

// 导出单例实例
export const unifiedApiService = new UnifiedApiService();
