import * as monaco from "monaco-editor";

export interface ApprovedRange {
  startLine: number;
  endLine: number;
  decorationId?: string;
}

export interface DiffBlock {
  id: number;
  startLine: number;
  endLine: number;
  isApproved: boolean;
}

/**
 * Updates dimmed decorations on the editor for approved ranges.
 * Uses deltaDecorations API for efficient updates.
 */
export function updateDimmedRanges(
  editor: monaco.editor.IStandaloneCodeEditor,
  approvedRanges: ApprovedRange[],
  oldDecorationIds: string[]
): string[] {
  const newDecorations: monaco.editor.IModelDeltaDecoration[] = approvedRanges.map(
    (range) => ({
      range: new monaco.Range(range.startLine, 1, range.endLine, 1),
      options: {
        isWholeLine: true,
        className: "approved-dimmed",
        linesDecorationsClassName: "approved-dimmed",
      },
    })
  );

  return editor.deltaDecorations(oldDecorationIds, newDecorations);
}

/**
 * Updates pending review decorations on the editor.
 * Highlights blocks that need attention.
 */
export function updatePendingRanges(
  editor: monaco.editor.IStandaloneCodeEditor,
  pendingRanges: ApprovedRange[],
  oldDecorationIds: string[]
): string[] {
  const newDecorations: monaco.editor.IModelDeltaDecoration[] = pendingRanges.map(
    (range) => ({
      range: new monaco.Range(range.startLine, 1, range.endLine, 1),
      options: {
        isWholeLine: true,
        className: "pending-review-block",
        linesDecorationsClassName: "pending-review-block",
      },
    })
  );

  return editor.deltaDecorations(oldDecorationIds, newDecorations);
}

/**
 * Updates N+1 step dimmed decorations.
 * Strongly dims diff blocks to focus attention on non-highlighted areas.
 */
export function updateNPlusOneDimmedRanges(
  editor: monaco.editor.IStandaloneCodeEditor,
  diffRanges: ApprovedRange[],
  oldDecorationIds: string[]
): string[] {
  const newDecorations: monaco.editor.IModelDeltaDecoration[] = diffRanges.map(
    (range) => ({
      range: new monaco.Range(range.startLine, 1, range.endLine, 1),
      options: {
        isWholeLine: true,
        className: "n-plus-one-dimmed",
        linesDecorationsClassName: "n-plus-one-dimmed",
      },
    })
  );

  return editor.deltaDecorations(oldDecorationIds, newDecorations);
}

/**
 * Gets the diff changes from the diff editor.
 * Returns an array of DiffBlock objects representing changed regions.
 */
export function getDiffBlocks(
  diffEditor: monaco.editor.IStandaloneDiffEditor
): DiffBlock[] {
  const lineChanges = diffEditor.getLineChanges();
  if (!lineChanges) return [];

  return lineChanges.map((change, index) => ({
    id: index,
    startLine: change.modifiedStartLineNumber,
    endLine: change.modifiedEndLineNumber || change.modifiedStartLineNumber,
    isApproved: false,
  }));
}

/**
 * Creates an approval widget for a diff block.
 * Positioned at the bottom-right of the block.
 * Supports toggle (click again to unapprove).
 */
export function createApproveWidget(
  blockId: number,
  endLineNumber: number,
  editor: monaco.editor.IStandaloneCodeEditor,
  onToggleApprove: (blockId: number, event?: MouseEvent) => void
): monaco.editor.IContentWidget {
  const domNode = document.createElement("button");
  domNode.className = "approve-button-widget";
  domNode.setAttribute("data-block-id", String(blockId));
  domNode.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <span>承認</span>
  `;
  domNode.onclick = (e) => {
    e.stopPropagation();
    onToggleApprove(blockId, e as MouseEvent);
  };

  // Get the maximum column for the end line to position at the right
  const model = editor.getModel();
  const maxColumn = model ? model.getLineMaxColumn(endLineNumber) : 1;

  return {
    getId: () => `approve-widget-${blockId}`,
    getDomNode: () => domNode,
    getPosition: () => ({
      position: {
        lineNumber: endLineNumber,
        column: maxColumn,
      },
      preference: [monaco.editor.ContentWidgetPositionPreference.BELOW],
    }),
  };
}

/**
 * Updates the approval widget to show approved state.
 */
export function updateWidgetToApproved(widgetDomNode: HTMLElement): void {
  widgetDomNode.classList.add("approved");
  widgetDomNode.innerHTML = `<span>✓ 確認済</span>`;
  widgetDomNode.title = "クリックで承認を取り消し";
}

/**
 * Updates the approval widget to show unapproved state.
 */
export function updateWidgetToUnapproved(widgetDomNode: HTMLElement): void {
  widgetDomNode.classList.remove("approved");
  widgetDomNode.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <span>承認</span>
  `;
  widgetDomNode.title = "";
}
