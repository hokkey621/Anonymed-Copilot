import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { ChatThread } from "./types";

interface ChatThreadHeaderProps {
  threads: ChatThread[];
  activeThreadId: string;
  onCreateNewThread: () => void;
  onSwitchThread: (id: string) => void;
  disabled: boolean;
}

export function ChatThreadHeader({
  threads,
  activeThreadId,
  onCreateNewThread,
  onSwitchThread,
  disabled,
}: ChatThreadHeaderProps) {
  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="border-b px-3 py-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">チャット履歴</span>
        <Button
          size="sm"
          variant="outline"
          onClick={onCreateNewThread}
          disabled={disabled}
          className="h-7 px-2 text-xs"
        >
          <Plus size={12} className="mr-1" />
          新規作成
        </Button>
      </div>
      <div className="max-h-24 overflow-y-auto space-y-1">
        {sortedThreads.map((thread) => (
          <button
            key={thread.id}
            onClick={() => onSwitchThread(thread.id)}
            disabled={disabled}
            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
              thread.id === activeThreadId
                ? "bg-blue-500/10 border border-blue-500/20"
                : "hover:bg-muted border border-transparent"
            }`}
          >
            <div className="truncate font-medium">{thread.title}</div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(thread.updatedAt).toLocaleString("ja-JP", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
