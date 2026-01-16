import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import { FileTreeNode } from "@/components/file-tree/FileTreeNode";

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
        <span>{folderName || "Explorer"}</span>
      </div>

      <ScrollArea className="flex-1 w-full">
        <div className="py-2">
          {/* Folder Tree Section */}
          {!folderName && folderFiles.length === 0 ? (
            <div className="space-y-1">
              <div
                className="flex items-center py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/70 text-base select-none transition-colors font-mono"
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
                <span className="w-5 text-center shrink-0 text-muted-foreground font-bold text-lg" aria-hidden="true">+</span>
                <span className="text-muted-foreground ml-2">ファイルを開く...</span>
              </div>
              <div
                className="flex items-center py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/70 text-base select-none transition-colors font-mono"
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
                <span className="w-5 text-center shrink-0 text-muted-foreground font-bold text-lg" aria-hidden="true">+</span>
                <span className="text-muted-foreground ml-2">フォルダを開く...</span>
              </div>
            </div>
          ) : folderName && folderFiles.length > 0 ? (
            <>
              <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {folderName}
              </div>
              {roots.map(file => renderFileItem(file, 0))}
            </>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
