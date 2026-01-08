import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, FileText, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SampleDraft {
    id: string;
    title: string;
    content: string;
    type: "sample" | "draft";
}

const SAMPLES: SampleDraft[] = [
    {
        id: "sample_medical_1",
        title: "Medical Record Template",
        type: "sample",
        content: `Patient: John Doe (DOB: 1980-05-15)
Address: 123 Main St, Springfield, IL 62704
Visit Date: 2023-10-25
Hospital: Springfield General Hospital

History of Present Illness:
Mr. Doe presented with a 3-day history of fever and cough. He works as a teacher at Springfield Elementary. He denies recent travel.

Assessment:
Viral upper respiratory infection.

Plan:
Rest and hydration. Follow up with Dr. Smith if symptoms worsen.`
    },
    {
        id: "sample_clinical_note",
        title: "Clinical Note (Short)",
        type: "sample",
        content: `Subjective: Patient reports headache and nausea.
Objective: BP 120/80, HR 72. No visible distress.
Assessment: Tension headache.
Plan: Ibuprofen 400mg PRN.`
    },
    {
        id: "sample_research",
        title: "Research Abstract",
        type: "sample",
        content: `Study ID: VAC-2023-001
Principal Investigator: Dr. Alice Johnson
Site: University Hospital, Tokyo

Abstract:
This study evaluates the efficacy of the new vaccine in 500 participants aged 20-60. Participant A001 reported mild side effects.`
    }
];

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
