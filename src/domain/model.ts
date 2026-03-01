export interface ReplacementEntry {
    original: string;
    replacement: string;
    start: number;
    end: number;
    reason: string;
    category?: string;
}

export interface AnonPlan {
    taskName: string;
    globalRules: Record<string, any>; // JSON Value in Rust maps to any or specific struct
    replacements: ReplacementEntry[];
    status: "draft" | "approved";
    appliedSkills?: string[];
}

export interface AgentResponse {
    message: string;
    plan: AnonPlan;
}
