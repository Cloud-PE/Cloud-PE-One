import React, { useState, useEffect } from 'react';
import { AlertCircle, Info, ChevronDown } from 'lucide-react';
import { useAppContext } from '../utils/AppContext';
import { getPluginFiles, enablePlugin, disablePlugin, updatePlugin, generatePluginId, compareVersions, Plugin } from '../api/pluginsApi';
import { Button } from '@/components/ui/button';
import { Card, CardPanel } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { toastManager } from '@/components/ui/toast';

const PluginsManagePage: React.FC = () => {
  const { bootDrive, pluginListRefreshTrigger, pluginCategories, isNetworkConnected, config, triggerPluginListRefresh } = useAppContext();
  const [enabledPlugins, setEnabledPlugins] = useState<Plugin[]>([]);
  const [disabledPlugins, setDisabledPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [processingPlugins, setProcessingPlugins] = useState<Record<string, boolean>>({});
  const [updatablePlugins, setUpdatablePlugins] = useState<Set<string>>(new Set());
  const [recentlyUpdatedPlugins, setRecentlyUpdatedPlugins] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ enabled: true, disabled: true });

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 加载插件文件列表
  const fetchPluginFiles = async () => {
    // 如果没有启动盘，不加载插件
    if (!bootDrive) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { enabled, disabled } = await getPluginFiles(bootDrive.letter);
      setEnabledPlugins(enabled);
      setDisabledPlugins(disabled);

      // 如果联网且有插件市场数据，检查更新
      if (isNetworkConnected && pluginCategories.length > 0 && enabled.length > 0) {
        checkForUpdates(enabled);
      }
    } catch (err) {
      console.error('加载插件文件失败:', err);
      setError('加载插件文件失败，请确保启动盘已正确插入。');
    } finally {
      setLoading(false);
    }
  };

  // 检查插件更新
  const checkForUpdates = (localPlugins: Plugin[]) => {
    const updatable = new Set<string>();

    // 创建市场插件映射
    const marketPluginsMap = new Map<string, Plugin>();
    pluginCategories.forEach(category => {
      category.list.forEach(plugin => {
        const id = generatePluginId(plugin.name, plugin.author);
        marketPluginsMap.set(id, plugin);
      });
    });

    // 检查每个本地已启用插件
    localPlugins.forEach(localPlugin => {
      if (localPlugin.id) {
        const marketPlugin = marketPluginsMap.get(localPlugin.id);
        if (marketPlugin) {
          const comparison = compareVersions(localPlugin.version, marketPlugin.version);
          if (comparison < 0) {
            updatable.add(localPlugin.id);
          }
        }
      }
    });

    setUpdatablePlugins(updatable);
  };

  // 对插件进行排序：有更新的在最上面，刚更新的在中间，其他的在最下面
  const sortPluginsByUpdate = (plugins: Plugin[]): Plugin[] => {
    return [...plugins].sort((a, b) => {
      const aHasUpdate = a.id && updatablePlugins.has(a.id);
      const bHasUpdate = b.id && updatablePlugins.has(b.id);
      const aRecentlyUpdated = a.id && recentlyUpdatedPlugins.has(a.id);
      const bRecentlyUpdated = b.id && recentlyUpdatedPlugins.has(b.id);

      // 有更新的排在最前面
      if (aHasUpdate && !bHasUpdate) return -1;
      if (!aHasUpdate && bHasUpdate) return 1;

      // 刚更新的排在中间（有更新的下面，无更新的上面）
      if (aRecentlyUpdated && !bRecentlyUpdated && !bHasUpdate) return -1;
      if (!aRecentlyUpdated && bRecentlyUpdated && !aHasUpdate) return 1;

      // 其他保持原顺序
      return 0;
    });
  };

  // 初始加载和监听刷新触发器
  useEffect(() => {
    fetchPluginFiles();
  }, [bootDrive, pluginListRefreshTrigger]);

  // 当网络状态或插件市场数据变化时，重新检查更新
  useEffect(() => {
    if (isNetworkConnected && pluginCategories.length > 0 && enabledPlugins.length > 0) {
      checkForUpdates(enabledPlugins);
    } else {
      setUpdatablePlugins(new Set());
    }
  }, [isNetworkConnected, pluginCategories, enabledPlugins]);

  // 更新插件文件名后缀的辅助函数
  const updatePluginFileName = (plugin: Plugin, newExtension: string): Plugin => {
    const baseName = plugin.file.replace(/\.(ce|CBK)$/i, '');
    return {
      ...plugin,
      file: `${baseName}.${newExtension}`
    };
  };

  // 启用插件
  const handleEnablePlugin = async (plugin: Plugin) => {
    if (!bootDrive) return;

    try {
      console.log('启用插件:', plugin.file);
      setProcessingPlugins(prev => ({ ...prev, [plugin.file]: true }));

      const success = await enablePlugin(bootDrive.letter, plugin.file);

      if (success) {
        // 创建更新后的插件对象（禁用状态的.CBK文件启用后变成.ce文件）
        const updatedPlugin = updatePluginFileName(plugin, 'ce');
        // 启用后需要分配唯一ID
        updatedPlugin.id = generatePluginId(updatedPlugin.name, updatedPlugin.author);

        // 更新状态
        setDisabledPlugins(prev => prev.filter(p => p.file !== plugin.file));
        setEnabledPlugins(prev => [...prev, updatedPlugin]);

        toastManager.add({
          title: '成功',
          description: `插件 ${plugin.name} 已启用`,
          type: 'success',
        });
      }
    } catch (err) {
      console.error('启用插件失败:', err);
      toastManager.add({
        title: '错误',
        description: `启用插件 ${plugin.name} 失败`,
        type: 'error',
      });
    } finally {
      setProcessingPlugins(prev => ({ ...prev, [plugin.file]: false }));
    }
  };

  // 禁用插件
  const handleDisablePlugin = async (plugin: Plugin) => {
    if (!bootDrive) return;

    try {
      console.log('禁用插件:', plugin.file);
      setProcessingPlugins(prev => ({ ...prev, [plugin.file]: true }));

      const success = await disablePlugin(bootDrive.letter, plugin.file);

      if (success) {
        // 创建更新后的插件对象（启用状态的.ce文件禁用后变成.CBK文件）
        const updatedPlugin = updatePluginFileName(plugin, 'CBK');
        // 禁用后移除唯一ID
        delete updatedPlugin.id;

        // 更新状态
        setEnabledPlugins(prev => prev.filter(p => p.file !== plugin.file));
        setDisabledPlugins(prev => [...prev, updatedPlugin]);

        toastManager.add({
          title: '成功',
          description: `插件 ${plugin.name} 已禁用`,
          type: 'success',
        });
      }
    } catch (err) {
      console.error('禁用插件失败:', err);
      toastManager.add({
        title: '错误',
        description: `禁用插件 ${plugin.name} 失败`,
        type: 'error',
      });
    } finally {
      setProcessingPlugins(prev => ({ ...prev, [plugin.file]: false }));
    }
  };

  // 更新插件
  const handleUpdatePlugin = async (plugin: Plugin) => {
    if (!bootDrive || !plugin.id) return;

    // 从插件市场找到对应的新版本插件
    let marketPlugin: Plugin | null = null;
    for (const category of pluginCategories) {
      const found = category.list.find(p => generatePluginId(p.name, p.author) === plugin.id);
      if (found) {
        marketPlugin = found;
        break;
      }
    }

    if (!marketPlugin) {
      toastManager.add({
        title: '错误',
        description: '未找到插件市场中的对应版本',
        type: 'error',
      });
      return;
    }

    try {
      console.log('更新插件:', plugin.file, '到版本:', marketPlugin.version);
      setProcessingPlugins(prev => ({ ...prev, [plugin.file]: true }));

      const newFileName = `${marketPlugin.name}_${marketPlugin.version}_${marketPlugin.author}_${marketPlugin.describe}.ce`;

      await updatePlugin(
        marketPlugin.link,
        plugin.file,
        newFileName,
        bootDrive.letter,
        config.downloadThreads
      );

      // 标记为刚更新的插件
      const newPluginId = generatePluginId(marketPlugin.name, marketPlugin.author);
      setRecentlyUpdatedPlugins(prev => new Set(prev).add(newPluginId));

      // 5秒后移除"刚更新"标记
      setTimeout(() => {
        setRecentlyUpdatedPlugins(prev => {
          const updated = new Set(prev);
          updated.delete(newPluginId);
          return updated;
        });
      }, 5000);

      // 触发插件列表刷新
      triggerPluginListRefresh();

      toastManager.add({
        title: '更新成功',
        description: `插件 ${plugin.name} 已更新到最新版本`,
        type: 'success',
      });
    } catch (err) {
      console.error('更新插件失败:', err);
      toastManager.add({
        title: '错误',
        description: `插件 ${plugin.name} 更新失败`,
        type: 'error',
      });
    } finally {
      setProcessingPlugins(prev => ({ ...prev, [plugin.file]: false }));
    }
  };

  // 渲染插件卡片
  const renderPluginCard = (plugin: Plugin, isEnabled: boolean) => {
    const isProcessing = processingPlugins[plugin.file];
    const canUpdate = plugin.id && updatablePlugins.has(plugin.id);

    return (
      <Card key={plugin.file} className="mb-4 shadow-sm">
        <CardPanel>
          <div className="flex justify-between">
            <div className="flex-1">
              <div className="flex items-center mb-2">
                <h5 className="text-base font-semibold mr-2">{plugin.name}</h5>
                {canUpdate && <Badge variant="warning">有更新</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mb-2">{plugin.describe}</p>
              <div className="flex flex-wrap gap-4">
                <span className="text-sm text-muted-foreground">版本: {plugin.version}</span>
                <span className="text-sm text-muted-foreground">大小: {plugin.size}</span>
                <span className="text-sm text-muted-foreground">作者: {plugin.author}</span>
                <span className="text-sm text-muted-foreground">文件: {plugin.file}</span>
              </div>
            </div>
            <div className="flex flex-col justify-center items-center min-w-[100px] gap-2">
              {isProcessing ? (
                <Spinner className="size-6" />
              ) : (
                <>
                  {canUpdate && (
                    <Button
                      variant="secondary"
                      onClick={() => handleUpdatePlugin(plugin)}
                    >
                      更新
                    </Button>
                  )}
                  {isEnabled ? (
                    <Button
                      variant="destructive"
                      onClick={() => handleDisablePlugin(plugin)}
                    >
                      禁用
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      onClick={() => handleEnablePlugin(plugin)}
                    >
                      启用
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardPanel>
      </Card>
    );
  };

  // 渲染折叠面板
  const renderCollapsePanel = (key: string, title: string, children: React.ReactNode) => {
    const isExpanded = expandedSections[key];
    return (
      <div className="border rounded-lg mb-4">
        <button
          className="w-full flex items-center justify-between p-4 text-left font-medium hover:bg-accent/50 transition-colors"
          onClick={() => toggleSection(key)}
        >
          <span>{title}</span>
          <ChevronDown className={`size-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
        <div
          className="overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
          style={{
            display: 'grid',
            gridTemplateRows: isExpanded ? '1fr' : '0fr',
          }}
        >
          <div className="min-h-0">
            <div className="p-4 pt-0">
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // 渲染空状态
  const renderEmpty = (icon: React.ReactNode, title: React.ReactNode, description: React.ReactNode) => (
    <div className="flex flex-col items-center justify-center py-12">
      {icon}
      <h4 className="mt-4 text-lg font-medium">{title}</h4>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );

  // 如果没有启动盘，显示提示
  if (!bootDrive) {
    return (
      <div className="p-6 h-[84vh] flex flex-col">
        <h3 className="text-2xl font-semibold mb-6">插件管理</h3>
        <div className="flex justify-center">
          {renderEmpty(
            <AlertCircle className="w-16 h-16 mb-2" />,
            <h2 className="text-2xl font-semibold mb-2 text-center">尚未准备就绪</h2>,
            <p className="text-muted-foreground">目前您还尚未安装或制作 Cloud-PE 启动盘，因此该功能暂不可用！</p>
          )}
        </div>
      </div>
    );
  }

  // 对已启用插件进行排序
  const sortedEnabledPlugins = sortPluginsByUpdate(enabledPlugins);

  return (
    <div className="p-6 h-[84vh] flex flex-col overflow-hidden">
      <h3 className="text-xl font-semibold mb-6 shrink-0">插件管理</h3>

      {loading ? (
        <div className="flex-1 flex justify-center items-center">
          <Spinner className="size-8" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          {renderEmpty(
            <AlertCircle className="size-12" />,
            "加载失败",
            error
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto pr-2">
          {renderCollapsePanel(
            'enabled',
            `已启用插件 (${enabledPlugins.length})`,
            sortedEnabledPlugins.length > 0 ? (
              sortedEnabledPlugins.map(plugin => renderPluginCard(plugin, true))
            ) : (
              renderEmpty(
                <Info className="size-12" />,
                "暂无已启用插件",
                "您可以从插件市场下载插件，或启用已禁用的插件"
              )
            )
          )}

          {renderCollapsePanel(
            'disabled',
            `已禁用插件 (${disabledPlugins.length})`,
            disabledPlugins.length > 0 ? (
              disabledPlugins.map(plugin => renderPluginCard(plugin, false))
            ) : (
              renderEmpty(
                <Info className="size-12" />,
                "暂无已禁用插件",
                "您可以禁用不需要的插件"
              )
            )
          )}
        </div>
      )}
    </div>
  );
};

export default PluginsManagePage;
