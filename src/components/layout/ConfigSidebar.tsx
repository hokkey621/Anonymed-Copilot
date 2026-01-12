import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ProgressIndicator, AgentProgressEvent } from "./ProgressIndicator";
import { Send, ChevronDown } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ConfigSidebarProps {
  onRunAnonymization: (task: string) => void;
  isProcessing: boolean;
  currentContent: string;
}

const TASK_OPTIONS = [
  { value: "Medical Case Study", label: "医療ケーススタディ" },
  { value: "Vaccine Development", label: "ワクチン開発" },
  { value: "Educational Material", label: "教育資料" },
  { value: "General", label: "一般" },
];

export function ConfigSidebar({ onRunAnonymization, isProcessing, currentContent }: ConfigSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "こんにちは！匿名化エージェントです。\n\nどのような匿名化が必要か教えてください。例えば：\n- 「ワクチン開発用に匿名化したい」\n- 「教育資料として使いたいので、病名は残してほしい」\n\n準備ができたら **実行** ボタンを押してください。" }
  ]);
  const [inputInfo, setInputInfo] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [taskContext, setTaskContext] = useState("Medical Case Study");
  const [showTaskDropdown, setShowTaskDropdown] = useState(false);
  const [progressEvent, setProgressEvent] = useState<AgentProgressEvent | null>(null);
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

  // Reset progress when processing starts/stops
  useEffect(() => {
    if (!isProcessing) {
        // Keep the last success state for a bit? Or just reset if it was successful?
        // Let's keep it visible until user interacts or new run starts.
        // Actually, let's reset it when new run starts.
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

    // Construct history for the backend
    // If it's the very first user interaction involving the document, inject the FULL content.
    // For subsequent turns, just send the messages as is (the backend is stateless between calls, so we send full history every time).
    // WAIT: The backend is "stateless" meaning we must send the WHOLE history every time.

    // 1. Prepare the new message list including the latest user message
    const newHistory = [...messages, userMsg];

    // 2. Map to the format backend expects.
    // Optimization: If the conversation is long, we might need to prune, but Gemini has a huuuuge context.
    // We inject the document into the SYSTEM context or the First User Message if it's not there.

    let apiMessages = newHistory.map(m => ({ role: m.role, content: m.content }));

    // If there is document content, ensuring it is part of the context.
    // We treat the first message's context injection carefully.
    if (currentContent && currentContent.trim().length > 0) {
        // If the first message doesn't have the context, prepending a system-like user message or modifying the first message.
        // For simplicity: We prepend a context message if it's not already established.
        // Actually, let's just prepend a context frame if it's the start.
        if (messages.length === 1) { // Only the initial greeting exists
             apiMessages = [
                 messages[0], // Greeting
                 { role: "user", content: `Context Document:\n${currentContent}\n\nUser Question: ${inputInfo}` }
             ];
             // Update local state to show just the question, but we send context to API?
             // Better: Just send the context in the API call but keep UI clean.
        } else {
             // For later turns, we just assume the history carries the context if we sent it before?
             // No, the backend `chat` is stateless. We must send the history where one of the messages *contained* the context.
             // So if we modified the message sent to API in turn 1, we must keep sending that modified version.
             // This implies `messages` state should nominally hold the full context?
             // Or we keep a separate "apiHistory" state?
             // Let's refine: We will inject context into the LAST message if it's the first time user speaks.

             // actually, simplest valid approach for now:
             // On every request, if we are in "analysis mode", we prepend the system context.
             // But purely for chat, let's just prepend the document to the *first* legitimate user message in the history.

             const firstUserIndex = apiMessages.findIndex(m => m.role === "user");
             if (firstUserIndex !== -1) {
                 apiMessages[firstUserIndex].content = `[Document Context]:\n${currentContent}\n\n[User]: ${apiMessages[firstUserIndex].content}`;
             }
        }
    }

    try {
      // Sending the array of messages
      const response = await invoke<string>("chat_with_ai", { messages: apiMessages });
      setMessages(prev => [...prev, { role: "assistant", content: response }]);


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

  const currentTaskLabel = TASK_OPTIONS.find(t => t.value === taskContext)?.label || taskContext;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between bg-gradient-to-r from-purple-500/10 to-pink-500/10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm font-semibold">匿名化エージェント</span>
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
            <ChatMessage
              key={i}
              role={m.role}
              content={m.content}
              onExecute={m.role === 'assistant' && i === messages.length - 1 && currentContent ? handleExecuteFromChat : undefined}
              isExecuting={isProcessing}
            />
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
            placeholder={currentContent ? "質問や要望を入力..." : "まずテキストを選択してください"}
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
