import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { BulkPlanCard } from "@/components/chat/BulkPlanCard";
import { SuggestionChips } from "@/components/chat/SuggestionChips";
import { AgentProgressEvent } from "./ProgressIndicator";
import { Send, ChevronDown, FileText, Loader2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  bulkPlan?: BulkExecutionPlan;
  workflowSteps?: WorkflowStep[];
  suggestions?: string[];
}

interface BulkExecutionPlan {
  target_count: number;
  estimated_time_ms: number;
  policy_summary: string[];
}

interface WorkflowStep {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
}

interface BulkProgressEvent {
  completed: number;
  total: number;
  current_file: string;
  step_id: string;
  step_status: string;
  step_message: string;
}

interface AgentChatResponse {
  message: string;
  bulk_plan: BulkExecutionPlan | null;
  workflow_steps: WorkflowStep[] | null;
  suggestions: string[] | null;
}

interface ConfigSidebarProps {
  onRunAnonymization: (task: string) => void;
  isProcessing: boolean;
  currentContent: string;
  fileCount?: number;
  currentDirPath?: string;
  currentPlan?: any;
  currentFileName?: string;
  selectedFilePaths?: string[];
}

const MODEL_OPTIONS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
];

export function ConfigSidebar({
  onRunAnonymization,
  isProcessing,
  currentContent,
  fileCount = 0,
  currentDirPath = "",
  currentPlan,
  currentFileName = "",
  selectedFilePaths = []
}: ConfigSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "こんにちは、Anonymed Copilotです。まず、作業するファイルかフォルダを開いてください。次に、チャットで質問するか質問例をタップしてください。",
      suggestions: ["匿名化したい", "使い方が知りたい"]
    }
  ]);
  const [inputInfo, setInputInfo] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [taskContext, setTaskContext] = useState("Medical Case Study");
  const [selectedModel, setSelectedModel] = useState("gemini-3-flash-preview");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number; currentFile?: string } | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [isBulkExecuting, setIsBulkExecuting] = useState(false);
  const [activeBulkPlan, setActiveBulkPlan] = useState<BulkExecutionPlan | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [thinkingPhase, setThinkingPhase] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Helper function to filter out thought tags from AI responses
  const filterThoughtTags = (text: string): string => {
    let cleaned = text;
    // Remove [System]: ... patterns (LLM sometimes echoes system prompt)
    cleaned = cleaned.replace(/\[System\]:?[\s\S]*?(?=\n\n|\n[ぁ-んァ-ン一-龯]|$)/gi, '');
    // Remove [THOUGHT]: ... patterns
    cleaned = cleaned.replace(/\[THOUGHT\]:?[\s\S]*?(?=\n\n|\n[A-Zぁ-んァ-ン一-龯]|$)/gi, '');
    // Remove [thinking]...[/thinking] blocks
    cleaned = cleaned.replace(/\[thinking\][\s\S]*?\[\/thinking\]\s*/gi, '');

    // Aggressive filter: If [/THOUGHT] exists, assume everything before it is internal thought
    if (cleaned.includes("[/THOUGHT]")) {
      cleaned = cleaned.replace(/[\s\S]*?\[\/THOUGHT\]\s*/i, '');
    }

    return cleaned.trim();
  };

  // Listen for agent progress
  useEffect(() => {
    const unlisten = listen<AgentProgressEvent>("agent-progress", () => {});
    return () => { unlisten.then(f => f()); };
  }, []);

  // Listen for bulk progress
  useEffect(() => {
    const unlisten = listen<BulkProgressEvent>("bulk-progress", (event) => {
      const { completed, total, current_file, step_id, step_status } = event.payload;
      setBulkProgress({ completed, total, currentFile: current_file });
      setWorkflowSteps(prev => prev.map(step =>
        step.id === step_id ? { ...step, status: step_status as WorkflowStep['status'] } : step
      ));
      if (step_id === "audit" && step_status === "completed") {
        setIsBulkExecuting(false);
      }
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  // Listen for chat streaming
  useEffect(() => {
    const unlistenStream = listen<{ chunk: string; full: string }>("chat-stream", (event) => {
      // Remove [THOUGHT]:... and [thinking]...[/thinking] blocks from display
      let cleaned = event.payload.full;
      // Remove [THOUGHT]: ... patterns (entire line or until end of thought)
      cleaned = cleaned.replace(/\[THOUGHT\]:?\s*[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '');
      // Remove [thinking]...[/thinking] blocks
      cleaned = cleaned.replace(/\[thinking\][\s\S]*?\[\/thinking\]\s*/gi, '');
      // Trim leading/trailing whitespace
      cleaned = cleaned.trim();
      setStreamingContent(cleaned);
    });
    return () => { unlistenStream.then(f => f()); };
  }, []);

  // Listen for thinking phases
  useEffect(() => {
    const unlistenPhase = listen<{ phase: string; message: string }>("thinking-phase", (event) => {
      setThinkingPhase(event.payload.message);
    });
    return () => { unlistenPhase.then(f => f()); };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputInfo.trim() || isChatLoading) return;

    const userMsg: Message = { role: "user", content: inputInfo };
    setMessages(prev => [...prev, userMsg]);
    setInputInfo("");
    setIsChatLoading(true);

    // Check if this message requires file content (only for plan creation/execution)
    const needsContentKeywords = [
      "計画を立てて", "実行して", "一括", "全件", "全て", "すべて"
    ];
    const needsFileContent = needsContentKeywords.some(kw => inputInfo.includes(kw));

    const newHistory = [...messages, userMsg];
    let apiMessages = newHistory.map(m => ({ role: m.role, content: m.content }));

    // Only include file content when needed for anonymization plan
    if (needsFileContent && currentContent && currentContent.trim().length > 0) {
      if (messages.length === 1) {
        apiMessages = [
          messages[0],
          { role: "user", content: `Context Document:\n${currentContent}\n\nUser Question: ${inputInfo}` }
        ];
      } else {
        const firstUserIndex = apiMessages.findIndex(m => m.role === "user");
        if (firstUserIndex !== -1) {
          apiMessages[firstUserIndex].content = `[Document Context]:\n${currentContent}\n\n[User]: ${apiMessages[firstUserIndex].content}`;
        }
      }
    }

    try {
      // Start with empty streaming content
      setStreamingContent("");

      const response = await invoke<AgentChatResponse>("agent_chat_streaming", {
        messages: apiMessages,
        fileCount: fileCount,
        editorContent: needsFileContent ? (currentContent || null) : null
      });

      const newMessage: Message = {
        role: "assistant",
        content: filterThoughtTags(response.message),
        bulkPlan: response.bulk_plan || undefined,
        workflowSteps: response.workflow_steps || undefined,
        suggestions: response.suggestions || undefined
      };

      setMessages(prev => [...prev, newMessage]);

      if (response.bulk_plan && response.workflow_steps) {
        setActiveBulkPlan(response.bulk_plan);
        setWorkflowSteps(response.workflow_steps);
      }

      // Auto-detect task context
      const lowerInput = inputInfo.toLowerCase();
      if (lowerInput.includes("ワクチン") || lowerInput.includes("vaccine")) {
        setTaskContext("Vaccine Development");
      } else if (lowerInput.includes("教育") || lowerInput.includes("教材")) {
        setTaskContext("Educational Material");
      }
    } catch (e) {
      console.error("Chat error:", e);
      setMessages(prev => [...prev, { role: "assistant", content: `エラー: ${e}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleBulkCommit = async () => {
    console.log("handleBulkCommit called", { currentDirPath, currentPlan, currentContent });

    setIsBulkExecuting(true);
    setBulkProgress({ completed: 0, total: activeBulkPlan?.target_count || 1 });

    try {
      // If folder is available, use bulk execute
      if (currentDirPath && currentPlan) {
        await invoke("bulk_execute", {
          dirPath: currentDirPath,
          plan: currentPlan,
          taskName: taskContext.replace(/\s+/g, '_'),
          targetFiles: selectedFilePaths.length > 0 ? selectedFilePaths : null
        });
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "✅ 完了しました。`anonymized_outputs` フォルダに保存されました。"
        }]);
      } else {
        // Single file mode - use the original anonymization flow (analyze + apply with diff)
        // No message needed - user will see the diff in the editor
        onRunAnonymization(taskContext);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `❌ エラー: ${e}` }]);
    } finally {
      setIsBulkExecuting(false);
      setActiveBulkPlan(null);
    }
  };

  const modelLabel = MODEL_OPTIONS.find(m => m.value === selectedModel)?.label || selectedModel;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Chat Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-3 space-y-3">
          {messages.map((m, i) => (
            <div key={i}>
              <ChatMessage role={m.role} content={m.content} />
              {m.bulkPlan && m.workflowSteps && (
                <div className="mt-2">
                  <BulkPlanCard
                    plan={m.bulkPlan}
                    workflowSteps={workflowSteps.length > 0 ? workflowSteps : m.workflowSteps}
                    onCommit={handleBulkCommit}
                    isExecuting={isBulkExecuting || isProcessing}
                    progress={bulkProgress || undefined}
                  />
                </div>
              )}
            </div>
          ))}
          {/* Show suggestions from the last assistant message */}
          {messages.length > 0 && messages[messages.length - 1].role === "assistant" &&
           messages[messages.length - 1].suggestions &&
           messages[messages.length - 1].suggestions!.length > 0 && (
            <SuggestionChips
              suggestions={messages[messages.length - 1].suggestions!}
              onSelect={async (text) => {
                // Directly send the suggestion as a message
                if (!currentContent || isChatLoading) return;

                const userMsg: Message = { role: "user", content: text };
                setMessages(prev => [...prev, userMsg]);
                setIsChatLoading(true);

                // Check if this suggestion requires file content (only for plan creation/execution)
                const needsContentKeywords = [
                  "計画を立てて", "実行して", "一括", "全件", "全て", "すべて"
                ];
                const needsFileContent = needsContentKeywords.some(kw => text.includes(kw));

                const newHistory = [...messages, userMsg];
                let apiMessages = newHistory.map(m => ({ role: m.role, content: m.content }));

                // Only include file content when needed for anonymization plan
                if (needsFileContent && currentContent && currentContent.trim().length > 0) {
                  const firstUserIndex = apiMessages.findIndex(m => m.role === "user");
                  if (firstUserIndex !== -1) {
                    apiMessages[firstUserIndex].content = `[Document Context]:\n${currentContent}\n\n[User]: ${apiMessages[firstUserIndex].content}`;
                  }
                }

                try {
                  setStreamingContent("");
                  const response = await invoke<AgentChatResponse>("agent_chat_streaming", {
                    messages: apiMessages,
                    fileCount: fileCount,
                    editorContent: needsFileContent ? (currentContent || null) : null
                  });

                  const newMessage: Message = {
                    role: "assistant",
                    content: filterThoughtTags(response.message),
                    bulkPlan: response.bulk_plan || undefined,
                    workflowSteps: response.workflow_steps || undefined,
                    suggestions: response.suggestions || undefined
                  };

                  setMessages(prev => [...prev, newMessage]);

                  if (response.bulk_plan && response.workflow_steps) {
                    setActiveBulkPlan(response.bulk_plan);
                    setWorkflowSteps(response.workflow_steps);
                  }
                } catch (e) {
                  console.error("Chat error:", e);
                  setMessages(prev => [...prev, { role: "assistant", content: `エラー: ${e}` }]);
                } finally {
                  setIsChatLoading(false);
                }
              }}
              disabled={isChatLoading || !currentContent}
            />
          )}
          {isChatLoading && (
            <div className="text-sm">
              <div className="text-xs font-medium mb-1 text-muted-foreground">Agent</div>
              <div className="rounded-md px-3 py-2 bg-muted/50">
                {streamingContent ? (
                  <p className="whitespace-pre-wrap break-words">{streamingContent}</p>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="inline-flex gap-1">
                      <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                    <span className="text-xs">{thinkingPhase || "考え中..."}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer: File indicator + Input */}
      <div className="border-t p-3 space-y-2">
        {/* Target file indicator */}
        {(currentFileName || currentContent) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1.5 rounded">
            <FileText size={12} />
            <span className="truncate">{currentFileName || "選択中のテキスト"}</span>
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={inputInfo}
            onChange={(e) => setInputInfo(e.target.value)}
            placeholder={currentContent ? "質問を入力..." : "テキストを選択してください"}
            onKeyDown={(e) => e.key === 'Enter' && e.metaKey && handleSendMessage()}
            disabled={!currentContent || isProcessing}
          />
          <Button
            size="sm"
            variant="default"
            onClick={handleSendMessage}
            disabled={!currentContent || !inputInfo.trim() || isChatLoading}
            className="shrink-0 gap-1.5"
          >
            <Send size={14} />
            送信
          </Button>
        </div>

        {/* Model selector row */}
        <div className="flex items-center justify-between text-xs">
          <div className="relative">
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors text-muted-foreground"
            >
              {modelLabel}
              <ChevronDown size={12} />
            </button>
            {showModelDropdown && (
              <div className="absolute bottom-full left-0 mb-1 bg-popover border rounded-md shadow-lg py-1 min-w-[160px] z-50">
                {MODEL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setSelectedModel(opt.value); setShowModelDropdown(false); }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-muted ${selectedModel === opt.value ? 'text-blue-500' : ''}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {isProcessing && (
            <span className="text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              処理中...
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
