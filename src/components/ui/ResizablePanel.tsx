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
      let newWidth: number;

      if (handlePosition === "right") {
        newWidth = startWidthRef.current + delta;
      } else {
        newWidth = startWidthRef.current - delta;
      }

      // Clamp to min/max
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      setWidth(newWidth);
    },
    [isResizing, handlePosition, minWidth, maxWidth]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

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
          "resize-handle",
          isResizing && "resize-handle-active"
        )}
        style={handleStyle}
        onMouseDown={handleMouseDown}
      >
        {/* Visual indicator line */}
        <div
          className={cn(
            "absolute top-0 bottom-0 w-[2px] transition-colors",
            handlePosition === "right" ? "left-[2px]" : "right-[2px]",
            isResizing
              ? "bg-blue-500"
              : "bg-transparent hover:bg-blue-400"
          )}
        />
      </div>
    </div>
  );
}
