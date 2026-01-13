import { AnonPlan } from "@/domain/model";
import { createDefaultPlan } from "@/domain/utils";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { ConfigSidebar } from "./ConfigSidebar";
import { EditorPanel } from "./EditorPanel";
import { MenuBar } from "./MenuBar";
import { SampleSidebar, SampleDraft } from "./SampleSidebar";
import { StatusBar } from "./StatusBar";

interface ActiveFile {
  path: string;
  filename: string;
}

interface OpenFileResult {
  path: string;
  content: string;
  filename: string;
}

interface SaveFileResult {
  saved_path: string;
  audit_log_path: string;
}

export function MainLayout() {
  const [originalContent, setOriginalContent] = useState<string>("");
  const [anonymizedContent, setAnonymizedContent] = useState<string>("");
  const [currentPlan, setCurrentPlan] = useState<AnonPlan>(createDefaultPlan());
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);

  const handleSampleSelect = (draft: SampleDraft) => {
      setOriginalContent(draft.content);
      setAnonymizedContent(draft.content);
      setCurrentPlan(createDefaultPlan());
      setActiveFile(null); // Clear active file when selecting sample
  };

  const handleNewDraft = () => {
      setOriginalContent("");
      setAnonymizedContent("");
      setCurrentPlan(createDefaultPlan());
      setActiveFile(null);
  };

  // Open file from dialog
  const handleOpenFile = async () => {
    try {
      const result = await invoke<OpenFileResult | null>("open_file");
      if (result) {
        setOriginalContent(result.content);
        setAnonymizedContent(result.content);
        setCurrentPlan(createDefaultPlan());
        setActiveFile({ path: result.path, filename: result.filename });
      }
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  // Save anonymized file with dialog
  const handleSaveFile = async () => {
    if (!anonymizedContent) return;
    try {
      const result = await invoke<SaveFileResult | null>("save_anonymized_file", {
        content: anonymizedContent,
        originalFilename: activeFile?.filename || "untitled.txt",
        originalContent: originalContent,
        appliedPlan: currentPlan,
      });
      if (result) {
        console.log("File saved:", result.saved_path);
        console.log("Audit log:", result.audit_log_path);
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
        onSaveFile={handleSaveFile}
        activeFileName={activeFile?.filename}
        hasUnsavedChanges={hasUnsavedChanges}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar */}
        <div className="w-12 border-r bg-muted/30 flex flex-col items-center py-4 gap-4">
             <div className="h-6 w-6 rounded bg-primary" />
             <div className="h-6 w-6 rounded bg-muted-foreground/30" />
        </div>

        {/* Main Flex Layout */}
        <div className="flex-1 flex min-w-0 overflow-hidden">
          {/* File Explorer */}
          <div className="w-64 shrink-0 h-full bg-background border-r overflow-hidden">
            <SampleSidebar onSelect={handleSampleSelect} onNewDraft={handleNewDraft} />
          </div>

          {/* Editor Area */}
          <div className="flex-1 h-full bg-background overflow-hidden">
            <EditorPanel
                original={originalContent}
                modified={anonymizedContent}
                onAccept={handleAccept}
                onModifiedChange={setAnonymizedContent}
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
                fileCount={1}
                currentFileName={activeFile?.filename}
             />
          </div>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}
