import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, FolderOpen, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OpenedFile {
  path: string;
  filename: string;
  hasChanges?: boolean;
}

interface FileExplorerProps {
  openedFiles: OpenedFile[];
  activeFilePath?: string;
  onSelectFile: (file: OpenedFile) => void;
  onCloseFile: (file: OpenedFile) => void;
  onOpenFile: () => void;
}

export function FileExplorer({
  openedFiles,
  activeFilePath,
  onSelectFile,
  onCloseFile,
  onOpenFile,
}: FileExplorerProps) {
  // Group files by directory
  const filesByDir = openedFiles.reduce((acc, file) => {
    const dir = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
    if (!acc[dir]) acc[dir] = [];
    acc[dir].push(file);
    return acc;
  }, {} as Record<string, OpenedFile[]>);

  const dirNames = Object.keys(filesByDir);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="h-9 px-4 flex items-center text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 shrink-0">
        <span>Explorer</span>
      </div>

      <ScrollArea className="flex-1 w-full">
        <div className="py-2">
          {openedFiles.length === 0 ? (
            <div
              className="flex items-center py-2 px-4 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-800 text-sm select-none transition-colors"
              onClick={onOpenFile}
            >
              <FolderOpen size={14} className="mr-2 text-muted-foreground" />
              <span className="text-muted-foreground">ファイルを開く...</span>
            </div>
          ) : (
            <>
              {dirNames.map((dir) => (
                <div key={dir}>
                  {/* Directory header */}
                  {dirNames.length > 1 && (
                    <div className="flex items-center px-3 py-1 text-xs text-muted-foreground">
                      <ChevronRight size={12} className="mr-1" />
                      <span className="truncate">{dir.split('/').pop() || dir}</span>
                    </div>
                  )}

                  {/* Files */}
                  {filesByDir[dir].map((file) => (
                    <div
                      key={file.path}
                      className={cn(
                        "flex items-center py-1.5 px-4 cursor-pointer text-sm select-none transition-colors group",
                        activeFilePath === file.path
                          ? "bg-blue-500/10 text-blue-600 border-l-2 border-blue-500"
                          : "hover:bg-slate-200/50 dark:hover:bg-slate-800"
                      )}
                      onClick={() => onSelectFile(file)}
                    >
                      <FileText size={14} className="mr-2 shrink-0 text-slate-500" />
                      <span className="truncate flex-1 font-medium">
                        {file.filename}
                      </span>
                      {file.hasChanges && (
                        <span className="text-orange-500 font-bold mr-1">●</span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseFile(file);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-300 dark:hover:bg-slate-700 rounded transition-all"
                        title="Close file"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}

              {/* Add more files link */}
              <div
                className="flex items-center py-1.5 px-4 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-800 text-sm select-none transition-colors mt-2 border-t"
                onClick={onOpenFile}
              >
                <FolderOpen size={14} className="mr-2 text-muted-foreground" />
                <span className="text-muted-foreground">ファイルを追加...</span>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
