// Shared application types. Timestamps are app-facing ISO strings (Firestore
// reads convert Timestamp -> ISO; writes accept Date or ISO).

export type ThoughtStatus = "unpublished" | "published" | "failed" | "archived";

export interface Thought {
  /** Graph task id == Firestore doc id */
  id: string;
  /** Composed title + optional note (== composeFullText) */
  text: string;
  title: string;
  /** HTML-stripped note; null if empty */
  note: string | null;
  status: ThoughtStatus;
  /** ISO string derived from the To Do createdDateTime */
  createdAt: string | null;
  /** ISO string of last sync that saw this task */
  syncedAt: string | null;
  /** ISO string */
  publishedAt: string | null;
  threadsPostId: string | null;
  permalink: string | null;
  /** Two-step container id for retry-safe publish */
  creationId: string | null;
  /**
   * Media ids already published for an in-progress multi-post chain. Lets a
   * failed/interrupted thread resume from where it left off instead of
   * re-posting segments that already went out (avoids the double-post footgun).
   * Empty once the chain completes or terminally fails.
   */
  publishedSegmentIds: string[];
  attempts: number;
  lastError: string | null;
  /** Source To Do list id */
  listId: string;
  /** UI: exclude from selection */
  skip: boolean;
  /** Idempotency lock, ISO string or null */
  lock: string | null;
  /** Derived from createdAt UTC year */
  year: number | null;
}

export interface PostLog {
  id: string;
  thoughtId: string;
  /** Full composed text actually sent */
  text: string;
  /** Published per-post segments */
  segments: string[];
  threadsPostId: string;
  permalink: string;
  /** ISO string */
  publishedAt: string;
  status: "success" | "failed";
  error?: string | null;
}

export type Cadence = "daily";
export type OnExhaustion = "stop" | "reshuffle";

export interface AppConfig {
  sourceListId: string | null;
  cadence: Cadence;
  postsPerRun: number;
  onExhaustion: OnExhaustion;
  writeBackComplete: boolean;
  paused: boolean;
  timezone: string;
  postTimeJitter: boolean;
  /** Target length of the "Up Next" queue; it auto-fills to this size. */
  queueSize: number;
  /**
   * ISO of the last "pool exhausted" alert, used to debounce repeated alerts
   * (otherwise a daily cron would alert every run once the pool empties). Null
   * when never alerted / reset after a successful publish.
   */
  lastExhaustionNotifiedAt: string | null;
}

export const DEFAULT_CONFIG: AppConfig = {
  sourceListId: null,
  cadence: "daily",
  postsPerRun: 1,
  onExhaustion: "stop",
  writeBackComplete: false,
  paused: false,
  timezone: "Asia/Seoul",
  postTimeJitter: false,
  queueSize: 10,
  lastExhaustionNotifiedAt: null,
};

export interface TokenState {
  /** DECRYPTED in memory */
  msRefreshToken: string | null;
  /** ISO string */
  msTokenUpdatedAt: string | null;
  /** DECRYPTED in memory */
  threadsToken: string | null;
  /** ISO string */
  threadsTokenObtainedAt: string | null;
  threadsUserId: string | null;
  msNeedsReauth: boolean;
  threadsNeedsReauth: boolean;
}
