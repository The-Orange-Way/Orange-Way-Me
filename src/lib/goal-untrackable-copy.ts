/**
 * What to tell someone whose goal cannot be measured, one line per cause.
 *
 * Shared deliberately. Three screens render this state: the list tile, the
 * goal detail page and the dashboard widget. When the copy lived in the tile
 * only, the detail page had no guard at all and drew a confident zero percent
 * bar for a goal the list had just flagged as untrackable, which is the screen
 * someone opens BECAUSE the list flagged it (DL-1588). The dashboard widget
 * had the same gap and is worse, because nothing warned the reader first
 * (DL-1601).
 *
 * A lookup keyed off the reason type rather than a chain of ternaries, so that
 * adding a fourth cause to goals-math is a type error in every screen that
 * renders it, instead of silently falling through to whichever message happens
 * to be last.
 *
 * The key type is derived from GoalProgress rather than restated here. A copy
 * of the union would drift the moment goals-math gained a reason, which is the
 * exact failure this lookup exists to prevent.
 */
import type { GoalProgress } from "@/lib/goals-math";

export type UntrackableReason = NonNullable<GoalProgress["untrackableReason"]>;

export const UNTRACKABLE_COPY: Record<UntrackableReason, string> = {
  no_target_set:
    "This goal has no target amount, so there is nothing to measure progress against. Open the goal and set one.",
  no_accounts_linked:
    "No accounts are linked to this goal, so there is no balance to measure. Open the goal and link one.",
  linked_accounts_missing:
    "The accounts linked to this goal no longer exist, so there is no balance to measure. Open the goal and link one.",
};

/**
 * The same three causes in a form that fits a dashboard tile.
 *
 * The widget shows three goals inside a small card, so the sentences above do
 * not fit and truncating them would cut off the half that says what to do.
 * These are labels, not instructions: the tile links to the goal, and the full
 * sentence is waiting on the other side.
 *
 * Kept in the same Record type as UNTRACKABLE_COPY on purpose. A fourth cause
 * in goals-math must be a compile error in BOTH lookups, not just the long one.
 */
export const UNTRACKABLE_SHORT: Record<UntrackableReason, string> = {
  no_target_set: "No target set",
  no_accounts_linked: "No accounts linked",
  linked_accounts_missing: "Linked accounts missing",
};
