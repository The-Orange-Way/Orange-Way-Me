/**
 * What to tell someone whose goal cannot be measured, one line per cause.
 *
 * Shared deliberately. Two screens render this state: the list tile and the
 * goal detail page. When the copy lived in the tile only, the detail page had
 * no guard at all and drew a confident zero percent bar for a goal the list
 * had just flagged as untrackable, which is the screen someone opens BECAUSE
 * the list flagged it (DL-1588).
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
