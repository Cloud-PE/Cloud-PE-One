import React from 'react';
import CheckCircle from '@/components/icon/CheckCircle';

export interface CacheStep {
  key: string;
  label: string;
}

interface CacheStepsProps {
  steps: CacheStep[];
  // 当前进行中的步骤索引（小于该索引的步骤视为已完成）
  current: number;
}

// 通用的缓存流程步骤条：验证缓存 → 下载/更新/修复缓存 → 复制到目标 →（部署）
const CacheSteps: React.FC<CacheStepsProps> = ({ steps, current }) => {
  return (
    <div className="flex items-center justify-center gap-3 mb-10 w-full max-w-[720px]">
      {steps.map((step, index) => {
        const completed = current > index;
        const active = current === index;
        return (
          <React.Fragment key={step.key}>
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
                  completed || active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {completed ? <CheckCircle className="w-4 h-4" /> : index + 1}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium whitespace-nowrap">
                  {completed ? '已完成' : active ? '进行中' : '等待中'}
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{step.label}</span>
              </div>
            </div>
            {index < steps.length - 1 && (
              <div className={`flex-1 h-0.5 min-w-[16px] ${completed ? 'bg-primary' : 'bg-muted'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default CacheSteps;
