import { useState, useEffect, useRef, useCallback } from "react";
import { Key, ExternalLink, AlertCircle, Check, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";

interface ApiKeyModalProps {
  isOpen: boolean;
  onSaved: () => void;
  onClose?: () => void;
}

export function ApiKeyModal({ isOpen, onSaved, onClose }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<"idle" | "validating" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      invoke<string | null>("load_api_key").then(key => {
        if (key) setApiKey(key);
      });
      setStatus("idle");
      setErrorMessage("");
      setShowKey(false);
    }
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose && status !== "validating") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, status]);

  // Focus trap
  const handleFocusTrap = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Tab" || !modalRef.current) return;

    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleFocusTrap);
    return () => document.removeEventListener("keydown", handleFocusTrap);
  }, [isOpen, handleFocusTrap]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
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

  const isError = status === "error";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget && onClose && status !== "validating") {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-key-modal-title"
    >
      <div
        ref={modalRef}
        className="bg-background border rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden relative"
      >
        {onClose && (
            <button
                onClick={onClose}
                className="absolute top-4 right-4 text-muted-foreground hover:text-foreground z-10"
                aria-label="閉じる"
            >
                <X size={20} />
            </button>
        )}
        <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Key className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 id="api-key-modal-title" className="text-lg font-semibold">APIキーの設定</h2>
            <p className="text-xs text-muted-foreground">Gemini利用時のみ必要です</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="api-key-input" className="block text-sm font-medium mb-2">
              Gemini APIキー（任意: Local Gemma利用時は不要）
            </label>
            <div className="relative">
              <input
                id="api-key-input"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setStatus("idle");
                }}
                className={`w-full px-3 py-2 pr-10 border rounded-md bg-background focus:outline-none focus:ring-2 text-sm transition-colors ${
                  isError
                    ? "border-red-500 focus:ring-red-400"
                    : "border-input focus:ring-blue-500"
                }`}
                placeholder="AIza..."
                autoFocus
                aria-invalid={isError}
                aria-describedby={isError ? "api-key-error" : undefined}
              />
              <button
                type="button"
                onClick={() => setShowKey(prev => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
                aria-label={showKey ? "APIキーを非表示" : "APIキーを表示"}
                tabIndex={0}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {isError && (
            <div id="api-key-error" className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded" role="alert">
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
            {status === "validating" ? "確認中..." : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
