import { useState, useEffect } from "react";
import { Key, ExternalLink, AlertCircle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";

interface ApiKeyModalProps {
  isOpen: boolean;
  onSaved: () => void;
  onClose?: () => void;
}

export function ApiKeyModal({ isOpen, onSaved, onClose }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "validating" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (isOpen) {
      invoke<string | null>("load_api_key").then(key => {
        if (key) setApiKey(key);
      });
      setStatus("idle");
      setErrorMessage("");
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setErrorMessage("APIキーを入力してください");
      setStatus("error");
      return;
    }

    setStatus("validating");
    try {
      await invoke("save_api_key", { apiKey: apiKey });
      setStatus("success");
      setTimeout(() => {
        onSaved();
      }, 1000);
    } catch (e) {
      console.error("Failed to save API key:", e);
      setStatus("error");
      setErrorMessage("APIキーの保存または検証に失敗しました");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden relative">
        {onClose && (
            <button
                onClick={onClose}
                className="absolute top-4 right-4 text-muted-foreground hover:text-foreground z-10"
                aria-label="Close"
            >
                <X size={20} />
            </button>
        )}
        <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Key className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">APIキーの設定</h2>
            <p className="text-xs text-muted-foreground">Gemini利用時のみ必要です</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Gemini APIキー（任意: Local Gemma利用時は不要）
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setStatus("idle");
              }}
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="AIza..."
              autoFocus
            />
          </div>

          {status === "error" && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {status === "success" && (
            <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded">
              <Check size={16} />
              <span>保存しました！</span>
            </div>
          )}

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
            >
              <ExternalLink size={12} />
              Google AI Studio を開く
            </a>
          </div>
        </div>

        <div className="px-6 py-4 border-t bg-muted/30 flex justify-end gap-2">
          {onClose && (
            <Button variant="ghost" onClick={onClose} disabled={status === "validating"}>
              キャンセル
            </Button>
          )}
          <Button onClick={handleSave} disabled={status === "validating" || !apiKey.trim()}>
            {status === "validating" ? "確認中..." : "保存して開始"}
          </Button>
        </div>
      </div>
    </div>
  );
}
