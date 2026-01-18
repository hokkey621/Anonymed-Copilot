import confetti from "canvas-confetti";
import { useCallback } from "react";

/**
 * Custom hook for approval animations using canvas-confetti.
 * Provides particle effects for individual approvals and completion celebrations.
 */
export function useApprovalAnimation() {
  /**
   * Trigger a small particle burst at a specific position.
   * Used when a single block is approved.
   */
  const triggerApprovalAnimation = useCallback((x: number, y: number) => {
    // Convert viewport coordinates to canvas coordinates (0-1 range)
    const originX = x / window.innerWidth;
    const originY = y / window.innerHeight;

    confetti({
      particleCount: 25,
      spread: 50,
      origin: { x: originX, y: originY },
      colors: ["#22c55e", "#16a34a", "#4ade80", "#86efac"], // Green palette for medical theme
      ticks: 100,
      gravity: 1.2,
      scalar: 0.8,
      shapes: ["circle"],
      disableForReducedMotion: true,
    });
  }, []);

  /**
   * Trigger a celebration animation for completion.
   * Used when all blocks are approved and review is complete.
   */
  const triggerCompletionCelebration = useCallback(() => {
    const duration = 2000;
    const animationEnd = Date.now() + duration;
    const defaults = {
      startVelocity: 30,
      spread: 360,
      ticks: 60,
      zIndex: 9999,
      disableForReducedMotion: true,
    };

    // Medical-appropriate color palette: soft greens and blues
    const colors = ["#22c55e", "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6"];

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min;
    }

    const interval = setInterval(() => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);

      // Random bursts from left and right
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
        colors,
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
        colors,
      });
    }, 250);
  }, []);

  /**
   * Trigger a subtle checkmark animation effect.
   * A small burst emanating from center-ish position.
   */
  const triggerCheckmarkBurst = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    confetti({
      particleCount: 15,
      spread: 40,
      origin: { x: x / window.innerWidth, y: y / window.innerHeight },
      colors: ["#22c55e", "#4ade80"],
      ticks: 80,
      gravity: 0.8,
      scalar: 0.6,
      shapes: ["circle"],
      disableForReducedMotion: true,
    });
  }, []);

  return {
    triggerApprovalAnimation,
    triggerCompletionCelebration,
    triggerCheckmarkBurst,
  };
}
