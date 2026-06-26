// Lazy environment access. NEVER throw at import time: every read happens at
// call time so `next build` does not require runtime secrets.

/** Read a required env var. Throws only at call time if missing. */
export function env(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

/** Read an optional env var. */
export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

// --- App ---
/**
 * Absolute base URL for contexts WITHOUT an incoming request (cron, background
 * jobs, notifications). Precedence: explicit APP_BASE_URL, then the Vercel-
 * provided deployment URL, else throw. For request-handling code prefer
 * baseUrlFromRequest() so links/redirects track whatever host we were reached on.
 */
export function appBaseUrl(): string {
  const explicit = optionalEnv("APP_BASE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  // Vercel injects these automatically; *_PRODUCTION_URL is the stable prod
  // domain, VERCEL_URL is the per-deployment (incl. preview) host.
  const vercel =
    optionalEnv("VERCEL_PROJECT_PRODUCTION_URL") ?? optionalEnv("VERCEL_URL");
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  throw new Error(
    "Missing base URL: set APP_BASE_URL (or deploy on Vercel, which provides VERCEL_URL)"
  );
}

/** Take the first value from a possibly comma-listed forwarded header. */
function firstHeader(v: string | null): string | undefined {
  if (!v) return undefined;
  const first = v.split(",")[0]?.trim();
  return first || undefined;
}

/**
 * Derive the origin (scheme + host) the client actually reached us on, from the
 * request headers. Honours proxy headers (Vercel/most hosts set x-forwarded-*),
 * defaults to http only for loopback hosts, and falls back to appBaseUrl() if no
 * host header is present. This makes absolute URLs work on localhost, the Vercel
 * production domain, preview deployments, and custom domains without config.
 */
export function baseUrlFromRequest(req: { headers: Headers }): string {
  const host =
    firstHeader(req.headers.get("x-forwarded-host")) ??
    firstHeader(req.headers.get("host"));
  if (!host) return appBaseUrl();
  const proto =
    firstHeader(req.headers.get("x-forwarded-proto")) ??
    (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * The OAuth redirect URI for a provider. Auto-derived from the request host so
 * it matches between the /start and /callback hops (OAuth requires an exact
 * match) and works wherever we're hosted. An explicit MS_REDIRECT_URI /
 * THREADS_REDIRECT_URI env var, if set, overrides the derived value.
 */
export function callbackUrl(
  req: { headers: Headers },
  provider: "microsoft" | "threads"
): string {
  const override = optionalEnv(
    provider === "microsoft" ? "MS_REDIRECT_URI" : "THREADS_REDIRECT_URI"
  );
  if (override) return override;
  return `${baseUrlFromRequest(req)}/api/auth/${provider}/callback`;
}
export function cronSecret(): string {
  return env("CRON_SECRET");
}
export function encryptionKey(): string {
  return env("ENCRYPTION_KEY");
}
export function notifyWebhookUrl(): string | undefined {
  return optionalEnv("NOTIFY_WEBHOOK_URL");
}

// --- Microsoft ---
// Note: the redirect URI is no longer part of this config — it is derived per
// request via callbackUrl(req, "microsoft") so it tracks the current host.
export interface MsConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
}
export function msConfig(): MsConfig {
  return {
    clientId: env("MS_CLIENT_ID"),
    clientSecret: env("MS_CLIENT_SECRET"),
    tenant: optionalEnv("MS_TENANT") ?? "consumers",
  };
}

// --- Threads ---
// Redirect URI derived per request via callbackUrl(req, "threads").
export interface ThreadsConfig {
  appId: string;
  appSecret: string;
}
export function threadsConfig(): ThreadsConfig {
  return {
    appId: env("THREADS_APP_ID"),
    appSecret: env("THREADS_APP_SECRET"),
  };
}

// --- Firebase Admin ---
export interface FirebaseConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}
export function firebaseConfig(): FirebaseConfig {
  return {
    projectId: env("FIREBASE_PROJECT_ID"),
    clientEmail: env("FIREBASE_CLIENT_EMAIL"),
    // Unescape backslash-n at runtime (env vars keep \n escaped).
    privateKey: env("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  };
}
