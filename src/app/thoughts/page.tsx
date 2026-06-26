"use client";

import { useCallback, useEffect, useState } from "react";
import PostPreview from "@/app/components/PostPreview";
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

  const doToggle = useCallback(
    async (id: string, action: "skip" | "pin") => {
      setBusy((prev) => ({ ...prev, [id]: true }));
      try {
        const res = await fetch(`/api/thoughts/${id}/${action}`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : `Failed to toggle ${action}`);
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
                <th style={{ width: "170px" }}>Actions</th>
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
                    onSkip={() => doToggle(t.id, "skip")}
                    onPin={() => doToggle(t.id, "pin")}
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
  onPin,
}: {
  t: ThoughtRow;
  isOpen: boolean;
  isBusy: boolean;
  segCount: number;
  onToggleExpanded: () => void;
  onSkip: () => void;
  onPin: () => void;
}) {
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
          <div>{t.title || <span className="dim">(untitled)</span>}</div>
          <div className="row-actions" style={{ marginTop: 4 }}>
            {t.pin && <span className="badge badge-unpublished">Pinned</span>}
            {t.skip && <span className="badge">Skipped</span>}
          </div>
        </td>
        <td className="mono">{t.year ?? "—"}</td>
        <td className="mono">{segCount}</td>
        <td>
          <div className="row-actions">
            <button
              className="btn btn-sm"
              onClick={onSkip}
              disabled={isBusy}
              title="Exclude from selection"
            >
              {t.skip ? "Unskip" : "Skip"}
            </button>
            <button
              className="btn btn-sm"
              onClick={onPin}
              disabled={isBusy}
              title="Force next"
            >
              {t.pin ? "Unpin" : "Pin"}
            </button>
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={6} style={{ background: "var(--bg-elevated)" }}>
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
