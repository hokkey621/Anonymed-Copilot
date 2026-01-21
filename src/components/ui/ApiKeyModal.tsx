import { useState } from "react";
import { Key, ExternalLink, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (apiKey: string) => void;
  currentKey?: string;
}

export function ApiKeyModal({ isOpen, onClose, onSave, currentKey }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState(currentKey || "");
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError("APIキーを入力してください");
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      // Save and validate the API key
      await invoke("save_api_key", { apiKey: apiKey.trim() });
      setSuccess(true);
      setTimeout(() => {
        onSave(apiKey.trim());
        onClose();
      }, 500);
    } catch (e) {
      setError(`保存に失敗しました: ${e}`);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Key className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">APIキーの設定</h2>
            <p className="text-xs text-muted-foreground">Google Gemini APIを利用します</p>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Gemini APIキー
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setError(null);
                setSuccess(false);
              }}
              placeholder="AIza..."
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded">
              <Check size={16} />
              <span>保存しました！</span>
            </div>
          )}

          {/* Help text */}
          <div className="bg-muted/50 rounded-md p-4 space-y-2">
            <p className="text-sm font-medium">💡 APIキーの取得方法</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Google AI Studio にアクセス</li>
              <li>Googleアカウントでログイン</li>
              <li>「Get API key」をクリック</li>
              <li>キーをコピーして上に貼り付け</li>
            </ol>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2"
              onClick={(e) => {
                e.preventDefault();
                invoke("plugin:opener|open", { path: "https://aistudio.google.com/apikey" });
              }}
            >
              <ExternalLink size={12} />
              Google AI Studio を開く
            </a>
            <p className="text-xs text-muted-foreground mt-2">
              ※ 無料枠で十分に利用できます
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-muted/30 flex justify-end gap-2">
          {currentKey && (
            <Button variant="ghost" onClick={onClose} disabled={isValidating}>
              キャンセル
            </Button>
          )}
          <Button onClick={handleSave} disabled={isValidating || !apiKey.trim()}>
            {isValidating ? "確認中..." : "保存して開始"}
          </Button>
        </div>
      </div>
    </div>
  );
}
