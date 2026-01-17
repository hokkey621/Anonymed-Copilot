import { cn } from "@/lib/utils";

interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (text: string) => void;
  disabled?: boolean;
}

/**
 * SuggestionChips - 文脈に応じた選択肢チップ
 *
 * エージェントメッセージの下に表示される選択肢ボタン。
 * クリックするとそのテキストがユーザーメッセージとして送信される。
 */
export function SuggestionChips({ suggestions, onSelect, disabled }: SuggestionChipsProps) {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
          className={cn(
            "px-3 py-1.5 text-sm rounded-full border transition-all",
            "bg-background hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600",
            "dark:hover:bg-blue-900/20 dark:hover:border-blue-700 dark:hover:text-blue-400",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
