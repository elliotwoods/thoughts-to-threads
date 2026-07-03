"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import PostPreview from "@/app/components/PostPreview";
import UpNext, {
  QUEUE_PREFIX,
  QUEUE_ZONE,
  type QueueRow,
} from "@/app/components/UpNext";

// /api/thoughts and /api/queue both return each thought with a `preview: string[]`
// (computed server-side via buildPreview so the preview == reality).
type Row = QueueRow;

/** dnd-kit id namespacing for pool rows (queue ids are namespaced in UpNext). */
const POOL_PREFIX = "pool:";

const STATUS_LABEL: Record<string, string> = {
  unpublished: "Unpublished",
  published: "Published",
  failed: "Failed",
  archived: "Archived",
};

export default function ThoughtsPage() {
  const [thoughts, setThoughts] = useState<Row[]>([]);
  const [queue, setQueue] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [queueBusy, setQueueBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeDrag, setActiveDrag] = useState<Row | null>(null);

  const loadThoughts = useCallback(async () => {
    try {
      const res = await fetch("/api/thoughts", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setThoughts(Array.isArray(data.thoughts) ? data.thoughts : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load thoughts");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/queue", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setQueue(Array.isArray(data.queue) ? data.queue : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queue");
    }
  }, []);

  useEffect(() => {
    void loadThoughts();
    void loadQueue();
  }, [loadThoughts, loadQueue]);

  // --- queue mutations (return { queue }) --------------------------------
  const runQueue = useCallback(
    async (url: string, init?: RequestInit) => {
      setQueueBusy(true);
      try {
        const res = await fetch(url, init);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const data = await res.json();
        setQueue(Array.isArray(data.queue) ? data.queue : []);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Queue action failed");
      } finally {
        setQueueBusy(false);
      }
    },
    []
  );

  const onShuffle = useCallback(
    () => runQueue("/api/queue/shuffle", { method: "POST" }),
    [runQueue]
  );
  const onAddRandom = useCallback(
    () => runQueue("/api/queue/random", { method: "POST" }),
    [runQueue]
  );
  const onRemove = useCallback(
    (id: string) => runQueue(`/api/queue/${id}`, { method: "DELETE" }),
    [runQueue]
  );

  // Persist a drag-reorder. The optimistic state is already set; sync to truth.
  const persistOrder = useCallback(
    async (order: string[]) => {
      try {
        const res = await fetch("/api/queue", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const data = await res.json();
        setQueue(Array.isArray(data.queue) ? data.queue : []);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save order");
        void loadQueue();
      }
    },
    [loadQueue]
  );

  // Insert a pool thought into the queue at an index (drag-in).
  const addToQueueAt = useCallback(
    async (id: string, index: number) => {
      try {
        const res = await fetch(`/api/queue/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: index }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const data = await res.json();
        setQueue(Array.isArray(data.queue) ? data.queue : []);
        await loadThoughts(); // POST clears skip — reflect it in the pool
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to queue thought");
      }
    },
    [loadThoughts]
  );

  // --- per-thought pool actions ------------------------------------------
  const doQueue = useCallback(
    async (id: string, position: "next" | "last") => {
      setBusy((p) => ({ ...p, [id]: true }));
      try {
        const res = await fetch(`/api/queue/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const data = await res.json();
        setQueue(Array.isArray(data.queue) ? data.queue : []);
        await loadThoughts(); // queuing clears skip
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to queue thought");
      } finally {
        setBusy((p) => ({ ...p, [id]: false }));
      }
    },
    [loadThoughts]
  );

  const doSkip = useCallback(
    async (id: string) => {
      setBusy((p) => ({ ...p, [id]: true }));
      try {
        const res = await fetch(`/api/thoughts/${id}/skip`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        await loadThoughts();
        await loadQueue(); // skip changes eligibility → reconcile the queue
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to toggle skip");
      } finally {
        setBusy((p) => ({ ...p, [id]: false }));
      }
    },
    [loadThoughts, loadQueue]
  );

  // Pull the latest content from To Do on demand (no webhook for personal accounts).
  const doSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/actions/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      await loadThoughts();
      await loadQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh from To Do");
    } finally {
      setSyncing(false);
    }
  }, [loadThoughts, loadQueue]);

  // --- drag-and-drop ------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Prefer a specific queue item under the pointer over the bare drop-zone.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    const list = pointer.length ? pointer : rectIntersection(args);
    const queueHit = list.find((c) => String(c.id).startsWith(QUEUE_PREFIX));
    return queueHit ? [queueHit] : list;
  }, []);

  const onDragStart = (e: DragStartEvent) => {
    const a = String(e.active.id);
    if (a.startsWith(QUEUE_PREFIX)) {
      const id = a.slice(QUEUE_PREFIX.length);
      setActiveDrag(queue.find((t) => t.id === id) ?? null);
    } else if (a.startsWith(POOL_PREFIX)) {
      const id = a.slice(POOL_PREFIX.length);
      setActiveDrag(thoughts.find((t) => t.id === id) ?? null);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = e;
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);

    // Reorder within the queue.
    if (a.startsWith(QUEUE_PREFIX)) {
      if (o === a) return;
      const activeId = a.slice(QUEUE_PREFIX.length);
      const oldIndex = queue.findIndex((t) => t.id === activeId);
      const newIndex = o.startsWith(QUEUE_PREFIX)
        ? queue.findIndex((t) => t.id === o.slice(QUEUE_PREFIX.length))
        : queue.length - 1; // dropped on the zone → end
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const next = arrayMove(queue, oldIndex, newIndex);
      setQueue(next); // optimistic
      void persistOrder(next.map((t) => t.id));
      return;
    }

    // Add (copy) a pool thought into the queue.
    if (a.startsWith(POOL_PREFIX)) {
      const poolId = a.slice(POOL_PREFIX.length);
      let insertIndex: number;
      if (o === QUEUE_ZONE) insertIndex = queue.length;
      else if (o.startsWith(QUEUE_PREFIX)) {
        const idx = queue.findIndex((t) => t.id === o.slice(QUEUE_PREFIX.length));
        insertIndex = idx < 0 ? queue.length : idx;
      } else return; // dropped over a pool row → ignore
      void addToQueueAt(poolId, insertIndex);
    }
  };

  const queuedIds = useMemo(() => new Set(queue.map((t) => t.id)), [queue]);
  const addRandomDisabled = useMemo(
    () =>
      !thoughts.some(
        (t) => t.status === "unpublished" && !t.skip && !queuedIds.has(t.id)
      ),
    [thoughts, queuedIds]
  );

  return (
    <div>
      <h1>Thoughts</h1>
      <p className="page-sub">
        Synced from Microsoft To&nbsp;Do. Drag a thought up into Up&nbsp;Next, or
        use the queue controls. Each preview is exactly how it will publish to
        Threads.
      </p>

      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className="btn" disabled={syncing} onClick={doSync}>
          {syncing ? (
            <>
              <span className="spinner" aria-hidden="true" /> Refreshing…
            </>
          ) : (
            "Refresh from To Do"
          )}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <UpNext
          queue={queue}
          busy={queueBusy}
          onRemove={onRemove}
          onShuffle={onShuffle}
          onAddRandom={onAddRandom}
          addRandomDisabled={addRandomDisabled}
        />

        <div className="card">
          <h2>All thoughts</h2>
          {loading ? (
            <p className="muted">Loading thoughts…</p>
          ) : thoughts.length === 0 ? (
            <p className="muted">
              No thoughts yet. Connect Microsoft and run a sync to import tasks.
            </p>
          ) : (
            <ul className="pool-list">
              {thoughts.map((t) => (
                <PoolItem
                  key={t.id}
                  t={t}
                  isBusy={!!busy[t.id]}
                  queued={queuedIds.has(t.id)}
                  onQueueNext={() => doQueue(t.id, "next")}
                  onQueueLast={() => doQueue(t.id, "last")}
                  onSkip={() => doSkip(t.id)}
                />
              ))}
            </ul>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag ? <DragCard t={activeDrag} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function PoolItem({
  t,
  isBusy,
  queued,
  onQueueNext,
  onQueueLast,
  onSkip,
}: {
  t: Row;
  isBusy: boolean;
  queued: boolean;
  onQueueNext: () => void;
  onQueueLast: () => void;
  onSkip: () => void;
}) {
  const canQueue = t.status === "unpublished" && !t.skip;
  const posted = t.status === "published";
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: POOL_PREFIX + t.id,
    disabled: !canQueue,
  });
  const segCount = t.preview?.length ?? 0;

  return (
    <li
      ref={setNodeRef}
      className={`pool-item${isDragging ? " dragging" : ""}${
        posted ? " posted" : ""
      }${queued ? " queued" : ""}`}
    >
      {canQueue ? (
        <button
          className="pool-handle"
          aria-label="Drag into Up Next"
          {...listeners}
        >
          ⠿
        </button>
      ) : (
        <span className="pool-handle-spacer" aria-hidden="true" />
      )}
      <div>
        <div className="queue-meta">
          <span className={`badge badge-${t.status}`}>
            {STATUS_LABEL[t.status] ?? t.status}
          </span>
          <span className="mono">{t.year ?? "—"}</span>
          <span className="sep">·</span>
          <span>
            {segCount} {segCount === 1 ? "post" : "posts"}
          </span>
          {queued && (
            <>
              <span className="sep">·</span>
              <span className="badge badge-unpublished">In queue</span>
            </>
          )}
          {t.skip && <span className="badge">Skipped</span>}
        </div>
        <PostPreview segments={t.preview ?? []} />
        {t.status === "unpublished" && (
          <div className="row-actions pool-actions">
            {canQueue && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={onQueueNext}
                  disabled={isBusy}
                  title="Put at the front of the queue"
                >
                  Queue next
                </button>
                <button
                  className="btn btn-sm"
                  onClick={onQueueLast}
                  disabled={isBusy}
                  title="Put at the back of the queue"
                >
                  Queue last
                </button>
              </>
            )}
            <button
              className="btn btn-sm"
              onClick={onSkip}
              disabled={isBusy}
              title="Exclude from selection"
            >
              {t.skip ? "Unskip" : "Skip"}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function DragCard({ t }: { t: Row }) {
  const segCount = t.preview?.length ?? 0;
  return (
    <div className="drag-card">
      <div className="literary">{t.title || "(untitled)"}</div>
      <div className="queue-meta">
        <span className="mono">{t.year ?? "—"}</span>
        <span className="sep">·</span>
        <span>
          {segCount} {segCount === 1 ? "post" : "posts"}
        </span>
      </div>
    </div>
  );
}
