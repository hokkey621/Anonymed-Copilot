import React, { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface ResizablePanelProps {
  children: React.ReactNode;
  /** Initial width in pixels */
  defaultWidth: number;
  /** Minimum width in pixels */
  minWidth?: number;
  /** Maximum width in pixels */
  maxWidth?: number;
  /** Position of the resize handle */
  handlePosition: "left" | "right";
  /** Additional class names */
  className?: string;
}

/** Pixels to move per arrow key press */
const KEYBOARD_STEP = 20;

export function ResizablePanel({
  children,
  defaultWidth,
  minWidth = 150,
  maxWidth = 600,
  handlePosition,
  className,
}: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);

  const clamp = useCallback(
    (w: number) => Math.max(minWidth, Math.min(maxWidth, w)),
    [minWidth, maxWidth]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
    },
    [width]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const delta = e.clientX - startXRef.current;
      const newWidth = handlePosition === "right"
        ? startWidthRef.current + delta
        : startWidthRef.current - delta;

      pendingWidthRef.current = clamp(newWidth);

      // Throttle updates with rAF
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          if (pendingWidthRef.current !== null) {
            setWidth(pendingWidthRef.current);
            pendingWidthRef.current = null;
          }
          rafRef.current = null;
        });
      }
    },
    [isResizing, handlePosition, clamp]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Keyboard resize on the handle
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let delta = 0;
      if (e.key === "ArrowRight") delta = KEYBOARD_STEP;
      else if (e.key === "ArrowLeft") delta = -KEYBOARD_STEP;
      else return;

      e.preventDefault();
      const direction = handlePosition === "right" ? 1 : -1;
      setWidth(prev => clamp(prev + delta * direction));
    },
    [handlePosition, clamp]
  );

  // Double-click to reset to default width
  const handleDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
  }, [defaultWidth]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      // Prevent text selection during resize
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    } else {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "6px",
    cursor: "col-resize",
    zIndex: 10,
    ...(handlePosition === "right" ? { right: "-3px" } : { left: "-3px" }),
  };

  return (
    <div
      ref={panelRef}
      className={cn("relative shrink-0 h-full overflow-hidden", className)}
      style={{ width: `${width}px`, maxWidth: `${width}px` }}
    >
      {/* Inner container to enforce width constraints on children */}
      <div className="w-full h-full overflow-hidden">
        {children}
      </div>
      {/* Resize Handle */}
      <div
        className={cn(
          "resize-handle group",
          isResizing && "resize-handle-active"
        )}
        style={handleStyle}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-label="パネルサイズ変更"
        tabIndex={0}
      >
        {/* Visual indicator line – visible at rest so users can discover it */}
        <div
          className={cn(
            "absolute top-0 bottom-0 w-[2px] transition-colors",
            handlePosition === "right" ? "left-[2px]" : "right-[2px]",
            isResizing
              ? "bg-blue-500"
              : "bg-border/60 group-hover:bg-blue-400 group-focus-visible:bg-blue-400"
          )}
        />
      </div>
    </div>
  );
}
