import { Button } from "@/components/ui/button";

interface FileStatus {
  path: string;
  fileName: string;
  status: "approved" | "skipped" | "pending";
}

interface BulkReviewProgress {
  current: number;
  total: number;
  fileName: string;
}

interface BulkAnalysisProgress {
  completed: number;
  total: number;
  isAnalyzing: boolean;
}

interface BulkReviewControlsProps {
  bulkReviewMode: boolean;
  bulkReviewProgress?: BulkReviewProgress;
  bulkAnalysisProgress?: BulkAnalysisProgress;
  onBulkApprove?: () => void;
  onBulkSkip?: () => void;
  onBulkCancel?: () => void;
  onBulkPrevious?: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  fileStatuses: FileStatus[];
  isApproving: boolean;
  onSetApproving: (v: boolean) => void;
}

export function BulkReviewControls({
  bulkReviewMode,
  bulkReviewProgress,
  bulkAnalysisProgress,
  onBulkApprove,
  onBulkSkip,
  onBulkCancel,
  onBulkPrevious,
  canGoPrevious,
  canGoNext,
  fileStatuses,
  isApproving,
  onSetApproving,
}: BulkReviewControlsProps) {
  return (
    <>
      {/* Analysis Progress - shown during AI analysis phase */}
      {bulkAnalysisProgress?.isAnalyzing && (
        <div className="border-t p-3 space-y-2 bg-amber-50 dark:bg-amber-900/20">
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex gap-1">
              <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            <span className="font-medium">
              🔄 AI分析中... {bulkAnalysisProgress.completed}/{bulkAnalysisProgress.total}件完了
            </span>
          </div>
          <div
            className="h-1.5 bg-muted rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={bulkAnalysisProgress.completed}
            aria-valuemin={0}
            aria-valuemax={bulkAnalysisProgress.total}
            aria-label={`分析進捗: ${bulkAnalysisProgress.completed}/${bulkAnalysisProgress.total}`}
          >
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${(bulkAnalysisProgress.completed / bulkAnalysisProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Bulk Review Controls - shown when in review mode */}
      {bulkReviewMode && bulkReviewProgress && (
        <div className="border-t p-3 space-y-2 bg-blue-50 dark:bg-blue-900/20">
          <div className="text-xs text-blue-700 dark:text-blue-200">
            一括レビュー中の保存は、チャットの「保存して終了」から行います。
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              ファイル {bulkReviewProgress.current}/{bulkReviewProgress.total}
            </span>
            <span className="text-muted-foreground truncate max-w-[150px]">
              {bulkReviewProgress.fileName}
            </span>
          </div>
          <div
            className="h-1.5 bg-muted rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={bulkReviewProgress.current}
            aria-valuemin={0}
            aria-valuemax={bulkReviewProgress.total}
            aria-label={`レビュー進捗: ${bulkReviewProgress.current}/${bulkReviewProgress.total}`}
          >
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${(bulkReviewProgress.current / bulkReviewProgress.total) * 100}%` }}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onBulkPrevious}
              disabled={!canGoPrevious}
              className="px-2"
            >
              ← 前へ
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onBulkSkip}
              className="flex-1"
            >
              スキップ
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                onSetApproving(true);
                onBulkApprove?.();
                setTimeout(() => onSetApproving(false), 800);
              }}
              className={`flex-1 transition-all duration-300 ${isApproving ? "bg-green-600 hover:bg-green-700 scale-105" : ""}`}
              disabled={isApproving}
            >
              {isApproving ? "承認済!" : (canGoNext ? "承認して次へ" : "承認")}
            </Button>
          </div>

          {/* File status list */}
          <div className="mt-2 max-h-24 overflow-y-auto text-xs space-y-1">
            {fileStatuses.map((f, i) => (
              <div key={f.path} className={`flex items-center gap-1.5 px-1 py-0.5 rounded ${
                bulkReviewProgress?.current === i + 1 ? 'bg-blue-100 dark:bg-blue-900/30' : ''
              }`}>
                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  f.status === 'approved' ? 'bg-green-500' :
                  f.status === 'skipped' ? 'bg-gray-400' : 'bg-gray-200'
                }`} />
                <span className="truncate flex-1">{f.fileName}</span>
                <span className="text-muted-foreground">
                  {f.status === 'approved' ? '✓' : f.status === 'skipped' ? '−' : ''}
                </span>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-2">
            <button
              onClick={onBulkCancel}
              className="flex-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
            >
              中断
            </button>
          </div>
          {!canGoNext && (
            <div className="text-xs text-blue-700 dark:text-blue-200">
              これが最後のファイルです。承認後に「保存して終了」を押してください。
            </div>
          )}
        </div>
      )}
    </>
  );
}
