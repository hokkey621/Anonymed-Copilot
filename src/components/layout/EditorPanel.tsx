import { DiffEditor } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { Check, Clipboard, Eye, EyeOff, FileText, Sparkles, AlertTriangle, Search, ChevronDown, ChevronUp, PartyPopper, X } from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  DiffBlock,
  getDiffBlocks,
  createApproveWidget,
  updateWidgetToApproved,
  updateWidgetToUnapproved,
} from "@/lib/editorDecorations";
import { useApprovalAnimation } from "@/lib/useApprovalAnimation";

interface EditorPanelProps {
  original?: string;
  modified?: string;
  onAccept: () => void;
  onModifiedChange?: (value: string) => void;
  activeFileName?: string;
}

export function EditorPanel({ original = "", modified = "", onAccept, onModifiedChange, activeFileName }: EditorPanelProps) {
  const hasChanges = original !== modified;

  // Focus Mode state
  const [focusModeEnabled, setFocusModeEnabled] = useState(true);
  const [diffBlocks, setDiffBlocks] = useState<DiffBlock[]>([]);
  const [approvedBlockIds, setApprovedBlockIds] = useState<Set<number>>(new Set());

  // N+1th check: confirmation that non-highlighted areas were reviewed
  const [nonHighlightedConfirmed, setNonHighlightedConfirmed] = useState(false);

  // Refs for Monaco editor instances and decorations
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const modifiedEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const widgetsRef = useRef<Map<number, monaco.editor.IContentWidget>>(new Map());

  // Completion celebration state
  const [showCompletionCelebration, setShowCompletionCelebration] = useState(false);
  const celebrationTriggeredRef = useRef(false);

  // Animation hook
  const { triggerApprovalAnimation, triggerCompletionCelebration } = useApprovalAnimation();

  const handleCopy = () => {
       navigator.clipboard.writeText(modified);
  };

  // Calculate approval progress
  const approvedCount = approvedBlockIds.size;
  const totalBlocks = diffBlocks.length;
  const allBlocksApproved = totalBlocks > 0 && approvedCount === totalBlocks;

  // Total steps = N blocks + 1 (non-highlighted check)
  const totalSteps = totalBlocks + 1;
  const completedSteps = approvedCount + (nonHighlightedConfirmed ? 1 : 0);
  const allComplete = allBlocksApproved && nonHighlightedConfirmed;

  // N+1 step is active when all blocks approved but non-highlighted not yet confirmed
  const isNPlusOneStep = allBlocksApproved && !nonHighlightedConfirmed;

  // Progress percentage
  const progressPercent = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  // Find next unapproved block
  const getNextUnapprovedBlock = useCallback(() => {
    return diffBlocks.find(block => !approvedBlockIds.has(block.id));
  }, [diffBlocks, approvedBlockIds]);

  // Jump to next unapproved block
  const jumpToNextUnapproved = useCallback(() => {
    const nextBlock = getNextUnapprovedBlock();
    if (nextBlock && modifiedEditorRef.current) {
      modifiedEditorRef.current.revealLineInCenter(nextBlock.startLine);
      modifiedEditorRef.current.setPosition({ lineNumber: nextBlock.startLine, column: 1 });
      modifiedEditorRef.current.focus();
    }
  }, [getNextUnapprovedBlock]);

  // Jump to previous unapproved block
  const jumpToPrevUnapproved = useCallback(() => {
    const unapprovedBlocks = diffBlocks.filter(block => !approvedBlockIds.has(block.id));
    if (unapprovedBlocks.length > 0 && modifiedEditorRef.current) {
      const lastBlock = unapprovedBlocks[unapprovedBlocks.length - 1];
      modifiedEditorRef.current.revealLineInCenter(lastBlock.startLine);
      modifiedEditorRef.current.setPosition({ lineNumber: lastBlock.startLine, column: 1 });
      modifiedEditorRef.current.focus();
    }
  }, [diffBlocks, approvedBlockIds]);

  // Handle block approval toggle with animations
  const handleToggleApproveBlock = useCallback((blockId: number, event?: MouseEvent) => {
    setApprovedBlockIds(prev => {
      const newSet = new Set(prev);
      const isCurrentlyApproved = newSet.has(blockId);

      if (isCurrentlyApproved) {
        // Unapprove
        newSet.delete(blockId);
        const widget = widgetsRef.current.get(blockId);
        if (widget) {
          const domNode = widget.getDomNode();
          if (domNode) {
            updateWidgetToUnapproved(domNode);
          }
        }
      } else {
        // Approve with animation
        newSet.add(blockId);
        const widget = widgetsRef.current.get(blockId);
        if (widget) {
          const domNode = widget.getDomNode();
          if (domNode) {
            // Add pulse animation class
            domNode.classList.add('approving');
            setTimeout(() => domNode.classList.remove('approving'), 350);

            updateWidgetToApproved(domNode);

            // Trigger particle animation at button position
            if (event) {
              triggerApprovalAnimation(event.clientX, event.clientY);
            } else {
              // Fallback: use button position
              const rect = domNode.getBoundingClientRect();
              triggerApprovalAnimation(rect.left + rect.width / 2, rect.top + rect.height / 2);
            }
          }
        }
      }

      return newSet;
    });
  }, [triggerApprovalAnimation]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if focus mode is enabled and we have changes
      if (!focusModeEnabled || !hasChanges) return;

      // Enter or Space to approve current block at cursor
      if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        const nextBlock = getNextUnapprovedBlock();
        if (nextBlock) {
          handleToggleApproveBlock(nextBlock.id);
        }
      }

      // Ctrl+↓ to jump to next unapproved
      if (e.key === "ArrowDown" && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        jumpToNextUnapproved();
      }

      // Ctrl+↑ to jump to previous unapproved
      if (e.key === "ArrowUp" && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        jumpToPrevUnapproved();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusModeEnabled, hasChanges, getNextUnapprovedBlock, handleToggleApproveBlock, jumpToNextUnapproved, jumpToPrevUnapproved]);

  // Apply decorations to dim approved blocks
  useEffect(() => {
    if (!modifiedEditorRef.current || !focusModeEnabled) return;

    // Build decorations for approved blocks (dim them)
    const newDecorations: monaco.editor.IModelDeltaDecoration[] = [];

    diffBlocks.forEach(block => {
      if (approvedBlockIds.has(block.id)) {
        // Approved blocks get dimmed
        newDecorations.push({
          range: new monaco.Range(block.startLine, 1, block.endLine, 1),
          options: {
            isWholeLine: true,
            className: "approved-line-dimmed",
            inlineClassName: "approved-text-dimmed",
          },
        });
      }
    });

    // N+1 step: dim ALL diff blocks to focus on non-highlighted areas
    if (isNPlusOneStep) {
      // Clear previous decorations and apply to all blocks
      const allBlockDecorations: monaco.editor.IModelDeltaDecoration[] = diffBlocks.map(block => ({
        range: new monaco.Range(block.startLine, 1, block.endLine, 1),
        options: {
          isWholeLine: true,
          className: "approved-line-dimmed",
          inlineClassName: "approved-text-dimmed",
        },
      }));
      decorationIdsRef.current = modifiedEditorRef.current.deltaDecorations(
        decorationIdsRef.current,
        allBlockDecorations
      );
    } else {
      decorationIdsRef.current = modifiedEditorRef.current.deltaDecorations(
        decorationIdsRef.current,
        newDecorations
      );
    }
  }, [approvedBlockIds, diffBlocks, focusModeEnabled, isNPlusOneStep]);

  // Clear decorations when Focus Mode is disabled
  useEffect(() => {
    if (!modifiedEditorRef.current) return;

    if (!focusModeEnabled) {
      decorationIdsRef.current = modifiedEditorRef.current.deltaDecorations(
        decorationIdsRef.current,
        []
      );
    }
  }, [focusModeEnabled]);

  // Trigger celebration when all complete
  useEffect(() => {
    if (allComplete && !celebrationTriggeredRef.current && hasChanges) {
      celebrationTriggeredRef.current = true;
      setShowCompletionCelebration(true);
      triggerCompletionCelebration();
    }
  }, [allComplete, hasChanges, triggerCompletionCelebration]);

  // Reset state when content changes
  useEffect(() => {
    setApprovedBlockIds(new Set());
    setDiffBlocks([]);
    setNonHighlightedConfirmed(false);
    setShowCompletionCelebration(false);
    celebrationTriggeredRef.current = false;

    // Clear widgets
    if (modifiedEditorRef.current) {
      widgetsRef.current.forEach(widget => {
        modifiedEditorRef.current?.removeContentWidget(widget);
      });
      widgetsRef.current.clear();
    }

    // Clear decorations
    if (modifiedEditorRef.current && decorationIdsRef.current.length > 0) {
      decorationIdsRef.current = modifiedEditorRef.current.deltaDecorations(
        decorationIdsRef.current,
        []
      );
    }
  }, [original, modified]);

  const handleEditorDidMount = (editor: monaco.editor.IStandaloneDiffEditor) => {
      diffEditorRef.current = editor;

      // Hide line numbers on the original (left) editor
      const originalEditor = editor.getOriginalEditor();
      originalEditor.updateOptions({ lineNumbers: 'off' });

      const modifiedEditor = editor.getModifiedEditor();
      modifiedEditorRef.current = modifiedEditor;

      modifiedEditor.onDidChangeModelContent(() => {
          if (onModifiedChange) {
              onModifiedChange(modifiedEditor.getValue());
          }
      });

      // Listen for diff updates
      editor.onDidUpdateDiff(() => {
        const blocks = getDiffBlocks(editor);
        setDiffBlocks(blocks);

        // Clear old widgets
        widgetsRef.current.forEach(widget => {
          modifiedEditor.removeContentWidget(widget);
        });
        widgetsRef.current.clear();

        // Create new widgets for each diff block (positioned at bottom-right)
        blocks.forEach(block => {
          const widget = createApproveWidget(block.id, block.endLine, modifiedEditor, handleToggleApproveBlock);
          widgetsRef.current.set(block.id, widget);
          modifiedEditor.addContentWidget(widget);
        });
      });
  };

  const nextUnapproved = getNextUnapprovedBlock();

  return (
    <>
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

            {/* Focus Mode toggle and progress */}
            {hasChanges && (
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => setFocusModeEnabled(!focusModeEnabled)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                    focusModeEnabled
                      ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                  title={focusModeEnabled ? "Disable Focus Mode" : "Enable Focus Mode"}
                >
                  {focusModeEnabled ? <Eye size={12} /> : <EyeOff size={12} />}
                  <span>Focus</span>
                </button>

                {/* Navigation buttons */}
                {totalBlocks > 0 && !isNPlusOneStep && nextUnapproved && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={jumpToPrevUnapproved}
                      className="flex items-center justify-center w-6 h-6 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                      title="前の未承認へ (Ctrl+Shift+↑)"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={jumpToNextUnapproved}
                      className="flex items-center justify-center w-6 h-6 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                      title="次の未承認へ (Ctrl+Shift+↓)"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                )}

                {totalBlocks > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    allComplete
                      ? "bg-green-100 text-green-700"
                      : isNPlusOneStep
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                  }`}>
                    {allComplete
                      ? "✓ 全て確認済"
                      : isNPlusOneStep
                        ? `最終確認（非ハイライト箇所）`
                        : `${completedSteps}/${totalSteps} 確認中`
                    }
                  </span>
                )}
              </div>
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
                    {/* Show prominent Apply button when all complete */}
                    <button
                        onClick={onAccept}
                        className={`flex items-center gap-1 text-xs px-3 py-1 rounded shadow-sm transition-all ${
                          allComplete
                            ? "bg-green-600 hover:bg-green-700 text-white animate-pulse"
                            : "bg-slate-400 text-white cursor-not-allowed opacity-60"
                        }`}
                        title={allComplete ? "全ての変更を適用" : "全ての確認ステップを完了してください"}
                        disabled={!allComplete}
                    >
                        {allComplete ? <Sparkles size={14} /> : <Check size={14} />}
                        <span>{allComplete ? "変更を適用" : "Apply Changes"}</span>
                    </button>
                  </>
              )}
          </div>
      </div>

      {/* Enhanced Progress Bar */}
      {hasChanges && totalBlocks > 0 && (
        <div className="progress-bar-container shrink-0">
          <div
            className={`progress-bar-fill ${
              allComplete ? "complete" : isNPlusOneStep ? "n-plus-one" : "in-progress"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* N+1th Step Banner: Check non-highlighted areas */}
      {isNPlusOneStep && hasChanges && (
        <div className="bg-red-50 border-b-2 border-red-300 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-200 text-red-700">
              <Search size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2 text-red-800 font-medium text-sm">
                <AlertTriangle size={14} />
                <span>最終確認: 薄くなっていない箇所をチェック</span>
              </div>
              <p className="text-xs text-red-600 mt-0.5">
                AIが提案しなかった箇所（はっきり見える部分）に個人情報の見落としがないか確認してください
              </p>
            </div>
          </div>
          <button
            onClick={() => setNonHighlightedConfirmed(true)}
            className="flex items-center gap-2 text-sm px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded shadow-sm transition-colors font-medium"
          >
            <Check size={16} />
            <span>確認完了</span>
          </button>
        </div>
      )}

      {/* All Complete Banner */}
      {allComplete && hasChanges && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-700">
            <Sparkles size={16} />
            <span className="text-sm font-medium">全ての確認が完了しました！</span>
          </div>
          <button
            onClick={onAccept}
            className="flex items-center gap-1 text-sm px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded shadow-sm transition-colors"
          >
            <Check size={14} />
            <span>変更を適用して保存</span>
          </button>
        </div>
      )}

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

      {/* Completion Celebration Overlay */}
      {showCompletionCelebration && (
        <div className="completion-overlay">
          <div className="completion-icon">
            <PartyPopper size={40} />
          </div>
          <h2 className="completion-title">確認完了！</h2>
          <p className="completion-subtitle">全ての変更箇所の確認が完了しました</p>
          <div className="completion-actions">
            <button
              className="completion-button-primary"
              onClick={() => {
                setShowCompletionCelebration(false);
                onAccept();
              }}
            >
              <Check size={20} />
              変更を適用して保存
            </button>
            <button
              className="completion-button-secondary"
              onClick={() => setShowCompletionCelebration(false)}
            >
              <X size={20} />
              閉じる
            </button>
          </div>
        </div>
      )}
    </>
  );
}
