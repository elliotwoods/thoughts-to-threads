# Thoughts → Threads — Implementation Spec

A single-user service that pulls "thoughts" from a Microsoft To Do list and auto-publishes one per day to Threads, selecting randomly and never repeating until the pool is exhausted. Includes a gated web dashboard.

> This document is written to be implemented by a coding agent (e.g. Claude Code) section by section. Sections 3–7 are the contract; section 11 is the build order. Anything marked **DECISION** is a config default you can change.

---

## 0. Scope

**In scope**
- One-way sync: Microsoft To Do list → internal store.
- Scheduled publish (default daily) of one randomly chosen, not-yet-published thought to Threads.
- Persistent "no repeat" state with explicit exhaustion behaviour.
- Web dashboard: status, history, manual sync/publish, pause/resume, settings, OAuth connect.
- Robust token lifecycle for both providers (the part that breaks unattended crons).

**Out of scope (for now)**
- Images/carousels/replies on Threads (text only).
- Multi-user / multi-account.
- Editing thought text in-app (To Do is the source of truth; UI is read + control only).

---

## 1. Architecture overview

```
Vercel Cron ──(daily GET)──▶ Next.js app on Vercel ◀──(dashboard)── Browser (Cloudflare Access)
                                   │      │   │
              Microsoft Graph ◀────┘      │   └────▶ Threads Graph API
                 (To Do)                  ▼
                                      Firestore
                          (thoughts · post log · config · encrypted tokens)
```

One Next.js deployment is the only compute. It hosts the dashboard, the API routes it calls, the OAuth callbacks, and the `/api/cron/tick` handler the scheduler hits. Firestore is the only datastore. Microsoft and Threads are reached over their respective Graph APIs. **No logic runs in Firebase Cloud Functions** — the Spark plan blocks outbound calls to non-Google hosts, so Firebase is storage only.

---

## 2. Tech stack & rationale

| Concern | Choice | Why |
|---|---|---|
| App + API + OAuth + cron handler | Next.js (App Router) on Vercel | One repo, one deploy; serverless route handlers cover everything |
| Scheduler | Vercel Cron → `GET /api/cron/tick` | Fewest moving parts. Daily is within Hobby limits. **Alt:** a Cloudflare Worker Cron Trigger calling the same route if you want sub-daily cadence or a randomised post time |
| Datastore | Firestore (Firebase Spark) | Free, generous, fine for a small pool; server access via Admin SDK |
| Server ↔ Firestore | Firebase Admin SDK (service account) | Server is authoritative; all writes go through it |
| Dashboard auth | Cloudflare Access in front of the deployment | Single-user gate, zero app code, DNS likely already on Cloudflare. **Alt:** Firebase Auth (Google) + email allowlist |
| Live dashboard updates | Polling `GET /api/status` (default), or Ably push | Polling is plenty for a daily job. Ably optional for instant "just posted" toasts |
| Token encryption | AES-256-GCM, key in env | Tokens rotate; never store them in plain env vars |

---

## 3. Prerequisites (accounts & app registrations)

### 3.1 Microsoft Entra app registration
This is the trickiest dependency: **personal To Do data is delegated-only.** There is no app-only/daemon path — you consent once interactively and live on a rotating refresh token.

1. Azure Portal → App registrations → New registration.
2. Supported account types: **Personal Microsoft accounts** (or *Accounts in any org directory and personal Microsoft accounts* if you might use a work account). This sets `signInAudience` accordingly.
3. Add a **Web** redirect URI: `{APP_BASE_URL}/api/auth/microsoft/callback`.
4. Certificates & secrets → New client secret. Record it (`MS_CLIENT_SECRET`).
5. API permissions → Microsoft Graph → **Delegated** → add `Tasks.ReadWrite` and `offline_access`. (User consent is sufficient; no admin consent needed for personal data.)
6. Record Application (client) ID → `MS_CLIENT_ID`.
7. Tenant segment for auth/token URLs: `consumers` for personal-only, `common` for both. → `MS_TENANT`.

### 3.2 Meta / Threads app
1. Meta Developers → Create App → add the **Threads** use-case/product.
2. Add OAuth redirect URI: `{APP_BASE_URL}/api/auth/threads/callback`.
3. Scopes: `threads_basic`, `threads_content_publish`.
4. Record App ID / App Secret → `THREADS_APP_ID`, `THREADS_APP_SECRET`.
5. **App Review note:** posting to *your own* Threads account works in development mode without full review. Going beyond your own account requires Meta App Review — not needed for this single-user tool, but be aware if scope ever expands.

