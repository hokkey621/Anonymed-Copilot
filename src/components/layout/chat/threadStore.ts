import {
  CHAT_THREADS_STORAGE_KEY,
  DEFAULT_THREAD_TITLE,
  MAX_CHAT_THREADS,
} from "./constants";
import type { ChatThread, Message, PersistedChatThreads } from "./types";

export const createThread = (initialMessage: Message, title = DEFAULT_THREAD_TITLE): ChatThread => {
  const now = Date.now();
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [initialMessage],
    activeSkills: [],
    chatPhase: "discovery",
  };
};

export const deriveThreadTitle = (threadMessages: Message[], fallback: string): string => {
  const firstUser = threadMessages.find((m) => m.role === "user")?.content.trim();
  if (!firstUser) return fallback;
  return firstUser.length > 24 ? `${firstUser.slice(0, 24)}...` : firstUser;
};

export const persistThreads = (nextThreads: ChatThread[], nextActiveThreadId: string) => {
  const payload: PersistedChatThreads = {
    activeThreadId: nextActiveThreadId,
    threads: nextThreads,
  };
  localStorage.setItem(CHAT_THREADS_STORAGE_KEY, JSON.stringify(payload));
};

export const clampThreads = (threads: ChatThread[]) => threads.slice(0, MAX_CHAT_THREADS);

export const loadThreads = (): PersistedChatThreads | null => {
  const raw = localStorage.getItem(CHAT_THREADS_STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as PersistedChatThreads;
};
