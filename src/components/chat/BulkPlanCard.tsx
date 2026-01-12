import { Check, Clock, Loader2, AlertCircle, Shield, Zap, AlertTriangle, FolderOpen, ListChecks, Play } from 'lucide-react';
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
  description?: string;
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

// Default transformations if not provided
const DEFAULT_TRANSFORMATIONS: KeyTransformation[] = [
  { rule: "全ての日付を「Day 0」からの相対表記に変換", enabled: true },
  { rule: "施設名を「施設[A-Z]」に抽象化", enabled: true },
  { rule: "90歳以上の年齢を「90+」に丸め", enabled: true },
];

// Step descriptions explaining why each step is important
const STEP_DESCRIPTIONS: Record<string, string> = {
  validation: "3省2ガイドラインの観点から、まず全ファイルの読み込み可否を検証します",
  dry_run: "メモリ上で仮置換を実行し、不整合やエラーを事前に検出します",
  execution: "検証済みファイルを並列処理で一括変換します",
  staging: "変更内容をプレビュー可能な状態で保持します",
  audit: "法的トレーサビリティのため、監査ログとハッシュ値を記録します",
};

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
  const transformations = plan.key_transformations || DEFAULT_TRANSFORMATIONS;

  return (
    <div className="rounded-xl border-2 border-purple-300 dark:border-purple-700 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/40 dark:to-pink-950/40 overflow-hidden shadow-xl">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5" />
          <h3 className="font-bold text-lg">Plan: Bulk Anonymization</h3>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Target Scope */}
        <div className="bg-white/70 dark:bg-slate-800/70 rounded-lg p-3 border border-purple-100 dark:border-purple-900">
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-semibold">Target Scope</span>
          </div>
          <div className="text-sm text-muted-foreground font-mono bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">
            {plan.target_scope || "選択されたディレクトリ"} 内の全 <span className="font-bold text-purple-600 dark:text-purple-400">{plan.target_count.toLocaleString()}</span> ファイル
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 bg-white/60 dark:bg-slate-800/60 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            <Shield className="w-5 h-5 text-green-500" />
            <div>
              <div className="text-xs text-muted-foreground">Applied Policy</div>
              <div className="font-semibold text-sm">{plan.applied_policy || "Medical Privacy (v1.0)"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-white/60 dark:bg-slate-800/60 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            <Clock className="w-5 h-5 text-blue-500" />
            <div>
              <div className="text-xs text-muted-foreground">推定時間</div>
              <div className="font-semibold text-sm">{estimatedSeconds < 60 ? `${estimatedSeconds} 秒` : `${Math.ceil(estimatedSeconds / 60)} 分`}</div>
            </div>
          </div>
        </div>

        {/* Key Transformations Checklist */}
        <div className="bg-white/70 dark:bg-slate-800/70 rounded-lg p-3 border border-purple-100 dark:border-purple-900">
          <div className="flex items-center gap-2 mb-3">
            <ListChecks className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-semibold">Key Transformations</span>
          </div>
          <div className="space-y-2">
            {transformations.map((t, i) => (
              <label key={i} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-950/30 p-1 rounded">
                <input
                  type="checkbox"
                  checked={t.enabled}
                  readOnly
                  className="w-4 h-4 rounded border-purple-300 text-purple-600 focus:ring-purple-500"
                />
                <span className={t.enabled ? '' : 'text-muted-foreground line-through'}>{t.rule}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Risk Assessment */}
        {(plan.risk_assessment || plan.target_count > 100) && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">Risk Assessment</div>
                <p className="text-xs text-amber-600 dark:text-amber-300 mt-1">
                  {plan.risk_assessment || `${Math.ceil(plan.target_count * 0.002)}件のファイルで通常より長い固有名詞を検知。実行後に個別確認を推奨。`}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Workflow Steps with Descriptions */}
        <div className="bg-white/70 dark:bg-slate-800/70 rounded-lg p-3 border border-purple-100 dark:border-purple-900">
          <div className="flex items-center gap-2 mb-3">
            <Play className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-semibold">Workflow</span>
          </div>
          <div className="space-y-3">
            {workflowSteps.map((step) => (
              <div
                key={step.id}
                className={`rounded-lg transition-all ${
                  step.status === 'running' ? 'bg-blue-50 dark:bg-blue-950/30 ring-2 ring-blue-300 dark:ring-blue-700' :
                  step.status === 'completed' ? 'bg-green-50 dark:bg-green-950/30' :
                  step.status === 'failed' ? 'bg-red-50 dark:bg-red-950/30' :
                  'bg-slate-50 dark:bg-slate-900/30'
                }`}
              >
                <div className="flex items-center gap-3 p-2">
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-white dark:bg-slate-800 shadow-sm border">
                    <StepIcon status={step.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${step.status === 'pending' ? 'text-muted-foreground' : ''}`}>
                        {step.label}
                      </span>
                      {step.status === 'completed' && (
                        <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">済</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {step.description || STEP_DESCRIPTIONS[step.id] || ""}
                    </p>
                  </div>
                  {step.status === 'running' && progress && (
                    <span className="text-xs font-mono bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                      {progress.completed}/{progress.total}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Enhanced Progress Bar */}
        {isExecuting && progress && (
          <div className="space-y-2 bg-slate-100 dark:bg-slate-900 rounded-lg p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">進捗状況</span>
              <span className="font-semibold text-purple-600 dark:text-purple-400">{progressPercent}%</span>
            </div>
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 transition-all duration-300 animate-pulse"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {progress.currentFile && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="truncate font-mono">処理中: {progress.currentFile}</span>
              </div>
            )}
          </div>
        )}

        {/* Commit Button */}
        <Button
          onClick={onCommit}
          disabled={isExecuting}
          size="lg"
          className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white shadow-lg font-semibold text-base h-12"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              処理中...
            </>
          ) : (
            <>
              <Check className="w-5 h-5" />
              Commit All Changes ({plan.target_count.toLocaleString()} files)
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
