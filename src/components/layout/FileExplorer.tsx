import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, FolderOpen } from "lucide-react";
import { useState } from "react";
import { FileTreeNode } from "@/components/file-tree/FileTreeNode";
import { cn } from "@/lib/utils";

export interface OpenedFile {
  path: string;
  filename: string;
  hasChanges?: boolean;
}

export interface FolderFileEntry {
  path: string;
  filename: string;
  isDir: boolean;
}

interface FileExplorerProps {
  activeFilePath?: string;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  folderName?: string;
  folderFiles: FolderFileEntry[];
  onFileClick: (filePath: string, filename: string) => void;
  // Selection mode props
  selectionMode?: boolean;
  selectedFiles?: Set<string>;
  onSelectionChange?: (paths: Set<string>) => void;
}

export function FileExplorer({
  activeFilePath,
  onOpenFile,
  onOpenFolder,
  folderName,
  folderFiles,
  onFileClick,
  selectionMode = false,
  selectedFiles = new Set(),
  onSelectionChange,
}: FileExplorerProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [rootExpanded, setRootExpanded] = useState(true);

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Group files by parent directory for tree structure
  const buildTree = (files: FolderFileEntry[]) => {
    const roots: FolderFileEntry[] = [];
    const children: Record<string, FolderFileEntry[]> = {};

    files.forEach(file => {
      const parentPath = file.path.substring(0, file.path.lastIndexOf('/'));
      const isRoot = !files.some(f => f.path === parentPath);

      if (isRoot || !parentPath) {
        roots.push(file);
      } else {
        if (!children[parentPath]) children[parentPath] = [];
        children[parentPath].push(file);
      }
    });

    return { roots, children };
  };

  const { roots, children } = buildTree(folderFiles);

  // Selection helpers
  const allFiles = folderFiles.filter(f => !f.isDir);
  const selectedCount = selectedFiles.size;
  const allSelected = allFiles.length > 0 && selectedFiles.size === allFiles.length;

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    const allPaths = new Set(allFiles.map(f => f.path));
    onSelectionChange(allPaths);
  };

  const handleDeselectAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(new Set());
  };

  const handleSelectChange = (path: string, selected: boolean) => {
    if (!onSelectionChange) return;
    const newSelection = new Set(selectedFiles);
    if (selected) {
      newSelection.add(path);
    } else {
      newSelection.delete(path);
    }
    onSelectionChange(newSelection);
  };

  const renderFileItem = (file: FolderFileEntry, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedDirs.has(file.path);
    const fileChildren = children[file.path] || [];
    const isActive = activeFilePath === file.path;
    const isSelected = selectedFiles.has(file.path);

    return (
      <FileTreeNode
        key={file.path}
        file={file}
        depth={depth}
        isExpanded={isExpanded}
        isActive={isActive}
        children={fileChildren}
        onToggle={toggleDir}
        onFileClick={onFileClick}
        renderChildren={renderFileItem}
        selectionMode={selectionMode}
        isSelected={isSelected}
        onSelectChange={handleSelectChange}
      />
    );
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="h-10 px-4 flex items-center text-sm font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 shrink-0 overflow-hidden">
        <span className="truncate flex-1 min-w-0" title={folderName || "Explorer"}>{folderName || "Explorer"}</span>
      </div>

      {/* Selection Controls Bar - only shown when folder is open and has files */}
      {selectionMode && folderName && allFiles.length > 0 && (
        <div className="px-4 py-2 border-b flex items-center justify-between text-xs bg-muted/10">
          <span className="text-muted-foreground">
            {selectedCount}件選択中
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleSelectAll}
              disabled={allSelected}
              className={cn(
                "px-2 py-1 rounded transition-colors",
                allSelected
                  ? "text-muted-foreground/50 cursor-not-allowed"
                  : "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30"
              )}
            >
              全選択
            </button>
            <button
              onClick={handleDeselectAll}
              disabled={selectedCount === 0}
              className={cn(
                "px-2 py-1 rounded transition-colors",
                selectedCount === 0
                  ? "text-muted-foreground/50 cursor-not-allowed"
                  : "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30"
              )}
            >
              全解除
            </button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1 w-full overflow-hidden">
        <div className="py-2 w-full overflow-hidden">
          {/* Folder Tree Section */}
          {!folderName && folderFiles.length === 0 ? (
            <div className="space-y-1">
              <div
                className="flex items-center py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/70 text-base select-none transition-colors"
                onClick={onOpenFile}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenFile();
                  }
                }}
              >
                <FileText size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground ml-2">ファイルを開く...</span>
              </div>
              <div
                className="flex items-center py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/70 text-base select-none transition-colors"
                onClick={onOpenFolder}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenFolder();
                  }
                }}
              >
                <FolderOpen size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground ml-2">フォルダを開く...</span>
              </div>
            </div>
          ) : folderName && folderFiles.length > 0 ? (
            <>
              {/* Root Folder Header - Clickable */}
              <div
                className={cn(
                  "flex items-center py-3 px-4 cursor-pointer text-base select-none transition-colors font-mono overflow-hidden",
                  "hover:bg-slate-100 dark:hover:bg-slate-800/70"
                )}
                onClick={() => setRootExpanded(!rootExpanded)}
                role="button"
                aria-expanded={rootExpanded}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setRootExpanded(!rootExpanded);
                  }
                }}
              >
                <span
                  className={cn(
                    "w-5 text-center shrink-0 font-bold text-lg",
                    rootExpanded ? "text-blue-600 dark:text-blue-400" : "text-slate-600 dark:text-slate-400"
                  )}
                  aria-hidden="true"
                >
                  {rootExpanded ? "−" : "+"}
                </span>
                <span className="truncate flex-1 min-w-0 font-semibold ml-2 uppercase text-xs tracking-wider text-muted-foreground" title={folderName}>
                  {folderName}
                </span>
              </div>
              {/* Files - only shown when expanded */}
              {rootExpanded && roots.map(file => renderFileItem(file, 0))}
            </>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
