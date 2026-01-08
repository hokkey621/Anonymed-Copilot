import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

interface FileTreeSidebarProps {
  onFileSelect: (path: string) => void;
}

const FileTreeNode = ({
    entry,
    level,
    onSelect
}: {
    entry: FileEntry,
    level: number,
    onSelect: (path: string) => void
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [children, setChildren] = useState<FileEntry[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    const handleToggle = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (entry.is_dir) {
            if (!isOpen && !isLoaded) {
                try {
                    const result = await invoke<FileEntry[]>("list_files", { dirPath: entry.path });
                    setChildren(result);
                    setIsLoaded(true);
                } catch (err) {
                    console.error("Failed to load dir:", err);
                }
            }
            setIsOpen(!isOpen);
        } else {
            onSelect(entry.path);
        }
    };

    return (
        <div>
            <div
                className={cn(
                    "flex items-center py-1 px-2 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-800 text-sm select-none truncate transition-colors",
                    // Indentation via padding
                )}
                style={{ paddingLeft: `${level * 12 + 8}px` }}
                onClick={handleToggle}
            >
                <span className="mr-1 opacity-70 shrink-0">
                    {entry.is_dir ? (
                         isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                    ) : (
                        <span className="w-[14px] inline-block" /> // Spacer
                    )}
                </span>
                <span className="mr-2 text-blue-500/80 shrink-0">
                    {entry.is_dir ? (
                        isOpen ? <FolderOpen size={16} /> : <Folder size={16} />
                    ) : (
                        <File size={16} className="text-slate-500" />
                    )}
                </span>
                <span className="truncate">{entry.name}</span>
            </div>
            {isOpen && entry.is_dir && (
                <div>
                    {children.map((child) => (
                        <FileTreeNode
                            key={child.path}
                            entry={child}
                            level={level + 1}
                            onSelect={onSelect}
                        />
                    ))}
                    {children.length === 0 && isLoaded && (
                        <div style={{ paddingLeft: `${(level + 1) * 12 + 28}px` }} className="text-xs text-muted-foreground py-1 italic">
                            Empty
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export function FileTreeSidebar({ onFileSelect }: FileTreeSidebarProps) {
  const [rootFiles, setRootFiles] = useState<FileEntry[]>([]);
  // Use current directory "." for MVP.
  const [currentPath] = useState<string>(".");

  useEffect(() => {
    async function loadFiles() {
        try {
           const result = await invoke<FileEntry[]>("list_files", { dirPath: currentPath });
           setRootFiles(result);
        } catch (e) {
            console.error("Failed to load files:", e);
        }
    }
    loadFiles();
  }, [currentPath]);

  return (
    <div className="flex flex-col h-full bg-background border-r overflow-hidden">
      <div className="h-9 px-4 flex items-center text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 shrink-0">
          Explorer
      </div>
      <ScrollArea className="flex-1 w-full">
        <div className="py-1">
            {/* Simulate a Root Project Folder */}
            <div className="px-2 py-1 text-xs font-bold text-blue-600 uppercase tracking-widest mb-1 truncate">
                Running Project
            </div>
            {rootFiles.map((f) => (
                <FileTreeNode key={f.path} entry={f} level={0} onSelect={onFileSelect} />
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
