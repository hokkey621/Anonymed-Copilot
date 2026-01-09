export interface ReplacementEntry {
    original: string;
    replacement: string;
    start: number;
    end: number;
    reason: string;
    category?: string;
}

export interface AnonPlan {
    task_name: string;
    global_rules: Record<string, any>; // JSON Value in Rust maps to any or specific struct
    replacements: ReplacementEntry[];
    status: "draft" | "approved";
}

export interface AgentResponse {
    message: string;
    plan: AnonPlan;
}
