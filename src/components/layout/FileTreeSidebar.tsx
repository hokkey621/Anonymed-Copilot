import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

interface FileTreeSidebarProps {
  onFileSelect: (path: string) => void;
}

export function FileTreeSidebar({ onFileSelect }: FileTreeSidebarProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  // Use current directory "." for MVP.
  const [currentPath, setCurrentPath] = useState<string>(".");

  useEffect(() => {
    async function loadFiles() {
        try {
           const result = await invoke<FileEntry[]>("list_files", { dirPath: currentPath });
           setFiles(result);
        } catch (e) {
            console.error("Failed to load files:", e);
        }
    }
    loadFiles();
  }, [currentPath]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b font-semibold bg-muted/40 text-sm">Explorer</div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
            {files.map((f) => (
                <div
                    key={f.path}
                    className="text-sm p-1 hover:bg-muted rounded cursor-pointer truncate"
                    onClick={() => !f.is_dir && onFileSelect(f.path)}
                >
                    {f.is_dir ? "📁" : "Vk"} {f.name}
                </div>
            ))}
             <div className="text-sm p-2 text-muted-foreground italic">
                (Workspace Selection WIP)
            </div>
        </div>
      </ScrollArea>
    </div>
  );
}
