// Server-only Firestore access layer. All timestamp READS convert Firestore
// Timestamps to ISO strings; WRITES accept Date or ISO string. Token fields are
// encrypted on write and decrypted on read.

import {
  Timestamp,
  type DocumentData,
  type Query,
} from "firebase-admin/firestore";
import { db } from "./firebase";
import { encrypt, decrypt } from "./crypto";
import { composeFullText } from "./post";
import { syncStatusTransition } from "./syncStatus";
import {
  DEFAULT_CONFIG,
  type AppConfig,
  type PostLog,
  type Thought,
  type ThoughtStatus,
  type TokenState,
} from "./types";

const THOUGHTS = "thoughts";
const POSTS = "posts";
const CONFIG_DOC = ["config", "app"] as const;
const QUEUE_DOC = ["config", "queue"] as const;
const TOKENS_DOC = ["secrets", "tokens"] as const;

// --- timestamp helpers ---------------------------------------------------

type TsInput = Date | string | null | undefined;

function toTs(v: TsInput): Timestamp | null {
  if (v == null) return null;
  if (v instanceof Date) return Timestamp.fromDate(v);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

/**
 * Year of a date in a given IANA timezone (falls back to UTC year if the
 * timezone is missing/invalid). Used so a thought created late on Dec 31 UTC
 * but already Jan 1 in the user's zone gets the local year on its post suffix.
 */
function yearInTz(d: Date, timeZone?: string | null): number {
  if (!timeZone) return d.getUTCFullYear();
  try {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
    }).format(d);
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : d.getUTCFullYear();
  } catch {
    return d.getUTCFullYear();
  }
}

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { toDate?: unknown }).toDate === "function"
  ) {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return null;
}

// --- config --------------------------------------------------------------

export async function getConfig(): Promise<AppConfig> {
  const snap = await db().doc(CONFIG_DOC.join("/")).get();
  const data = (snap.data() ?? {}) as Partial<AppConfig>;
  return { ...DEFAULT_CONFIG, ...data };
}

export async function updateConfig(
  patch: Partial<AppConfig>
): Promise<AppConfig> {
  const clean: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(patch)) {
    if (val !== undefined) clean[k] = val;
  }
  await db().doc(CONFIG_DOC.join("/")).set(clean, { merge: true });
  return getConfig();
}

// --- queue order ---------------------------------------------------------

/** Ordered list of thought ids for the "Up Next" queue (config/queue.order). */
export async function getQueueOrder(): Promise<string[]> {
  const snap = await db().doc(QUEUE_DOC.join("/")).get();
  const order = snap.data()?.order;
  return Array.isArray(order) ? (order.filter((x) => typeof x === "string") as string[]) : [];
}

export async function setQueueOrder(order: string[]): Promise<void> {
  await db().doc(QUEUE_DOC.join("/")).set({ order }, { merge: true });
}

// --- tokens --------------------------------------------------------------

export async function getTokenState(): Promise<TokenState> {
  const snap = await db().doc(TOKENS_DOC.join("/")).get();
  const d = snap.data() ?? {};
  return {
    msRefreshToken: d.msRefreshToken ? decrypt(d.msRefreshToken) : null,
    msTokenUpdatedAt: toIso(d.msTokenUpdatedAt),
    threadsToken: d.threadsToken ? decrypt(d.threadsToken) : null,
    threadsTokenObtainedAt: toIso(d.threadsTokenObtainedAt),
    threadsUserId: d.threadsUserId ?? null,
    msNeedsReauth: Boolean(d.msNeedsReauth),
    threadsNeedsReauth: Boolean(d.threadsNeedsReauth),
  };
}

export type TokenStateWrite = Partial<
  Omit<TokenState, "msTokenUpdatedAt" | "threadsTokenObtainedAt">
> & {
  msTokenUpdatedAt?: Date | string | null;
  threadsTokenObtainedAt?: Date | string | null;
};

