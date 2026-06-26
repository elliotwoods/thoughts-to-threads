// Server-only Microsoft Graph (To Do) integration. Delegated-only access for
// personal accounts: consent once interactively, then live on a rotating
// refresh token. NEVER constructs clients at module top level.

import { msConfig } from "./env";
import {
  getConfig,
  getTokenState,
  updateTokenState,
  setThoughtFromTask,
  markArchivedExcept,
  getThought,
} from "./firestore";
import { stripHtml } from "./post";
import { notify } from "./notify";

const AUTHORITY = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPE = "offline_access Tasks.ReadWrite";

function authorityBase(): string {
  const { tenant } = msConfig();
  return `${AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0`;
}

/** Build the Microsoft consent URL (§7.1). The redirect URI is supplied by the
 * caller (derived from the request) so it matches the callback exactly. */
export function authorizeUrl(state: string, redirectUri: string): string {
  const { clientId } = msConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPE,
    state,
  });
  return `${authorityBase()}/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${authorityBase()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  let json: TokenResponse;
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    json = {};
  }
  if (!res.ok) {
    const msg =
      json.error_description ||
      json.error ||
      `Microsoft token endpoint ${res.status}`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Exchange an authorization code for a refresh token (callback flow). The
 * redirect URI must match the one used to obtain the code. */
export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<{ refreshToken: string }> {
  const { clientId, clientSecret } = msConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: SCOPE,
  });
  const json = await postToken(body);
  if (!json.refresh_token) {
    throw new Error("Microsoft token response missing refresh_token");
  }
  return { refreshToken: json.refresh_token };
}

/**
 * Refresh the access token using the stored, rotating refresh token. Persists
 * the new refresh_token and msTokenUpdatedAt, clears msNeedsReauth. On any 4xx
 * sets msNeedsReauth, notifies, and throws.
 */
export async function refreshAccessToken(): Promise<string> {
  const { clientId, clientSecret } = msConfig();
  const tokens = await getTokenState();
  if (!tokens.msRefreshToken) {
    await updateTokenState({ msNeedsReauth: true });
    await notify("Microsoft: no refresh token stored; reconnect required.");
    throw new Error("Microsoft refresh token missing; reconnect required");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokens.msRefreshToken,
    scope: SCOPE,
  });

  let json: TokenResponse;
  try {
    json = await postToken(body);
  } catch (e) {
    const status = (e as { status?: number }).status;
    // Only a client error (4xx) means the refresh token is dead → reauth.
    if (status != null && status >= 400 && status < 500) {
      await updateTokenState({ msNeedsReauth: true });
      await notify("Microsoft token refresh failed; reconnect required.", {
        status,
        error: (e as Error).message,
      });
    }
    throw e;
  }

  if (!json.access_token) {
    throw new Error("Microsoft token refresh missing access_token");
  }

  // Persist the rotated refresh token (rotation) and clear the reauth flag.
  const patch: Parameters<typeof updateTokenState>[0] = {
    msTokenUpdatedAt: new Date().toISOString(),
    msNeedsReauth: false,
  };
  if (json.refresh_token) {
    patch.msRefreshToken = json.refresh_token;
  }
  await updateTokenState(patch);

  return json.access_token;
}

// --- Graph helpers -------------------------------------------------------

async function graphGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `Microsoft Graph GET ${res.status}: ${text.slice(0, 300)}`
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

interface TodoList {
  id: string;
  displayName: string;
}

interface GraphCollection<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

/** List the user's To Do lists for the settings picker. */
export async function listTodoLists(
  accessToken: string
): Promise<{ id: string; displayName: string }[]> {
  const out: { id: string; displayName: string }[] = [];
  let url: string | undefined = `${GRAPH}/me/todo/lists?$top=100`;
  while (url) {
    const page: GraphCollection<TodoList> = await graphGet(url, accessToken);
    for (const l of page.value ?? []) {
      out.push({ id: l.id, displayName: l.displayName });
    }
    url = page["@odata.nextLink"];
  }
  return out;
}

interface TodoTask {
  id: string;
  title?: string;
  status?: string;
  body?: { content?: string; contentType?: string } | null;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

/**
 * One-way sync of a To Do list into the thoughts store. Paginates via
 * @odata.nextLink, strips HTML from the note body, imports tasks already
 * completed-in-ToDo as `archived` (don't republish historical items), then
 * archives any previously-seen task absent from this list.
 */
export async function syncTasks(
  accessToken: string,
  listId: string
): Promise<{ added: number; updated: number; archived: number }> {
  const seenIds: string[] = [];
  let added = 0;
  let updated = 0;
  // Derive the year suffix in the user's configured timezone (read once).
  const { timezone } = await getConfig();

  // The personal/consumer To Do endpoint (Exchange RequestBroker) rejects a
  // multi-field $select with "RequestBroker--ParseUri" — only a single field or
  // no $select works. So we omit $select and read the full task objects (we only
  // need id/title/status/body/createdDateTime, all present anyway). The list ID
  // is opaque base64 placed in the path verbatim.
  let url: string | undefined =
    `${GRAPH}/me/todo/lists/${listId}/tasks?$top=100`;

  while (url) {
    const page: GraphCollection<TodoTask> = await graphGet(url, accessToken);
    for (const task of page.value ?? []) {
      seenIds.push(task.id);
      const note = stripHtml(task.body?.content);
      // Completed-in-ToDo tasks are imported as archived on first sight so we
      // never publish historical/done items.
      const importStatus =
        task.status === "completed" ? "archived" : "unpublished";

      // Detect add vs update for accurate counts without an extra read per task.
      const wasNew = await upsertAndDetectNew({
        id: task.id,
        title: task.title ?? "",
        note: note.length > 0 ? note : null,
        createdAt: task.createdDateTime ?? null,
        listId,
        importStatus,
        timezone,
      });
      if (wasNew) added++;
      else updated++;
    }
    url = page["@odata.nextLink"];
  }

  const archived = await markArchivedExcept(listId, seenIds);
  return { added, updated, archived };
}

/**
 * Upsert a task and report whether it was newly created. setThoughtFromTask is
 * an idempotent upsert; we read first only to distinguish added vs updated for
 * the sync summary counts.
 */
async function upsertAndDetectNew(
  input: Parameters<typeof setThoughtFromTask>[0]
): Promise<boolean> {
  const existing = await getThought(input.id);
  await setThoughtFromTask(input);
  return existing == null;
}

/** Write-back: mark a To Do task completed (optional, per config). */
export async function completeTask(
  accessToken: string,
  listId: string,
  taskId: string
): Promise<void> {
  // Opaque base64 list/task IDs go in the path verbatim.
  const url = `${GRAPH}/me/todo/lists/${listId}/tasks/${taskId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ status: "completed" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Microsoft Graph PATCH (complete) ${res.status}: ${text.slice(0, 300)}`
    );
  }
}
