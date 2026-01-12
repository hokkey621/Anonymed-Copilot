import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { BulkPlanCard } from "@/components/chat/BulkPlanCard";
import { ProgressIndicator, AgentProgressEvent } from "./ProgressIndicator";
import { Send, ChevronDown } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  bulkPlan?: BulkExecutionPlan;
  workflowSteps?: WorkflowStep[];
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
}

interface ConfigSidebarProps {
  onRunAnonymization: (task: string) => void;
  isProcessing: boolean;
  currentContent: string;
  fileCount?: number;
  currentDirPath?: string;
  currentPlan?: any;
}

const TASK_OPTIONS = [
  { value: "Medical Case Study", label: "医療ケーススタディ" },
  { value: "Vaccine Development", label: "ワクチン開発" },
  { value: "Educational Material", label: "教育資料" },
  { value: "General", label: "一般" },
];

export function ConfigSidebar({
  onRunAnonymization,
  isProcessing,
  currentContent,
  fileCount = 0,
  currentDirPath = "",
  currentPlan
}: ConfigSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "こんにちは！匿名化エージェントです。\n\nどのような匿名化が必要か教えてください。例えば：\n- 「ワクチン開発用に匿名化したい」\n- 「教育資料として使いたいので、病名は残してほしい」\n\n準備ができたら **実行** ボタンを押してください。\n\n**バルク処理**をご希望の場合は「全件に適用して」とお伝えください。" }
  ]);
  const [inputInfo, setInputInfo] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [taskContext, setTaskContext] = useState("Medical Case Study");
  const [showTaskDropdown, setShowTaskDropdown] = useState(false);
  const [progressEvent, setProgressEvent] = useState<AgentProgressEvent | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number; currentFile?: string } | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [isBulkExecuting, setIsBulkExecuting] = useState(false);
  const [activeBulkPlan, setActiveBulkPlan] = useState<BulkExecutionPlan | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Listen for agent progress
  useEffect(() => {
    const unlisten = listen<AgentProgressEvent>("agent-progress", (event) => {
        setProgressEvent(event.payload);
    });

    return () => {
        unlisten.then(f => f());
    };
  }, []);

  // Listen for bulk progress
  useEffect(() => {
    const unlisten = listen<BulkProgressEvent>("bulk-progress", (event) => {
      const { completed, total, current_file, step_id, step_status } = event.payload;
      setBulkProgress({ completed, total, currentFile: current_file });

      // Update workflow steps
      setWorkflowSteps(prev => prev.map(step =>
        step.id === step_id
          ? { ...step, status: step_status as WorkflowStep['status'] }
          : step
      ));

      // Check if all done
      if (step_id === "audit" && step_status === "completed") {
        setIsBulkExecuting(false);
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Reset progress when processing starts/stops
  useEffect(() => {
    if (!isProcessing) {
        // Keep the last success state for a bit
    } else {
        setProgressEvent({ step: 'Planner', status: 'In Progress', message: 'Starting agent...' });
    }
  }, [isProcessing]);

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

    const newHistory = [...messages, userMsg];
    let apiMessages = newHistory.map(m => ({ role: m.role, content: m.content }));

    // Inject document context
    if (currentContent && currentContent.trim().length > 0) {
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
      // Use agent_chat for enhanced responses
      const response = await invoke<AgentChatResponse>("agent_chat", {
        messages: apiMessages,
        fileCount: fileCount
      });

      const newMessage: Message = {
        role: "assistant",
        content: response.message,
        bulkPlan: response.bulk_plan || undefined,
        workflowSteps: response.workflow_steps || undefined
      };

      setMessages(prev => [...prev, newMessage]);

      // If bulk plan received, store for commit
      if (response.bulk_plan && response.workflow_steps) {
        setActiveBulkPlan(response.bulk_plan);
        setWorkflowSteps(response.workflow_steps);
      }

      // Auto-detect task context
      const lowerInput = inputInfo.toLowerCase();
      if (lowerInput.includes("ワクチン") || lowerInput.includes("vaccine")) {
        setTaskContext("Vaccine Development");
      } else if (lowerInput.includes("教育") || lowerInput.includes("教材") || lowerInput.includes("educational")) {
        setTaskContext("Educational Material");
      }

    } catch (e) {
      console.error("Chat error:", e);
      setMessages(prev => [...prev, { role: "assistant", content: `エラーが発生しました: ${e}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleExecuteFromChat = () => {
    onRunAnonymization(taskContext);
  };

  const handleBulkCommit = async () => {
    // For single file mode (no directory path), use the normal execution flow
    if (!currentDirPath) {
      onRunAnonymization(taskContext);
      return;
    }

    // For bulk mode with directory path
    if (!currentPlan) {
      console.error("No plan available for bulk execution");
      return;
    }

    setIsBulkExecuting(true);
    setBulkProgress({ completed: 0, total: activeBulkPlan?.target_count || 0 });

    try {
      await invoke("bulk_execute", {
        dirPath: currentDirPath,
        plan: currentPlan,
        taskName: taskContext.replace(/\s+/g, '_')
      });

      setMessages(prev => [...prev, {
        role: "assistant",
        content: "✅ バルク処理が完了しました！\n\n匿名化されたファイルは `anonymized_outputs` フォルダに保存されました。元のファイルは変更されていません。"
      }]);
    } catch (e) {
      console.error("Bulk execute error:", e);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `❌ バルク処理中にエラーが発生しました: ${e}`
      }]);
    } finally {
      setIsBulkExecuting(false);
      setActiveBulkPlan(null);
    }
  };

  const currentTaskLabel = TASK_OPTIONS.find(t => t.value === taskContext)?.label || taskContext;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between bg-gradient-to-r from-purple-500/10 to-pink-500/10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm font-semibold">匿名化エージェント</span>
          {fileCount > 0 && (
            <span className="text-xs text-muted-foreground bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
              {fileCount} files
            </span>
          )}
        </div>

        {/* Task Context Selector */}
        <div className="relative">
          <button
            onClick={() => setShowTaskDropdown(!showTaskDropdown)}
            className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1 transition-colors"
          >
            {currentTaskLabel}
            <ChevronDown size={12} />
          </button>
          {showTaskDropdown && (
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border rounded-lg shadow-lg z-50 py-1 min-w-[160px] max-w-[200px]">
              {TASK_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setTaskContext(opt.value); setShowTaskDropdown(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700
                    ${taskContext === opt.value ? 'text-blue-500 font-medium' : ''}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Progress Indicator */}
      {(isProcessing || progressEvent) && (
        <div className="px-3 pt-2">
            <ProgressIndicator
                currentStep={progressEvent?.step || 'Planner'}
                status={progressEvent?.status || 'In Progress'}
                message={progressEvent?.message || 'Ready to start...'}
            />
        </div>
      )}

      {/* Chat Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-4">
          {messages.map((m, i) => (
            <div key={i}>
              <ChatMessage
                role={m.role}
                content={m.content}
                onExecute={m.role === 'assistant' && i === messages.length - 1 && currentContent && !m.bulkPlan ? handleExecuteFromChat : undefined}
                isExecuting={isProcessing}
              />
              {/* Show BulkPlanCard if this message has a bulk plan */}
              {m.bulkPlan && m.workflowSteps && (
                <div className="mt-3 ml-10">
                  <BulkPlanCard
                    plan={m.bulkPlan}
                    workflowSteps={workflowSteps.length > 0 ? workflowSteps : m.workflowSteps}
                    onCommit={handleBulkCommit}
                    isExecuting={isBulkExecuting}
                    progress={bulkProgress || undefined}
                  />
                </div>
              )}
            </div>
          ))}
          {isChatLoading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="text-sm text-muted-foreground italic">考え中...</div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="p-3 border-t bg-muted/5">
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 text-sm rounded-full border bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            value={inputInfo}
            onChange={(e) => setInputInfo(e.target.value)}
            placeholder={currentContent ? "質問や要望を入力...（例: 全件に適用して）" : "まずテキストを選択してください"}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
            disabled={!currentContent}
          />
          <Button
            size="icon"
            className="rounded-full shrink-0"
            onClick={handleSendMessage}
            disabled={!currentContent || !inputInfo.trim() || isChatLoading}
          >
            <Send size={16} />
          </Button>
        </div>

        {/* Execute Button */}
        <Button
          onClick={() => onRunAnonymization(taskContext)}
          disabled={isProcessing || !currentContent}
          className="w-full mt-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600"
        >
          {isProcessing ? "処理中..." : "実行"}
        </Button>
      </div>
    </div>
  );
}
