import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invoke } from "@tauri-apps/api/core";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ConfigSidebarProps {
  onRunAnonymization: (task: string) => void;
  isProcessing: boolean;
  currentContent: string;
}

export function ConfigSidebar({ onRunAnonymization, isProcessing, currentContent }: ConfigSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "こんにちは！匿名化エージェントです。どのような匿名化が必要か教えてください。準備ができたら「実行」ボタンを押してください。" }
  ]);
  const [inputInfo, setInputInfo] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [taskContext, setTaskContext] = useState("Medical Case Study");

  const handleSendMessage = async () => {
    if (!inputInfo.trim() || isChatLoading) return;

    const userMsg: Message = { role: "user", content: inputInfo };
    setMessages(prev => [...prev, userMsg]);
    setInputInfo("");
    setIsChatLoading(true);

    try {
        // Simple conversational chat - include context
        let prompt = inputInfo;
        if (currentContent && currentContent.trim().length > 0) {
            prompt = `以下のテキストについて相談があります:\n---\n${currentContent.slice(0, 500)}${currentContent.length > 500 ? '...' : ''}\n---\n\n質問: ${inputInfo}`;
        }

        const response = await invoke<string>("chat_with_ai", { message: prompt });
        setMessages(prev => [...prev, { role: "assistant", content: response }]);

        // Detect task context from conversation
        const lowerInput = inputInfo.toLowerCase();
        if (lowerInput.includes("ワクチン") || lowerInput.includes("vaccine")) {
            setTaskContext("Vaccine Development");
        } else if (lowerInput.includes("教育") || lowerInput.includes("教材") || lowerInput.includes("educational")) {
            setTaskContext("Educational Material");
        }

    } catch (e) {
        console.error("Chat error:", e);
        setMessages(prev => [...prev, { role: "assistant", content: `エラー: ${e}` }]);
    } finally {
        setIsChatLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
        <div className="p-3 border-b text-sm font-semibold flex justify-between items-center bg-muted/10">
            <span>匿名化エージェント</span>
            <div className="flex gap-1">
                 <div className={`h-2 w-2 rounded-full ${isChatLoading ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
            </div>
        </div>

         {/* Chat History */}
         <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-lg p-3 text-sm border shadow-sm ${m.role === 'user' ? 'bg-white text-foreground' : 'bg-muted/30 text-foreground'}`}>
                            {m.content}
                        </div>
                    </div>
                ))}
                {isChatLoading && (
                    <div className="flex justify-start">
                        <div className="max-w-[85%] rounded-lg p-3 text-sm border shadow-sm bg-muted/30 text-muted-foreground italic">
                            考え中...
                        </div>
                    </div>
                )}
            </div>
         </ScrollArea>

         {/* Task Context Display */}
         <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            タスク: {taskContext}
         </div>

         {/* Input Area */}
         <div className="p-4 border-t bg-muted/10 space-y-3">
            <div className={`p-3 rounded-md border bg-white shadow-sm transition-all ${isProcessing ? 'ring-2 ring-primary/20' : ''}`}>
                 <Input
                    className="border-0 p-0 h-auto focus-visible:ring-0 text-sm shadow-none placeholder:text-muted-foreground/50"
                    value={inputInfo}
                    onChange={(e) => setInputInfo(e.target.value)}
                    placeholder="質問や要望を入力..."
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    disabled={!currentContent}
                />
            </div>

            <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setInputInfo("")}>クリア</Button>
                <Button
                    onClick={() => onRunAnonymization(taskContext)}
                    size="sm"
                    disabled={isProcessing || !currentContent}
                    className="bg-green-600 hover:bg-green-700"
                >
                    {isProcessing ? "処理中..." : "実行"}
                </Button>
            </div>
         </div>
    </div>
  );
}
