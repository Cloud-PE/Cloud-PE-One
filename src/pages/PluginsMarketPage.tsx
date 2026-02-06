import React, { useState, useEffect } from 'react';
import { Download, AlertCircle, Globe, ArrowLeft, PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardPanel } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipPopup } from '@/components/ui/tooltip';
import { toastManager } from '@/components/ui/toast';
import { downloadPlugin, updatePlugin, getPluginFiles, generatePluginId, compareVersions, Plugin } from '../api/pluginsApi';
import { useAppContext } from '../utils/AppContext';
import { cacheService } from '../utils/cacheService';
import CheckCircle from '@/components/icon/CheckCircle';

interface PluginStatus {
  installed: boolean;
  canUpdate: boolean;
  localVersion?: string;
  localFileName?: string;
}

const PluginsMarketPage: React.FC = () => {
  const {
    bootDrive,
    pluginCategories,
    isLoadingPlugins,
    pluginsError,
    searchResults,
    searchKeyword,
    config,
    downloadingPlugins,
    setPluginDownloading,
    triggerPluginListRefresh,
    isNetworkConnected,
  } = useAppContext();

  const [currentCategory, setCurrentCategory] = useState<string>('');
  const [, setUserSelectedCategory] = useState<boolean>(false);
  const [hasProcessedSearch, setHasProcessedSearch] = useState<boolean>(false);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isPageLoaded, setIsPageLoaded] = useState<boolean>(false);
  const [webSearchPlugin, setWebSearchPlugin] = useState<Plugin | null>(null);
  const [showWebSearch, setShowWebSearch] = useState<boolean>(false);
  const [localPluginsMap, setLocalPluginsMap] = useState<Map<string, Plugin>>(new Map());
  const [processingPlugins, setProcessingPlugins] = useState<Record<string, boolean>>({});
  const [recentlyUpdatedPlugins, setRecentlyUpdatedPlugins] = useState<Set<string>>(new Set());

  const hasPlugins = cacheService.hasPlugins();

  // 生成插件的唯一标识符
  const getPluginUniqueId = (plugin: Plugin): string => {
    return `${plugin.name}_${plugin.version}_${plugin.author}_${plugin.describe}`;
  };

  // 去重函数：移除重复的插件
  const deduplicatePlugins = (plugins: Plugin[]): Plugin[] => {
    const seen = new Set<string>();
    return plugins.filter(plugin => {
      const uniqueId = getPluginUniqueId(plugin);
      if (seen.has(uniqueId)) {
        return false;
      }
      seen.add(uniqueId);
      return true;
    });
  };

  // 对插件进行排序：有更新的在最上面，刚更新的在中间，其他的在最下面
  const sortPluginsByUpdate = (plugins: Plugin[]): Plugin[] => {
    return [...plugins].sort((a, b) => {
      const aStatus = getPluginStatus(a);
      const bStatus = getPluginStatus(b);
      const aId = generatePluginId(a.name, a.author);
      const bId = generatePluginId(b.name, b.author);
      const aRecentlyUpdated = recentlyUpdatedPlugins.has(aId);
      const bRecentlyUpdated = recentlyUpdatedPlugins.has(bId);

      // 有更新的排在最前面
      if (aStatus.canUpdate && !bStatus.canUpdate) return -1;
      if (!aStatus.canUpdate && bStatus.canUpdate) return 1;

      // 刚更新的排在中间（有更新的下面，其他的上面）
      if (aRecentlyUpdated && !bRecentlyUpdated && !bStatus.canUpdate) return -1;
      if (!aRecentlyUpdated && bRecentlyUpdated && !aStatus.canUpdate) return 1;

      // 其他保持原顺序
      return 0;
    });
  };

  // 加载本地已启用插件列表
  const loadLocalPlugins = async () => {
    if (!bootDrive || !isNetworkConnected) {
      setLocalPluginsMap(new Map());
      return;
    }

    try {
      const { enabled } = await getPluginFiles(bootDrive.letter);
      const pluginsMap = new Map<string, Plugin>();

      enabled.forEach(plugin => {
        if (plugin.id) {
          pluginsMap.set(plugin.id, plugin);
        }
      });

      setLocalPluginsMap(pluginsMap);
    } catch (err) {
      console.error('加载本地插件失败:', err);
      setLocalPluginsMap(new Map());
    }
  };

  // 获取插件状态
  const getPluginStatus = (plugin: Plugin): PluginStatus => {
    const pluginId = generatePluginId(plugin.name, plugin.author);
    const localPlugin = localPluginsMap.get(pluginId);

    if (!localPlugin) {
      return { installed: false, canUpdate: false };
    }

    const comparison = compareVersions(localPlugin.version, plugin.version);

    return {
      installed: true,
      canUpdate: comparison < 0,
      localVersion: localPlugin.version,
      localFileName: localPlugin.file,
    };
  };

  // 初始化时和网络状态变化时加载本地插件
  useEffect(() => {
    loadLocalPlugins();
  }, [bootDrive, isNetworkConnected]);

  // 当插件分类加载完成后，设置默认分类
  useEffect(() => {
    if (pluginCategories.length > 0 && !currentCategory && !isInitialized) {
      if (searchResults && searchKeyword.trim()) {
        setCurrentCategory('搜索');
        setHasProcessedSearch(true);
      } else {
        setCurrentCategory(pluginCategories[0].class);
      }
      setIsInitialized(true);
    }
  }, [pluginCategories, searchResults, currentCategory, isInitialized, searchKeyword]);

  // 当搜索结果变化时，处理分类切换
  useEffect(() => {
    if (searchResults && searchKeyword.trim() && !hasProcessedSearch) {
      setCurrentCategory('搜索');
      setHasProcessedSearch(true);
      setUserSelectedCategory(false);
    }
    else if (!searchKeyword.trim() && currentCategory === '搜索' && pluginCategories.length > 0) {
      setCurrentCategory(pluginCategories[0].class);
      setHasProcessedSearch(false);
      setUserSelectedCategory(false);
    }
  }, [searchResults, searchKeyword, currentCategory, pluginCategories, hasProcessedSearch]);

  // 当搜索关键词变化时，重置处理状态
  useEffect(() => {
    if (searchKeyword) {
      setHasProcessedSearch(false);
    }
  }, [searchKeyword]);

  // 监听页面加载状态
  useEffect(() => {
    if (!isLoadingPlugins && !pluginsError && isInitialized && pluginCategories.length > 0) {
      setIsPageLoaded(true);
    }
    if (pluginsError) {
      setIsPageLoaded(true);
    }
  }, [isLoadingPlugins, pluginsError, isInitialized, pluginCategories.length]);

  // 组件卸载时恢复body滚动条
  useEffect(() => {
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // 处理分类切换
  const handleCategoryChange = (value: string | number | null) => {
    if (value !== null) {
      setUserSelectedCategory(true);
      setCurrentCategory(value as string);
    }
  };

  // 处理插件下载
  const handleDownloadPlugin = async (plugin: Plugin) => {
    if (!bootDrive) {
      toastManager.add({
        type: 'error',
        title: '尚未准备就绪！',
        description: '目前您还尚未安装或制作 Cloud-PE 启动盘，因此该功能暂不可用！',
      });
      return;
    }

    const pluginId = getPluginUniqueId(plugin);

    try {
      setPluginDownloading(pluginId, true);

      await downloadPlugin(
        plugin.link,
        `${plugin.name}_${plugin.version}_${plugin.author}_${plugin.describe}.ce`,
        bootDrive.letter,
        config.downloadThreads
      );

      toastManager.add({
        type: 'success',
        title: '下载成功',
        description: `插件 ${plugin.name} 已下载完成`,
      });

      // 触发插件列表刷新并重新加载本地插件
      triggerPluginListRefresh();
      await loadLocalPlugins();
    } catch (err) {
      console.error('下载插件失败:', err);
      toastManager.add({
        type: 'error',
        title: '错误',
        description: `插件 ${plugin.name} 下载失败`,
      });
    } finally {
      setPluginDownloading(pluginId, false);
    }
  };

  // 处理插件更新
  const handleUpdatePlugin = async (plugin: Plugin) => {
    if (!bootDrive) {
      toastManager.add({
        type: 'error',
        title: '错误',
        description: '启动盘未就绪',
      });
      return;
    }

    const pluginId = getPluginUniqueId(plugin);
    const status = getPluginStatus(plugin);

    if (!status.canUpdate || !status.localFileName) {
      return;
    }

    try {
      setProcessingPlugins(prev => ({ ...prev, [pluginId]: true }));

      await updatePlugin(
        plugin.link,
        `${plugin.name}_${plugin.version}_${plugin.author}_${plugin.describe}.ce`,
        status.localFileName,
        bootDrive.letter,
        config.downloadThreads
      );

      toastManager.add({
        type: 'success',
        title: '更新成功',
        description: `插件 ${plugin.name} 已更新到版本 ${plugin.version}`,
      });

      // 标记为最近更新的插件
      const newPluginId = generatePluginId(plugin.name, plugin.author);
      setRecentlyUpdatedPlugins(prev => new Set(prev).add(newPluginId));

      // 触发插件列表刷新并重新加载本地插件
      triggerPluginListRefresh();
      await loadLocalPlugins();
    } catch (err) {
      console.error('更新插件失败:', err);
      toastManager.add({
        type: 'error',
        title: '更新失败',
        description: `插件 ${plugin.name} 更新失败`,
      });
    } finally {
      setProcessingPlugins(prev => {
        const newState = { ...prev };
        delete newState[pluginId];
        return newState;
      });
    }
  };

  // 处理Web搜索
  const handleWebSearch = (plugin: Plugin) => {
    setWebSearchPlugin(plugin);
    setShowWebSearch(true);
    document.body.style.overflow = 'hidden';
  };

  // 返回插件列表
  const handleBackFromWebSearch = () => {
    setShowWebSearch(false);
    setWebSearchPlugin(null);
    document.body.style.overflow = '';
  };

  // 获取当前分类的插件列表
  const getCurrentCategoryPlugins = (): Plugin[] => {
    let plugins: Plugin[] = [];

    if (currentCategory === '搜索') {
      if (searchKeyword.trim() && searchResults) {
        plugins = searchResults.list;
      } else if (pluginCategories.length > 0) {
        const firstCategory = pluginCategories[0];
        plugins = firstCategory ? firstCategory.list : [];
      }
    } else {
      const category = pluginCategories.find(cat => cat.class === currentCategory);
      plugins = category ? category.list : [];
    }

    const deduped = deduplicatePlugins(plugins);
    return sortPluginsByUpdate(deduped);
  };

  // 获取导航项列表
  const getNavItems = () => {
    const items = pluginCategories.map(category => ({
      itemKey: category.class,
      text: category.class
    }));

    if (searchResults && searchKeyword.trim()) {
      items.unshift({
        itemKey: '搜索',
        text: '搜索'
      });
    }

    return items;
  };

  // 生成唯一的插件卡片key
  const generatePluginKey = (plugin: Plugin, index: number): string => {
    return `${getPluginUniqueId(plugin)}-${index}-${currentCategory}`;
  };

  // 渲染插件卡片
  const renderPluginCard = (plugin: Plugin, index: number) => {
    const pluginId = getPluginUniqueId(plugin);
    const isDownloading = downloadingPlugins[pluginId];
    const isProcessing = processingPlugins[pluginId];
    const status = getPluginStatus(plugin);

    return (
      <Card
        key={generatePluginKey(plugin, index)}
        className="w-full shadow-sm py-4"
      >
        <CardPanel>
          <div className="flex justify-between">
            <div className="flex-1">
              <div className="flex items-center mb-2">
                <h5 className="text-lg font-semibold mr-2">{plugin.name}</h5>
                {status.installed && status.canUpdate && (
                  <Badge variant="warning">有更新</Badge>
                )}
              </div>
              <p className="mb-2 text-muted-foreground">{plugin.describe}</p>
              <div className="flex flex-wrap gap-4">
                <span className="text-sm text-muted-foreground">版本: {plugin.version}</span>
                <span className="text-sm text-muted-foreground">大小: {plugin.size}</span>
                <span className="text-sm text-muted-foreground">作者: {plugin.author}</span>
              </div>
            </div>
            <div
              className="flex flex-col justify-center items-center gap-2"
              style={{ minWidth: config.enablePluginWebSearch ? 150 : 100 }}
            >
              <div className="flex gap-2">
                {config.enablePluginWebSearch && (
                  <Tooltip>
                    <TooltipTrigger>
                      <Button
                        variant="outline"
                        onClick={() => handleWebSearch(plugin)}
                      >
                        <Globe className="size-4" />
                        搜索
                      </Button>
                    </TooltipTrigger>
                    <TooltipPopup>在 Bing 上搜索该软件</TooltipPopup>
                  </Tooltip>
                )}

                {isDownloading || isProcessing ? (
                  <Button disabled>
                    <Spinner className="size-4" />
                    {isProcessing ? '更新中' : '下载中'}
                  </Button>
                ) : status.installed && !status.canUpdate ? (
                  <Button
                    variant="secondary"
                    disabled
                  >
                    <CheckCircle className="size-4" />
                    已安装
                  </Button>
                ) : status.installed && status.canUpdate ? (
                  <Button
                    variant="destructive"
                    onClick={() => handleUpdatePlugin(plugin)}
                  >
                    更新
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleDownloadPlugin(plugin)}
                  >
                    <Download className="size-4" />
                    下载
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardPanel>
      </Card>
    );
  };

  // 渲染Web搜索界面
  const renderWebSearchView = () => {
    if (!webSearchPlugin) return null;

    const searchQuery = encodeURIComponent(webSearchPlugin.name);
    const bingUrl = `https://www.bing.com/search?q=${searchQuery}`;

    return (
      <div className="plugins-info flex flex-col h-full w-full bg-background overflow-hidden">
        <div className="plugins-info p-4 border-b border-border flex items-center gap-4 bg-card">
          <Button
            variant="outline"
            onClick={handleBackFromWebSearch}
          >
            <ArrowLeft className="size-4" />
            返回
          </Button>

          <div className="flex-1">
            <h4 className="text-lg font-semibold mb-1">{webSearchPlugin.name}</h4>
            <div className="flex gap-4 flex-wrap">
              <span className="text-sm text-muted-foreground">作者: {webSearchPlugin.author}</span>
              <span className="text-sm text-muted-foreground">版本: {webSearchPlugin.version}</span>
              <span className="text-sm text-muted-foreground">大小: {webSearchPlugin.size}</span>
            </div>
            <span className="text-sm text-muted-foreground">{webSearchPlugin.describe}</span>
          </div>
        </div>

        <div className="flex-1 relative">
          <iframe
            src={bingUrl}
            className="w-full h-full border-none"
            title={`搜索 ${webSearchPlugin.name}`}
          />
        </div>
      </div>
    );
  };

  const shouldShowCategories = !isLoadingPlugins && !pluginsError && pluginCategories.length > 0 && hasPlugins;

  const shouldHideScrollbar = pluginsError || !hasPlugins ||
    (isPageLoaded && !isLoadingPlugins && !pluginsError && getCurrentCategoryPlugins().length === 0);

  if (showWebSearch) {
    return (
      <div className="flex h-[calc(100vh-48px)] overflow-hidden">
        {renderWebSearchView()}
      </div>
    );
  }

  if (!isLoadingPlugins && !pluginsError && !hasPlugins) {
    return (
      <div className="p-6 h-[84vh] flex flex-col">
        <h3 className="text-2xl font-semibold mb-6">插件市场</h3>
        <div className="flex-1 flex justify-center items-center">
          <div className="text-center">
            <AlertCircle className="w-16 h-16 mb-2" />
            <h2 className="text-2xl font-semibold mb-2 text-center">出现错误</h2>
            <p className="text-muted-foreground">无法获取到插件列表，插件市场加载失败</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-48px)]">
      {shouldShowCategories && (
        <div className="w-30 shrink-0 relative overflow-hidden">
          <div className="plugins-market-nav bg-card h-full border-r border-border overflow-auto">
            <Tabs
              value={currentCategory}
              onValueChange={handleCategoryChange}
              orientation="vertical"
            >
              <TabsList variant="underline" className="w-full gap-1">
                {getNavItems().map(item => (
                  <TabsTab key={item.itemKey} value={item.itemKey} className="py-2">
                    {item.text}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
      )}

      <div
        className={`plugins-market-list flex-1 p-4 bg-background ${shouldHideScrollbar ? 'overflow-hidden' : 'overflow-auto'}`}
      >
        {isLoadingPlugins && (
          <div className="text-center py-10">
            <Spinner className="size-8 mx-auto" />
          </div>
        )}

        {pluginsError && (
          <div className="p-6 h-[84vh] flex flex-col">
            <h3 className="text-xl font-semibold mb-6">插件市场</h3>
            <div className="flex-1 flex justify-center items-center">
              <div className="text-center">
                <AlertCircle className="size-12 text-destructive mx-auto mb-4" />
                <h4 className="text-lg font-medium mb-2">出现错误</h4>
                <p className="text-muted-foreground">{pluginsError}</p>
              </div>
            </div>
          </div>
        )}

        {isPageLoaded && !isLoadingPlugins && !pluginsError && hasPlugins && (
          <>
            {getCurrentCategoryPlugins().length > 0 ? (
              <div className="flex flex-col gap-4">
                {getCurrentCategoryPlugins().map((plugin, index) =>
                  renderPluginCard(plugin, index)
                )}
              </div>
            ) : (
              <div className="text-center py-10">
                <PackageOpen className="w-16 h-16 mb-6 mx-auto" />
                <h2 className="text-2xl font-semibold mb-2 text-center">暂无插件</h2>
                <p className="text-muted-foreground">
                  {currentCategory === '搜索' ? '没有找到相关插件' : '该分类下暂无插件'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PluginsMarketPage;