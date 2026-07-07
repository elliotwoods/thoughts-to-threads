"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppConfig } from "@/lib/types";
import { WEEKDAYS, formatScheduleDays } from "@/lib/schedule";

interface TodoList {
  id: string;
  displayName: string;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [lists, setLists] = useState<TodoList[]>([]);
  const [listsError, setListsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setConfig(data.config as AppConfig);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLists = useCallback(async () => {
    try {
      const res = await fetch("/api/lists", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setLists(Array.isArray(data.lists) ? data.lists : []);
      setListsError(null);
    } catch (e) {
      setListsError(
        e instanceof Error
          ? e.message
          : "Could not load To Do lists (is Microsoft connected?)"
      );
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadLists();
  }, [loadConfig, loadLists]);

  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  };

  const toggleDay = (day: number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const cur = prev.scheduleDays ?? [];
      const next = cur.includes(day)
        ? cur.filter((d) => d !== day)
        : [...cur, day].sort((a, b) => a - b);
      return { ...prev, scheduleDays: next };
    });
    setSaved(false);
  };

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json().catch(() => null);
      if (data && data.config) setConfig(data.config as AppConfig);
      setError(null);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }, [config]);

  return (
    <div>
      <h1>Settings</h1>
      <p className="page-sub">
        Configure the source list and how thoughts are published.
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {saved && <div className="banner banner-ok">Settings saved.</div>}

      {loading || !config ? (
        <div className="card">
          <p className="muted">Loading settings…</p>
        </div>
      ) : (
        <div className="card">
          <div className="field">
            <label htmlFor="sourceListId">Source To Do list</label>
            {listsError ? (
              <div className="banner banner-warn" style={{ marginBottom: 0 }}>
                {listsError}
              </div>
            ) : (
              <select
                id="sourceListId"
                value={config.sourceListId ?? ""}
                onChange={(e) =>
                  update("sourceListId", e.target.value || null)
                }
              >
                <option value="">— Select a list —</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.displayName}
                  </option>
                ))}
                {config.sourceListId &&
                  !lists.some((l) => l.id === config.sourceListId) && (
                    <option value={config.sourceListId}>
                      {config.sourceListId} (current)
                    </option>
                  )}
              </select>
            )}
          </div>

          <div className="field">
            <label>Publishing schedule</label>
            <div className="daypicker" role="group" aria-label="Publishing days">
              {WEEKDAYS.map((w) => {
                const on = (config.scheduleDays ?? []).includes(w.value);
                return (
                  <button
                    type="button"
                    key={w.value}
                    className={`daypicker-day${on ? " on" : ""}`}
                    aria-pressed={on}
                    aria-label={w.long}
                    onClick={() => toggleDay(w.value)}
                  >
                    {w.short}
                  </button>
                );
              })}
            </div>
            {config.scheduleDays && config.scheduleDays.length > 0 ? (
              <p className="field-hint">
                Publishes at <strong>09:00 {config.timezone}</strong> on{" "}
                {formatScheduleDays(config.scheduleDays)}.
              </p>
            ) : (
              <p className="field-hint">
                No days selected — nothing will publish on schedule.
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="postsPerRun">Posts per run</label>
            <input
              id="postsPerRun"
              type="number"
              min={1}
              max={50}
              value={config.postsPerRun}
              onChange={(e) =>
                update(
                  "postsPerRun",
                  Math.max(1, parseInt(e.target.value, 10) || 1)
                )
              }
            />
          </div>

          <div className="field">
            <label htmlFor="queueSize">Up Next queue size</label>
            <input
              id="queueSize"
              type="number"
              min={1}
              max={50}
              value={config.queueSize}
              onChange={(e) =>
                update(
                  "queueSize",
                  Math.max(1, parseInt(e.target.value, 10) || 1)
                )
              }
            />
          </div>

          <div className="field">
            <label htmlFor="onExhaustion">On pool exhaustion</label>
            <select
              id="onExhaustion"
              value={config.onExhaustion}
              onChange={(e) =>
                update(
                  "onExhaustion",
                  e.target.value as AppConfig["onExhaustion"]
                )
              }
            >
              <option value="stop">Stop (alert, post nothing)</option>
              <option value="reshuffle">
                Reshuffle (reset published → unpublished)
              </option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="timezone">Timezone</label>
            <input
              id="timezone"
              type="text"
              value={config.timezone}
              onChange={(e) => update("timezone", e.target.value)}
              placeholder="Asia/Seoul"
            />
          </div>

          <div className="checkbox-field">
            <input
              id="writeBackComplete"
              type="checkbox"
              checked={config.writeBackComplete}
              onChange={(e) => update("writeBackComplete", e.target.checked)}
            />
            <label htmlFor="writeBackComplete">
              Mark the To&nbsp;Do task complete after publishing
            </label>
          </div>

          <div className="checkbox-field">
            <input
              id="postTimeJitter"
              type="checkbox"
              checked={config.postTimeJitter}
              onChange={(e) => update("postTimeJitter", e.target.checked)}
            />
            <label htmlFor="postTimeJitter">
              Randomise post time within the run (jitter)
            </label>
          </div>

          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
