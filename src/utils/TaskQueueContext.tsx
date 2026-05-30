import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { downloadPlugin } from '../api/pluginsApi';
import { useAppContext } from './AppContext';

// 下载任务状态
export type TaskStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'canceled';

// 下载任务
export interface DownloadTask {
  id: string;
  pluginId: string; // name|author
  name: string;
  version: string;
  author: string;
  describe: string;
  size: string;
  link: string;
  fileName: string;
  driveLetter: string;
  status: TaskStatus;
  progress: number; // 0-100
  speed: string; // 例如 "1.23MB/s"
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

// 入队参数
export interface EnqueueInput {
  name: string;
  version: string;
  author: string;
  describe: string;
  size: string;
  link: string;
  driveLetter: string;
}

export type EnqueueResult = 'added' | 'exists' | 'no-drive';

interface TaskQueueContextType {
  tasks: DownloadTask[];
  enqueueDownload: (input: EnqueueInput) => EnqueueResult;
  cancelTask: (id: string) => void;
  retryTask: (id: string) => void;
  removeTask: (id: string) => void;
  clearFinished: () => void;
  isPluginActive: (pluginId: string) => boolean; // 等待中或下载中
}

const STORAGE_KEY = 'pluginDownloadQueue';

const TaskQueueContext = createContext<TaskQueueContextType | undefined>(undefined);

const genId = (pluginId: string): string =>
  `${pluginId}__${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

interface TaskQueueProviderProps {
  children: ReactNode;
}

export const TaskQueueProvider: React.FC<TaskQueueProviderProps> = ({ children }) => {
  const { config, triggerPluginListRefresh } = useAppContext();

  // 初始化：从 localStorage 恢复（有记忆）。
  // 上次中断的“下载中”任务重置为“等待中”，由处理器自动续传（后端支持断点续传）。
  const [tasks, setTasks] = useState<DownloadTask[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed: DownloadTask[] = saved ? JSON.parse(saved) : [];
      return parsed.map((t) =>
        t.status === 'downloading'
          ? { ...t, status: 'pending' as TaskStatus, progress: 0, speed: '0.00MB/s' }
          : t
      );
    } catch {
      return [];
    }
  });

  const tasksRef = useRef<DownloadTask[]>(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // 持久化
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // 忽略写入失败
    }
  }, [tasks]);

  const processingRef = useRef<boolean>(false);
  const activeIdRef = useRef<string | null>(null);
  const canceledRef = useRef<Set<string>>(new Set());

  const threadsRef = useRef<number>(config.downloadThreads ?? 8);
  useEffect(() => {
    threadsRef.current = config.downloadThreads ?? 8;
  }, [config.downloadThreads]);

  const updateTask = useCallback((id: string, patch: Partial<DownloadTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // 监听后端下载进度。下载为顺序执行，全局仅一个活动任务，事件无歧义。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<{ progress: string; speed: string; downloading: boolean }>(
      'download://progress',
      (e) => {
        const id = activeIdRef.current;
        if (!id) return;
        const pct = parseFloat(String(e.payload.progress).replace('%', ''));
        updateTask(id, {
          progress: isNaN(pct) ? 0 : Math.min(100, Math.max(0, pct)),
          speed: e.payload.speed || '0.00MB/s',
        });
      }
    ).then((u) => {
      un = u;
    });
    return () => {
      if (un) un();
    };
  }, [updateTask]);

  // 顺序处理队列
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    const next = tasksRef.current.find((t) => t.status === 'pending');
    if (!next) return;

    processingRef.current = true;
    activeIdRef.current = next.id;
    updateTask(next.id, {
      status: 'downloading',
      progress: 0,
      speed: '0.00MB/s',
      error: undefined,
    });

    try {
      await downloadPlugin(next.link, next.fileName, next.driveLetter, threadsRef.current);
      updateTask(next.id, {
        status: 'completed',
        progress: 100,
        speed: '0.00MB/s',
        finishedAt: Date.now(),
      });
      try {
        triggerPluginListRefresh();
      } catch {
        // 忽略刷新失败
      }
    } catch (err) {
      if (canceledRef.current.has(next.id)) {
        canceledRef.current.delete(next.id);
        updateTask(next.id, { status: 'canceled', finishedAt: Date.now() });
      } else {
        updateTask(next.id, {
          status: 'failed',
          error: String(err),
          finishedAt: Date.now(),
        });
      }
    } finally {
      activeIdRef.current = null;
      processingRef.current = false;
      // 继续处理下一个
      setTimeout(() => {
        void processQueue();
      }, 60);
    }
  }, [updateTask, triggerPluginListRefresh]);

  // 出现等待任务时启动处理器
  useEffect(() => {
    if (!processingRef.current && tasks.some((t) => t.status === 'pending')) {
      void processQueue();
    }
  }, [tasks, processQueue]);

  const enqueueDownload = useCallback((input: EnqueueInput): EnqueueResult => {
    if (!input.driveLetter) return 'no-drive';
    const pluginId = `${input.name}|${input.author}`;
    const exists = tasksRef.current.some(
      (t) => t.pluginId === pluginId && (t.status === 'pending' || t.status === 'downloading')
    );
    if (exists) return 'exists';

    const fileName = `${input.name}_${input.version}_${input.author}_${input.describe}.ce`;
    const task: DownloadTask = {
      id: genId(pluginId),
      pluginId,
      name: input.name,
      version: input.version,
      author: input.author,
      describe: input.describe,
      size: input.size,
      link: input.link,
      fileName,
      driveLetter: input.driveLetter,
      status: 'pending',
      progress: 0,
      speed: '0.00MB/s',
      createdAt: Date.now(),
    };
    setTasks((prev) => [task, ...prev]);
    return 'added';
  }, []);

  const cancelTask = useCallback(
    (id: string) => {
      const t = tasksRef.current.find((x) => x.id === id);
      if (!t) return;
      if (t.status === 'downloading') {
        // 标记取消并请求后端取消当前下载（顺序下载，全局取消即取消当前任务）
        canceledRef.current.add(id);
        void invoke('cancel_download').catch(() => {});
      } else if (t.status === 'pending') {
        updateTask(id, { status: 'canceled', finishedAt: Date.now() });
      }
    },
    [updateTask]
  );

  const retryTask = useCallback(
    (id: string) => {
      const t = tasksRef.current.find((x) => x.id === id);
      if (!t || (t.status !== 'failed' && t.status !== 'canceled')) return;
      updateTask(id, {
        status: 'pending',
        progress: 0,
        speed: '0.00MB/s',
        error: undefined,
        finishedAt: undefined,
      });
    },
    [updateTask]
  );

  const removeTask = useCallback((id: string) => {
    const t = tasksRef.current.find((x) => x.id === id);
    if (t && t.status === 'downloading') return; // 下载中的任务请先取消
    setTasks((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((prev) =>
      prev.filter((t) => t.status === 'pending' || t.status === 'downloading')
    );
  }, []);

  const activePluginIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) {
      if (t.status === 'pending' || t.status === 'downloading') s.add(t.pluginId);
    }
    return s;
  }, [tasks]);

  const isPluginActive = useCallback(
    (pluginId: string) => activePluginIds.has(pluginId),
    [activePluginIds]
  );

  const value: TaskQueueContextType = {
    tasks,
    enqueueDownload,
    cancelTask,
    retryTask,
    removeTask,
    clearFinished,
    isPluginActive,
  };

  return <TaskQueueContext.Provider value={value}>{children}</TaskQueueContext.Provider>;
};

export const useTaskQueue = (): TaskQueueContextType => {
  const ctx = useContext(TaskQueueContext);
  if (ctx === undefined) {
    throw new Error('useTaskQueue must be used within a TaskQueueProvider');
  }
  return ctx;
};
