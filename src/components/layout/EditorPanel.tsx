import { DiffEditor } from "@monaco-editor/react";
import { Check, Clipboard, FileText } from "lucide-react";

interface EditorPanelProps {
  original?: string;
  modified?: string;
  onAccept: () => void;
  onModifiedChange?: (value: string) => void;
  activeFileName?: string;
}

export function EditorPanel({ original = "", modified = "", onAccept, onModifiedChange, activeFileName }: EditorPanelProps) {
  const hasChanges = original !== modified;

  const handleCopy = () => {
       navigator.clipboard.writeText(modified);
  };

  const handleEditorDidMount = (editor: any) => {
      // Hide line numbers on the original (left) editor
      const originalEditor = editor.getOriginalEditor();
      originalEditor.updateOptions({ lineNumbers: 'off' });

      const modifiedEditor = editor.getModifiedEditor();
      modifiedEditor.onDidChangeModelContent(() => {
          if (onModifiedChange) {
              onModifiedChange(modifiedEditor.getValue());
          }
      });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Editor Header */}
      <div className="h-9 border-b flex items-center justify-between px-4 bg-muted/20 shrink-0">
          <div className="flex items-center gap-2">
            {activeFileName && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <FileText size={12} />
                <span className="font-medium">{activeFileName}</span>
                {hasChanges && <span className="text-orange-500 font-bold ml-1">●</span>}
              </div>
            )}
            {!activeFileName && (
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {hasChanges ? "Review Changes" : "Editor"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
              {hasChanges && (
                  <>
                    <button
                        onClick={handleCopy}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 transition-colors"
                        title="Copy Modified Text"
                    >
                        <Clipboard size={14} />
                        <span>Copy</span>
                    </button>
                    <button
                        onClick={onAccept}
                        className="flex items-center gap-1 text-xs px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded shadow-sm transition-colors"
                        title="Overwrite original with modified text"
                    >
                        <Check size={14} />
                        <span>Apply Changes</span>
                    </button>
                  </>
              )}
          </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
         <DiffEditor
            original={original}
            modified={modified}
            language="plaintext"
            theme="light"
            onMount={handleEditorDidMount}
            options={{
                readOnly: false,
                renderSideBySide: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                originalEditable: false,
            }}
            originalModelPath="original"
            modifiedModelPath="modified"
         />
      </div>
    </div>
  );
}
