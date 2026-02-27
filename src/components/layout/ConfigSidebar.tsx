import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/Toast";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { BulkPlanCard } from "@/components/chat/BulkPlanCard";
import { SuggestionChips } from "@/components/chat/SuggestionChips";
import { AgentProgressEvent } from "./ProgressIndicator";
import { ChatThreadHeader } from "./chat/ChatThreadHeader";
import { BulkReviewControls } from "./chat/BulkReviewControls";
import { ChatInputFooter } from "./chat/ChatInputFooter";
import {
  INITIAL_ASSISTANT_MESSAGE,
  MAX_CHAT_THREADS,
  MODEL_OPTIONS,
  PLAN_FLOW_PHASES,
} from "./chat/constants";
import {
  applyPartialPlanEdit,
  buildExecutionTaskContext,
  checkNeedsFileContent,
  filterThoughtTags,
  formatCommandError,
  isPartialPlanEditIntent,
  namesFromPath,
  resolveResponseContent,
  shouldRunAnonymizationDirectly,
} from "./chat/chatLogic";
import { clampThreads, createThread, deriveThreadTitle, loadThreads, persistThreads } from "./chat/threadStore";
import type {
  AgentChatResponse,
  BulkExecutionPlan,
  BulkProgressEvent,
  ChatPhase,
  ChatThread,
  Message,
  ModelProvider,
} from "./chat/types";

export type { ModelProvider } from "./chat/types";

interface ConfigSidebarProps {
  onRunAnonymization: (task: string) => void;
  isProcessing: boolean;
  selectedProvider: ModelProvider;
  onProviderChange: (provider: ModelProvider) => void;
  onOpenFile?: () => Promise<void> | void;
  onOpenFolder?: () => Promise<void> | void;
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
  onBulkComplete?: () => Promise<{ path: string; files: string[] } | null | void>;
  canGoPrevious?: boolean;
  canGoNext?: boolean;
  fileStatuses?: { path: string; fileName: string; status: 'approved' | 'skipped' | 'pending' }[];
  onStopOperations?: () => Promise<void> | void;
}

