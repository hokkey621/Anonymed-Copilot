import { AnonPlan } from "@/domain/model";
import { createDefaultPlan } from "@/domain/utils";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { ConfigSidebar } from "./ConfigSidebar";
import { EditorPanel } from "./EditorPanel";
import { SampleSidebar, SampleDraft } from "./SampleSidebar";
import { StatusBar } from "./StatusBar";

export function MainLayout() {
  const [originalContent, setOriginalContent] = useState<string>("");
  const [anonymizedContent, setAnonymizedContent] = useState<string>("");
  const [currentPlan, setCurrentPlan] = useState<AnonPlan>(createDefaultPlan());
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSampleSelect = (draft: SampleDraft) => {
      setOriginalContent(draft.content);
      setAnonymizedContent(draft.content);
      setCurrentPlan(createDefaultPlan());
  };

  const handleNewDraft = () => {
      setOriginalContent("");
      setAnonymizedContent("");
      setCurrentPlan(createDefaultPlan());
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

  // Accept changes and generate audit log
  const handleAccept = async () => {
      try {
          await invoke("create_audit_report", {
              finalContent: anonymizedContent,
              appliedPlan: currentPlan
          });

          setOriginalContent(anonymizedContent);
          setAnonymizedContent(anonymizedContent);
          setCurrentPlan(createDefaultPlan());
          console.log("Anonymization approved and audited.");
      } catch (e) {
          console.error("Audit generation failed:", e);
      }
  };

  return (
    <div className="h-screen w-full bg-background text-foreground flex flex-col font-sans">
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
             />
          </div>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}
