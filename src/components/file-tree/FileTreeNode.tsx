import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileEntry {
  path: string;
  filename: string;
  is_dir: boolean;
}

export interface OpenedFileInfo {
  path: string;
  hasChanges?: boolean;
}

interface FileTreeNodeProps {
  file: FileEntry;
  depth?: number;
  isExpanded: boolean;
  isActive: boolean;
  openedFileInfo?: OpenedFileInfo;
  children?: FileEntry[];
  onToggle: (path: string) => void;
  onFileClick: (path: string, filename: string) => void;
  onCloseFile?: (path: string) => void;
  renderChildren: (file: FileEntry, depth: number) => React.ReactNode;
  // Selection mode props
  selectionMode?: boolean;
  isSelected?: boolean;
  onSelectChange?: (path: string, selected: boolean) => void;
}

/**
 * FileTreeNode - 医療スタイルのファイルツリーノード
 *
 * 医療従事者に馴染みのある「プラス・マイナス」式のリスト表示。
 * - テキストベースの + (閉) / - (開) プレフィックス
 * - ファイルには |- コネクタ
 * - 16pxフォントサイズ、広めのパディング
 */
export function FileTreeNode({
  file,
  depth = 0,
  isExpanded,
  isActive,
  openedFileInfo,
  children = [],
  onToggle,
  onFileClick,
  onCloseFile,
  renderChildren,
  selectionMode = false,
  isSelected = false,
  onSelectChange,
}: FileTreeNodeProps) {
  const baseIndent = 16; // px per depth level

  if (file.is_dir) {
    return (
      <div>
        <div
          className={cn(
            "flex items-center py-3 cursor-pointer text-base select-none transition-colors font-mono overflow-hidden",
            "hover:bg-slate-100 dark:hover:bg-slate-800/70"
          )}
          style={{ paddingLeft: `${depth * baseIndent + 12}px`, paddingRight: "12px" }}
          onClick={() => onToggle(file.path)}
          role="button"
          aria-expanded={isExpanded}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle(file.path);
            }
          }}
        >
          <span
            className={cn(
              "w-5 text-center shrink-0 font-bold text-lg",
              isExpanded ? "text-blue-600 dark:text-blue-400" : "text-slate-600 dark:text-slate-400"
            )}
            aria-hidden="true"
          >
            {isExpanded ? "−" : "+"}
          </span>
          <span className="truncate flex-1 min-w-0 font-medium ml-2" title={file.filename}>{file.filename}</span>
        </div>
        {isExpanded && children.map((child) => renderChildren(child, depth + 1))}
      </div>
    );
  }

  // ファイル（末端ノード）
  return (
    <div
      className={cn(
        "flex items-center py-3 cursor-pointer text-base select-none transition-colors group font-mono overflow-hidden",
        isActive
          ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          : "hover:bg-slate-100 dark:hover:bg-slate-800/70"
      )}
      style={{ paddingLeft: `${depth * baseIndent + 12}px`, paddingRight: "12px" }}
      onClick={() => onFileClick(file.path, file.filename)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFileClick(file.path, file.filename);
        }
      }}
    >
      {/* Selection Checkbox */}
      {selectionMode && onSelectChange && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            onSelectChange(file.path, e.target.checked);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mr-2 shrink-0 cursor-pointer"
          aria-label={`${file.filename}を選択`}
        />
      )}
      <span
        className="w-5 text-center shrink-0 text-slate-400 dark:text-slate-500"
        aria-hidden="true"
      >
        ├
      </span>
      <span className="truncate flex-1 min-w-0 ml-2" title={file.filename}>{file.filename}</span>
      {openedFileInfo?.hasChanges && (
        <span className="text-orange-500 font-bold mr-2" aria-label="未保存の変更">
          ●
        </span>
      )}
      {openedFileInfo && onCloseFile && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCloseFile(file.path);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-all"
          aria-label={`${file.filename}を閉じる`}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
