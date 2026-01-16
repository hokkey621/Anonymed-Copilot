import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TabFile {
  path: string;
  filename: string;
  hasChanges?: boolean;
}

interface EditorTabsProps {
  files: TabFile[];
  activeFilePath?: string;
  onSelectFile: (file: TabFile) => void;
  onCloseFile: (file: TabFile) => void;
}

/**
 * EditorTabs - VS Code 風のタブバー
 *
 * エディタ上部に開いているファイルをタブ形式で表示。
 * - アクティブタブのハイライト
 * - 未保存変更のインジケータ
 * - 閉じるボタン
 */
export function EditorTabs({
  files,
  activeFilePath,
  onSelectFile,
  onCloseFile,
}: EditorTabsProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="h-9 bg-muted/30 border-b flex items-stretch shrink-0 overflow-x-auto overflow-y-hidden scrollbar-thin">
      {files.map((file) => {
        const isActive = file.path === activeFilePath;
        return (
          <div
            key={file.path}
            className={cn(
              "group flex items-center gap-2 px-3 h-full cursor-pointer border-r transition-colors min-w-0 shrink-0",
              "hover:bg-slate-100 dark:hover:bg-slate-800/50",
              isActive
                ? "bg-background border-b-2 border-b-blue-500"
                : "bg-muted/20"
            )}
            onClick={() => onSelectFile(file)}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectFile(file);
              }
            }}
          >
            <span
              className={cn(
                "text-sm truncate max-w-[120px]",
                isActive ? "text-foreground font-medium" : "text-muted-foreground"
              )}
            >
              {file.filename}
            </span>
            {file.hasChanges && (
              <span
                className="text-orange-500 font-bold text-xs shrink-0"
                aria-label="未保存の変更"
              >
                ●
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseFile(file);
              }}
              className={cn(
                "p-0.5 rounded transition-all shrink-0",
                "hover:bg-slate-300 dark:hover:bg-slate-600",
                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
              aria-label={`${file.filename}を閉じる`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
