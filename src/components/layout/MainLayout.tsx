import { AnonPlan } from "@/domain/model";
import { createDefaultPlan } from "@/domain/utils";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { ConfigSidebar } from "./ConfigSidebar";
import { EditorPanel } from "./EditorPanel";
import { FileExplorer, OpenedFile } from "./FileExplorer";
import { MenuBar } from "./MenuBar";
import { StatusBar } from "./StatusBar";

interface OpenFileResult {
  path: string;
  content: string;
  filename: string;
}

interface SaveFileResult {
  saved_path: string;
  audit_log_path: string;
}

interface FolderFileEntry {
  path: string;
  filename: string;
  is_dir: boolean;
}

interface OpenFolderResult {
  folder_path: string;
  folder_name: string;
  files: FolderFileEntry[];
}

export function MainLayout() {
  const [originalContent, setOriginalContent] = useState<string>("");
  const [anonymizedContent, setAnonymizedContent] = useState<string>("");
  const [currentPlan, setCurrentPlan] = useState<AnonPlan>(createDefaultPlan());
  const [isProcessing, setIsProcessing] = useState(false);
  const [openedFiles, setOpenedFiles] = useState<OpenedFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<{ path: string; name: string } | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFileEntry[]>([]);

  const activeFile = openedFiles.find(f => f.path === activeFilePath) || null;

  // Open file from dialog
  const handleOpenFile = async () => {
    try {
      const result = await invoke<OpenFileResult | null>("open_file");
      if (result) {
        // Check if already open
        const existing = openedFiles.find(f => f.path === result.path);
        if (existing) {
          setActiveFilePath(result.path);
          return;
        }

        const newFile: OpenedFile = {
          path: result.path,
          filename: result.filename,
          hasChanges: false,
        };
        setOpenedFiles(prev => [...prev, newFile]);
        setActiveFilePath(result.path);
        setOriginalContent(result.content);
        setAnonymizedContent(result.content);
        setCurrentPlan(createDefaultPlan());
      }
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  // Open folder from dialog
  const handleOpenFolder = async () => {
    try {
      const result = await invoke<OpenFolderResult | null>("open_folder");
      if (result) {
        setCurrentFolder({ path: result.folder_path, name: result.folder_name });
        setFolderFiles(result.files);
        // Reset opened files when opening new folder
        setOpenedFiles([]);
        setActiveFilePath(null);
        setOriginalContent("");
        setAnonymizedContent("");
      }
    } catch (e) {
      console.error("Failed to open folder:", e);
    }
  };

  // Open a file from folder tree
  const handleOpenFileFromTree = async (filePath: string, filename: string) => {
    try {
      const result = await invoke<OpenFileResult>("read_file_content", { filePath });
      const existing = openedFiles.find(f => f.path === filePath);
      if (existing) {
        setActiveFilePath(filePath);
        setOriginalContent(result.content);
        setAnonymizedContent(result.content);
        return;
      }

      const newFile: OpenedFile = {
        path: filePath,
        filename: filename,
        hasChanges: false,
      };
      setOpenedFiles(prev => [...prev, newFile]);
      setActiveFilePath(filePath);
      setOriginalContent(result.content);
      setAnonymizedContent(result.content);
      setCurrentPlan(createDefaultPlan());
    } catch (e) {
      console.error("Failed to read file:", e);
    }
  };

  // Select an already opened file
  const handleSelectFile = (file: OpenedFile) => {
    setActiveFilePath(file.path);
    // Note: In a full implementation, we'd store content per file
    // For now, just switch the active file
  };

  // Close a file
  const handleCloseFile = (file: OpenedFile) => {
    setOpenedFiles(prev => prev.filter(f => f.path !== file.path));
    if (activeFilePath === file.path) {
      const remaining = openedFiles.filter(f => f.path !== file.path);
      setActiveFilePath(remaining.length > 0 ? remaining[0].path : null);
      if (remaining.length === 0) {
        setOriginalContent("");
        setAnonymizedContent("");
        setCurrentPlan(createDefaultPlan());
      }
    }
  };

  // Save anonymized file with dialog
  const handleSaveFile = async () => {
    if (!anonymizedContent || !activeFile) return;
    try {
      const result = await invoke<SaveFileResult | null>("save_anonymized_file", {
        content: anonymizedContent,
        originalFilename: activeFile.filename,
        originalContent: originalContent,
        appliedPlan: currentPlan,
      });
      if (result) {
        console.log("File saved:", result.saved_path);
        console.log("Audit log:", result.audit_log_path);
        // Mark as no changes
        setOpenedFiles(prev =>
          prev.map(f => f.path === activeFilePath ? { ...f, hasChanges: false } : f)
        );
      }
    } catch (e) {
      console.error("Failed to save file:", e);
    }
  };

  // Execute anonymization (triggered by "実行" button)
  const handleAnonymize = async (task: string) => {
    if (!originalContent) return;
    setIsProcessing(true);
    try {
        const plan = await invoke<AnonPlan>("analyze_text", { text: originalContent, taskContext: task });
        setCurrentPlan(plan);
        const result = await invoke<string>("apply_plan", { text: originalContent, plan });
        setAnonymizedContent(result);
        // Mark file as having changes
        if (activeFilePath) {
          setOpenedFiles(prev =>
            prev.map(f => f.path === activeFilePath ? { ...f, hasChanges: true } : f)
          );
        }
    } catch (e) {
        console.error("Anonymization failed:", e);
        setAnonymizedContent(`Error: ${e}`);
    } finally {
        setIsProcessing(false);
    }
  };

  // Accept changes and save file
  const handleAccept = async () => {
      if (!anonymizedContent) return;

      try {
          // Create internal audit record
          await invoke("create_audit_report", {
              finalContent: anonymizedContent,
              appliedPlan: currentPlan
          });

          // If a file is open, trigger save dialog
          if (activeFile) {
            const result = await invoke<SaveFileResult | null>("save_anonymized_file", {
              content: anonymizedContent,
              originalFilename: activeFile.filename,
              originalContent: originalContent,
              appliedPlan: currentPlan,
            });
            if (result) {
              console.log("File saved:", result.saved_path);
              console.log("Audit log:", result.audit_log_path);
              // Mark as no changes
              setOpenedFiles(prev =>
                prev.map(f => f.path === activeFilePath ? { ...f, hasChanges: false } : f)
              );
            }
          }

          setOriginalContent(anonymizedContent);
          setAnonymizedContent(anonymizedContent);
          setCurrentPlan(createDefaultPlan());
          console.log("Anonymization approved and saved.");
      } catch (e) {
          console.error("Save failed:", e);
      }
  };

  const hasUnsavedChanges = originalContent !== anonymizedContent;

  return (
    <div className="h-screen w-full bg-background text-foreground flex flex-col font-sans">
      {/* Menu Bar */}
      <MenuBar
        onOpenFile={handleOpenFile}
        onOpenFolder={handleOpenFolder}
        onSaveFile={handleSaveFile}
        activeFileName={activeFile?.filename}
        hasUnsavedChanges={hasUnsavedChanges}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Flex Layout */}
        <div className="flex-1 flex min-w-0 overflow-hidden">

          {/* File Explorer */}
          <div className="w-64 shrink-0 h-full bg-background border-r overflow-hidden">
            <FileExplorer
              openedFiles={openedFiles}
              activeFilePath={activeFilePath || undefined}
              onSelectFile={handleSelectFile}
              onCloseFile={handleCloseFile}
              onOpenFile={handleOpenFile}
              onOpenFolder={handleOpenFolder}
              folderName={currentFolder?.name}
              folderFiles={folderFiles}
              onFileClick={handleOpenFileFromTree}
            />

          </div>

          {/* Editor Area */}
          <div className="flex-1 h-full bg-background overflow-hidden">
            <EditorPanel
                original={originalContent}
                modified={anonymizedContent}
                onAccept={handleAccept}
                onModifiedChange={(value) => {
                  setAnonymizedContent(value);
                  if (activeFilePath) {
                    setOpenedFiles(prev =>
                      prev.map(f => f.path === activeFilePath ? { ...f, hasChanges: true } : f)
                    );
                  }
                }}
                activeFileName={activeFile?.filename}
            />
          </div>

          {/* Chat Sidebar */}
          <div className="w-96 shrink-0 h-full bg-background border-l overflow-hidden">
             <ConfigSidebar
                onRunAnonymization={handleAnonymize}
                isProcessing={isProcessing}
                currentContent={originalContent}
                currentPlan={currentPlan}
                fileCount={openedFiles.length}
                currentFileName={activeFile?.filename}
             />
          </div>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}
