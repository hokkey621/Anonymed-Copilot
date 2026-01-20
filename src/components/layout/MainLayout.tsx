import { AnonPlan } from "@/domain/model";
import { createDefaultPlan } from "@/domain/utils";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { ConfigSidebar } from "./ConfigSidebar";
import { EditorPanel } from "./EditorPanel";
import { FileExplorer, OpenedFile } from "./FileExplorer";
import { MenuBar } from "./MenuBar";
import { StatusBar } from "./StatusBar";
import { EditorTabs } from "@/components/editor/EditorTabs";

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

interface OpenedFileState extends OpenedFile {
  originalContent: string;
  modifiedContent: string;
  plan: AnonPlan;
}

export function MainLayout() {
  const [originalContent, setOriginalContent] = useState<string>("");
  const [anonymizedContent, setAnonymizedContent] = useState<string>("");
  const [currentPlan, setCurrentPlan] = useState<AnonPlan>(createDefaultPlan());
  const [isProcessing, setIsProcessing] = useState(false);
  const [openedFiles, setOpenedFiles] = useState<OpenedFileState[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<{ path: string; name: string } | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFileEntry[]>([]);
  const [selectedFilesForBulk, setSelectedFilesForBulk] = useState<Set<string>>(new Set());

  // Bulk review mode state
  const [bulkReviewMode, setBulkReviewMode] = useState(false);
  const [bulkReviewQueue, setBulkReviewQueue] = useState<{path: string, fileName: string, original: string, anonymized: string, plan: AnonPlan}[]>([]);
  const [bulkReviewIndex, setBulkReviewIndex] = useState(0);
  const [bulkApprovedResults, setBulkApprovedResults] = useState<{fileName: string, content: string}[]>([]);
  // Analysis progress (for parallel processing)
  const [bulkAnalysisProgress, setBulkAnalysisProgress] = useState<{completed: number; total: number; isAnalyzing: boolean}>({completed: 0, total: 0, isAnalyzing: false});

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
          setOriginalContent(existing.originalContent);
          setAnonymizedContent(existing.modifiedContent);
          setCurrentPlan(existing.plan);
          return;
        }

        const newPlan = createDefaultPlan();
        const newFile: OpenedFileState = {
          path: result.path,
          filename: result.filename,
          hasChanges: false,
          originalContent: result.content,
          modifiedContent: result.content,
          plan: newPlan,
        };
        setOpenedFiles(prev => [...prev, newFile]);
        setActiveFilePath(result.path);
        setOriginalContent(result.content);
        setAnonymizedContent(result.content);
        setCurrentPlan(newPlan);
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
        // Select all non-directory files by default
        const allFilePaths = result.files.filter(f => !f.is_dir).map(f => f.path);
        setSelectedFilesForBulk(new Set(allFilePaths));
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
        setOriginalContent(existing.originalContent);
        setAnonymizedContent(existing.modifiedContent);
        setCurrentPlan(existing.plan);
        return;
      }

      const newPlan = createDefaultPlan();
      const newFile: OpenedFileState = {
        path: filePath,
        filename: filename,
        hasChanges: false,
        originalContent: result.content,
        modifiedContent: result.content,
        plan: newPlan,
      };
      setOpenedFiles(prev => [...prev, newFile]);
      setActiveFilePath(filePath);
      setOriginalContent(result.content);
      setAnonymizedContent(result.content);
      setCurrentPlan(newPlan);
    } catch (e) {
      console.error("Failed to read file:", e);
    }
  };

  // Select an already opened file (for tabs)
  const handleSelectFile = (file: OpenedFile) => {
    const target = openedFiles.find(f => f.path === file.path);
    if (!target) return;
    setActiveFilePath(target.path);
    setOriginalContent(target.originalContent);
    setAnonymizedContent(target.modifiedContent);
    setCurrentPlan(target.plan);
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
      } else {
        setOriginalContent(remaining[0].originalContent);
        setAnonymizedContent(remaining[0].modifiedContent);
        setCurrentPlan(remaining[0].plan);
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
            prev.map(f => f.path === activeFilePath ? { ...f, hasChanges: true, modifiedContent: result, plan } : f)
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

          const nextPlan = createDefaultPlan();
          setOriginalContent(anonymizedContent);
          setAnonymizedContent(anonymizedContent);
          setCurrentPlan(nextPlan);
          if (activeFilePath) {
            setOpenedFiles(prev =>
              prev.map(f => f.path === activeFilePath ? {
                ...f,
                hasChanges: false,
                originalContent: anonymizedContent,
                modifiedContent: anonymizedContent,
                plan: nextPlan,
              } : f)
            );
          }
          console.log("Anonymization approved and saved.");
      } catch (e) {
          console.error("Save failed:", e);
      }
  };

  // === Bulk Review Mode Handlers ===

  // Start bulk review: analyze each file with AI (parallel processing)
  const handleStartBulkReview = async (taskContext: string) => {
    if (selectedFilesForBulk.size === 0) return;

    const targetFiles = Array.from(selectedFilesForBulk);
    const total = targetFiles.length;

    // Start analysis phase
    setBulkAnalysisProgress({ completed: 0, total, isAnalyzing: true });
    setIsProcessing(true);

    try {
      // Read all file contents first
      const fileContents: {path: string, fileName: string, content: string}[] = [];
      for (const filePath of targetFiles) {
        const result = await invoke<{path: string, content: string, filename: string}>("read_file_content", { filePath });
        fileContents.push({ path: filePath, fileName: result.filename, content: result.content });
      }

      // Analyze each file with AI in parallel (Promise.all with progress tracking)
      let completedCount = 0;
      const analysisPromises = fileContents.map(async (file) => {
        try {
          // Call analyze_text for this specific file
          const plan = await invoke<AnonPlan>("analyze_text", {
            text: file.content,
            taskContext
          });
          // Apply the plan
          const anonymized = await invoke<string>("apply_plan", {
            text: file.content,
            plan
          });

          // Update progress
          completedCount++;
          setBulkAnalysisProgress(prev => ({ ...prev, completed: completedCount }));

          return {
            path: file.path,
            fileName: file.fileName,
            original: file.content,
            anonymized,
            plan,
          };
        } catch (e) {
          console.error(`Failed to analyze ${file.fileName}:`, e);
          completedCount++;
          setBulkAnalysisProgress(prev => ({ ...prev, completed: completedCount }));
          return null;
        }
      });

      const results = await Promise.all(analysisPromises);
      const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null);

      // Analysis complete - enter review mode
      setBulkAnalysisProgress(prev => ({ ...prev, isAnalyzing: false }));
      setBulkReviewQueue(validResults);
      setBulkReviewIndex(0);
      setBulkApprovedResults([]);
      setBulkReviewMode(true);

      // Load first file into diff view
      if (validResults.length > 0) {
        setOriginalContent(validResults[0].original);
        setAnonymizedContent(validResults[0].anonymized);
        setCurrentPlan(validResults[0].plan);
      }
    } catch (e) {
      console.error("Bulk analysis failed:", e);
    } finally {
      setIsProcessing(false);
    }
  };

  // Approve current file and move to next
  const handleBulkApprove = () => {
    if (!bulkReviewMode || bulkReviewQueue.length === 0) return;

    const current = bulkReviewQueue[bulkReviewIndex];
    setBulkApprovedResults(prev => [...prev, { fileName: current.fileName, content: anonymizedContent }]);

    moveToNextBulkFile();
  };

  // Skip current file and move to next
  const handleBulkSkip = () => {
    if (!bulkReviewMode) return;
    moveToNextBulkFile();
  };

  // Move to next file in queue or finish
  const moveToNextBulkFile = () => {
    const nextIndex = bulkReviewIndex + 1;
    if (nextIndex >= bulkReviewQueue.length) {
      // All files processed - trigger save dialog
      handleBulkComplete();
    } else {
      setBulkReviewIndex(nextIndex);
      const next = bulkReviewQueue[nextIndex];
      setOriginalContent(next.original);
      setAnonymizedContent(next.anonymized);
      setCurrentPlan(next.plan);
    }
  };

  // Complete bulk review: show save dialog and save
  const handleBulkComplete = async () => {
    if (bulkApprovedResults.length === 0) {
      // No files approved, just exit review mode
      setBulkReviewMode(false);
      setOriginalContent("");
      setAnonymizedContent("");
      return;
    }

    try {
      // Use Tauri dialog to select output folder
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selectedPath = await open({
        directory: true,
        title: "保存先フォルダを選択",
        defaultPath: currentFolder?.path,
      });

      if (selectedPath && typeof selectedPath === "string") {
        await invoke("bulk_save", {
          outputDir: selectedPath,
          items: bulkApprovedResults,
        });
        console.log(`Saved ${bulkApprovedResults.length} files to ${selectedPath}`);
      }
    } catch (e) {
      console.error("Bulk save failed:", e);
    } finally {
      // Exit review mode
      setBulkReviewMode(false);
      setBulkReviewQueue([]);
      setBulkReviewIndex(0);
      setBulkApprovedResults([]);
      setOriginalContent("");
      setAnonymizedContent("");
    }
  };

  // Cancel bulk review
  const handleBulkCancel = () => {
    setBulkReviewMode(false);
    setBulkReviewQueue([]);
    setBulkReviewIndex(0);
    setBulkApprovedResults([]);
    setOriginalContent("");
    setAnonymizedContent("");
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
              onOpenFile={handleOpenFile}
              onOpenFolder={handleOpenFolder}
              folderName={currentFolder?.name}
              folderFiles={folderFiles}
              onFileClick={handleOpenFileFromTree}
              activeFilePath={activeFilePath || undefined}
              selectionMode={!!currentFolder}
              selectedFiles={selectedFilesForBulk}
              onSelectionChange={setSelectedFilesForBulk}
            />

          </div>

          {/* Editor Area */}
          <div className="flex-1 h-full bg-background overflow-hidden flex flex-col">
            {/* Tab Bar */}
            <EditorTabs
              files={openedFiles}
              activeFilePath={activeFilePath || undefined}
              onSelectFile={handleSelectFile}
              onCloseFile={handleCloseFile}
            />
            {/* Editor */}
            <div className="flex-1 overflow-hidden">
              <EditorPanel
                  original={originalContent}
                  modified={anonymizedContent}
                  onAccept={handleAccept}
                  onModifiedChange={(value) => {
                    setAnonymizedContent(value);
                    if (activeFilePath) {
                      setOpenedFiles(prev =>
                        prev.map(f => f.path === activeFilePath ? { ...f, hasChanges: true, modifiedContent: value } : f)
                      );
                    }
                  }}
                  activeFileName={activeFile?.filename}
              />
            </div>
          </div>

          {/* Chat Sidebar */}
          <div className="w-96 shrink-0 h-full bg-background border-l overflow-hidden">
             <ConfigSidebar
                onRunAnonymization={handleAnonymize}
                isProcessing={isProcessing}
                currentContent={originalContent}
                currentPlan={currentPlan}
                fileCount={folderFiles.filter(f => !f.is_dir).length}
                currentFileName={activeFile?.filename}
                currentDirPath={currentFolder?.path}
                selectedFilePaths={Array.from(selectedFilesForBulk)}
                onStartBulkReview={handleStartBulkReview}
                bulkReviewMode={bulkReviewMode}
                bulkReviewProgress={bulkReviewMode ? { current: bulkReviewIndex + 1, total: bulkReviewQueue.length, fileName: bulkReviewQueue[bulkReviewIndex]?.fileName || "" } : undefined}
                onBulkApprove={handleBulkApprove}
                onBulkSkip={handleBulkSkip}
                onBulkCancel={handleBulkCancel}
                bulkAnalysisProgress={bulkAnalysisProgress}
             />
          </div>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}
