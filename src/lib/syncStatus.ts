// Pure decision logic for a thought's status during a To Do sync. Kept free of
// firebase-admin so it is trivially unit-testable.

import type { ThoughtStatus } from "./types";

/**
 * Decide the status to write for a thought on sync.
 *
 * @param current      the thought's existing status, or null for a brand-new doc
 * @param taskCompleted whether the source To Do task is completed (ticked off)
 * @returns the status to set, or null to leave the existing status unchanged
 *
 * Rules:
 * - New doc: a completed task imports as `archived` (never publish historical/done
 *   items); otherwise `unpublished`.
 * - Existing doc: ticking a task off drops an as-yet-`unpublished` thought out of the
 *   queue (→ `archived`). Everything else is left untouched — we never downgrade a
 *   `published` (already posted) or `failed` thought, never resurrect an `archived`
 *   one, and never disturb an active `unpublished` thought whose task is still open.
 */
export function syncStatusTransition(
  current: ThoughtStatus | null,
  taskCompleted: boolean
): ThoughtStatus | null {
  if (current == null) return taskCompleted ? "archived" : "unpublished";
  if (taskCompleted && current === "unpublished") return "archived";
  return null;
}
