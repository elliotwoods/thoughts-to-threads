"use client";

// Dashboard — polls GET /api/status every ~10s. Shows pool counts, the next
// scheduled run, token health with re-auth banners, recent posts with
// permalinks, and the Sync / Publish / Pause-Resume action buttons.

import { useCallback, useEffect, useState } from "react";

interface StatusData {
  pool: {
    unpublished: number;
    published: number;
    archived: number;
    failed: number;
  };
  recentPosts: Array<{
    id: string;
    thoughtId: string;
    text: string;
    segments: string[];
    threadsPostId: string;
    permalink: string;
    publishedAt: string;
    status: "success" | "failed";
    error?: string | null;
  }>;
  tokens: {
    msTokenAgeHrs: number | null;
    threadsTokenAgeHrs: number | null;
    threadsDaysToExpiry: number | null;
    msNeedsReauth: boolean;
    threadsNeedsReauth: boolean;
    msConnected: boolean;
    threadsConnected: boolean;
  };
  config: {
    paused: boolean;
    postsPerRun: number;
    cadence: string;
    timezone: string;
  };
  nextRunIso: string;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fmtAgeHrs(hrs: number | null): string {
  if (hrs == null) return "not connected";
  if (hrs < 1) return `${Math.round(hrs * 60)}m ago`;
  if (hrs < 48) return `${Math.round(hrs)}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function DashboardPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Status ${res.status}`);
      }
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load status");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const action = useCallback(
    async (label: string, path: string) => {
      setBusy(label);
      try {
        const res = await fetch(path, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="page-sub">
        One thought published to Threads per scheduled run.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      {data?.tokens.msNeedsReauth && (
        <div className="banner banner-error">
          Microsoft needs re-authentication — publishing is blocked.{" "}
          <a href="/api/auth/microsoft/start">Reconnect Microsoft</a>
        </div>
      )}
      {data?.tokens.threadsNeedsReauth && (
        <div className="banner banner-error">
          Threads needs re-authentication — publishing is blocked.{" "}
          <a href="/api/auth/threads/start">Reconnect Threads</a>
        </div>
      )}
      {data?.config.paused && (
        <div className="banner banner-warn">
          Publishing is paused. No scheduled posts will go out until resumed.
        </div>
      )}
      {data &&
        data.tokens.threadsDaysToExpiry != null &&
        data.tokens.threadsDaysToExpiry < 7 && (
          <div className="banner banner-warn">
            Threads token expires in{" "}
            {Math.max(0, Math.round(data.tokens.threadsDaysToExpiry))} days —
            reconnect soon to avoid an outage.
          </div>
        )}

      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-4">
            <div className="stat">
              <div className="num">{data.pool.unpublished}</div>
              <div className="label">Unpublished</div>
            </div>
            <div className="stat">
              <div className="num">{data.pool.published}</div>
              <div className="label">Published</div>
            </div>
            <div className="stat">
              <div className="num">{data.pool.archived}</div>
              <div className="label">Archived</div>
            </div>
            <div className="stat">
              <div className="num">{data.pool.failed}</div>
              <div className="label">Failed</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <h2>Controls</h2>
            <div className="btn-row">
              <button
                className="btn"
                disabled={busy !== null}
                onClick={() => action("sync", "/api/actions/sync")}
              >
                {busy === "sync" ? "Syncing…" : "Sync now"}
              </button>
              <button
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => action("publish", "/api/actions/publish-now")}
              >
                {busy === "publish" ? "Publishing…" : "Publish now"}
              </button>
              {data.config.paused ? (
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => action("resume", "/api/actions/resume")}
                >
                  {busy === "resume" ? "Resuming…" : "Resume"}
                </button>
              ) : (
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => action("pause", "/api/actions/pause")}
                >
                  {busy === "pause" ? "Pausing…" : "Pause"}
                </button>
              )}
            </div>
            <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
              Next scheduled run: <strong>{fmtDateTime(data.nextRunIso)}</strong>{" "}
              · {data.config.cadence} · {data.config.postsPerRun} per run ·{" "}
              {data.config.timezone}
            </p>
          </div>

          <div className="card">
            <h2>Token health</h2>
            <div className="grid grid-3">
              <div>
                <div className="label">Microsoft To Do</div>
                <div>
                  {data.tokens.msConnected ? (
                    <span className="badge badge-published">connected</span>
                  ) : (
                    <span className="badge badge-failed">not connected</span>
                  )}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Refreshed {fmtAgeHrs(data.tokens.msTokenAgeHrs)}
                </div>
              </div>
              <div>
                <div className="label">Threads</div>
                <div>
                  {data.tokens.threadsConnected ? (
                    <span className="badge badge-published">connected</span>
                  ) : (
                    <span className="badge badge-failed">not connected</span>
                  )}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Obtained {fmtAgeHrs(data.tokens.threadsTokenAgeHrs)}
                </div>
              </div>
              <div>
                <div className="label">Threads expiry</div>
                <div className="num" style={{ fontSize: 20 }}>
                  {data.tokens.threadsDaysToExpiry == null
                    ? "—"
                    : `${Math.max(
                        0,
                        Math.round(data.tokens.threadsDaysToExpiry)
                      )}d`}
                </div>
                <div className="muted">days to expiry</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Recent posts</h2>
            {data.recentPosts.length === 0 ? (
              <p className="muted">No posts yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Published</th>
                    <th>Status</th>
                    <th>Text</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPosts.map((p) => (
                    <tr key={p.id}>
                      <td className="muted">{fmtDateTime(p.publishedAt)}</td>
                      <td>
                        <span
                          className={`badge badge-${
                            p.status === "success" ? "published" : "failed"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td>
                        <span className="literary">{p.text}</span>
                        {p.segments && p.segments.length > 1 && (
                          <span className="dim">
                            {" "}
                            ({p.segments.length} posts)
                          </span>
                        )}
                        {p.error && (
                          <div className="dim mono">{p.error}</div>
                        )}
                      </td>
                      <td>
                        {p.permalink ? (
                          <a
                            href={p.permalink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            view
                          </a>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
