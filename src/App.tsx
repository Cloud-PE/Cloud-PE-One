import React, { useState, useEffect } from 'react';
import { AppProvider, useAppContext } from './utils/AppContext';
import { ToastProvider } from '@/components/ui/toast';
import LoadingScreen from './components/LoadingScreen';
import AppLayout from './components/Layout';
import HomePage from './pages/HomePage';
import SettingsPage from './pages/SettingsPage';
import DocsPage from './pages/DocsPage';
import PluginsMarketPage from './pages/PluginsMarketPage';
import PluginsManagePage from './pages/PluginsManagePage';
import UpgradeBootDrivePage from './pages/UpgradeBootDrivePage';
import CreateIsoPage from './pages/CreateIsoPage';
import CreatStartupDisk from './pages/CreatStartupDisk';
import UpdateNotification from './components/UpdateNotification';
import './App.css';

// 主应用组件
const AppContent: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<string>('home');
  const {
    updateInfo, 
    updateDialogVisible, 
    setUpdateDialogVisible 
  } = useAppContext();

  // 全局禁用右键菜单
  useEffect(() => {
    const disableContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    
    document.addEventListener('contextmenu', disableContextMenu);
    
    return () => {
      document.removeEventListener('contextmenu', disableContextMenu);
    };
  }, []);

  const handleLoadingComplete = () => {
    setIsLoading(false);
  };

  const handleNavigate = async (page: string) => {
    setCurrentPage(page);
  };

  // 处理更新对话框关闭
  const handleUpdateDialogClose = () => {
    // 只有可跳过的更新才能关闭对话框
    if (updateInfo?.canSkip) {
      setUpdateDialogVisible(false);
    }
  };

  // 根据当前页面渲染对应组件
  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={handleNavigate}/>;
      case 'settings':
        return <SettingsPage/>;
      case 'docs':
        return <DocsPage />;
      case 'create-boot-drive':
        return <CreatStartupDisk onNavigate={handleNavigate}/>;
      case 'create-iso':
        return <CreateIsoPage />;
      case 'upgrade-boot-drive':
        return <UpgradeBootDrivePage onNavigate={handleNavigate}/>;
      case 'download-plugins':
        return <PluginsMarketPage />;
      case 'manage-plugins':
        return <PluginsManagePage />;
      default:
        return <HomePage onNavigate={handleNavigate} />;
    }
  };

  return (
    <>
      {isLoading ? (
        <LoadingScreen onLoadingComplete={handleLoadingComplete} />
      ) : (
        <>
          <AppLayout currentPage={currentPage} onNavigate={handleNavigate}>
            {renderPage()}
          </AppLayout>
          
          {/* 更新通知对话框 */}
          {updateInfo && (
            <UpdateNotification
              visible={updateDialogVisible}
              onClose={handleUpdateDialogClose}
              version={updateInfo.version}
              updateLog={updateInfo.updateLog}
              downloadLink={updateInfo.downloadLink}
              appExecutableName={updateInfo.appExecutableName}
              canSkip={updateInfo.canSkip}
            />
          )}
        </>
      )}
    </>
  );
};

// 应用入口
const App: React.FC = () => {
  return (
    <AppProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AppProvider>
  );
};

export default App;