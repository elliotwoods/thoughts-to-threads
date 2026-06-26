"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PostPreview from "@/app/components/PostPreview";
import UpNext, { type UpNextHandle } from "@/app/components/UpNext";
import type { Thought } from "@/lib/types";

// /api/thoughts returns each thought with a `preview: string[]` added
// (computed server-side via buildPreview so the preview == reality).
type ThoughtRow = Thought & { preview: string[] };

const STATUS_LABEL: Record<string, string> = {
  unpublished: "Unpublished",
  published: "Published",
  failed: "Failed",
  archived: "Archived",
};

export default function ThoughtsPage() {
  const [thoughts, setThoughts] = useState<ThoughtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const upNextRef = useRef<UpNextHandle>(null);

  const load = useCallback(async () => {
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

  useEffect(() => {
    void load();
  }, [load]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const doSkip = useCallback(
    async (id: string) => {
      setBusy((prev) => ({ ...prev, [id]: true }));
      try {
        const res = await fetch(`/api/thoughts/${id}/skip`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        await load();
        await upNextRef.current?.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to toggle skip");
      } finally {
        setBusy((prev) => ({ ...prev, [id]: false }));
      }
    },
    [load]
  );

  const doQueue = useCallback(
    async (id: string, position: "next" | "last") => {
      setBusy((prev) => ({ ...prev, [id]: true }));
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
        await upNextRef.current?.refresh();
        await load(); // queuing clears skip — reflect it in the table
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to queue thought");
      } finally {
        setBusy((prev) => ({ ...prev, [id]: false }));
      }
    },
    [load]
  );

  return (
    <div>
      <h1>Thoughts</h1>
      <p className="page-sub">
        Synced from Microsoft To&nbsp;Do. Expand a row for a live preview of the
        exact Threads post(s) that will be published.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      <UpNext ref={upNextRef} />

      <div className="card">
        {loading ? (
          <p className="muted">Loading thoughts…</p>
        ) : thoughts.length === 0 ? (
          <p className="muted">
            No thoughts yet. Connect Microsoft and run a sync to import tasks.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: "1%" }}></th>
                <th style={{ width: "120px" }}>Status</th>
                <th>Title</th>
                <th style={{ width: "70px" }}>Year</th>
                <th style={{ width: "70px" }}>Posts</th>
                <th style={{ width: "230px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {thoughts.map((t) => {
                const isOpen = !!expanded[t.id];
                const isBusy = !!busy[t.id];
                const segCount = t.preview?.length ?? 0;
                return (
                  <ThoughtRowGroup
                    key={t.id}
                    t={t}
                    isOpen={isOpen}
                    isBusy={isBusy}
                    segCount={segCount}
                    onToggleExpanded={() => toggleExpanded(t.id)}
                    onSkip={() => doSkip(t.id)}
                    onQueueNext={() => doQueue(t.id, "next")}
                    onQueueLast={() => doQueue(t.id, "last")}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ThoughtRowGroup({
  t,
  isOpen,
  isBusy,
  segCount,
  onToggleExpanded,
  onSkip,
  onQueueNext,
  onQueueLast,
}: {
  t: ThoughtRow;
  isOpen: boolean;
  isBusy: boolean;
  segCount: number;
  onToggleExpanded: () => void;
  onSkip: () => void;
  onQueueNext: () => void;
  onQueueLast: () => void;
}) {
  // Only unpublished, non-skipped thoughts can be queued.
  const canQueue = t.status === "unpublished" && !t.skip;
  return (
    <>
      <tr>
        <td>
          <button
            className="btn btn-sm"
            onClick={onToggleExpanded}
            aria-expanded={isOpen}
            title={isOpen ? "Hide preview" : "Show preview"}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        </td>
        <td>
          <span className={`badge badge-${t.status}`}>
            {STATUS_LABEL[t.status] ?? t.status}
          </span>
        </td>
        <td>
          <div className="literary">
            {t.title || <span className="dim">(untitled)</span>}
          </div>
          {t.skip && (
            <div className="row-actions" style={{ marginTop: 4 }}>
              <span className="badge">Skipped</span>
            </div>
          )}
        </td>
        <td className="mono">{t.year ?? "—"}</td>
        <td className="mono">{segCount}</td>
        <td>
          <div className="row-actions">
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
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td
            colSpan={6}
            style={{ background: "var(--paper-tint)", padding: "20px 24px" }}
          >
            <div style={{ fontSize: 13 }} className="muted">
              Live preview — exactly how this will publish to Threads
              {segCount > 1 && ` (${segCount}-post reply chain)`}:
            </div>
            <PostPreview segments={t.preview ?? []} />
          </td>
        </tr>
      )}
    </>
  );
}
