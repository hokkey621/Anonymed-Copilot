import type { ChatPhase, Message, ModelProvider } from "./types";

export const MODEL_OPTIONS: { value: ModelProvider; label: string }[] = [
  { value: "gemini", label: "Gemini" },
  { value: "local_gemma", label: "Local Gemma (Ollama)" },
];

export const CHAT_THREADS_STORAGE_KEY = "anonymed-copilot-chat-threads-v1";
export const MAX_CHAT_THREADS = 30;
export const DEFAULT_THREAD_TITLE = "新しいチャット";

export const INITIAL_ASSISTANT_MESSAGE: Message = {
  role: "assistant",
  content:
    "こんにちは。ユーザーテストへのご協力ありがとうございます！\n\nまずは左上の「File」>「ファイルを開く」から、匿名化したいカルテや資料（テキストファイル）を開いてください。\n\n個人情報は自動的に検出・匿名化されます。",
  suggestions: ["匿名化を実行して", "使い方を教えて"],
};

export const PLAN_FLOW_PHASES: ChatPhase[] = ["plan_presented", "execution_ready", "revision"];