### 3.3 Firebase
1. Create a Firebase project on the **Spark** plan (or attach to existing).
2. Enable **Firestore** (Native mode).
3. Project settings → Service accounts → generate a private key. Use it for the Admin SDK env vars (3 fields below).
4. (Only if you choose the Firebase Auth dashboard variant) enable Google sign-in and write security rules locking docs to your UID.

### 3.4 Cloudflare Access
1. Cloudflare Zero Trust → Access → Applications → add a self-hosted app for the deployment's hostname.
2. Policy: allow only your email. (Optionally verify the `Cf-Access-Jwt-Assertion` header server-side in middleware for defence in depth.)

---

## 4. Environment variables

```
# App
APP_BASE_URL=                 # https://your-app.example.com
CRON_SECRET=                  # random; Vercel sends it as Authorization: Bearer on cron calls
ENCRYPTION_KEY=               # base64-encoded 32 random bytes (AES-256-GCM)

# Microsoft
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT=consumers           # or "common"
MS_REDIRECT_URI=              # {APP_BASE_URL}/api/auth/microsoft/callback

# Threads
THREADS_APP_ID=
THREADS_APP_SECRET=
THREADS_REDIRECT_URI=         # {APP_BASE_URL}/api/auth/threads/callback

# Firebase Admin
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=         # keep the \n escaping; unescape at runtime

# Optional
ABLY_API_KEY=                 # only if using Ably push
NOTIFY_WEBHOOK_URL=           # where re-auth / failure alerts POST to (e.g. a Slack/Discord webhook)
```

---

## 5. Data model (Firestore)

### `thoughts/{graphTaskId}`
Keyed by the Graph task `id` so sync is idempotent.

| Field | Type | Notes |
|---|---|---|
| `text` | string | Task title (+ optional body), normalised, ≤500 chars enforced at publish |
| `status` | string | `unpublished` \| `published` \| `failed` \| `archived` |
| `createdAt` | timestamp | From `createdDateTime` |
| `syncedAt` | timestamp | Last time sync saw it |
| `publishedAt` | timestamp\|null | |
| `threadsPostId` | string\|null | Returned media id |
| `permalink` | string\|null | Fetched after publish |
| `attempts` | number | Publish attempts |
| `lastError` | string\|null | |
| `listId` | string | Source To Do list id |
| `skip` | bool | UI: exclude from selection |
| `pin` | bool | UI: force next |
| `lock` | timestamp\|null | Idempotency lock (see §7.7) |

### `posts/{autoId}`
Append-only audit log.

| Field | Type |
|---|---|
| `thoughtId` | string |
| `text` | string |
| `threadsPostId` | string |
| `permalink` | string |
| `publishedAt` | timestamp |
| `status` | string (`success` \| `failed`) |

### `config/app` (singleton)

| Field | Type | Default |
|---|---|---|
| `sourceListId` | string | (set in UI) |
| `cadence` | string | `daily` |
| `postsPerRun` | number | `1` |
| `onExhaustion` | string | `stop` (\| `reshuffle`) |
| `writeBackComplete` | bool | `false` |
| `paused` | bool | `false` |
| `timezone` | string | `Asia/Seoul` |
| `postTimeJitter` | bool | `false` |

### `secrets/tokens` (singleton, encrypted fields)

| Field | Type | Notes |
|---|---|---|
| `msRefreshToken` | string (enc) | Rotated on every refresh |
| `msTokenUpdatedAt` | timestamp | |
| `threadsToken` | string (enc) | Long-lived (60d) |
| `threadsTokenObtainedAt` | timestamp | Drives refresh timing |
| `threadsUserId` | string | |
| `msNeedsReauth` | bool | Set on refresh failure |
| `threadsNeedsReauth` | bool | Set on refresh failure |

**Indexes:** none beyond defaults. Selection fetches all `status == unpublished` docs and picks in code (the pool is small), so no composite index on a random key is required.

---

## 6. Security model

