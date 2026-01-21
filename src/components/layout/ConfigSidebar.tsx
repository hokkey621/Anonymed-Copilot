import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { BulkPlanCard } from "@/components/chat/BulkPlanCard";
import { SuggestionChips } from "@/components/chat/SuggestionChips";
import { AgentProgressEvent } from "./ProgressIndicator";
import { Send, ChevronDown, FileText, Loader2, Sparkles } from "lucide-react";

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
  // Bulk review mode props
  onStartBulkReview?: (taskContext: string) => void;
  bulkReviewMode?: boolean;
  bulkReviewProgress?: { current: number; total: number; fileName: string };
  bulkAnalysisProgress?: { completed: number; total: number; isAnalyzing: boolean };
  onBulkApprove?: () => void;
  onBulkSkip?: () => void;
  onBulkCancel?: () => void;
  onBulkPrevious?: () => void;
  onBulkComplete?: () => void;
  canGoPrevious?: boolean;
  canGoNext?: boolean;
  fileStatuses?: { path: string; fileName: string; status: 'approved' | 'skipped' | 'pending' }[];
}

const MODEL_OPTIONS = [
  { value: "gemini-3.0-flash", label: "Gemini 3.0 Flash" },
  { value: "other", label: "Other Model" },
];

export function ConfigSidebar({
  onRunAnonymization,
  isProcessing,
  currentContent,
  fileCount = 0,
  currentDirPath = "",
  currentPlan,
  currentFileName = "",
  selectedFilePaths = [],
  onStartBulkReview,
  bulkReviewMode = false,
  bulkReviewProgress,
  bulkAnalysisProgress,
  onBulkApprove,
  onBulkSkip,
  onBulkCancel,
  onBulkPrevious,
  onBulkComplete,
  canGoPrevious = false,
  canGoNext = true,
  fileStatuses = [],
}: ConfigSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "こんにちは、Anonymed Copilotです。匿名化したいカルテや資料を開いてください。元のファイルは変更されないので安心してください。",
      suggestions: ["匿名化したい", "使い方を教えて"]
    }
  ]);
  const [inputInfo, setInputInfo] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [taskContext, setTaskContext] = useState("Medical Case Study");
  const [selectedModel, setSelectedModel] = useState("gemini-3.0-flash");
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

  // Keywords that indicate file content should be sent to the LLM
  const FILE_CONTENT_KEYWORDS = [
    "計画を立てて", "実行して", "一括", "全件", "全て", "すべて",
    // スキル関連のキーワードでもファイルコンテンツを渡す
    "ワクチン", "vaccine", "教材", "教育", "症例", "研究", "開発用", "作成用",
    "学会", "論文", "匿名化", "確認", "変更"
  ];

  // Helper to check if a message needs file content
  const checkNeedsFileContent = (text: string): boolean => {
    return FILE_CONTENT_KEYWORDS.some(kw => text.includes(kw));
  };

  const [activeSkills, setActiveSkills] = useState<string[]>([]);

  // Listen for agent progress (including skill matching)
  useEffect(() => {
    const unlisten = listen<AgentProgressEvent>("agent-progress", (event) => {
      // Track matched skills from the Skills step
      if (event.payload.step === "Skills" && event.payload.status === "Completed") {
        const match = event.payload.message.match(/Matched skills: (.+)/);
        if (match) {
          const skills = match[1].split(", ").map(s => s.trim());
          setActiveSkills(skills);
        }
      }
    });
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

    const needsFileContent = checkNeedsFileContent(inputInfo);

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

    // If in bulk review mode, this should not be called directly
    // Use onStartBulkReview instead for sequential review flow
    if (currentDirPath && onStartBulkReview && selectedFilePaths.length > 0) {
      // Start sequential review mode with per-file AI analysis
      onStartBulkReview(taskContext);
      setActiveBulkPlan(null);
      return;
    }

    // Single file mode - use the original anonymization flow
    if (!currentDirPath && currentContent) {
      onRunAnonymization(taskContext);
      return;
    }

    // Fallback: Old bulk execute (direct save without review)
    setIsBulkExecuting(true);
    setBulkProgress({ completed: 0, total: activeBulkPlan?.target_count || 1 });

    try {
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
                if (isChatLoading) return;

                const userMsg: Message = { role: "user", content: text };
                setMessages(prev => [...prev, userMsg]);
                setIsChatLoading(true);

                const needsFileContent = checkNeedsFileContent(text);

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
              disabled={isChatLoading}
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

      {/* Analysis Progress - shown during AI analysis phase */}
      {bulkAnalysisProgress?.isAnalyzing && (
        <div className="border-t p-3 space-y-2 bg-amber-50 dark:bg-amber-900/20">
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex gap-1">
              <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            <span className="font-medium">
              🔄 AI分析中... {bulkAnalysisProgress.completed}/{bulkAnalysisProgress.total}件完了
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${(bulkAnalysisProgress.completed / bulkAnalysisProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Bulk Review Controls - shown when in review mode */}
      {bulkReviewMode && bulkReviewProgress && (
        <div className="border-t p-3 space-y-2 bg-blue-50 dark:bg-blue-900/20">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              ファイル {bulkReviewProgress.current}/{bulkReviewProgress.total}
            </span>
            <span className="text-muted-foreground truncate max-w-[150px]">
              {bulkReviewProgress.fileName}
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${(bulkReviewProgress.current / bulkReviewProgress.total) * 100}%` }}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onBulkPrevious}
              disabled={!canGoPrevious}
              className="px-2"
            >
              ← 前へ
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onBulkSkip}
              className="flex-1"
            >
              スキップ
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={onBulkApprove}
              className="flex-1"
            >
              {canGoNext ? "承認して次へ" : "承認"}
            </Button>
          </div>

          {/* File status list */}
          <div className="mt-2 max-h-24 overflow-y-auto text-xs space-y-1">
            {fileStatuses.map((f, i) => (
              <div key={f.path} className={`flex items-center gap-1.5 px-1 py-0.5 rounded ${
                bulkReviewProgress?.current === i + 1 ? 'bg-blue-100 dark:bg-blue-900/30' : ''
              }`}>
                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  f.status === 'approved' ? 'bg-green-500' :
                  f.status === 'skipped' ? 'bg-gray-400' : 'bg-gray-200'
                }`} />
                <span className="truncate flex-1">{f.fileName}</span>
                <span className="text-muted-foreground">
                  {f.status === 'approved' ? '✓' : f.status === 'skipped' ? '−' : ''}
                </span>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-2">
            <button
              onClick={onBulkCancel}
              className="flex-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
            >
              中断
            </button>
            <Button
              size="sm"
              variant="default"
              onClick={onBulkComplete}
              className="flex-1"
            >
              保存して完了
            </Button>
          </div>
        </div>
      )}

      {/* Footer: File indicator + Input */}
      <div className="border-t p-3 space-y-2">
        {/* Active Skills indicator */}
        {activeSkills.length > 0 && (
          <div className="flex items-center gap-2 text-xs bg-purple-500/10 px-2 py-1.5 rounded border border-purple-500/20">
            <Sparkles size={12} className="text-purple-500" />
            <span className="text-purple-700 dark:text-purple-300">適用中のスキル:</span>
            <div className="flex gap-1 flex-wrap">
              {activeSkills.map(skill => (
                <span
                  key={skill}
                  className="bg-purple-500/20 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded text-xs font-medium"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

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
            placeholder={currentContent ? "質問を入力..." : "ご質問をどうぞ"}
            onKeyDown={(e) => e.key === 'Enter' && e.metaKey && handleSendMessage()}
            disabled={isProcessing}
          />
          <Button
            size="sm"
            variant="default"
            onClick={handleSendMessage}
            disabled={!inputInfo.trim() || isChatLoading}
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
