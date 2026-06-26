"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PostPreview from "@/app/components/PostPreview";
import type { Thought } from "@/lib/types";

// /api/queue returns each thought with a `preview: string[]` (same as /api/thoughts).
type QueueRow = Thought & { preview: string[] };

export interface UpNextHandle {
  refresh: () => Promise<void>;
}

/**
 * The drag-reorderable "Up Next" queue. Self-manages its data; the parent holds
 * a ref and calls refresh() after queue actions taken elsewhere (e.g. "Queue
 * next" on the full thoughts table).
 */
const UpNext = forwardRef<UpNextHandle, unknown>(function UpNext(_props, ref) {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/queue", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setQueue(Array.isArray(data.queue) ? data.queue : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useImperativeHandle(ref, () => ({ refresh: load }), [load]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Persist a new order; the server returns the normalized (re-filled) queue.
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
        void load(); // re-sync to the server's truth
      }
    },
    [load]
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = queue.findIndex((t) => t.id === active.id);
    const newIndex = queue.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(queue, oldIndex, newIndex);
    setQueue(next); // optimistic
    void persistOrder(next.map((t) => t.id));
  };

  const action = useCallback(
    async (url: string, method: "DELETE" | "POST") => {
      setBusy(true);
      try {
        const res = await fetch(url, { method });
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
        setBusy(false);
      }
    },
    []
  );

  const remove = (id: string) => action(`/api/queue/${id}`, "DELETE");
  const shuffle = () => action("/api/queue/shuffle", "POST");
  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="card">
      <div className="queue-head">
        <h2>Up Next</h2>
        <button
          className="btn btn-sm"
          onClick={shuffle}
          disabled={busy || loading}
          title="Redraw the queue at random"
        >
          Shuffle
        </button>
      </div>
      <p className="queue-note">
        The next thoughts to publish — drag to reorder. The list tops up at
        random; the top of the list goes out first.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading queue…</p>
      ) : queue.length === 0 ? (
        <p className="muted">
          Nothing queued. Sync some thoughts, or use “Queue next” below.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={queue.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="queue-list">
              {queue.map((t, i) => (
                <QueueItem
                  key={t.id}
                  t={t}
                  index={i}
                  isOpen={!!expanded[t.id]}
                  busy={busy}
                  onToggle={() => toggle(t.id)}
                  onRemove={() => remove(t.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
});

function QueueItem({
  t,
  index,
  isOpen,
  busy,
  onToggle,
  onRemove,
}: {
  t: QueueRow;
  index: number;
  isOpen: boolean;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: t.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const segCount = t.preview?.length ?? 0;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`queue-item${isDragging ? " dragging" : ""}`}
    >
      <button
        className="queue-handle"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="queue-folio">{String(index + 1).padStart(2, "0")}</span>
      <div>
        <div className="literary">
          {t.title || <span className="dim">(untitled)</span>}
        </div>
        <div className="queue-meta">
          <span className="mono">{t.year ?? "—"}</span>
          <span className="sep">·</span>
          <span>
            {segCount} {segCount === 1 ? "post" : "posts"}
          </span>
          <button className="btn btn-sm" onClick={onToggle} aria-expanded={isOpen}>
            {isOpen ? "Hide" : "Preview"}
          </button>
        </div>
        {isOpen && <PostPreview segments={t.preview ?? []} />}
      </div>
      <button
        className="btn btn-sm queue-remove"
        onClick={onRemove}
        disabled={busy}
        title="Remove from queue"
        aria-label="Remove from queue"
      >
        ×
      </button>
    </li>
  );
}

export default UpNext;
