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
  is_dir: boolean;
}

interface FileExplorerProps {
  activeFilePath?: string;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  folderName?: string;
  folderFiles: FolderFileEntry[];
  onFileClick: (filePath: string, filename: string) => void;
}

export function FileExplorer({
  activeFilePath,
  onOpenFile,
  onOpenFolder,
  folderName,
  folderFiles,
  onFileClick,
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

  const renderFileItem = (file: FolderFileEntry, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedDirs.has(file.path);
    const fileChildren = children[file.path] || [];
    const isActive = activeFilePath === file.path;

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
      />
    );
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="h-10 px-4 flex items-center text-sm font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 shrink-0">
        <span className="truncate">{folderName || "Explorer"}</span>
      </div>

      <ScrollArea className="flex-1 w-full">
        <div className="py-2">
          {/* Folder Tree Section */}
          {!folderName && folderFiles.length === 0 ? (
            <div className="space-y-1">
              <div
                className="flex items-center py-3 px-4 cursor-pointer hover:bg-slate-60 dark:hover:bg-slate-800/70 text-base select-none transition-colors"
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
                className="flex items-center py-3 px-4 cursor-pointer hover:bg-slate-60 dark:hover:bg-slate-800/70 text-base select-none transition-colors"
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
                  "flex items-center py-3 px-4 cursor-pointer text-base select-none transition-colors font-mono",
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
                <span className="truncate font-semibold ml-2 uppercase text-xs tracking-wider text-muted-foreground">
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
