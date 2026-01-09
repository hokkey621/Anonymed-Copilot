import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { ChatMessage } from "@/components/chat/ChatMessage";
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
  const scrollRef = useRef<HTMLDivElement>(null);

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

    try {
      let prompt = inputInfo;
      if (currentContent && currentContent.trim().length > 0) {
        prompt = `以下のテキストについて相談があります:\n---\n${currentContent.slice(0, 500)}${currentContent.length > 500 ? '...' : ''}\n---\n\n質問: ${inputInfo}`;
      }

      const response = await invoke<string>("chat_with_ai", { message: prompt });
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
