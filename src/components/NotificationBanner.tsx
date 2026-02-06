import React from 'react';
import { X, Info, AlertTriangle, AlertCircle } from 'lucide-react';
import CheckCircle from '@/components/icon/CheckCircle';
import { Alert, AlertDescription, AlertAction, AlertTitle } from '@/components/ui/alert';
import { useAppContext } from '../utils/AppContext';

interface NotificationBannerProps {
  type: 'info' | 'warning' | 'danger' | 'success';
  content: string;
}

const iconMap = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertCircle,
  success: CheckCircle,
};

const variantMap = {
  info: 'info',
  warning: 'warning',
  danger: 'error',
  success: 'success',
} as const;

const titleMap = {
  info: '提示',
  warning: '警告',
  danger: '错误',
  success: '成功',
};

const NotificationBanner: React.FC<NotificationBannerProps> = ({ type, content }) => {
  const { notificationClosed, setNotificationClosed } = useAppContext();

  // 处理关闭按钮点击
  const handleClose = () => {
    setNotificationClosed(true);
    localStorage.setItem("lastClosedNotificationContent", content);
  };

  if (notificationClosed) {
    return null;
  }

  const Icon = iconMap[type];

  return (
    <div className="mt-2 mb-4 w-full">
      <Alert variant={variantMap[type]}>
        <Icon className="h-4 w-4" />
        <AlertTitle>{titleMap[type]}</AlertTitle>
        <AlertDescription>{content}</AlertDescription>
        <AlertAction>
          <button
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            aria-label="关闭通知"
          >
            <X className="h-4 w-4" />
          </button>
        </AlertAction>
      </Alert>
    </div>
  );
};

export default NotificationBanner;