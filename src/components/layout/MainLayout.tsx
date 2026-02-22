import { AnonPlan } from "@/domain/model";
import { createDefaultPlan } from "@/domain/utils";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useEffect } from "react";
import { ConfigSidebar, ModelProvider } from "./ConfigSidebar";
import { EditorPanel } from "./EditorPanel";
import { FileExplorer, OpenedFile } from "./FileExplorer";
import { MenuBar } from "./MenuBar";
import { StatusBar } from "./StatusBar";
import { EditorTabs } from "@/components/editor/EditorTabs";
import { ResizablePanel } from "@/components/ui/ResizablePanel";
import { ApiKeyModal } from "@/components/ui/ApiKeyModal";

interface OpenFileResult {
  path: string;
  content: string;
  filename: string;
}

interface SaveFileResult {
  savedPath: string;
  auditLogPath: string;
}

interface FolderFileEntry {
  path: string;
  filename: string;
  isDir: boolean;
}

interface OpenFolderResult {
  folderPath: string;
  folderName: string;
  files: FolderFileEntry[];
}

interface OpenedFileState extends OpenedFile {
  originalContent: string;
  modifiedContent: string;
  plan: AnonPlan;
}

interface AppSettingsView {
  selectedProvider: ModelProvider;
  ollamaBaseUrl: string;
  hasApiKey: boolean;
}

interface BulkAnalyzeItem {
  path: string;
  fileName: string;
  original: string;
  anonymized: string;
  plan: AnonPlan;
}

interface BulkAnalyzeFailure {
  path: string;
  fileName: string;
  error: string;
}

interface BulkAnalyzeResponse {
  items: BulkAnalyzeItem[];
  failures: BulkAnalyzeFailure[];
  cancelled: boolean;
}

interface BulkAnalysisProgressEvent {
  completed: number;
  total: number;
  currentFile: string;
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
  const [bulkApprovedResults, setBulkApprovedResults] = useState<Map<string, {fileName: string, content: string, status: 'approved' | 'skipped' | 'pending'}>>(new Map());
  // Analysis progress (for parallel processing)
  const [bulkAnalysisProgress, setBulkAnalysisProgress] = useState<{completed: number; total: number; isAnalyzing: boolean}>({completed: 0, total: 0, isAnalyzing: false});

