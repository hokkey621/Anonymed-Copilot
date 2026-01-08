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
}

export function ConfigSidebar({ onRunAnonymization, isProcessing }: ConfigSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello! I am your Anonymization Copilot. Please select a file to start." }
  ]);
  const [inputInfo, setInputInfo] = useState("");
  const [taskContext, setTaskContext] = useState("Medical Case Study");

  const handleSendMessage = async () => {
    if (!inputInfo.trim()) return;

    const userMsg: Message = { role: "user", content: inputInfo };
    setMessages(prev => [...prev, userMsg]);
    setInputInfo("");

    try {
        const response = await invoke<string>("chat_with_ai", { message: inputInfo });
        setMessages(prev => [...prev, { role: "assistant", content: response }]);
    } catch (e) {
        setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e}` }]);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
        <div className="p-3 border-b text-sm font-semibold flex justify-between items-center bg-muted/10">
            <span>Copilot Chat</span>
            <div className="flex gap-1">
                 <div className="h-2 w-2 rounded-full bg-green-500" />
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
            </div>
         </ScrollArea>

         {/* Input Area */}
         <div className="p-4 border-t bg-muted/10 space-y-3">
            <div className={`p-3 rounded-md border bg-white shadow-sm transition-all ${isProcessing ? 'ring-2 ring-primary/20' : ''}`}>
                 <Input
                    className="border-0 p-0 h-auto focus-visible:ring-0 text-sm shadow-none placeholder:text-muted-foreground/50"
                    value={inputInfo}
                    onChange={(e) => setInputInfo(e.target.value)}
                    placeholder="Ask Copilot to edit..."
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                />
            </div>

            <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setInputInfo("")}>Cancel</Button>
                <Button onClick={() => onRunAnonymization(taskContext)} size="sm" disabled={isProcessing}>
                    {isProcessing ? "Processing..." : "Run Anonymization"}
                </Button>
            </div>
         </div>
    </div>
  );
}