export async function updateTokenState(
  patch: TokenStateWrite
): Promise<void> {
  const data: Record<string, unknown> = {};
  if ("msRefreshToken" in patch) {
    data.msRefreshToken =
      patch.msRefreshToken == null ? null : encrypt(patch.msRefreshToken);
  }
  if ("threadsToken" in patch) {
    data.threadsToken =
      patch.threadsToken == null ? null : encrypt(patch.threadsToken);
  }
  if ("msTokenUpdatedAt" in patch) {
    data.msTokenUpdatedAt = toTs(patch.msTokenUpdatedAt);
  }
  if ("threadsTokenObtainedAt" in patch) {
    data.threadsTokenObtainedAt = toTs(patch.threadsTokenObtainedAt);
  }
  if ("threadsUserId" in patch) data.threadsUserId = patch.threadsUserId ?? null;
  if ("msNeedsReauth" in patch) data.msNeedsReauth = Boolean(patch.msNeedsReauth);
  if ("threadsNeedsReauth" in patch) {
    data.threadsNeedsReauth = Boolean(patch.threadsNeedsReauth);
  }
  await db().doc(TOKENS_DOC.join("/")).set(data, { merge: true });
}

// --- thoughts ------------------------------------------------------------

function mapThought(id: string, d: DocumentData): Thought {
  return {
    id,
    text: d.text ?? "",
    title: d.title ?? "",
    note: d.note ?? null,
    status: (d.status ?? "unpublished") as ThoughtStatus,
    createdAt: toIso(d.createdAt),
    syncedAt: toIso(d.syncedAt),
    publishedAt: toIso(d.publishedAt),
    threadsPostId: d.threadsPostId ?? null,
    permalink: d.permalink ?? null,
    creationId: d.creationId ?? null,
    publishedSegmentIds: Array.isArray(d.publishedSegmentIds)
      ? (d.publishedSegmentIds as string[])
      : [],
    attempts: typeof d.attempts === "number" ? d.attempts : 0,
    lastError: d.lastError ?? null,
    listId: d.listId ?? "",
    skip: Boolean(d.skip),
    lock: toIso(d.lock),
    year: typeof d.year === "number" ? d.year : null,
  };
}

export interface SetThoughtInput {
  id: string;
  title: string;
  note: string | null;
  createdAt: Date | string | null;
  listId: string;
  /** Whether the source To Do task is completed (ticked off). */
  taskCompleted: boolean;
  /** IANA timezone used to derive the year suffix (defaults to UTC). */
  timezone?: string | null;
}

export async function setThoughtFromTask(input: SetThoughtInput): Promise<void> {
  const { id, title, note, createdAt, listId, taskCompleted, timezone } = input;
  const ref = db().collection(THOUGHTS).doc(id);
  const text = composeFullText({ title, note });
  const createdTs = toTs(createdAt);
  const year =
    createdTs != null ? yearInTz(createdTs.toDate(), timezone) : null;

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Timestamp.now();
    const common: Record<string, unknown> = {
      title,
      note: note ?? null,
      text,
      syncedAt: now,
      listId,
    };
    // Only touch createdAt/year when we actually know the creation date, so a
    // later sync without the field can't wipe it.
    if (createdTs != null) {
      common.createdAt = createdTs;
      common.year = year;
    }

    if (!snap.exists) {
      tx.set(ref, {
        ...common,
        createdAt: createdTs,
        year,
        // New doc: completed task -> archived, otherwise unpublished.
        status: syncStatusTransition(null, taskCompleted),
        attempts: 0,
        skip: false,
        lock: null,
        publishedAt: null,
        threadsPostId: null,
        permalink: null,
        creationId: null,
        publishedSegmentIds: [],
        lastError: null,
      });
    } else {
      // A task ticked off in To Do drops an as-yet-unpublished thought out of the
      // queue (-> archived). Never downgrade a published/failed/archived thought.
      const current = (snap.data()?.status ?? "unpublished") as ThoughtStatus;
      const next = syncStatusTransition(current, taskCompleted);
      if (next) common.status = next;
      tx.update(ref, common);
    }
  });
}

export async function getThought(id: string): Promise<Thought | null> {
  const snap = await db().collection(THOUGHTS).doc(id).get();
  if (!snap.exists) return null;
  return mapThought(snap.id, snap.data() as DocumentData);
}

export async function listThoughts(filter?: {
  status?: ThoughtStatus;
  skip?: boolean;
}): Promise<Thought[]> {
  let q: Query = db().collection(THOUGHTS);
  if (filter?.status) q = q.where("status", "==", filter.status);
  const snap = await q.get();
  let rows = snap.docs.map((doc) =>
    mapThought(doc.id, doc.data() as DocumentData)
  );
  // Apply the skip filter in memory to avoid needing a composite index.
  if (filter?.skip !== undefined) {
    rows = rows.filter((t) => t.skip === filter.skip);
  }
  return rows;
}

