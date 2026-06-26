"use client";

// Connections — connect / reconnect Microsoft To Do and Threads. The connect
// buttons are plain links to the server OAuth start routes (which sign state
// and redirect to the provider). Live connection status comes from /api/status.

import { useCallback, useEffect, useState } from "react";

interface TokenHealth {
  msTokenAgeHrs: number | null;
  threadsTokenAgeHrs: number | null;
  threadsDaysToExpiry: number | null;
  msNeedsReauth: boolean;
  threadsNeedsReauth: boolean;
  msConnected: boolean;
  threadsConnected: boolean;
}

function fmtAgeHrs(hrs: number | null): string {
  if (hrs == null) return "—";
  if (hrs < 1) return `${Math.round(hrs * 60)}m ago`;
  if (hrs < 48) return `${Math.round(hrs)}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function ConnectionsPage() {
  const [tokens, setTokens] = useState<TokenHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Status ${res.status}`);
      }
      const data = await res.json();
      setTokens(data.tokens);
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

  return (
    <div>
      <h1>Connections</h1>
      <p className="page-sub">
        Connect the Microsoft To Do source and the Threads publishing account.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="card">
        <h2>Microsoft To Do</h2>
        {tokens?.msNeedsReauth && (
          <div className="banner banner-error">
            Re-authentication required — the stored refresh token failed.
          </div>
        )}
        <p className="muted">
          Status:{" "}
          {tokens == null ? (
            "loading…"
          ) : tokens.msConnected && !tokens.msNeedsReauth ? (
            <span className="badge badge-published">connected</span>
          ) : (
            <span className="badge badge-failed">not connected</span>
          )}
          {tokens?.msConnected && (
            <>
              {" "}
              · token refreshed {fmtAgeHrs(tokens.msTokenAgeHrs)}
            </>
          )}
        </p>
        <div className="btn-row">
          <a className="btn btn-primary" href="/api/auth/microsoft/start">
            {tokens?.msConnected ? "Reconnect Microsoft" : "Connect Microsoft"}
          </a>
        </div>
        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
          Grants <span className="mono">Tasks.ReadWrite</span> and{" "}
          <span className="mono">offline_access</span> for the To Do list.
        </p>
      </div>

      <div className="card">
        <h2>Threads</h2>
        {tokens?.threadsNeedsReauth && (
          <div className="banner banner-error">
            Re-authentication required — the long-lived token failed to refresh.
          </div>
        )}
        <p className="muted">
          Status:{" "}
          {tokens == null ? (
            "loading…"
          ) : tokens.threadsConnected && !tokens.threadsNeedsReauth ? (
            <span className="badge badge-published">connected</span>
          ) : (
            <span className="badge badge-failed">not connected</span>
          )}
          {tokens?.threadsConnected && (
            <>
              {" "}
              · obtained {fmtAgeHrs(tokens.threadsTokenAgeHrs)}
              {tokens.threadsDaysToExpiry != null && (
                <>
                  {" "}
                  · {Math.max(0, Math.round(tokens.threadsDaysToExpiry))} days to
                  expiry
                </>
              )}
            </>
          )}
        </p>
        <div className="btn-row">
          <a className="btn btn-primary" href="/api/auth/threads/start">
            {tokens?.threadsConnected ? "Reconnect Threads" : "Connect Threads"}
          </a>
        </div>
        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
          Grants <span className="mono">threads_basic</span> and{" "}
          <span className="mono">threads_content_publish</span>. The long-lived
          token lasts 60 days and auto-refreshes.
        </p>
      </div>
    </div>
  );
}
