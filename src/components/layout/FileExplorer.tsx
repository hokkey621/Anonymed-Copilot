import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Folder, FolderOpen, ChevronRight, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

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
  openedFiles: OpenedFile[];
  activeFilePath?: string;
  onSelectFile: (file: OpenedFile) => void;
  onCloseFile: (file: OpenedFile) => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  folderName?: string;
  folderFiles: FolderFileEntry[];
  onFileClick: (filePath: string, filename: string) => void;
}

export function FileExplorer({
  openedFiles,
  activeFilePath,
  onSelectFile,
  onCloseFile,
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

  const renderFileItem = (file: FolderFileEntry, depth: number = 0) => {
    const isExpanded = expandedDirs.has(file.path);
    const fileChildren = children[file.path] || [];
    const isActive = activeFilePath === file.path;
    const openedFile = openedFiles.find(f => f.path === file.path);

    if (file.is_dir) {
      return (
        <div key={file.path}>
          <div
            className={cn(
              "flex items-center py-1 cursor-pointer text-sm select-none transition-colors hover:bg-slate-200/50 dark:hover:bg-slate-800"
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => toggleDir(file.path)}
          >
            {isExpanded ? <ChevronDown size={12} className="mr-1" /> : <ChevronRight size={12} className="mr-1" />}
            <Folder size={14} className="mr-2 text-amber-500" />
            <span className="truncate">{file.filename}</span>
          </div>
          {isExpanded && fileChildren.map(child => renderFileItem(child, depth + 1))}
        </div>
      );
    }

    return (
      <div
        key={file.path}
        className={cn(
          "flex items-center py-1 cursor-pointer text-sm select-none transition-colors group",
          isActive
            ? "bg-blue-500/10 text-blue-600"
            : "hover:bg-slate-200/50 dark:hover:bg-slate-800"
        )}
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
        onClick={() => onFileClick(file.path, file.filename)}
      >
        <FileText size={14} className="mr-2 shrink-0 text-slate-500" />
        <span className="truncate flex-1">{file.filename}</span>
        {openedFile?.hasChanges && <span className="text-orange-500 font-bold mr-1">●</span>}
        {openedFile && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCloseFile(openedFile);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-300 dark:hover:bg-slate-700 rounded transition-all"
          >
            <X size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="h-9 px-4 flex items-center text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 shrink-0">
        <span>{folderName || "Explorer"}</span>
      </div>

      <ScrollArea className="flex-1 w-full">
        <div className="py-2">
          {/* Opened Files Section */}
          {openedFiles.length > 0 && (
            <div className="mb-2">
              <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                開いているファイル
              </div>
              {openedFiles.map(file => (
                <div
                  key={file.path}
                  className={cn(
                    "flex items-center py-1 px-4 cursor-pointer text-sm select-none transition-colors group",
                    activeFilePath === file.path
                      ? "bg-blue-500/10 text-blue-600"
                      : "hover:bg-slate-200/50 dark:hover:bg-slate-800"
                  )}
                  onClick={() => onSelectFile(file)}
                >
                  <FileText size={14} className="mr-2 shrink-0 text-slate-500" />
                  <span className="truncate flex-1">{file.filename}</span>
                  {file.hasChanges && <span className="text-orange-500 font-bold mr-1">●</span>}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseFile(file);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-300 dark:hover:bg-slate-700 rounded transition-all"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Folder Tree Section */}
          {!folderName && folderFiles.length === 0 && openedFiles.length === 0 ? (
            <div className="space-y-1">
              <div
                className="flex items-center py-2 px-4 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-800 text-sm select-none transition-colors"
                onClick={onOpenFile}
              >
                <FileText size={14} className="mr-2 text-muted-foreground" />
                <span className="text-muted-foreground">ファイルを開く...</span>
              </div>
              <div
                className="flex items-center py-2 px-4 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-800 text-sm select-none transition-colors"
                onClick={onOpenFolder}
              >
                <FolderOpen size={14} className="mr-2 text-muted-foreground" />
                <span className="text-muted-foreground">フォルダを開く...</span>
              </div>
            </div>
          ) : folderName && folderFiles.length > 0 ? (
            <>
              <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
