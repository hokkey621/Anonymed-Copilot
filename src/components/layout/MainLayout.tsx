// import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"; // Temporarily disabled due to layout issues
import { ConfigSidebar } from "./ConfigSidebar";
import { EditorPanel } from "./EditorPanel";
import { FileTreeSidebar } from "./FileTreeSidebar";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function MainLayout() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string>("");
  const [anonymizedContent, setAnonymizedContent] = useState<string>("");

  const [isProcessing, setIsProcessing] = useState(false);

  const handleFileSelect = async (path: string) => {
    setSelectedFile(path);
    try {
      const content = await invoke<string>("read_text_file", { filePath: path });
      setOriginalContent(content);
      // For now, init anonymized content as same as original (or empty until analyzed)
      setAnonymizedContent(content);
    } catch (error) {
      console.error("Failed to read file:", error);
      setOriginalContent("Error reading file");
    }
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
            <FileTreeSidebar onFileSelect={handleFileSelect} />
          </div>

          {/* Editor Area - Flexible */}
          <div className="flex-1 h-full bg-background overflow-hidden">
            <EditorPanel original={originalContent} modified={anonymizedContent} />
          </div>

          {/* Copilot Chat - Fixed Width */}
          <div className="w-80 shrink-0 h-full bg-background border-l overflow-hidden">
             <ConfigSidebar onRunAnonymization={handleAnonymize} isProcessing={isProcessing} />
          </div>
        </div>
      </div>

      {/* Footer / Status Bar */}
      <div className="h-8 border-t bg-primary text-primary-foreground flex items-center px-4 text-xs justify-between">
          <div className="flex items-center gap-4">
              <span className="font-semibold">Re-identification Risk</span>
              <div className="h-2 w-24 bg-white/20 rounded-full overflow-hidden">
                  <div className="h-full bg-green-400 w-[1%]" />
              </div>
              <span className="text-green-200">Extremely Low 0.01%</span>
          </div>
          <div className="flex items-center gap-4">
               <span>Ready</span>
          </div>
      </div>
    </div>
  );
}
