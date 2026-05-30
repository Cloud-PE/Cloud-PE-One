import React from 'react';
import {
  Download,
  X,
  RotateCcw,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  PackageOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardPanel } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { toastManager } from '@/components/ui/toast';
import { useTaskQueue, DownloadTask, TaskStatus } from '../utils/TaskQueueContext';

const statusMeta: Record<
  TaskStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline' }
> = {
  pending: { label: '等待中', variant: 'secondary' },
  downloading: { label: '下载中', variant: 'default' },
  completed: { label: '已完成', variant: 'success' },
  failed: { label: '失败', variant: 'destructive' },
  canceled: { label: '已取消', variant: 'warning' },
};

const PluginsTaskQueuePage: React.FC = () => {
  const { tasks, cancelTask, retryTask, removeTask, clearFinished } = useTaskQueue();

  const activeTasks = tasks.filter(
    (t) => t.status === 'downloading' || t.status === 'pending'
  );
  const finishedTasks = tasks.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'canceled'
  );

  const handleCancel = (task: DownloadTask) => {
    cancelTask(task.id);
    toastManager.add({
      type: 'info',
      title: '已请求取消',
      description: `正在取消「${task.name}」的下载`,
    });
  };

  const handleRetry = (task: DownloadTask) => {
    retryTask(task.id);
    toastManager.add({
      type: 'info',
      title: '已重新加入队列',
      description: `「${task.name}」将重新下载`,
    });
  };

  const renderStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'downloading':
        return <Spinner className="h-4 w-4" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'canceled':
        return <Ban className="h-4 w-4 text-amber-500" />;
      default:
        return null;
    }
  };

  const renderTaskCard = (task: DownloadTask) => {
    const meta = statusMeta[task.status];
    return (
      <Card key={task.id} className="flex flex-col">
        <CardPanel className="pt-4 pb-4 flex flex-col">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex-shrink-0">{renderStatusIcon(task.status)}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm truncate" title={task.name}>
                  {task.name}
                </h3>
                <Badge variant="secondary" className="text-xs">
                  v{task.version}
                </Badge>
                <Badge variant={meta.variant} className="text-xs">
                  {meta.label}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {task.author} · {task.size} · {task.driveLetter}
              </p>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              {task.status === 'downloading' && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleCancel(task)}
                  title="取消下载"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
              {task.status === 'pending' && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleCancel(task)}
                  title="移出队列"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
              {(task.status === 'failed' || task.status === 'canceled') && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleRetry(task)}
                  title="重试"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
              {task.status !== 'downloading' && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeTask(task.id)}
                  title="移除记录"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {task.status === 'downloading' && (
            <div className="mt-3">
              <Progress value={task.progress}>
                <ProgressTrack>
                  <ProgressIndicator />
                </ProgressTrack>
              </Progress>
              <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground tabular-nums">
                <span>{task.progress.toFixed(1)}%</span>
                <span>{task.speed}</span>
              </div>
            </div>
          )}

          {task.status === 'failed' && task.error && (
            <p className="mt-2 text-xs text-destructive line-clamp-2" title={task.error}>
              {task.error}
            </p>
          )}
        </CardPanel>
      </Card>
    );
  };

  return (
    <div className="pt-6 px-6 w-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-2xl font-semibold">任务队列</h3>
        {finishedTasks.length > 0 && (
          <Button size="sm" variant="outline" onClick={clearFinished}>
            <Trash2 className="h-4 w-4 mr-1" />
            清除已完成
          </Button>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="flex justify-center">
          <div className="flex flex-col items-center justify-center py-12">
            <PackageOpen className="w-16 h-16 mb-2" />
            <h2 className="mt-4 text-2xl font-semibold mb-2 text-center">暂无下载任务</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              当前没有任何下载任务，前往插件市场即可添加下载任务。
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {activeTasks.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Download className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-muted-foreground">
                  进行中（{activeTasks.length}）
                </h3>
              </div>
              <div className="flex flex-col gap-3">{activeTasks.map(renderTaskCard)}</div>
            </section>
          )}

          {finishedTasks.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-muted-foreground">
                  已结束（{finishedTasks.length}）
                </h3>
              </div>
              <div className="flex flex-col gap-3">{finishedTasks.map(renderTaskCard)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default PluginsTaskQueuePage;
