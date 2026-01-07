import { DiffEditor } from "@monaco-editor/react";

interface EditorPanelProps {
  original?: string;
  modified?: string;
}

export function EditorPanel({ original = "", modified = "" }: EditorPanelProps) {
  return (
    <div className="h-full flex flex-col bg-background">
      <DiffEditor
        original={original}
        modified={modified}
        language="plaintext" // Can be dynamic
        theme="vs-dark" // Match app theme
        options={{
            readOnly: false, // User might want to edit? Usually Diff is ReadOnly, but allow for now.
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
}
