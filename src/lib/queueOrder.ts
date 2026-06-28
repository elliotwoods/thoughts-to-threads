// Pure, dependency-free helpers for the "Up Next" order. Kept separate from
// queue.ts (which imports Firestore) so this logic is trivially unit-testable.

/** Anything with a membership test — a Map or a Set of eligible ids. */
export interface HasId {
  has(id: string): boolean;
}

/** Where to inject a thought: front, back, or an explicit 0-based index. */
export type QueuePosition = "next" | "last" | number;

/**
 * Keep stored ids that are still eligible, in order, de-duplicated. Adds nothing.
 * The single building block under reconcile / refill / mutations.
 */
export function reconcileOrder(eligible: HasId, stored: string[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of stored) {
    if (eligible.has(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  return order;
}

/** Resolve a QueuePosition to a clamped 0-based index in a list of `length`. */
export function insertIndexFor(position: QueuePosition, length: number): number {
  if (position === "next") return 0;
  if (position === "last") return length;
  return Math.max(0, Math.min(Math.floor(position), length));
}

/** True when two id arrays are element-wise equal. */
export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
