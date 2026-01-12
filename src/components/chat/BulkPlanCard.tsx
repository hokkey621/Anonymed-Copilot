import { Check, Clock, Loader2, AlertCircle, FileText, Shield, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BulkExecutionPlan {
  target_count: number;
  estimated_time_ms: number;
  policy_summary: string[];
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
  };
}

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <Check className="w-4 h-4 text-green-500" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case 'failed':
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    default:
      return <Clock className="w-4 h-4 text-slate-400" />;
  }
}

export function BulkPlanCard({ plan, workflowSteps, onCommit, isExecuting, progress }: BulkPlanCardProps) {
  const estimatedSeconds = Math.ceil(plan.estimated_time_ms / 1000);
  const progressPercent = progress ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 overflow-hidden shadow-lg">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5" />
          <h3 className="font-semibold">バルク実行プラン</h3>
        </div>
      </div>

      {/* Plan Summary */}
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 bg-white/60 dark:bg-slate-800/60 rounded-lg p-2">
            <FileText className="w-4 h-4 text-purple-500" />
            <div>
              <div className="text-xs text-muted-foreground">対象ファイル</div>
              <div className="font-semibold">{plan.target_count} 件</div>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-white/60 dark:bg-slate-800/60 rounded-lg p-2">
            <Clock className="w-4 h-4 text-blue-500" />
            <div>
              <div className="text-xs text-muted-foreground">推定時間</div>
              <div className="font-semibold">{estimatedSeconds} 秒</div>
            </div>
          </div>
        </div>

        {/* Policy Summary */}
        <div className="bg-white/60 dark:bg-slate-800/60 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium">適用ポリシー</span>
          </div>
          <ul className="space-y-1">
            {plan.policy_summary.map((policy, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-purple-400" />
                {policy}
              </li>
            ))}
          </ul>
        </div>

        {/* Workflow Steps */}
        <div className="bg-white/60 dark:bg-slate-800/60 rounded-lg p-3">
          <div className="text-sm font-medium mb-3">ワークフロー</div>
          <div className="space-y-2">
            {workflowSteps.map((step) => (
              <div
                key={step.id}
                className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                  step.status === 'running' ? 'bg-blue-50 dark:bg-blue-950/30' :
                  step.status === 'completed' ? 'bg-green-50 dark:bg-green-950/30' :
                  step.status === 'failed' ? 'bg-red-50 dark:bg-red-950/30' :
                  'bg-slate-50 dark:bg-slate-900/30'
                }`}
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-white dark:bg-slate-800 shadow-sm">
                  <StepIcon status={step.status} />
                </div>
                <span className={`text-sm ${step.status === 'pending' ? 'text-muted-foreground' : ''}`}>
                  {step.label}
                </span>
                {step.status === 'running' && progress && (
                  <span className="ml-auto text-xs text-blue-600 dark:text-blue-400">
                    {progress.completed}/{progress.total}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Progress Bar */}
        {isExecuting && progress && (
          <div className="space-y-1">
            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="text-xs text-center text-muted-foreground">
              {progressPercent}% 完了
            </div>
          </div>
        )}

        {/* Commit Button */}
        <Button
          onClick={onCommit}
          disabled={isExecuting}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white shadow-lg"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              処理中...
            </>
          ) : (
            <>
              <Check className="w-4 h-4" />
              Commit All Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
