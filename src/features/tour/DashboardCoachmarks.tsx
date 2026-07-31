import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { TOUR_COPY } from "./copy";

/**
 * DashboardCoachmarks -- first-run coachmark layer for the dashboard.
 *
 * Renders three floating bubbles over anchor elements identified by
 * [data-tour="..."] attributes on wrapper divs in DashboardPage.
 * Uses a React portal so it renders above the page grid without
 * needing z-index changes inside child components.
 *
 * Non-blocking: no backdrop, no focus trap. The user can scroll and
 * interact with the dashboard while the bubbles are visible. Dismissal
 * happens via the "Got it" button on any bubble (dismisses all three)
 * or via the Escape key.
 *
 * App-agnostic: the component knows nothing about OWM or OWB. It reads
 * its anchors via CSS selectors and its strings from TOUR_COPY. OWB
 * can reuse DashboardCoachmarks with its own selectors and copy file.
 *
 * Positioning: each bubble uses fixed positioning so it tracks the anchor
 * element regardless of scroll. Recalculates on window resize. Bubbles
 * appear below their anchor when there is enough viewport room, above
 * otherwise.
 */

interface BubbleAnchor {
  selector: string;
  label: string;
}

interface BubblePos {
  top: number;
  left: number;
  arrowBelow: boolean; // true = arrow points up (bubble is below anchor)
}

const BUBBLE_MIN_HEIGHT_PX = 100;

function computePos(selector: string): BubblePos | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const arrowBelow = spaceBelow >= BUBBLE_MIN_HEIGHT_PX;
  return {
    top: arrowBelow ? rect.bottom + 10 : rect.top - 10,
    left: rect.left + rect.width / 2,
    arrowBelow,
  };
}

function CoachmarkBubble({
  selector,
  label,
  onDismiss,
}: BubbleAnchor & { onDismiss: () => void }) {
  const [pos, setPos] = useState<BubblePos | null>(null);

  useLayoutEffect(() => {
    setPos(computePos(selector));
  }, [selector]);

  useEffect(() => {
    function onResize() {
      setPos(computePos(selector));
    }
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [selector]);

  if (!pos) return null;

  const translateY = pos.arrowBelow ? "0" : "-100%";

  return (
    <div
      role="tooltip"
      className="pointer-events-auto fixed z-50 w-60 rounded-xl border border-border bg-popover px-4 py-3 shadow-xl"
      style={{
        top: pos.top,
        left: pos.left,
        transform: `translateX(-50%) translateY(${translateY})`,
      }}
    >
      {/* Arrow */}
      {pos.arrowBelow ? (
        <span
          aria-hidden="true"
          className="absolute -top-2 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-border bg-popover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="absolute -bottom-2 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-border bg-popover"
        />
      )}
      <p className="text-sm leading-snug text-popover-foreground">{label}</p>
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
        >
          {TOUR_COPY.dismiss}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss tour"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface DashboardCoachmarksProps {
  onDismiss: () => void;
}

const ANCHORS: BubbleAnchor[] = [
  { selector: '[data-tour="net-worth"]', label: TOUR_COPY.netWorth.label },
  { selector: '[data-tour="accounts"]', label: TOUR_COPY.accounts.label },
  { selector: '[data-tour="transactions"]', label: TOUR_COPY.transactions.label },
];

export function DashboardCoachmarks({ onDismiss }: DashboardCoachmarksProps) {
  // Dismiss on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return createPortal(
    <>
      {ANCHORS.map((anchor) => (
        <CoachmarkBubble key={anchor.selector} {...anchor} onDismiss={onDismiss} />
      ))}
    </>,
    document.body,
  );
}
