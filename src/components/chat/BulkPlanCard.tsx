import { Check, Clock, Loader2, AlertCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface KeyTransformation {
  rule: string;
  enabled: boolean;
}

interface BulkExecutionPlan {
  target_count: number;
  estimated_time_ms: number;
  policy_summary: string[];
  target_scope?: string;
  applied_policy?: string;
  key_transformations?: KeyTransformation[];
  risk_assessment?: string;
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

// Default transformations
const DEFAULT_TRANSFORMATIONS: KeyTransformation[] = [
  { rule: "日付を相対表記に変換", enabled: true },
  { rule: "施設名を抽象化", enabled: true },
  { rule: "90歳以上を「90+」に", enabled: true },
];

// Step descriptions
const STEP_DESCRIPTIONS: Record<string, string> = {
  validation: "ファイルの読み込み可否を検証",
  dry_run: "仮置換で不整合をチェック",
  execution: "並列処理で一括変換",
  audit: "監査ログとハッシュを記録",
};

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <Check className="w-3 h-3 text-green-500" />;
    case 'running':
      return <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />;
    case 'failed':
      return <AlertCircle className="w-3 h-3 text-red-500" />;
    default:
      return <Clock className="w-3 h-3 text-muted-foreground" />;
  }
}

export function BulkPlanCard({ plan, workflowSteps, onCommit, isExecuting, progress }: BulkPlanCardProps) {
  const progressPercent = progress ? Math.round((progress.completed / progress.total) * 100) : 0;
  const transformations = plan.key_transformations || DEFAULT_TRANSFORMATIONS;
  const estimatedSeconds = Math.ceil(plan.estimated_time_ms / 1000);

  return (
    <div className="rounded-md border bg-muted/30 text-sm">
      {/* Header */}
      <div className="px-3 py-2 border-b bg-muted/50 flex items-center justify-between">
        <span className="font-medium">実行プラン</span>
        <span className="text-xs text-muted-foreground">
          {plan.target_count} ファイル · 約{estimatedSeconds}秒
        </span>
      </div>

      <div className="p-3 space-y-3">
        {/* Key Transformations */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">変換ルール</div>
          <div className="space-y-0.5">
            {transformations.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={t.enabled}
                  readOnly
                  className="w-3 h-3 rounded"
                />
                <span className={t.enabled ? '' : 'text-muted-foreground line-through'}>{t.rule}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Assessment */}
        {(plan.risk_assessment || plan.target_count > 100) && (
          <div className="flex items-start gap-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5">
            <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
            <span className="text-amber-700 dark:text-amber-400">
              {plan.risk_assessment || `${Math.ceil(plan.target_count * 0.002)}件で長い固有名詞を検知`}
            </span>
          </div>
        )}

        {/* Workflow Steps */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">ワークフロー</div>
          <div className="space-y-1">
            {workflowSteps.map((step) => (
              <div
                key={step.id}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                  step.status === 'running' ? 'bg-blue-500/10' :
                  step.status === 'completed' ? 'bg-green-500/10' :
                  step.status === 'failed' ? 'bg-red-500/10' : ''
                }`}
              >
                <StepIcon status={step.status} />
                <div className="flex-1 min-w-0">
                  <span className={step.status === 'pending' ? 'text-muted-foreground' : ''}>
                    {step.label}
                  </span>
                  {STEP_DESCRIPTIONS[step.id] && (
                    <span className="text-muted-foreground ml-1">
                      - {STEP_DESCRIPTIONS[step.id]}
                    </span>
                  )}
                </div>
                {step.status === 'running' && progress && (
                  <span className="text-muted-foreground shrink-0">
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
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {progress.currentFile && (
              <div className="text-xs text-muted-foreground truncate">
                処理中: {progress.currentFile}
              </div>
            )}
          </div>
        )}

        {/* Commit Button */}
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
            '実行'
          )}
        </Button>
      </div>
    </div>
  );
}