export function ConfigSidebar({
  onRunAnonymization,
  isProcessing,
  selectedProvider,
  onProviderChange,
  onOpenFile,
  onOpenFolder,
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
  onStopOperations,
}: ConfigSidebarProps) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Message[]>([INITIAL_ASSISTANT_MESSAGE]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [inputInfo, setInputInfo] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isStopRequested, setIsStopRequested] = useState(false);
  const [taskContext, setTaskContext] = useState("Medical Case Study");
  const [_showModelDropdown] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number; currentFile?: string } | null>(null);
  const [isBulkExecuting, setIsBulkExecuting] = useState(false);
  const [activeBulkPlan, setActiveBulkPlan] = useState<BulkExecutionPlan | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [thinkingPhase, setThinkingPhase] = useState<string>("");
  const [isApproving, setIsApproving] = useState(false);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [chatPhase, setChatPhase] = useState<ChatPhase>("discovery");
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamEndReasonRef = useRef<"completed" | "cancelled" | null>(null);

  const canStop = isChatLoading || !!bulkAnalysisProgress?.isAnalyzing;

  const replaceActiveThread = (
    nextMessages: Message[],
    nextSkills?: string[],
    nextPhase?: ChatPhase,
  ) => {
    const skills = nextSkills ?? activeSkills;
    const phase = nextPhase ?? chatPhase;
    setMessages(nextMessages);
    setActiveSkills(skills);
    setChatPhase(phase);
    setThreads((prev) => {
      const updated = prev
        .map((thread) => {
          if (thread.id !== activeThreadId) return thread;
          return {
            ...thread,
            messages: nextMessages,
            activeSkills: skills,
            chatPhase: phase,
            updatedAt: Date.now(),
            title: deriveThreadTitle(nextMessages, thread.title),
          };
        })
        .slice(0, MAX_CHAT_THREADS);
      persistThreads(updated, activeThreadId);
      return updated;
    });
  };

  const buildApiMessages = (history: Message[]) => {
    // The first assistant greeting is UI guidance and should not bias the model conversation.
    const cleaned = history.filter((m, i) => !(i === 0 && m.role === "assistant"));
    return cleaned
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content }));
  };

  const showErrorPopup = (message: string) => {
    showToast(message, "error", 6000);
  };

  useEffect(() => {
    try {
      const parsed = loadThreads();
      if (parsed && Array.isArray(parsed.threads) && parsed.threads.length > 0) {
          const hydratedThreads = clampThreads(parsed.threads).map((thread) => ({
            ...thread,
            chatPhase: (thread.chatPhase ?? "discovery") as ChatPhase,
          }));
          const initialActiveId = parsed.activeThreadId || hydratedThreads[0].id;
          const initialThread = hydratedThreads.find((t) => t.id === initialActiveId) ?? hydratedThreads[0];
          setThreads(hydratedThreads);
          setActiveThreadId(initialThread.id);
          setMessages(initialThread.messages.length > 0 ? initialThread.messages : [INITIAL_ASSISTANT_MESSAGE]);
          setActiveSkills(initialThread.activeSkills ?? []);
          setChatPhase(initialThread.chatPhase ?? "discovery");
          return;
      }
    } catch (e) {
      console.warn("Failed to load chat history:", e);
    }

    const thread = createThread(INITIAL_ASSISTANT_MESSAGE);
    setThreads([thread]);
    setActiveThreadId(thread.id);
    setMessages(thread.messages);
    setActiveSkills(thread.activeSkills);
    setChatPhase("discovery");
    persistThreads([thread], thread.id);
  }, []);

  useEffect(() => {
    if (threads.length === 0 || !activeThreadId) return;
    persistThreads(clampThreads(threads), activeThreadId);
  }, [threads, activeThreadId]);

  const allReviewed = bulkReviewMode && fileStatuses.length > 0 && fileStatuses.every(f => f.status !== 'pending');
  const approvedCount = fileStatuses.filter(f => f.status === 'approved').length;

  // Listen for agent progress (including skill matching)
  useEffect(() => {
    const unlisten = listen<AgentProgressEvent>("agent-progress", (event) => {
      // Track matched skills from the Skills step
      if (event.payload.step === "Skills" && event.payload.status === "Completed") {
        const match = event.payload.message.match(/Matched skills: (.+)/);
        if (match) {
          const skills = match[1].split(", ").map(s => s.trim());
          setActiveSkills(skills);
          setThreads((prev) =>
            prev.map((thread) =>
              thread.id === activeThreadId ? { ...thread, activeSkills: skills, updatedAt: Date.now() } : thread
            )
          );
        }
      }
    });
    return () => { unlisten.then(f => f()); };
  }, [activeThreadId]);

  // Listen for bulk progress
  useEffect(() => {
    const unlisten = listen<BulkProgressEvent>("bulk-progress", (event) => {
      const { completed, total, currentFile, stepId, stepStatus } = event.payload;
      setBulkProgress({ completed, total, currentFile });
      if (stepId === "audit" && stepStatus === "completed") {
        setIsBulkExecuting(false);
      }
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  // Listen for chat streaming
  useEffect(() => {
    const unlistenStream = listen<{ chunk: string; full: string }>("chat-stream", (event) => {
      setStreamingContent(filterThoughtTags(event.payload.full));
    });
    return () => { unlistenStream.then(f => f()); };
  }, []);

  useEffect(() => {
    const unlistenEnd = listen<{ full: string; reason?: string }>("chat-stream-end", (event) => {
      streamEndReasonRef.current =
        event.payload.reason === "cancelled" ? "cancelled" : "completed";
      if (event.payload.reason === "cancelled") {
        setThinkingPhase("停止しました");
      }
    });
    return () => { unlistenEnd.then(f => f()); };
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

  const handleCreateNewThread = () => {
    if (canStop || isProcessing) return;
    const thread = createThread(INITIAL_ASSISTANT_MESSAGE);
    setThreads((prev) => {
      const next = clampThreads([thread, ...prev]);
      persistThreads(next, thread.id);
      return next;
    });
    setActiveThreadId(thread.id);
    setMessages(thread.messages);
    setActiveSkills([]);
    setChatPhase("discovery");
    setStreamingContent("");
    setThinkingPhase("");
  };

  const handleSwitchThread = (threadId: string) => {
    if (canStop || isProcessing) return;
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return;
    setActiveThreadId(thread.id);
    setMessages(thread.messages);
    setActiveSkills(thread.activeSkills ?? []);
    setChatPhase(thread.chatPhase ?? "discovery");
    setStreamingContent("");
    setThinkingPhase("");
  };

  const handleStop = async () => {
    if (!canStop || isStopRequested) return;
    setIsStopRequested(true);
    setThinkingPhase("停止要求中...");
    try {
      if (onStopOperations) {
        await onStopOperations();
      } else {
        await invoke("cancel_active_operations");
      }
    } catch (e) {
      console.error("Failed to request stop:", e);
    } finally {
      setIsStopRequested(false);
    }
  };

  const sendText = async (text: string) => {
    if (!text.trim() || isChatLoading || !activeThreadId) return;

    const userMsg: Message = { role: "user", content: text };
    const history = [...messages, userMsg];
    replaceActiveThread(history);
    setInputInfo("");

    const normalized = text.replace(/\s+/g, "");
    if (normalized === "ファイルを開く" || normalized === "フォルダを開く") {
      try {
        if (normalized === "ファイルを開く") {
          await onOpenFile?.();
          replaceActiveThread([
            ...history,
            {
              role: "assistant",
              content: "ファイル選択ダイアログを開きました。ファイルを開いたら「匿名化プランを作成」と入力してください。",
              suggestions: ["匿名化プランを作成", "標準ルールで作成", "使い方を教えて"],
            },
          ]);
        } else {
          await onOpenFolder?.();
          replaceActiveThread([
            ...history,
            {
              role: "assistant",
              content: "フォルダ選択ダイアログを開きました。対象を選んだら「匿名化プランを作成」と入力してください。",
              suggestions: ["匿名化プランを作成", "処理対象を確認", "使い方を教えて"],
            },
          ]);
        }
      } catch (e) {
        showErrorPopup(formatCommandError(e));
        replaceActiveThread([
          ...history,
          { role: "assistant", content: `エラー: ${formatCommandError(e)}` },
        ]);
      }
      return;
    }

    if (normalized === "処理対象を確認" || normalized === "選択ファイルを確認") {
      const selectedNames = namesFromPath(selectedFilePaths);
      let targetSummary = "";

      if (selectedNames.length > 0) {
        const preview = selectedNames.slice(0, 5).join("、");
        const rest = selectedNames.length > 5 ? ` ほか${selectedNames.length - 5}件` : "";
        targetSummary = `現在の処理対象は ${selectedNames.length} 件です。\n${preview}${rest}`;
      } else if (currentFileName) {
        targetSummary = `現在の処理対象は 1 件です。\n${currentFileName}`;
      } else if (fileCount > 0) {
        targetSummary = `現在の処理対象は ${fileCount} 件です。`;
      } else {
        targetSummary = "現在、処理対象のファイルはありません。先にファイルまたはフォルダを開いてください。";
      }

      replaceActiveThread([
        ...history,
        {
          role: "assistant",
          content: targetSummary,
          suggestions:
            fileCount > 0
              ? ["匿名化プランを作成", "標準ルールで作成", "使い方を教えて"]
              : ["ファイルを開く", "フォルダを開く", "使い方を教えて"],
        },
      ]);
      return;
    }

    const hasExecutablePlan = !!activeBulkPlan || ((currentPlan?.replacements?.length ?? 0) > 0);
    if (shouldRunAnonymizationDirectly(text, hasExecutablePlan)) {
      if (currentDirPath && onStartBulkReview && selectedFilePaths.length > 0) {
        replaceActiveThread([...history, {
          role: "assistant",
          content: `選択された ${selectedFilePaths.length} 件を匿名化します。結果が出るまでお待ちください。`,
        }]);
        onStartBulkReview(buildExecutionTaskContext(taskContext, activeBulkPlan));
        return;
      }

      if (!currentContent) {
        replaceActiveThread([...history, {
          role: "assistant",
          content: "匿名化するテキストがありません。先にファイルを開いてください。",
        }]);
        return;
      }

      replaceActiveThread([...history, {
        role: "assistant",
        content: "匿名化を実行します。結果が出るまでお待ちください。",
      }]);
      onRunAnonymization(buildExecutionTaskContext(taskContext, activeBulkPlan));
      return;
    }

    if (
      activeBulkPlan &&
      PLAN_FLOW_PHASES.includes(chatPhase) &&
      isPartialPlanEditIntent(text)
    ) {
      const { plan: updatedPlan, changedRules } = applyPartialPlanEdit(activeBulkPlan, text);
      const changed = changedRules.length > 0;

      if (changed) {
        setActiveBulkPlan(updatedPlan);
        const rules = changedRules.join("・");
        replaceActiveThread(
          [
            ...history,
            {
              role: "assistant",
              content: `${rules}ルールのみ更新しました。他のルールは変更していません。内容を確認して実行してください。`,
              bulkPlan: updatedPlan,
              suggestions: ["この内容で実行", "一部ルールを修正", "変更点を説明して"],
            },
          ],
          activeSkills,
          "revision",
        );
      } else {
        replaceActiveThread(
          [
            ...history,
            {
              role: "assistant",
              content: "指定内容に対応するルール変更は見つかりませんでした。変更したい項目（例: 年齢、日付）を具体的に指定してください。",
              suggestions: ["年齢を5歳刻みにする", "日付を年月のみにする", "氏名を完全削除にする"],
            },
          ],
          activeSkills,
          "revision",
        );
      }
      return;
    }

    setIsChatLoading(true);
    const needsFileContent = checkNeedsFileContent(text);
    const apiMessages = buildApiMessages(history);
    try {
      streamEndReasonRef.current = null;
      setStreamingContent("");

      const response = await invoke<AgentChatResponse>("agent_chat_streaming", {
        messages: apiMessages,
        fileCount: fileCount,
        editorContent: needsFileContent ? (currentContent || null) : null,
        provider: selectedProvider,
        chatPhase,
      });

      const nextPhase: ChatPhase = response.nextState ?? chatPhase;

      const assistantMessage: Message = {
        role: "assistant",
        content: resolveResponseContent(
          response.message,
          text,
          streamEndReasonRef.current === "cancelled",
          !!currentContent || selectedFilePaths.length > 0 || fileCount > 0,
        ),
        bulkPlan: response.bulkPlan || undefined,
        workflowSteps: response.workflowSteps || undefined,
        suggestions: response.suggestions || undefined,
      };

      replaceActiveThread(
        [...history, assistantMessage],
        response.appliedSkills ?? [],
        nextPhase,
      );

      if (response.bulkPlan) {
        setActiveBulkPlan(response.bulkPlan);
      }

      const lowerInput = text.toLowerCase();
      if (lowerInput.includes("ワクチン") || lowerInput.includes("vaccine")) {
        setTaskContext("Vaccine Development");
      } else if (lowerInput.includes("教育") || lowerInput.includes("教材")) {
        setTaskContext("Educational Material");
      }
    } catch (e) {
      console.error("Chat error:", e);
      const message = formatCommandError(e);
      showErrorPopup(message);
      replaceActiveThread([...history, { role: "assistant", content: `エラー: ${message}` }]);
    } finally {
      setIsChatLoading(false);
      setStreamingContent("");
    }
  };

  const handleSendMessage = async () => {
    await sendText(inputInfo);
  };

  const handleBulkCommit = async () => {
    console.log("handleBulkCommit called", { currentDirPath, currentPlan, currentContent });

    // If in bulk review mode, this should not be called directly
    // Use onStartBulkReview instead for sequential review flow
    if (currentDirPath && onStartBulkReview && selectedFilePaths.length > 0) {
      // Start sequential review mode with per-file AI analysis
      onStartBulkReview(buildExecutionTaskContext(taskContext, activeBulkPlan));
      setActiveBulkPlan(null);
      return;
    }

    // Single file mode - use the original anonymization flow
    if (!currentDirPath && currentContent) {
      onRunAnonymization(buildExecutionTaskContext(taskContext, activeBulkPlan));
      return;
    }

    // Fallback: Old bulk execute (direct save without review)
    setIsBulkExecuting(true);
    setBulkProgress({ completed: 0, total: activeBulkPlan?.targetCount || 1 });

    try {
      if (currentDirPath && currentPlan) {
        await invoke("bulk_execute", {
          dirPath: currentDirPath,
          plan: currentPlan,
          taskName: taskContext.replace(/\s+/g, '_'),
          targetFiles: selectedFilePaths.length > 0 ? selectedFilePaths : null
        });
        replaceActiveThread([...messages, {
          role: "assistant",
          content: "✅ 完了しました。`anonymized_outputs` フォルダに保存されました。"
        }]);
      }
    } catch (e) {
      showErrorPopup(String(e));
      replaceActiveThread([...messages, { role: "assistant", content: `❌ エラー: ${e}` }]);
    } finally {
      setIsBulkExecuting(false);
      setActiveBulkPlan(null);
    }
  };

  const modelLabel = MODEL_OPTIONS.find(m => m.value === selectedProvider)?.label || selectedProvider;

  return (
    <div className="h-full flex flex-col bg-background">
      <ChatThreadHeader
        threads={threads}
        activeThreadId={activeThreadId}
        onCreateNewThread={handleCreateNewThread}
        onSwitchThread={handleSwitchThread}
        disabled={canStop || isProcessing}
      />

      {/* Chat Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-3 space-y-3">
          {messages.map((m, i) => (
            <div key={i}>
              <ChatMessage role={m.role} content={m.content} />
              {m.bulkPlan && (
                <div className="mt-2">
                  <BulkPlanCard
                    plan={m.bulkPlan}
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
              onSelect={sendText}
              disabled={isChatLoading || isProcessing}
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

      <BulkReviewControls
        bulkReviewMode={bulkReviewMode}
        bulkReviewProgress={bulkReviewProgress}
        bulkAnalysisProgress={bulkAnalysisProgress}
        onBulkApprove={onBulkApprove}
        onBulkSkip={onBulkSkip}
        onBulkCancel={onBulkCancel}
        onBulkPrevious={onBulkPrevious}
        canGoPrevious={canGoPrevious}
        canGoNext={canGoNext}
        fileStatuses={fileStatuses}
        isApproving={isApproving}
        onSetApproving={setIsApproving}
      />

      <ChatInputFooter
        inputInfo={inputInfo}
        onInputChange={setInputInfo}
        onSendMessage={handleSendMessage}
        isProcessing={isProcessing}
        isChatLoading={isChatLoading}
        currentContent={currentContent}
        currentFileName={currentFileName}
        selectedProvider={selectedProvider}
        onProviderChange={onProviderChange}
        modelLabel={modelLabel}
        canStop={canStop}
        isStopRequested={isStopRequested}
        onStop={handleStop}
        activeSkills={activeSkills}
        bulkReviewMode={bulkReviewMode}
        allReviewed={allReviewed}
        approvedCount={approvedCount}
        onBulkComplete={onBulkComplete}
        messages={messages}
        onReplaceThread={replaceActiveThread}
      />
    </div>
  );
}
