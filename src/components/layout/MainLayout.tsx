import { ConfigSidebar } from "./ConfigSidebar";
import { EditorPanel } from "./EditorPanel";
import { SampleSidebar, SampleDraft } from "./SampleSidebar";
import { StatusBar } from "./StatusBar";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function MainLayout() {
  const [originalContent, setOriginalContent] = useState<string>("");
  const [anonymizedContent, setAnonymizedContent] = useState<string>("");

  const [isProcessing, setIsProcessing] = useState(false);

  const handleSampleSelect = (draft: SampleDraft) => {
      setOriginalContent(draft.content);
      setAnonymizedContent(draft.content); // Reset anonymized view
  };

  const handleNewDraft = () => {
      setOriginalContent("");
      setAnonymizedContent("");
  };

  const handleAnonymize = async (task: string) => {
    if (!originalContent) return;
    setIsProcessing(true);
    try {
        // 1. Analyze (Gemini)
        const plan = await invoke("analyze_text", { text: originalContent, taskContext: task });
        // 2. Apply (Rust)
        const result = await invoke<string>("apply_plan", { text: originalContent, plan });
        setAnonymizedContent(result);
    } catch (e) {
        console.error("Anonymization failed:", e);
        setAnonymizedContent(`Error: ${e}`);
    } finally {
        setIsProcessing(false);
    }
  };

  const handleAccept = () => {
      setOriginalContent(anonymizedContent);
      // Optional: clear anonymizedContent or keep it same?
      // Keeping it same means DiffEditor shows no diff, which is correct feedback.
      // Or we could show a toast.
  };

  return (
    <div className="h-screen w-full bg-background text-foreground flex flex-col font-sans">
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar (Leftmost narrow strip) */}
        <div className="w-12 border-r bg-muted/30 flex flex-col items-center py-4 gap-4">
             {/* Icons would go here */}
             <div className="h-6 w-6 rounded bg-primary" />
             <div className="h-6 w-6 rounded bg-muted-foreground/30" />
        </div>

        {/* Simple Flex Layout (Replaced ResizablePanelGroup due to persistent issues) */}
        <div className="flex-1 flex min-w-0 overflow-hidden">
          {/* File Explorer - Fixed Width */}
          <div className="w-64 shrink-0 h-full bg-background border-r overflow-hidden">
            <SampleSidebar onSelect={handleSampleSelect} onNewDraft={handleNewDraft} />
          </div>

          {/* Editor Area - Flexible */}
          <div className="flex-1 h-full bg-background overflow-hidden">
            <EditorPanel
                original={originalContent}
                modified={anonymizedContent}
                onAccept={handleAccept}
            />
          </div>

          {/* Copilot Chat - Fixed Width */}
          <div className="w-80 shrink-0 h-full bg-background border-l overflow-hidden">
             <ConfigSidebar
                onRunAnonymization={handleAnonymize}
                isProcessing={isProcessing}
                currentContent={originalContent}
             />
          </div>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}
