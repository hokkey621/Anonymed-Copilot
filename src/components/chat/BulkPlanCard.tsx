import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BulkExecutionPlan {
  targetCount: number;
  estimatedTimeMs: number;
  policySummary: string[];
}

interface WorkflowStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface BulkPlanCardProps {
  plan: BulkExecutionPlan;
  workflowSteps: WorkflowStep[];
  onCommit: () => void;
  isExecuting: boolean;
  progress?: {
    completed: number;
    total: number;
    currentFile?: string;
  };
}

export function BulkPlanCard({ plan, onCommit, isExecuting, progress }: BulkPlanCardProps) {
  const progressPercent = progress ? Math.round((progress.completed / progress.total) * 100) : 0;
  const estimatedSeconds = Math.ceil(plan.estimatedTimeMs / 1000);

  return (
    <div className="rounded-md border bg-muted/30 text-sm">
      {/* Header */}
      <div className="px-3 py-2 border-b bg-muted/50 flex items-center justify-between">
        <span className="font-medium">確認と実行</span>
        <span className="text-xs text-muted-foreground">
          {plan.targetCount} ファイル · 約{estimatedSeconds}秒
        </span>
      </div>

      <div className="p-3 space-y-3">
        {/* Progress Bar (only when executing) */}
        {isExecuting && progress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>処理中...</span>
              <span>{progress.completed}/{progress.total}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {progress.currentFile && (
              <div className="text-xs text-muted-foreground truncate">
                {progress.currentFile}
              </div>
            )}
          </div>
        )}

        {/* Execute Button */}
        <Button
          onClick={onCommit}
          disabled={isExecuting}
          size="sm"
          className="w-full"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
              実行中...
            </>
          ) : (
            '匿名化を実行'
          )}
        </Button>
      </div>
    </div>
  );
}