export async function updateThought(
  id: string,
  patch: Partial<Thought>
): Promise<void> {
  const data: Record<string, unknown> = {};
  const tsFields = new Set(["createdAt", "syncedAt", "publishedAt", "lock"]);
  for (const [k, val] of Object.entries(patch)) {
    if (k === "id" || val === undefined) continue;
    if (tsFields.has(k)) {
      data[k] = toTs(val as TsInput);
    } else {
      data[k] = val;
    }
  }
  await db().collection(THOUGHTS).doc(id).update(data);
}

export async function markArchivedExcept(
  listId: string,
  seenIds: string[]
): Promise<number> {
  const seen = new Set(seenIds);
  const snap = await db()
    .collection(THOUGHTS)
    .where("listId", "==", listId)
    .get();
  const targets = snap.docs.filter(
    (doc) => !seen.has(doc.id) && doc.data().status !== "archived"
  );
  let count = 0;
  for (let i = 0; i < targets.length; i += 400) {
    const batch = db().batch();
    for (const doc of targets.slice(i, i + 400)) {
      batch.update(doc.ref, { status: "archived" });
      count++;
    }
    await batch.commit();
  }
  return count;
}

// --- locking -------------------------------------------------------------

export async function acquireLock(id: string, ttlMs: number): Promise<boolean> {
  const ref = db().collection(THOUGHTS).doc(id);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const d = snap.data() as DocumentData;
    if (d.status !== "unpublished") return false;
    const lockIso = toIso(d.lock);
    if (lockIso) {
      const ageMs = Date.now() - new Date(lockIso).getTime();
      if (ageMs < ttlMs) return false;
    }
    tx.update(ref, { lock: Timestamp.now() });
    return true;
  });
}

export async function releaseLock(id: string): Promise<void> {
  await db().collection(THOUGHTS).doc(id).update({ lock: null });
}

// --- posts ---------------------------------------------------------------

export async function appendPost(log: Omit<PostLog, "id">): Promise<string> {
  const ref = await db()
    .collection(POSTS)
    .add({
      thoughtId: log.thoughtId,
      text: log.text,
      segments: log.segments ?? [],
      threadsPostId: log.threadsPostId,
      permalink: log.permalink,
      publishedAt: toTs(log.publishedAt) ?? Timestamp.now(),
      status: log.status,
      error: log.error ?? null,
    });
  return ref.id;
}

export async function listPosts(limit: number): Promise<PostLog[]> {
  const snap = await db()
    .collection(POSTS)
    .orderBy("publishedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((doc) => {
    const d = doc.data() as DocumentData;
    return {
      id: doc.id,
      thoughtId: d.thoughtId ?? "",
      text: d.text ?? "",
      segments: Array.isArray(d.segments) ? (d.segments as string[]) : [],
      threadsPostId: d.threadsPostId ?? "",
      permalink: d.permalink ?? "",
      publishedAt: toIso(d.publishedAt) ?? "",
      status: (d.status ?? "success") as PostLog["status"],
      error: d.error ?? null,
    };
  });
}

// --- pool operations -----------------------------------------------------

export async function reshufflePublished(): Promise<number> {
  const snap = await db()
    .collection(THOUGHTS)
    .where("status", "==", "published")
    .get();
  const docs = snap.docs;
  let count = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db().batch();
    for (const doc of docs.slice(i, i + 400)) {
      batch.update(doc.ref, { status: "unpublished", lock: null });
      count++;
    }
    await batch.commit();
  }
  return count;
}

export interface PoolStats {
  unpublished: number;
  published: number;
  archived: number;
  failed: number;
}

export async function poolStats(): Promise<PoolStats> {
  // Use server-side count() aggregations rather than reading every doc — the
  // dashboard polls this frequently, and a full-collection scan per poll burns
  // Firestore read quota. Each count() bills ~1 read instead of one-per-doc.
  const keys: (keyof PoolStats)[] = [
    "unpublished",
    "published",
    "archived",
    "failed",
  ];
  const counts = await Promise.all(
    keys.map((s) =>
      db()
        .collection(THOUGHTS)
        .where("status", "==", s)
        .count()
        .get()
        .then((r) => r.data().count)
    )
  );
  const stats: PoolStats = { unpublished: 0, published: 0, archived: 0, failed: 0 };
  keys.forEach((s, i) => {
    stats[s] = counts[i];
  });
  return stats;
}
