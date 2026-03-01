import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  /** Auto-dismiss duration in ms. 0 = no auto-dismiss */
  duration: number;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Maximum number of toasts shown simultaneously */
const MAX_VISIBLE_TOASTS = 5;

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={18} className="text-green-600 shrink-0" />,
  error: <AlertCircle size={18} className="text-red-600 shrink-0" />,
  info: <Info size={18} className="text-blue-600 shrink-0" />,
};

const BG_CLASSES: Record<ToastType, string> = {
  success: "bg-green-50 border-green-300 text-green-900",
  error: "bg-red-50 border-red-300 text-red-900",
  info: "bg-blue-50 border-blue-300 text-blue-900",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = "info", duration = 4000) => {
    const id = ++idRef.current;
    setToasts(prev => {
      const next = [...prev, { id, message, type, duration }];
      // Limit visible toasts – drop oldest when exceeding max
      if (next.length > MAX_VISIBLE_TOASTS) {
        return next.slice(next.length - MAX_VISIBLE_TOASTS);
      }
      return next;
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast Container – error toasts use assertive for immediate screen-reader announcement */}
      <div
        className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2 max-w-sm pointer-events-none"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.filter(t => t.type !== "error").map(toast => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
      <div
        className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2 max-w-sm pointer-events-none"
        aria-live="assertive"
        aria-atomic="true"
        style={{ bottom: `${1 + toasts.filter(t => t.type !== "error").length * 4.5}rem` }}
      >
        {toasts.filter(t => t.type === "error").map(toast => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(toast.duration);
  const startTimeRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Auto-dismiss timer with pause/resume support
  useEffect(() => {
    if (toast.duration <= 0) return;

    if (paused) {
      // Pause: clear timer and record remaining time
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const elapsed = Date.now() - startTimeRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      return;
    }

    // Start / resume timer
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => handleDismiss(), remainingRef.current);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [paused, toast.id, toast.duration]);

  const handleDismiss = () => {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  };

  return (
    <div
      role="alert"
      className={`
        pointer-events-auto flex items-start gap-2 px-4 py-3 rounded-lg border shadow-lg
        transition-all duration-200 ease-out
        ${BG_CLASSES[toast.type]}
        ${visible && !exiting ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
      `}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {ICONS[toast.type]}
      <span className="text-sm leading-relaxed whitespace-pre-line flex-1">{toast.message}</span>
      <button
        onClick={handleDismiss}
        className="shrink-0 p-0.5 rounded hover:bg-black/10 transition-colors"
        aria-label="閉じる"
      >
        <X size={14} />
      </button>
    </div>
  );
}
