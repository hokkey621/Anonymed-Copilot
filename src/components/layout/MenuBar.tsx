import { useState, useRef, useEffect } from "react";
import { FolderOpen, Folder, Save, FileText } from "lucide-react";


interface MenuBarProps {
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onSaveFile: () => void;
  activeFileName?: string;
  hasUnsavedChanges?: boolean;
}

export function MenuBar({ onOpenFile, onOpenFolder, onSaveFile, activeFileName, hasUnsavedChanges }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMenuClick = (menu: string) => {
    setOpenMenu(openMenu === menu ? null : menu);
  };

  const handleAction = (action: () => void) => {
    action();
    setOpenMenu(null);
  };

  return (
    <div
      ref={menuRef}
      className="h-8 bg-muted/30 border-b flex items-center px-2 text-sm select-none shrink-0"
    >
      {/* File Menu */}
      <div className="relative">
        <button
          className={`px-3 py-1 rounded-sm hover:bg-muted transition-colors ${openMenu === "file" ? "bg-muted" : ""}`}
          onClick={() => handleMenuClick("file")}
        >
          File
        </button>
        {openMenu === "file" && (
          <div className="absolute top-full left-0 mt-0.5 w-56 bg-popover border rounded-md shadow-lg py-1 z-50">
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
              onClick={() => handleAction(onOpenFile)}
            >
              <FolderOpen size={14} />
              <span>ファイルを開く</span>
              <span className="ml-auto text-xs text-muted-foreground">⌘O</span>
            </button>
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
              onClick={() => handleAction(onOpenFolder)}
            >
              <Folder size={14} />
              <span>フォルダを開く</span>
              <span className="ml-auto text-xs text-muted-foreground">⌘⇧O</span>
            </button>
            <div className="border-t my-1" />
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
              onClick={() => handleAction(onSaveFile)}
            >
              <Save size={14} />
              <span>名前を付けて保存</span>
              <span className="ml-auto text-xs text-muted-foreground">⌘⇧S</span>
            </button>

            <div className="border-t my-1" />
            <div className="px-3 py-1.5 text-xs text-muted-foreground">
              {activeFileName ? (
                <div className="flex items-center gap-2">
                  <FileText size={12} />
                  <span className="truncate">{activeFileName}</span>
                  {hasUnsavedChanges && <span className="text-orange-500">●</span>}
                </div>
              ) : (
                <span>ファイルが開かれていません</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Edit Menu (placeholder for future) */}
      <div className="relative">
        <button
          className={`px-3 py-1 rounded-sm hover:bg-muted transition-colors ${openMenu === "edit" ? "bg-muted" : ""}`}
          onClick={() => handleMenuClick("edit")}
        >
          Edit
        </button>
        {openMenu === "edit" && (
          <div className="absolute top-full left-0 mt-0.5 w-48 bg-popover border rounded-md shadow-lg py-1 z-50">
            <div className="px-3 py-1.5 text-muted-foreground text-xs">
              編集機能は準備中です
            </div>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Current file indicator */}
      {activeFileName && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground px-2">
          <FileText size={12} />
          <span className="truncate max-w-40">{activeFileName}</span>
          {hasUnsavedChanges && <span className="text-orange-500 font-bold">●</span>}
        </div>
      )}
    </div>
  );
}
