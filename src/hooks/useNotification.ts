import { useState, useEffect } from 'react';
import { getNotification, NotificationInfo } from '../api/notificationApi';

interface UseNotificationResult {
  notification: NotificationInfo | null;
  isLoading: boolean;
  error: string | null;
}

export const useNotification = (): UseNotificationResult => {
  const [notification, setNotification] = useState<NotificationInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchNotification = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const notificationInfo = await getNotification();
        setNotification(notificationInfo);
      } catch (err) {
        console.error('获取通知失败:', err);
        setError('获取通知失败，请检查网络连接后重试。');
      } finally {
        setIsLoading(false);
      }
    };

    fetchNotification();
  }, []);

  return {
    notification,
    isLoading,
    error
  };
};

