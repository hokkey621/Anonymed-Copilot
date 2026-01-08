import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
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
    <div className="h-screen w-full bg-background text-foreground overflow-hidden">
      <ResizablePanelGroup direction="horizontal">
        {/* Left Sidebar: File Tree */}
        <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="border-r">
          <FileTreeSidebar onFileSelect={handleFileSelect} />
        </ResizablePanel>

        <ResizableHandle />

        {/* Center: Editor (Diff View) */}
        <ResizablePanel defaultSize={55} minSize={30}>
          <EditorPanel original={originalContent} modified={anonymizedContent} />
        </ResizablePanel>

        <ResizableHandle />

        {/* Right Sidebar: Chat & Config (AI Agent) */}
        <ResizablePanel defaultSize={25} minSize={20} className="border-l">
          <ConfigSidebar onRunAnonymization={handleAnonymize} isProcessing={isProcessing} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