- **Dashboard gate:** Cloudflare Access (allowlist your email). Optionally validate `Cf-Access-Jwt-Assertion` in Next.js middleware.
- **Cron endpoint:** `GET /api/cron/tick` rejects any request whose `Authorization` header isn't `Bearer ${CRON_SECRET}`. Vercel attaches this automatically when `CRON_SECRET` is set.
- **Token at rest:** encrypt `msRefreshToken` and `threadsToken` with AES-256-GCM before writing; decrypt only in memory when needed. Store `iv:authTag:ciphertext`.
- **OAuth callbacks:** use a signed `state` param to prevent CSRF on the connect flows.
- **No secrets to the client:** the browser never receives raw tokens; all provider calls happen server-side.

Encryption helper (Node `crypto`):
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
const key = Buffer.from(process.env.ENCRYPTION_KEY!, "base64"); // 32 bytes

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}
export function decrypt(blob: string) {
  const [iv, tag, ct] = blob.split(":").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
```

---

## 7. Core flows

### 7.1 Microsoft OAuth + token refresh

**Authorize (connect):** redirect to
```
https://login.microsoftonline.com/{MS_TENANT}/oauth2/v2.0/authorize
  ?client_id={MS_CLIENT_ID}
  &response_type=code
  &redirect_uri={MS_REDIRECT_URI}
  &response_mode=query
  &scope=offline_access Tasks.ReadWrite
  &state={signedState}
```

**Callback → exchange code:** `POST https://login.microsoftonline.com/{MS_TENANT}/oauth2/v2.0/token`
(`application/x-www-form-urlencoded`)
```
client_id, client_secret, grant_type=authorization_code,
code, redirect_uri, scope=offline_access Tasks.ReadWrite
```
Store the returned `refresh_token` (encrypted). Access token (~1h) is used immediately and not persisted.

**Refresh (every tick):** same token endpoint with
```
grant_type=refresh_token, refresh_token, client_id, client_secret,
scope=offline_access Tasks.ReadWrite
```
The response contains a **new** `refresh_token` — persist it (rotation). On any 4xx, set `msNeedsReauth=true`, alert, and abort the tick.

### 7.2 Threads OAuth + token refresh

**Authorize (connect):** redirect to
```
https://threads.net/oauth/authorize
  ?client_id={THREADS_APP_ID}
  &redirect_uri={THREADS_REDIRECT_URI}
  &scope=threads_basic,threads_content_publish
  &response_type=code
  &state={signedState}
```

**Callback → short-lived token:** `POST https://graph.threads.net/oauth/access_token`
```
client_id, client_secret, grant_type=authorization_code, redirect_uri, code
```
Returns a short-lived token (1h) + `user_id`.

**Exchange for long-lived (60d):** `GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret={THREADS_APP_SECRET}&access_token={shortLived}`
Store the long-lived token (encrypted), `threadsTokenObtainedAt`, `threadsUserId`.

**Refresh:** `GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token={longLived}`
- Only valid once the token is **≥24h old**; resets to 60 days. `threads_basic` is sufficient.
- In the tick, refresh if `now - threadsTokenObtainedAt > 24h` (e.g. effectively weekly). **Never let an outage cross 60 days** or you must reconnect. On failure: set `threadsNeedsReauth=true`, alert, abort.

### 7.3 Sync from To Do

```
GET https://graph.microsoft.com/v1.0/me/todo/lists/{sourceListId}/tasks
    ?$select=id,title,status,body,createdDateTime,lastModifiedDateTime
    &$top=100
```
- Follow `@odata.nextLink` for pagination.
- Upsert each task into `thoughts/{id}`: if new → `status=unpublished`; always update `text`, `syncedAt`.
- Tasks already `completed` in To Do at first sight → import as `archived` (don't publish historical/done items). **DECISION**: or import as `unpublished` if you want everything eligible.
- Tasks present before but absent now → mark `archived` (don't delete; preserve history).
- (List discovery for the settings UI: `GET https://graph.microsoft.com/v1.0/me/todo/lists`.)

### 7.4 Selection (random, no-repeat)

```ts
const pool = await getThoughts({ status: "unpublished", skip: false });
const pinned = pool.find(t => t.pin);
if (pinned) return pinned;
if (pool.length === 0) return handleExhaustion(); // see below
return pool[Math.floor(Math.random() * pool.length)];
```
`handleExhaustion()`:
- `onExhaustion === "stop"` → alert "pool empty", post nothing, return null.
- `onExhaustion === "reshuffle"` → batch-update all `published` → `unpublished` (skip `archived`), then re-select. Optionally log a cycle marker.

### 7.5 Publish to Threads

Enforce `text.length <= 500` (truncate or skip — **DECISION**; be careful with emoji byte counts).

**Option A — one-step (text only):**
```
POST https://graph.threads.net/{userId}/threads
  media_type=TEXT, text={text}, auto_publish_text=true, access_token={token}
```

**Option B — two-step (default; explicit and future-proof for media):**
```
POST https://graph.threads.net/{userId}/threads
  media_type=TEXT, text={text}, access_token={token}      -> { id: creationId }

POST https://graph.threads.net/{userId}/threads_publish
  creation_id={creationId}, access_token={token}          -> { id: mediaId }
```

**Fetch permalink:** `GET https://graph.threads.net/{mediaId}?fields=permalink&access_token={token}`

**Rate limits:** ceiling is 250 posts / rolling 24h — you won't approach it, but on HTTP 429 leave the thought `unpublished`, increment `attempts`, and skip the run. Optional pre-check: `GET https://graph.threads.net/{userId}/threads_publishing_limit`.

> If using two-step, persist `creationId` on the thought between the two calls so a retry can publish the existing container instead of creating a duplicate.

### 7.6 The scheduled tick (orchestration)

`GET /api/cron/tick`:
```
1. Verify Authorization: Bearer CRON_SECRET. Else 401.
2. Load config/app. If paused → 200 {skipped:"paused"}.
3. If msNeedsReauth or threadsNeedsReauth → 200 {skipped:"reauth"} (alert already sent).
4. Refresh Microsoft token (§7.1). On failure → set flag, alert, return.
5. If threads token >24h old → refresh (§7.2). On failure → set flag, alert, return.
6. Sync from To Do (§7.3).
7. Repeat postsPerRun times:
     a. Select a thought (§7.4). If null (exhausted+stop) → break.
     b. Acquire lock (§7.7). If already locked/published → skip.
     c. Publish (§7.5).
     d. On success: set status=published, threadsPostId, permalink, publishedAt;
        append posts/{}. If writeBackComplete → PATCH To Do task to completed.
        Emit Ably event (optional).
     e. On failure: status stays unpublished (or failed after N attempts), record lastError,
        release lock.
8. Return 200 with a summary.
```

To Do write-back (optional): `PATCH https://graph.microsoft.com/v1.0/me/todo/lists/{listId}/tasks/{taskId}` body `{"status":"completed"}`.

### 7.7 Idempotency & locking

The container→publish split plus cron retries is the classic double-post footgun.

- Before publishing, set `thoughts/{id}.lock = now` inside a Firestore transaction that also asserts `status == unpublished` and `lock` is null or older than a TTL (e.g. 10 min). If the assertion fails, another run owns it — skip.
- After a confirmed publish, set `status = published` (terminal). A retry then can't re-select it.
- Treat `posts` as the source of truth for "did this go out" — before publishing, you may also check there's no existing `posts` row for `thoughtId`.

---

## 8. HTTP routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/auth/microsoft/start` | gate | Redirect to MS authorize |
| GET | `/api/auth/microsoft/callback` | gate | Exchange code, store MS refresh token |
| GET | `/api/auth/threads/start` | gate | Redirect to Threads authorize |
| GET | `/api/auth/threads/callback` | gate | Code → short → long-lived, store |
| GET | `/api/cron/tick` | CRON_SECRET | The scheduled job (§7.6) |
| GET | `/api/status` | gate | Dashboard data: pool stats, recent posts, token health, next run |
| POST | `/api/actions/sync` | gate | Manual sync now |
| POST | `/api/actions/publish-now` | gate | Run one publish cycle now |
| POST | `/api/actions/pause` | gate | Set `paused=true` |
| POST | `/api/actions/resume` | gate | Set `paused=false` |
| PUT | `/api/config` | gate | Update settings |
| POST | `/api/thoughts/[id]/skip` | gate | Toggle `skip` |
| POST | `/api/thoughts/[id]/pin` | gate | Toggle `pin` |

`vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/tick", "schedule": "0 0 * * *" }
  ]
}
```
Schedule is **UTC**. `0 0 * * *` = 09:00 KST. Adjust for your preferred Seoul time.

---

## 9. Web UI

App Router pages, all behind the Cloudflare Access gate; data via `GET /api/status` (poll every ~10s) or Ably subscription.

- **`/` Dashboard** — pool counts (X unpublished / Y published / Z archived), next scheduled run, recent posts with permalinks, **token health** (MS refresh age, Threads token age + days-to-expiry, re-auth banners), and buttons: Sync now, Publish now, Pause/Resume.
- **`/thoughts`** — table of synced thoughts with status; per-row Skip / Pin (force next).
- **`/settings`** — source list picker (from `/me/todo/lists`), cadence, posts per run, exhaustion behaviour, write-back toggle, timezone, jitter.
- **`/connections`** — Microsoft and Threads connect/reconnect buttons + connection status.

---

## 10. Error handling & edge cases

| Case | Behaviour |
|---|---|
| Pool exhausted | `stop` → alert + no post; `reshuffle` → reset published→unpublished and continue |
| Token refresh fails | Set `*NeedsReauth`, POST alert to `NOTIFY_WEBHOOK_URL`, dashboard banner, block publishing until reconnected |
| Threads 429 / over limit | Leave thought unpublished, increment attempts, skip run |
| Container created, publish failed | Reuse stored `creationId` on retry; mark `failed` after N attempts |
| Duplicate cron / retry | Transactional lock + terminal `published` status prevent double-post |
| Re-synced task | Idempotent upsert by task id (no duplicates) |
| Empty / over-length text | Truncate to 500 or skip (DECISION); never send empty |
| Timezone | Cron is UTC; compute Seoul time. For randomised post *time*, jitter with a delay in-tick or run cron N×/day and post probabilistically |
| MS refresh token expired (long outage) | Surface "reconnect Microsoft" prominently; this is the most likely long-term failure |

---

## 11. Implementation phases

Each phase ends in something runnable and testable.

1. **Skeleton.** Next.js + Firebase Admin init + env loading + Cloudflare Access. `GET /api/status` returns stub data. Deploy and confirm the gate works.
2. **Microsoft connect + sync.** OAuth start/callback, encrypted token storage, `POST /api/actions/sync`, list picker. `/thoughts` shows real tasks. *Test: tasks appear and re-sync is idempotent.*
3. **Threads connect + manual publish.** OAuth + long-lived exchange, selection (§7.4), publish (§7.5), state update, locking (§7.7). `POST /api/actions/publish-now`. *Test: one real post goes out, status flips, no double-post on repeat click.*
4. **Token refresh + cron.** Refresh logic for both providers, the full tick orchestration (§7.6), `vercel.json` cron, re-auth flags + alerting. *Test: tick runs end-to-end on schedule; token ages update.*
5. **Polish.** Dashboard token-health + banners, pause/resume, exhaustion handling, write-back toggle, settings persistence, optional Ably push. *Test: pause stops posting; exhaustion behaves per config.*

---

## 12. Open decisions / defaults

- **Completed-in-To-Do on import:** archive (default) vs treat as eligible.
- **Exhaustion:** `stop` (default) vs `reshuffle`.
- **Over-length text:** truncate to 500 (default) vs skip and flag.
- **Live updates:** polling (default) vs Ably push vs Firebase-Auth + client Firestore listeners.
- **Dashboard auth:** Cloudflare Access (default) vs Firebase Auth.
- **Post time randomisation:** off (default) vs in-tick jitter vs probabilistic multi-run.

---

## Appendix A: External API quick reference

**Microsoft Graph (To Do) — delegated only for personal accounts**
- Lists: `GET /v1.0/me/todo/lists`
- Tasks: `GET /v1.0/me/todo/lists/{listId}/tasks` (paginate via `@odata.nextLink`)
- Complete: `PATCH /v1.0/me/todo/lists/{listId}/tasks/{taskId}` `{"status":"completed"}`
- Auth: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/{authorize|token}`
- Scopes: `offline_access Tasks.ReadWrite`
- Access token ~1h; refresh token rotates on use and expires if unused.

**Threads Graph API**
- Base: `https://graph.threads.net`
- Create container: `POST /{userId}/threads` (`media_type=TEXT`, `text`, optional `auto_publish_text=true`)
- Publish: `POST /{userId}/threads_publish` (`creation_id`)
- Permalink: `GET /{mediaId}?fields=permalink`
- Quota check: `GET /{userId}/threads_publishing_limit`
- Token exchange: `GET /access_token?grant_type=th_exchange_token`
- Token refresh: `GET /refresh_access_token?grant_type=th_refresh_token` (token must be ≥24h old)
- Limits: text ≤500 chars; ≤250 posts / rolling 24h; long-lived token = 60 days, refresh within the window or reconnect.