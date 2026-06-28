"use client";

// The "Up Next" queue — presentational. The parent (thoughts/page.tsx) owns the
// data and the single DndContext that spans both this list and the pool list, so
// a thought can be dragged from the pool into here. This component renders the
// sortable queue (reorder within), a droppable zone (so empty/edge drops land),
// always-on previews, and the Shuffle / Add-random controls.

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PostPreview from "@/app/components/PostPreview";
import type { Thought } from "@/lib/types";

export type QueueRow = Thought & { preview: string[] };

/** dnd-kit id namespacing — the same thoughtId lives in both lists. */
export const QUEUE_PREFIX = "queue:";
export const QUEUE_ZONE = "queue-zone";

export default function UpNext({
  queue,
  busy,
  onRemove,
  onShuffle,
  onAddRandom,
  addRandomDisabled,
}: {
  queue: QueueRow[];
  busy: boolean;
  onRemove: (id: string) => void;
  onShuffle: () => void;
  onAddRandom: () => void;
  addRandomDisabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: QUEUE_ZONE });

  return (
    <div className="card">
      <div className="queue-head">
        <h2>Up Next</h2>
        <button
          className="btn btn-sm"
          onClick={onShuffle}
          disabled={busy}
          title="Redraw the queue at random"
        >
          Shuffle
        </button>
      </div>
      <p className="queue-note">
        The next thoughts to publish — drag to reorder, or drag one up from below.
        The top goes out first; the list refills to full after each post.
      </p>

      <SortableContext
        items={queue.map((t) => QUEUE_PREFIX + t.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul
          ref={setNodeRef}
          className={`queue-list${isOver ? " drop-over" : ""}`}
        >
          {queue.length === 0 ? (
            <li className="queue-empty">
              Nothing queued. Drag a thought here, add one at random, or use
              “Queue next” below.
            </li>
          ) : (
            queue.map((t, i) => (
              <QueueItem
                key={t.id}
                t={t}
                index={i}
                busy={busy}
                onRemove={() => onRemove(t.id)}
              />
            ))
          )}
        </ul>
      </SortableContext>

      <div className="queue-foot">
        <button
          className="btn btn-sm"
          onClick={onAddRandom}
          disabled={addRandomDisabled || busy}
          title="Add a random thought to the queue"
        >
          Add random
        </button>
      </div>
    </div>
  );
}

function QueueItem({
  t,
  index,
  busy,
  onRemove,
}: {
  t: QueueRow;
  index: number;
  busy: boolean;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: QUEUE_PREFIX + t.id });
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
        <div className="queue-meta">
          <span className="mono">{t.year ?? "—"}</span>
          <span className="sep">·</span>
          <span>
            {segCount} {segCount === 1 ? "post" : "posts"}
          </span>
        </div>
        <PostPreview segments={t.preview ?? []} />
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
