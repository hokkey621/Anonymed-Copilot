import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, FileText, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SampleDraft, SAMPLES } from "@/data/samples";

export type { SampleDraft }; // Re-export type for consumers

interface SampleSidebarProps {
    onSelect: (draft: SampleDraft) => void;
    onNewDraft: () => void;
}

export function SampleSidebar({ onSelect, onNewDraft }: SampleSidebarProps) {
    return (
        <div className="flex flex-col h-full bg-background border-r overflow-hidden">
            <div className="h-9 px-4 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 shrink-0">
                <span>Samples & Drafts</span>
                <button
                    onClick={onNewDraft}
                    className="hover:text-primary transition-colors"
                    title="New Draft"
                >
                    <PlusCircle size={14} />
                </button>
            </div>
            <ScrollArea className="flex-1 w-full">
                <div className="py-2">
                    <div className="px-4 py-2 text-xs font-bold text-blue-600 uppercase tracking-widest mb-1">
                        Samples
                    </div>
                    {SAMPLES.map((sample) => (
                        <div
                            key={sample.id}
                            className={cn(
                                "flex items-center py-2 px-4 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-800 text-sm select-none transition-colors group"
                            )}
                            onClick={() => onSelect(sample)}
                        >
                            <span className="mr-3 text-slate-500 shrink-0">
                                <Copy size={16} />
                            </span>
                            <div className="overflow-hidden">
                                <span className="truncate block font-medium">{sample.title}</span>
                                <span className="truncate block text-xs text-muted-foreground opacity-70">
                                    {sample.content.substring(0, 30)}...
                                </span>
                            </div>
                        </div>
                    ))}

                    <div className="px-4 py-2 mt-4 text-xs font-bold text-green-600 uppercase tracking-widest mb-1">
                        Actions
                    </div>
                    <div
                        className="flex items-center py-2 px-4 cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-800 text-sm select-none transition-colors"
                        onClick={onNewDraft}
                    >
                         <span className="mr-3 text-green-600 shrink-0">
                            <FileText size={16} />
                        </span>
                        <span className="font-medium">Open Blank Editor</span>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
