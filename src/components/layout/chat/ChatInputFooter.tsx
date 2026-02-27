import { Button } from "@/components/ui/button";
import { Send, FileText, Loader2, Sparkles, Square } from "lucide-react";
import { MODEL_OPTIONS } from "./constants";
import type { ModelProvider, Message } from "./types";
import { useState } from "react";

interface ChatInputFooterProps {
  inputInfo: string;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  isProcessing: boolean;
  isChatLoading: boolean;
  currentContent: string;
  currentFileName: string;
  selectedProvider: ModelProvider;
  onProviderChange: (provider: ModelProvider) => void;
  modelLabel: string;
  canStop: boolean;
  isStopRequested: boolean;
  onStop: () => void;
  activeSkills: string[];
  // Bulk save
  bulkReviewMode: boolean;
  allReviewed: boolean;
  approvedCount: number;
  onBulkComplete?: () => Promise<any>;
  messages: Message[];
  onReplaceThread: (messages: Message[]) => void;
  onStopOperations?: () => void;
}

export function ChatInputFooter({
  inputInfo,
  onInputChange,
  onSendMessage,
  isProcessing,
  isChatLoading,
  currentContent,
  currentFileName,
  selectedProvider,
  onProviderChange,
  modelLabel,
  canStop,
  isStopRequested,
  onStop,
  activeSkills,
  bulkReviewMode,
  allReviewed,
  approvedCount,
  onBulkComplete,
  messages,
  onReplaceThread,
}: ChatInputFooterProps) {
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  return (
    <div className="border-t p-3 space-y-2">
      {bulkReviewMode && allReviewed && (
        <div className="flex items-center justify-between gap-2 text-xs bg-blue-50/60 dark:bg-blue-900/20 px-2 py-1.5 rounded border border-blue-200/60 dark:border-blue-700/40">
          <span className="text-blue-700 dark:text-blue-200">
            保存対象: {approvedCount} 件
          </span>
          <Button
            size="sm"
            variant="default"
            onClick={async () => {
              if (onBulkComplete) {
                const result = await onBulkComplete();
                if (result && typeof result === 'object' && 'path' in result) {
                  onReplaceThread([...messages, {
                    role: "assistant",
                    content: `✅ 保存が完了しました！\n\n**保存先:**\n\`${result.path}\`\n\n**保存されたファイル (${result.files.length}件):**\n${result.files.map((f: string) => `- ${f}`).join('\n')}`
                  }]);
                } else if (typeof result === 'string') {
                  onReplaceThread([...messages, {
                    role: "assistant",
                    content: `✅ 保存が完了しました！\n\n**保存先:**\n\`${result}\``
                  }]);
                }
              }
            }}
            disabled={approvedCount === 0}
          >
            保存して終了
          </Button>
        </div>
      )}
      {/* Active Skills indicator */}
      {activeSkills.length > 0 && (
        <div className="flex items-center gap-2 text-xs bg-purple-500/10 px-2 py-1.5 rounded border border-purple-500/20">
          <Sparkles size={12} className="text-purple-500" />
          <span className="text-purple-700 dark:text-purple-300">適用中のスキル:</span>
          <div className="flex gap-1 flex-wrap">
            {activeSkills.map(skill => (
              <span
                key={skill}
                className="bg-purple-500/20 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded text-xs font-medium"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Target file indicator */}
      {(currentFileName || currentContent) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1.5 rounded">
          <FileText size={12} />
          <span className="truncate">{currentFileName || "選択中のテキスト"}</span>
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={inputInfo}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={currentContent ? "質問を入力..." : "ご質問をどうぞ"}
          onKeyDown={(e) => e.key === 'Enter' && e.metaKey && onSendMessage()}
          disabled={isProcessing || isChatLoading}
        />
        {canStop ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={onStop}
            disabled={isStopRequested}
            className="shrink-0 gap-1.5"
          >
            {isStopRequested ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
            停止
          </Button>
        ) : (
          <Button
            size="sm"
            variant="default"
            onClick={onSendMessage}
            disabled={!inputInfo.trim() || isChatLoading || isProcessing}
            className="shrink-0 gap-1.5"
          >
            <Send size={14} />
            送信
          </Button>
        )}
      </div>

      {/* Model selector row */}
      <div className="flex items-center justify-between text-xs">
        <div className="relative">
          <button
            onClick={() => setShowModelDropdown(!showModelDropdown)}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors text-muted-foreground"
          >
            {modelLabel}
          </button>
          {showModelDropdown && (
            <div className="absolute bottom-full left-0 mb-1 bg-popover border rounded-md shadow-lg py-1 min-w-[180px] z-50">
              {MODEL_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onProviderChange(opt.value);
                    setShowModelDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-muted ${selectedProvider === opt.value ? 'text-blue-500' : ''}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {isProcessing && (
          <span className="text-muted-foreground flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            処理中...
          </span>
        )}
      </div>
    </div>
  );
}
