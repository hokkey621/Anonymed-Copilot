import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  const handleSendMessage = () => {
    if (!inputInfo.trim()) return;

    const newMsg: Message = { role: "user", content: inputInfo };
    setMessages(prev => [...prev, newMsg]);
    setInputInfo("");

    // Mock AI response for now
    setTimeout(() => {
        setMessages(prev => [...prev, { role: "assistant", content: "I received your message. Anonymization logic is continuously improving." }]);
    }, 1000);
  };

  return (
    <div className="h-full flex flex-col">
        <div className="p-4 border-b font-semibold bg-muted/40 text-sm">Copilot Chat</div>

         {/* Chat History */}
         <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-lg p-3 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                            {m.content}
                        </div>
                    </div>
                ))}
            </div>
         </ScrollArea>

         {/* Input Area */}
         <div className="p-4 border-t gap-2 flex flex-col">
            <div className="flex gap-2">
                 <Input
                    value={taskContext}
                    onChange={(e) => setTaskContext(e.target.value)}
                    placeholder="Context (e.g. Vaccine Study)"
                    className="text-xs"
                />
            </div>
            <div className="flex gap-2">
                <Input
                    value={inputInfo}
                    onChange={(e) => setInputInfo(e.target.value)}
                    placeholder="Type instructions..."
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                />
                <Button onClick={handleSendMessage} size="sm">Send</Button>
            </div>
            <Button
                variant="secondary"
                className="w-full"
                size="sm"
                onClick={() => onRunAnonymization(taskContext)}
                disabled={isProcessing}
            >
                {isProcessing ? "Analyzing with Gemini..." : "Run Auto-Anonymization"}
            </Button>
         </div>
    </div>
  );
}
