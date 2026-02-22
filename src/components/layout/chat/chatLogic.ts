import type { BulkExecutionPlan } from "./types";

const FILE_CONTENT_KEYWORDS = [
  "計画を立てて",
  "一括",
  "全件",
  "全て",
  "すべて",
  "ワクチン",
  "vaccine",
  "教材",
  "教育",
  "症例",
  "研究",
  "開発用",
  "作成用",
  "学会",
  "論文",
  "匿名化プラン",
  "確認",
  "変更",
  "修正",
  "調整",
  "再実行",
];

export const filterThoughtTags = (text: string): string => {
  let cleaned = text;
  cleaned = cleaned.replace(/\[System\]:?[\s\S]*?(?=\n\n|\n[ぁ-んァ-ン一-龯]|$)/gi, "");
  cleaned = cleaned.replace(/\[THOUGHT\]:?[\s\S]*?(?=\n\n|\n[A-Zぁ-んァ-ン一-龯]|$)/gi, "");
  cleaned = cleaned.replace(/\[thinking\][\s\S]*?\[\/thinking\]\s*/gi, "");

  if (cleaned.includes("[/THOUGHT]")) {
    cleaned = cleaned.replace(/[\s\S]*?\[\/THOUGHT\]\s*/i, "");
  }

  cleaned = cleaned
    .split("\n")
    .filter((line) => !/^\s*ファイル.*(アップロード|開い).*ください[。.!！]?\s*$/.test(line))
    .join("\n");

  return cleaned.trim();
};

export const buildFallbackResponse = (userInput: string, hasFileContext: boolean): string => {
  const normalized = userInput.trim();
  const hasAnonymizationIntent = /匿名化|実行|プラン|計画|個人情報|マスク|伏せ字/i.test(normalized);

  if (/使い方|ヘルプ|help/i.test(normalized)) {
    return "使い方の概要:\n1. 左上のメニューからファイルを開く\n2. 右のチャットで「匿名化プランを作成」と入力\n3. 変更内容を確認して保存";
  }

  if (!hasFileContext) {
    return "まず左上の「File」から匿名化したいファイルを開いてください。開いたら「匿名化プランを作成」と送ってください。";
  }

  if (hasAnonymizationIntent) {
    return "匿名化の利用目的を教えてください（例: ワクチン研究、教材作成、標準）。";
  }

  return "続けて具体的に指定してください。例: 「匿名化プランを作成」「変更点を確認」";
};

export const resolveResponseContent = (
  raw: string,
  userInput: string,
  wasCancelled: boolean,
  hasFileContext: boolean,
): string => {
  const cleaned = filterThoughtTags(raw);
  if (cleaned) return cleaned;

  if (wasCancelled) {
    return "処理を停止しました。必要であれば指示を短くして再実行してください。";
  }

  return buildFallbackResponse(userInput, hasFileContext);
};

export const formatCommandError = (error: unknown): string => {
  const raw = String(error ?? "");
  if (raw.includes("GEMINI_API_KEY_MISSING")) {
    return "Gemini の APIキーが未設定です。Settings から APIキーを設定してから再実行してください。";
  }
  if (raw.includes("OLLAMA_CONNECTION_ERROR")) {
    return "Ollama に接続できません。`ollama serve` を起動してから再実行してください。";
  }
  if (raw.includes("OLLAMA_STREAM_ERROR") && raw.includes("timed out")) {
    return "Local Gemma の応答がタイムアウトしました。短い指示にするか、再実行してください。";
  }
  return raw;
};

export const checkNeedsFileContent = (text: string): boolean => {
  return FILE_CONTENT_KEYWORDS.some((kw) => text.includes(kw));
};

export const shouldRunAnonymizationDirectly = (text: string, hasExecutablePlan: boolean): boolean => {
  const normalized = text.replace(/\s+/g, "");
  const directCommands = new Set(["実行", "匿名化実行", "処理を開始", "再実行", "修正して再実行"]);
  if (normalized === "この内容で実行") {
    return hasExecutablePlan;
  }
  return directCommands.has(normalized) || normalized.endsWith("を実行");
};

export const buildExecutionTaskContext = (
  taskContext: string,
  activeBulkPlan: BulkExecutionPlan | null,
): string => {
  if (!activeBulkPlan || !activeBulkPlan.policySummary || activeBulkPlan.policySummary.length === 0) {
    return taskContext;
  }
  const policyLines = activeBulkPlan.policySummary
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `- ${line}`)
    .join("\n");
  return `${taskContext}\n\n[USER_LOCKED_POLICY]\n${policyLines}\n[/USER_LOCKED_POLICY]`;
};

export const isPartialPlanEditIntent = (text: string): boolean => {
  return /年齢|日付|氏名|名前|住所|地名|病名|疾患|ルール|だけ|のみ/i.test(text);
};

const updateRuleLine = (
  lines: string[],
  keyword: string,
  nextLine: string,
): { next: string[]; changed: boolean } => {
  const index = lines.findIndex((line) => line.includes(keyword));
  if (index >= 0) {
    if (lines[index] === nextLine) return { next: lines, changed: false };
    const next = [...lines];
    next[index] = nextLine;
    return { next, changed: true };
  }
  return { next: [...lines, nextLine], changed: true };
};

export const applyPartialPlanEdit = (
  plan: BulkExecutionPlan,
  text: string,
): { plan: BulkExecutionPlan; changedRules: string[] } => {
  let summary = [...(plan.policySummary || [])];
  const changedRules: string[] = [];

  if (/年齢/i.test(text)) {
    const next = /五歳|5歳|5 歳|5才|５歳/.test(text) ? "年齢 → 5歳刻みへ一般化" : "年齢 → 年代へ一般化";
    const res = updateRuleLine(summary, "年齢", next);
    summary = res.next;
    if (res.changed) changedRules.push("年齢");
  }

  if (/日付/i.test(text)) {
    const next = /年月|月単位/.test(text)
      ? "日付 → 年月のみへ一般化"
      : /相対|経過/.test(text)
        ? "日付 → 相対日付へ置換"
        : "日付 → 月単位へ一般化";
    const res = updateRuleLine(summary, "日付", next);
    summary = res.next;
    if (res.changed) changedRules.push("日付");
  }

  if (/氏名|名前/i.test(text)) {
    const next = /仮名|疑似|置換/.test(text) ? "氏名 → 仮名へ置換" : "氏名 → 完全削除";
    const res = updateRuleLine(summary, "氏名", next);
    summary = res.next;
    if (res.changed) changedRules.push("氏名");
  }

  if (/住所|地名|地域/i.test(text)) {
    const next = /都道府県/.test(text) ? "住所 → 都道府県レベルへ一般化" : "住所 → 広域へ一般化";
    const res = updateRuleLine(summary, "住所", next);
    summary = res.next;
    if (res.changed) changedRules.push("住所");
  }

  if (/病名|疾患/i.test(text)) {
    const next = /そのまま|保持/.test(text) ? "病名 → そのまま保持" : "病名 → 一般化";
    const res = updateRuleLine(summary, "病名", next);
    summary = res.next;
    if (res.changed) changedRules.push("病名");
  }

  return {
    plan: {
      ...plan,
      policySummary: summary,
    },
    changedRules,
  };
};

export const namesFromPath = (paths: string[]) =>
  paths.map((p) => p.split(/[\\/]/).pop() || p).filter(Boolean);
