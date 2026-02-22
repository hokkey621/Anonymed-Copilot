export type ModelProvider = "gemini" | "local_gemma";

export type ChatPhase =
  | "discovery"
  | "help"
  | "purpose_selection"
  | "plan_presented"
  | "execution_ready"
  | "revision"
  | "troubleshoot"
  | "off_topic";

export interface BulkExecutionPlan {
  targetCount: number;
  estimatedTimeMs: number;
  policySummary: string[];
}

export interface WorkflowStep {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  bulkPlan?: BulkExecutionPlan;
  workflowSteps?: WorkflowStep[];
  suggestions?: string[];
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  activeSkills: string[];
  chatPhase: ChatPhase;
}

export interface BulkProgressEvent {
  completed: number;
  total: number;
  currentFile: string;
  stepId: string;
  stepStatus: string;
  stepMessage: string;
}

export interface AgentChatResponse {
  message: string;
  bulkPlan: BulkExecutionPlan | null;
  workflowSteps: WorkflowStep[] | null;
  suggestions: string[] | null;
  nextState: ChatPhase;
  stateReason: string;
  appliedSkills?: string[] | null;
}

export interface PersistedChatThreads {
  activeThreadId: string;
  threads: ChatThread[];
}
