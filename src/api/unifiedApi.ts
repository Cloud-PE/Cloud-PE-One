import axios from 'axios';

// 定义统一的API响应数据结构
export interface UnifiedApiResponse {
  code: number;
  message: string;
  data: {
    cloud_pe: string;
    cloudpe_updata: string[];
    iso_version: string;
    iso_important_updata: string[];
    iso_second_version: string;
    iso_s_important_updata: string[];
    hub_version: string;
  };
  hub_new: {
    hub_ver: string;
    hub_tip: string;
    hub_tip_type: string;
    hub_updata_link: string;
    app_name_exe: string;
    log: {
      [version: string]: {
        can_skip: string;
        log: string;
        md5: string;
      };
    };
  };
  // ISO下载链接（当m=1时返回）
  down_link?: string;
}

// 统一的API请求服务
class UnifiedApiService {
  private baseUrl = 'https://api.cloud-pe.cn/GetInfo/';
  private cache: Map<string, UnifiedApiResponse> = new Map();
  
  // 获取数据（带缓存）
  async getData(withIsoLink: boolean = false): Promise<UnifiedApiResponse> {
    const cacheKey = withIsoLink ? 'with_iso' : 'default';
    
    // 检查缓存
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    
    try {
      const url = withIsoLink ? `${this.baseUrl}?m=1` : this.baseUrl;
      const response = await axios.get<UnifiedApiResponse>(url);
      
      if (response.data.code === 200) {
        // 缓存成功的响应
        this.cache.set(cacheKey, response.data);
        return response.data;
      } else {
        throw new Error(`API返回错误: ${response.data.message || '未知错误'}`);
      }
    } catch (error) {
      console.error('统一API请求失败:', error);
      throw error;
    }
  }
  
  // 清除缓存
  clearCache(): void {
    this.cache.clear();
  }
}

// 导出单例实例
export const unifiedApiService = new UnifiedApiService();