  // API Key modal state
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [_hasApiKey, setHasApiKey] = useState(true); // Assume true initially
  const [selectedProvider, setSelectedProvider] = useState<ModelProvider>("gemini");
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const formatError = (error: unknown): string => {
    const raw =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : (() => {
              try {
                return JSON.stringify(error);
              } catch {
                return String(error);
              }
            })();

    if (raw.includes("GEMINI_API_KEY_MISSING")) {
      return "Gemini の APIキーが未設定です。Settings から APIキーを設定してください。";
    }
    if (raw.includes("OLLAMA_CONNECTION_ERROR")) {
      return "Ollama に接続できません。`ollama serve` を起動してください。";
    }
    if (raw.includes("OLLAMA_STREAM_ERROR") && raw.includes("timed out")) {
      return "Local Gemma の応答がタイムアウトしました。短い指示にするか、再実行してください。";
    }

    return raw;
  };

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await invoke<AppSettingsView>("load_app_settings");
        const provider = settings.selectedProvider ?? "gemini";
        setSelectedProvider(provider);
        setHasApiKey(settings.hasApiKey);
        if (provider === "gemini" && !settings.hasApiKey) {
          setShowApiKeyModal(true);
        }
        setSettingsLoaded(true);
      } catch (e) {
        console.error("Failed to load settings:", e);
        setShowApiKeyModal(true);
        setSettingsLoaded(true);
      }
    };
    loadSettings();
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    invoke("save_selected_provider", { provider: selectedProvider }).catch((e) => {
      console.error("Failed to save selected provider:", e);
    });
  }, [selectedProvider, settingsLoaded]);

  useEffect(() => {
    const unlisten = listen<BulkAnalysisProgressEvent>("bulk-analysis-progress", (event) => {
      const { completed, total } = event.payload;
      setBulkAnalysisProgress(prev => ({
        ...prev,
        completed,
        total,
        isAnalyzing: true,
      }));
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const activeFile = openedFiles.find(f => f.path === activeFilePath) || null;

  // Open file from dialog
  const handleOpenFile = async () => {
    try {
      console.info("[UI] Open file dialog");
      const result = await invoke<OpenFileResult | null>("open_file");
      if (result) {
        console.info("[UI] File opened:", { path: result.path, name: result.filename, size: result.content.length });
        // Check if already open
        const existing = openedFiles.find(f => f.path === result.path);
        if (existing) {
          console.info("[UI] File already open, focusing:", result.path);
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
      console.error("[UI] Failed to open file:", e);
    }
  };

  // Open folder from dialog
  const handleOpenFolder = async () => {
    try {
      console.info("[UI] Open folder dialog");
      const result = await invoke<OpenFolderResult | null>("open_folder");
      if (result) {
        console.info("[UI] Folder opened:", {
          path: result.folderPath,
          name: result.folderName,
          files: result.files.length,
        });
        setCurrentFolder({ path: result.folderPath, name: result.folderName });
        setFolderFiles(result.files);
        // Select all non-directory files by default
        const allFilePaths = result.files.filter(f => !f.isDir).map(f => f.path);
        setSelectedFilesForBulk(new Set(allFilePaths));
        // Reset opened files when opening new folder
        setOpenedFiles([]);
        setActiveFilePath(null);
        setOriginalContent("");
        setAnonymizedContent("");
      }
    } catch (e) {
      console.error("[UI] Failed to open folder:", e);
    }
  };

  // Open a file from folder tree
  const handleOpenFileFromTree = async (filePath: string, filename: string) => {
    try {
      console.info("[UI] Read file from tree:", { path: filePath, name: filename });
      const result = await invoke<OpenFileResult>("read_file_content", { filePath });
      const existing = openedFiles.find(f => f.path === filePath);
      if (existing) {
        console.info("[UI] File already open from tree, focusing:", filePath);
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
      console.error("[UI] Failed to read file:", e);
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
      console.info("[UI] Save file (single):", activeFile.filename);
      const result = await invoke<SaveFileResult | null>("save_anonymized_file", {
        content: anonymizedContent,
        originalFilename: activeFile.filename,
        originalContent: originalContent,
        appliedPlan: currentPlan,
      });
      if (result) {
        console.info("[UI] File saved:", result.savedPath);
        console.info("[UI] Audit log:", result.auditLogPath);
        alert(`保存しました:\n${result.savedPath}`);
        // Mark as no changes
        setOpenedFiles(prev =>
          prev.map(f => f.path === activeFilePath ? { ...f, hasChanges: false } : f)
        );
      }
    } catch (e) {
      console.error("[UI] Failed to save file:", e);
    }
  };

  // Execute anonymization (triggered by "実行" button)
  const handleAnonymize = async (task: string) => {
    if (!originalContent) return;
    setIsProcessing(true);
    try {
        console.info("[UI] Analyze text request:", { task, length: originalContent.length });
        const plan = await invoke<AnonPlan>("analyze_text", {
          text: originalContent,
          taskContext: task,
          provider: selectedProvider,
        });
        setCurrentPlan(plan);
        console.info("[UI] Apply plan request:", { replacements: plan.replacements?.length ?? 0 });
        const result = await invoke<string>("apply_plan", { text: originalContent, plan });

        // Single File -> Start "Bulk Review Mode" with 1 file
        // This unifies the UX: Approve -> Save All
        if (activeFilePath && activeFile) {
            console.log("[UI] Entering Unified Review Mode for single file");
            const singleItem = {
                path: activeFilePath,
                fileName: activeFile.filename,
                original: originalContent,
                anonymized: result,
                plan: plan
            };

            setBulkReviewQueue([singleItem]);
            setBulkReviewIndex(0);
            setBulkApprovedResults(new Map());
            setBulkReviewMode(true);

            // Set content for editor
            setAnonymizedContent(result);

            // Mark file as having changes
            setOpenedFiles(prev =>
              prev.map(f => f.path === activeFilePath ? { ...f, hasChanges: true, modifiedContent: result, plan } : f)
            );
        } else {
             // Fallback if no file is technically "open" (e.g. pasted text?)
             // For now we assume a file is open since we require it.
             setAnonymizedContent(result);
        }

    } catch (e) {
        console.error("[UI] Anonymization failed:", e);
        const message = formatError(e);
        alert(message);
        if (message.includes("APIキー")) {
          setShowApiKeyModal(true);
        }
        setAnonymizedContent(`Error: ${message}`);
    } finally {
        setIsProcessing(false);
    }
  };

  // Accept changes and save file
  const handleAccept = async () => {
      if (!anonymizedContent) return;

      try {
          console.info("[UI] Create audit report");
          // Create internal audit record
          await invoke("create_audit_report", {
              finalContent: anonymizedContent,
              appliedPlan: currentPlan
          });

          // If a file is open, trigger save dialog
          if (activeFile) {
            console.info("[UI] Save file (accept):", activeFile.filename);
            const result = await invoke<SaveFileResult | null>("save_anonymized_file", {
              content: anonymizedContent,
              originalFilename: activeFile.filename,
              originalContent: originalContent,
              appliedPlan: currentPlan,
            });
            if (result) {
              console.info("[UI] File saved:", result.savedPath);
              console.info("[UI] Audit log:", result.auditLogPath);
              alert(`保存しました:\n${result.savedPath}`);
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
          console.info("[UI] Anonymization approved and saved.");
      } catch (e) {
          console.error("[UI] Save failed:", e);
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
      console.log("[Bulk Review] Starting with files:", targetFiles);
      const response = await invoke<BulkAnalyzeResponse>("bulk_analyze_files", {
        targetFiles,
        taskContext,
        provider: selectedProvider,
      });
      const validResults = response.items;
      const analysisFailures = response.failures.map((f) => ({
        fileName: f.fileName,
        error: f.error,
      }));
      const wasCancelled = response.cancelled;

      console.log("[Bulk Review] Valid results:", validResults.length, "of", targetFiles.length);

      // Check if we have any valid results
      if (validResults.length === 0) {
        if (wasCancelled) {
          alert("解析を停止しました。");
          return;
        }
        console.error("[Bulk Review] No files were successfully analyzed!");
        alert("エラー: ファイルの分析に失敗しました。コンソールログを確認してください。");
        return;
      }

      if (analysisFailures.length > 0) {
        console.warn("[Bulk Review] Analysis failures:", analysisFailures);
        alert(
          `解析に失敗したファイルがあります:\n${analysisFailures
            .map(f => `- ${f.fileName}: ${f.error}`)
            .join("\n")}`
        );
      }

      if (wasCancelled) {
        alert(
          `解析を停止しました。完了済み ${validResults.length} 件のみレビューします。`
        );
      }

      // Analysis complete - enter review mode
      console.log("[Bulk Review] Entering review mode with", validResults.length, "files");
      setBulkAnalysisProgress(prev => ({
        ...prev,
        completed: prev.total,
        isAnalyzing: false
      }));
      setBulkReviewQueue(validResults);
      setBulkReviewIndex(0);
      setBulkApprovedResults(new Map());
      setBulkReviewMode(true);

      // Load first file into diff view
      if (validResults.length > 0) {
        setOriginalContent(validResults[0].original);
        setAnonymizedContent(validResults[0].anonymized);
        setCurrentPlan(validResults[0].plan);
      }
    } catch (e) {
      console.error("Bulk analysis failed:", e);
      alert(`解析に失敗しました: ${formatError(e)}`);
    } finally {
      setBulkAnalysisProgress(prev => ({ ...prev, isAnalyzing: false }));
      setIsProcessing(false);
    }
  };

  const handleStopOperations = async () => {
    try {
      await invoke("cancel_active_operations");
    } catch (e) {
      console.error("Failed to cancel active operations:", e);
    }
  };

  // Approve current file and move to next
  const handleBulkApprove = () => {
    if (!bulkReviewMode || bulkReviewQueue.length === 0) return;

    const current = bulkReviewQueue[bulkReviewIndex];
    setBulkApprovedResults(prev => {
      const next = new Map(prev);
      next.set(current.path, { fileName: current.fileName, content: anonymizedContent, status: 'approved' });
      return next;
    });

    moveToNextBulkFile();
  };

  // Skip current file and move to next
  const handleBulkSkip = () => {
    if (!bulkReviewMode) return;
    const current = bulkReviewQueue[bulkReviewIndex];
    setBulkApprovedResults(prev => {
      const next = new Map(prev);
      next.set(current.path, { fileName: current.fileName, content: anonymizedContent, status: 'skipped' });
      return next;
    });
    moveToNextBulkFile();
  };

  // Go back to previous file
  const handleBulkPrevious = () => {
    if (!bulkReviewMode || bulkReviewIndex <= 0) return;
    const prevIndex = bulkReviewIndex - 1;
    setBulkReviewIndex(prevIndex);
    const prev = bulkReviewQueue[prevIndex];
    setOriginalContent(prev.original);
    // Load previously saved content if exists, otherwise use AI result
    const savedResult = bulkApprovedResults.get(prev.path);
    setAnonymizedContent(savedResult?.content || prev.anonymized);
    setCurrentPlan(prev.plan);
  };

  // Move to next file in queue or stay at last
  const moveToNextBulkFile = () => {
    const nextIndex = bulkReviewIndex + 1;
    if (nextIndex >= bulkReviewQueue.length) {
      // At the end - stay here, user can click "Complete" button
      // Don't auto-complete - let user review all files first
      return;
    }
    setBulkReviewIndex(nextIndex);
    const next = bulkReviewQueue[nextIndex];
    setOriginalContent(next.original);
    // Load previously saved content if exists, otherwise use AI result
    const savedResult = bulkApprovedResults.get(next.path);
    setAnonymizedContent(savedResult?.content || next.anonymized);
    setCurrentPlan(next.plan);
  };

  // Complete bulk review: show save dialog and save
  const handleBulkComplete = async (): Promise<{ path: string; files: string[] } | null> => {
    // Get only approved files
    const approvedFiles = Array.from(bulkApprovedResults.values()).filter(r => r.status === 'approved');
    if (approvedFiles.length === 0) {
      // No files approved, just exit review mode
      setBulkReviewMode(false);
      setOriginalContent("");
      setAnonymizedContent("");
      return null;
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
        const itemsToSave = approvedFiles.map(r => ({ file_name: r.fileName, content: r.content }));
        console.info("[Bulk Review] Save request:", {
          outputDir: selectedPath,
          files: itemsToSave.map(f => f.file_name),
        });
        await invoke("bulk_save", {
          outputDir: selectedPath,
          items: itemsToSave,
        });
        console.info(`Saved ${approvedFiles.length} files to ${selectedPath}`);

        // Open the directory in OS explorer
        try {
          await invoke("open_directory", { path: selectedPath });
        } catch (openErr) {
          console.warn("Failed to open directory:", openErr);
        }

        // Return the path and files so ConfigSidebar can show it
        const savedFilesList = approvedFiles.map(r => r.fileName);

        // Exit review mode
        setBulkReviewMode(false);
        setBulkReviewQueue([]);
        setBulkReviewIndex(0);
        setBulkApprovedResults(new Map());
        setOriginalContent("");
        setAnonymizedContent("");

        return { path: selectedPath, files: savedFilesList };
      }
      return null;
    } catch (e) {
      console.error("Bulk save failed:", e);
      alert(`保存に失敗しました: ${e}`);
      return null;
    }
  };

  // Cancel bulk review
  const handleBulkCancel = () => {
    setBulkReviewMode(false);
    setBulkReviewQueue([]);
    setBulkReviewIndex(0);
    setBulkApprovedResults(new Map());
    setOriginalContent("");
    setAnonymizedContent("");
  };

  const handleProviderChange = async (provider: ModelProvider) => {
    setSelectedProvider(provider);
    if (provider === "gemini") {
      try {
        const hasKey = await invoke<boolean>("has_api_key_for_provider", { provider });
        setHasApiKey(hasKey);
        if (!hasKey) {
          setShowApiKeyModal(true);
        }
      } catch (e) {
        console.error("Failed to check provider credential:", e);
      }
    } else {
      setShowApiKeyModal(false);
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
        onOpenSettings={() => setShowApiKeyModal(true)}
        activeFileName={activeFile?.filename}
        hasUnsavedChanges={hasUnsavedChanges}
        disableSave={bulkReviewMode}
        isReviewMode={bulkReviewMode}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Flex Layout */}
        <div className="flex-1 flex min-w-0 overflow-hidden">

          {/* File Explorer */}
          <ResizablePanel
            defaultWidth={256}
            minWidth={180}
            maxWidth={450}
            handlePosition="right"
            className="bg-background border-r overflow-hidden"
          >
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
          </ResizablePanel>

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
                  onAccept={bulkReviewMode ? handleBulkApprove : handleAccept}
                  isReviewMode={bulkReviewMode}
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
          <ResizablePanel
            defaultWidth={384}
            minWidth={280}
            maxWidth={600}
            handlePosition="left"
            className="bg-background border-l overflow-hidden"
          >
             <ConfigSidebar
                onRunAnonymization={handleAnonymize}
                isProcessing={isProcessing}
                selectedProvider={selectedProvider}
                onProviderChange={handleProviderChange}
                currentContent={originalContent}
                currentPlan={currentPlan}
                fileCount={
                  selectedFilesForBulk.size > 0
                    ? selectedFilesForBulk.size
                    : currentFolder
                      ? folderFiles.filter(f => !f.isDir).length
                      : openedFiles.length > 0
                        ? 1
                        : 0
                }
                currentFileName={activeFile?.filename}
                currentDirPath={currentFolder?.path}
                selectedFilePaths={Array.from(selectedFilesForBulk)}
                onOpenFile={handleOpenFile}
                onOpenFolder={handleOpenFolder}
                onStartBulkReview={handleStartBulkReview}
                bulkReviewMode={bulkReviewMode}
                bulkReviewProgress={bulkReviewMode ? { current: bulkReviewIndex + 1, total: bulkReviewQueue.length, fileName: bulkReviewQueue[bulkReviewIndex]?.fileName || "" } : undefined}
                onBulkApprove={handleBulkApprove}
                onBulkSkip={handleBulkSkip}
                onBulkCancel={handleBulkCancel}
                onBulkPrevious={handleBulkPrevious}
                onBulkComplete={handleBulkComplete}
                onStopOperations={handleStopOperations}
                canGoPrevious={bulkReviewIndex > 0}
                canGoNext={bulkReviewIndex < bulkReviewQueue.length - 1}
                fileStatuses={bulkReviewQueue.map(f => ({
                  path: f.path,
                  fileName: f.fileName,
                  status: bulkApprovedResults.get(f.path)?.status || 'pending'
                }))}
                bulkAnalysisProgress={bulkAnalysisProgress}
             />
          </ResizablePanel>
        </div>
      </div>

      <StatusBar />

      {/* API Key Modal */}
      <ApiKeyModal
        isOpen={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
        onSaved={() => {
          setHasApiKey(true);
          setShowApiKeyModal(false);
          console.log("API key saved");
        }}
      />
    </div>
  );
}
