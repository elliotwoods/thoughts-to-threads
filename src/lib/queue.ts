// The "Up Next" queue: a Spotify-style, user-orderable view of the thoughts
// that will publish next. Order is persisted as an array of thought ids in
// Firestore (config/queue.order); this module is the single source of truth for
// reading, normalizing, refilling, and mutating it.
//
// "Eligible" means a thought is in the active pool: status === "unpublished" and
// skip === false. The queue only ever contains eligible ids. Reordering and
// manual injection are sticky; the tail auto-fills with random eligible picks up
// to config.queueSize, so it always feels like a shuffled upcoming list you can
// shape. Publishing consumes the head implicitly: a published thought leaves the
// eligible pool, so the next normalize drops it.

import { getQueueOrder, listThoughts, setQueueOrder } from "./firestore";
import type { AppConfig, Thought } from "./types";

/** In-place Fisher–Yates shuffle, returning the same array for convenience. */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The active pool, keyed by id, that the queue may contain. */
async function eligiblePool(): Promise<Map<string, Thought>> {
  const pool = await listThoughts({ status: "unpublished", skip: false });
  return new Map(pool.map((t) => [t.id, t]));
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Reconcile the persisted order with the live pool and top it up to
 * config.queueSize with random eligible picks. Persists only when the order
 * actually changes. Returns the ordered, hydrated thoughts (the head publishes
 * next). Pass a prebuilt pool to avoid a redundant read.
 */
export async function normalizeQueue(
  config: AppConfig,
  pool?: Map<string, Thought>
): Promise<Thought[]> {
  const eligible = pool ?? (await eligiblePool());
  const stored = await getQueueOrder();

  // Keep stored ids that are still eligible, in order, de-duplicated.
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of stored) {
    if (eligible.has(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }

  // Top up the tail with a random draw of the remaining eligible thoughts.
  const target = Math.max(0, Math.floor(config.queueSize || 0));
  if (order.length < target) {
    const rest = shuffleInPlace([...eligible.keys()].filter((id) => !seen.has(id)));
    for (const id of rest) {
      if (order.length >= target) break;
      order.push(id);
    }
  }

  if (!sameOrder(order, stored)) await setQueueOrder(order);
  return order.map((id) => eligible.get(id)!);
}

/** Put a thought at the front ("next") or back ("last") of the queue. */
export async function addToQueue(
  config: AppConfig,
  id: string,
  position: "next" | "last"
): Promise<Thought[]> {
  const eligible = await eligiblePool();
  if (!eligible.has(id)) {
    // Caller is expected to have cleared skip first; if it's still not eligible
    // (e.g. already published) there's nothing to queue — just normalize.
    return normalizeQueue(config, eligible);
  }
  const current = (await getQueueOrder()).filter((x) => x !== id);
  const next = position === "next" ? [id, ...current] : [...current, id];
  await setQueueOrder(next);
  return normalizeQueue(config, eligible);
}

/** Remove a thought from the queue (it stays in the pool, eligible to refill). */
export async function removeFromQueue(
  config: AppConfig,
  id: string
): Promise<Thought[]> {
  const current = await getQueueOrder();
  if (current.includes(id)) {
    await setQueueOrder(current.filter((x) => x !== id));
  }
  return normalizeQueue(config);
}

/**
 * Set an explicit order (e.g. after a drag-reorder). Ignores ids that aren't
 * eligible, then normalizes (which re-fills the tail to queueSize).
 */
export async function reorderQueue(
  config: AppConfig,
  order: string[]
): Promise<Thought[]> {
  const eligible = await eligiblePool();
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const id of order) {
    if (eligible.has(id) && !seen.has(id)) {
      seen.add(id);
      clean.push(id);
    }
  }
  await setQueueOrder(clean);
  return normalizeQueue(config, eligible);
}

/** Redraw the whole queue: a fresh random shuffle of the eligible pool. */
export async function shuffleQueue(config: AppConfig): Promise<Thought[]> {
  const eligible = await eligiblePool();
  const target = Math.max(0, Math.floor(config.queueSize || 0));
  const order = shuffleInPlace([...eligible.keys()]).slice(0, target);
  await setQueueOrder(order);
  return normalizeQueue(config, eligible);
}

/**
 * Move a thought to the back of the queue (used when its publish fails
 * non-terminally, so a stuck head doesn't block the rest of a run). Best-effort.
 */
export async function rotateToBack(id: string): Promise<void> {
  const current = await getQueueOrder();
  if (!current.includes(id)) return;
  await setQueueOrder([...current.filter((x) => x !== id), id]);
}
