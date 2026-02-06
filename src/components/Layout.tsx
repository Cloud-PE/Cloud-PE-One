/* eslint-disable @typescript-eslint/no-unused-vars */
import "./../App.css";
import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toastManager } from "@/components/ui/toast";
import {
  Minus,
  X,
  Search,
  Home,
  FileDown,
  Puzzle,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown
} from "lucide-react";

import { useAppContext } from '../utils/AppContext';

import { Window } from '@tauri-apps/api/window';
const appWindow = new Window('main');

interface AppLayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

interface NavItem {
  itemKey: string;
  text: string;
  icon: React.ReactNode;
  items?: { itemKey: string; text: string }[];
}

const AppLayout: React.FC<AppLayoutProps> = ({ children, currentPage, onNavigate }) => {
  const {
    bootDriveUpdateAvailable,
    setSearchKeyword,
    searchKeyword,
    pluginCategories,
    isLoadingPlugins,
    pluginsError,
    isGeneratingIso,
    isCreatingBootDrive,
    isUpgradingBootDrive,
    isNetworkConnected
  } = useAppContext();

  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [localSearchValue, setLocalSearchValue] = useState<string>('');
  const [windowWidth, setWindowWidth] = useState<number>(window.innerWidth);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([currentPage]);
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['install', 'plugins']);
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null);

  const navItems: NavItem[] = [
    { itemKey: 'home', text: '首页', icon: <Home className="h-4 w-4" /> },
    {
      itemKey: 'install',
      text: '安装',
      icon: <FileDown className="h-4 w-4" />,
      items: [
        { itemKey: 'create-boot-drive', text: '制作启动盘' },
        { itemKey: 'create-iso', text: '生成ISO镜像' },
        ...(bootDriveUpdateAvailable ? [{ itemKey: 'upgrade-boot-drive', text: '升级' }] : [])
      ]
    },
    {
      itemKey: 'plugins',
      text: '插件',
      icon: <Puzzle className="h-4 w-4" />,
      items: [
        { itemKey: 'download-plugins', text: '下载插件' },
        { itemKey: 'manage-plugins', text: '插件管理' },
      ]
    },
    { itemKey: 'docs', text: '文档', icon: <FileText className="h-4 w-4" /> },
    { itemKey: 'settings', text: '设置', icon: <Settings className="h-4 w-4" /> },
  ];

  const handleMinimize = async () => {
    try {
      await appWindow.minimize();
    } catch (error) {
      console.error('Failed to minimize window:', error);
    }
  };

  const handleClose = async () => {
    try {
      await appWindow.close();
    } catch (error) {
      console.error('Failed to close window:', error);
    }
  };

  const requiresNetworkConnection = (page: string): boolean => {
    const networkRequiredPages = [
      'create-boot-drive',
      'create-iso',
      'upgrade-boot-drive',
      'download-plugins',
      'docs'
    ];
    return networkRequiredPages.includes(page);
  };

  const showWarning = (message: string) => {
    toastManager.add({ title: '提示', description: message, type: 'warning' });
  };

  const handleNavSelect = async (itemKey: string) => {
    if (isGeneratingIso) {
      showWarning('正在生成ISO镜像中，不可切换页面!');
      setSelectedKeys([currentPage]);
      return;
    }

    if (isCreatingBootDrive) {
      showWarning('制作启动盘中，不可切换页面!');
      setSelectedKeys([currentPage]);
      return;
    }

    if (isUpgradingBootDrive) {
      showWarning('升级启动盘中，不可切换页面!');
      setSelectedKeys([currentPage]);
      return;
    }

    if (!isNetworkConnected && requiresNetworkConnection(itemKey)) {
      showWarning('当前处于离线模式，不可使用该功能!');
      setSelectedKeys([currentPage]);
      return;
    }

    setSelectedKeys([itemKey]);
    onNavigate(itemKey);
  };

  const toggleMenu = (itemKey: string) => {
    setExpandedMenus(prev =>
      prev.includes(itemKey)
        ? prev.filter(k => k !== itemKey)
        : [...prev, itemKey]
    );
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalSearchValue(value);
    if (!value.trim()) {
      setSearchKeyword('');
    }
  };

  const handleSearchSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && localSearchValue.trim()) {
      if (isGeneratingIso) {
        showWarning('正在生成ISO镜像中，不可切换页面!');
        return;
      }

      if (isCreatingBootDrive) {
        showWarning('制作启动盘中，不可切换页面!');
        return;
      }

      if (isUpgradingBootDrive) {
        showWarning('升级启动盘中，不可切换页面!');
        return;
      }

      if (!isNetworkConnected) {
        showWarning('当前处于离线模式，不可切换页面!');
        return;
      }

      setSearchKeyword(localSearchValue);
      setSelectedKeys(['download-plugins']);
      onNavigate('download-plugins');
    }
  };

  const getSearchBoxWidth = () => {
    if (windowWidth < 890) {
      return 250;
    } else {
      return 250 + (windowWidth - 889);
    }
  };

  useEffect(() => {
    setLocalSearchValue(searchKeyword);
  }, [searchKeyword]);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setSelectedKeys([currentPage]);
  }, [currentPage]);

  const shouldShowSearchBox = !isLoadingPlugins && !pluginsError && pluginCategories.length > 0 && isNetworkConnected;

  const isItemSelected = (itemKey: string, items?: { itemKey: string }[]) => {
    if (selectedKeys.includes(itemKey)) return true;
    if (items) {
      return items.some(item => selectedKeys.includes(item.itemKey));
    }
    return false;
  };

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-background">
      {/* Header */}
      <header
        className="draggable h-12 flex justify-between items-center px-4 border-b border-border bg-card"
        data-tauri-drag-region
      >
        {/* 左侧Logo和标题区域 */}
        <div className="flex items-center" data-tauri-drag-region>
          <img
            src=""
            className="cloud-pe-logo w-[30px] h-[30px] mr-2"
            alt="Logo"
            data-tauri-drag-region
          />
          <span
            className="cloud-pe-title font-semibold text-xl"
            data-tauri-drag-region
          >
            Cloud-PE
          </span>
        </div>

        {/* 中间搜索框 */}
        {shouldShowSearchBox ? (
          <div className="relative" style={{ width: getSearchBoxWidth() }}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10 pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="输入关键字，回车搜索插件"
              value={localSearchValue}
              onChange={handleSearchChange}
              onKeyPress={handleSearchSubmit}
            />
          </div>
        ) : (
          <div style={{ width: getSearchBoxWidth() }} data-tauri-drag-region />
        )}

        {/* 右侧窗口控制按钮 */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleMinimize}
            className="h-8 w-8"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-8 w-8 hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`bg-card border-r border-border flex flex-col transition-[width] duration-200 ${isCollapsed ? 'w-14' : 'w-52'}`}>
          <nav className="flex-1 py-2 px-2 overflow-visible">
            {navItems.map((item) => (
              <div key={item.itemKey} className="mb-1">
                {item.items ? (
                  <div
                    className="relative"
                    onMouseEnter={() => isCollapsed && setHoveredMenu(item.itemKey)}
                    onMouseLeave={() => isCollapsed && setHoveredMenu(null)}
                  >
                    <button
                      onClick={() => !isCollapsed && toggleMenu(item.itemKey)}
                      className={`w-full flex items-center px-3 py-2 text-sm rounded-lg hover:bg-accent transition-colors ${
                        isItemSelected(item.itemKey, item.items) ? 'bg-accent text-accent-foreground' : 'text-foreground'
                      }`}
                    >
                      <span className="flex-shrink-0">{item.icon}</span>
                      {!isCollapsed && (
                        <>
                          <span className="ml-3 flex-1 text-left">{item.text}</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${expandedMenus.includes(item.itemKey) ? 'rotate-180' : ''}`} />
                        </>
                      )}
                    </button>
                    {/* 展开状态下的子菜单 */}
                    <div
                      className={`ml-5 overflow-hidden transition-all duration-200 ${
                        !isCollapsed && expandedMenus.includes(item.itemKey)
                          ? 'max-h-[500px] opacity-100 mt-1'
                          : 'max-h-0 opacity-0 mt-0'
                      }`}
                    >
                      <div className="space-y-1">
                        {item.items.map((subItem) => (
                          <button
                            key={subItem.itemKey}
                            onClick={() => handleNavSelect(subItem.itemKey)}
                            className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent transition-colors ${
                              selectedKeys.includes(subItem.itemKey) ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground'
                            }`}
                          >
                            {subItem.text}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 收缩状态下的悬浮弹出子菜单 */}
                    {isCollapsed && hoveredMenu === item.itemKey && (
                      <div
                        className="absolute left-full top-0 flex items-start z-50 pl-3"
                        onMouseEnter={() => setHoveredMenu(item.itemKey)}
                        onMouseLeave={() => setHoveredMenu(null)}
                      >
                        <div className="py-2 px-2 bg-popover border border-border rounded-lg shadow-lg min-w-[120px]">
                          <div className="text-xs text-muted-foreground px-2 py-1 mb-1">{item.text}</div>
                          <div className="space-y-1">
                            {item.items.map((subItem) => (
                              <button
                                key={subItem.itemKey}
                                onClick={() => {
                                  handleNavSelect(subItem.itemKey);
                                  setHoveredMenu(null);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent transition-colors whitespace-nowrap ${
                                  selectedKeys.includes(subItem.itemKey) ? 'bg-accent text-accent-foreground font-medium' : 'text-foreground'
                                }`}
                              >
                                {subItem.text}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => handleNavSelect(item.itemKey)}
                    className={`w-full flex items-center px-3 py-2 text-sm rounded-lg hover:bg-accent transition-colors ${
                      selectedKeys.includes(item.itemKey) ? 'bg-accent text-accent-foreground font-medium' : 'text-foreground'
                    }`}
                  >
                    <span className="flex-shrink-0">{item.icon}</span>
                    {!isCollapsed && <span className="ml-3">{item.text}</span>}
                  </button>
                )}
              </div>
            ))}
          </nav>

          {/* Collapse button */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center justify-center p-3 border-t border-border hover:bg-accent transition-colors"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
