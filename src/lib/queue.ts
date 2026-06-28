// The "Up Next" queue: a Spotify-style, user-orderable view of the thoughts
// that will publish next. Order is persisted as an array of thought ids in
// Firestore (config/queue.order); this module is the single source of truth for
// reading, reconciling, refilling, and mutating it.
//
// "Eligible" means a thought is in the active pool: status === "unpublished" and
// skip === false. The queue only ever contains eligible ids.
//
// Two distinct operations, deliberately split:
//   - RECONCILE: drop ids that are no longer eligible, de-duplicate. Used on
//     reads and on every user mutation. Never adds anything.
//   - REFILL: reconcile, then top the queue back up to config.queueSize with a
//     random draw of the pool. Used ONLY by the publish cycle (and cold start).
// This split is what makes a manual removal "stick": it reduces the count and
// stays reduced until the next post cycle, which refills to queueSize.
// Publishing consumes the head implicitly: a published thought leaves the
// eligible pool, so the next reconcile drops it.

import { getQueueOrder, listThoughts, setQueueOrder } from "./firestore";
import {
  insertIndexFor,
  reconcileOrder,
  sameOrder,
  type QueuePosition,
} from "./queueOrder";
import type { AppConfig, Thought } from "./types";

export type { QueuePosition } from "./queueOrder";

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

/** Hydrate an id order against the eligible map (all ids guaranteed present). */
function hydrate(order: string[], eligible: Map<string, Thought>): Thought[] {
  return order.map((id) => eligible.get(id)!);
}

/**
 * Reconcile the persisted order with the live pool (drop ineligible, dedupe).
 * Does NOT top up. Persists only when the order changes. This is the read-time
 * and mutation-time normaliser. Pass a prebuilt pool to avoid a redundant read.
 */
export async function reconcileQueue(
  _config: AppConfig,
  pool?: Map<string, Thought>
): Promise<Thought[]> {
  const eligible = pool ?? (await eligiblePool());
  const stored = await getQueueOrder();
  const order = reconcileOrder(eligible, stored);
  if (!sameOrder(order, stored)) await setQueueOrder(order);
  return hydrate(order, eligible);
}

/**
 * Reconcile then top the queue up to config.queueSize with a random draw of the
 * eligible pool. Used by the publish cycle and cold start. Persists when the
 * order changes (persist-if-changed, so a cold start with an empty pool doesn't
 * materialise an empty doc that would suppress later auto-fill).
 */
export async function refillQueue(
  config: AppConfig,
  pool?: Map<string, Thought>
): Promise<Thought[]> {
  const eligible = pool ?? (await eligiblePool());
  const stored = await getQueueOrder();
  const order = reconcileOrder(eligible, stored);

  const target = Math.max(0, Math.floor(config.queueSize || 0));
  if (order.length < target) {
    const seen = new Set(order);
    const rest = shuffleInPlace(
      [...eligible.keys()].filter((id) => !seen.has(id))
    );
    for (const id of rest) {
      if (order.length >= target) break;
      order.push(id);
    }
  }

  if (!sameOrder(order, stored)) await setQueueOrder(order);
  return hydrate(order, eligible);
}

/**
 * Inject a thought into the queue at `position`. Reconcile-only (no top-up) so
 * adding one thought never balloons the queue to queueSize. If `id` is already
 * queued it is moved to the new position.
 */
export async function addToQueue(
  config: AppConfig,
  id: string,
  position: QueuePosition,
  pool?: Map<string, Thought>
): Promise<Thought[]> {
  const eligible = pool ?? (await eligiblePool());
  if (!eligible.has(id)) {
    // Caller is expected to have cleared skip first; if it's still not eligible
    // (e.g. already published) there's nothing to queue — just reconcile.
    return reconcileQueue(config, eligible);
  }
  const stored = await getQueueOrder();
  const order = reconcileOrder(eligible, stored).filter((x) => x !== id);
  order.splice(insertIndexFor(position, order.length), 0, id);
  if (!sameOrder(order, stored)) await setQueueOrder(order);
  return hydrate(order, eligible);
}

/**
 * Remove a thought from the queue. Reconcile-only — the count stays reduced
 * until the next publish cycle refills it. The thought remains in the pool.
 */
export async function removeFromQueue(
  config: AppConfig,
  id: string
): Promise<Thought[]> {
  const eligible = await eligiblePool();
  const stored = await getQueueOrder();
  const order = reconcileOrder(eligible, stored).filter((x) => x !== id);
  if (!sameOrder(order, stored)) await setQueueOrder(order);
  return hydrate(order, eligible);
}

/**
 * Set an explicit order (e.g. after a drag-reorder). Honours the requested
 * order, dropping ineligible ids. Reconcile-only (no top-up).
 */
export async function reorderQueue(
  config: AppConfig,
  requested: string[]
): Promise<Thought[]> {
  const eligible = await eligiblePool();
  const order = reconcileOrder(eligible, requested);
  await setQueueOrder(order);
  return hydrate(order, eligible);
}

/**
 * Append one random eligible thought that isn't already queued. Safe no-op when
 * none remain. Reconcile-based — does not top up to queueSize.
 */
export async function addRandom(
  config: AppConfig,
  pool?: Map<string, Thought>
): Promise<Thought[]> {
  const eligible = pool ?? (await eligiblePool());
  const stored = await getQueueOrder();
  const order = reconcileOrder(eligible, stored);
  const seen = new Set(order);
  const candidates = [...eligible.keys()].filter((id) => !seen.has(id));
  if (candidates.length > 0) {
    order.push(candidates[Math.floor(Math.random() * candidates.length)]);
  }
  if (!sameOrder(order, stored)) await setQueueOrder(order);
  return hydrate(order, eligible);
}

/** Redraw the whole queue: a fresh random shuffle of the eligible pool. */
export async function shuffleQueue(config: AppConfig): Promise<Thought[]> {
  const eligible = await eligiblePool();
  const target = Math.max(0, Math.floor(config.queueSize || 0));
  const order = shuffleInPlace([...eligible.keys()]).slice(0, target);
  await setQueueOrder(order);
  return hydrate(order, eligible);
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
