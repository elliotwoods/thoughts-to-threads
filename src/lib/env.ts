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
export function appBaseUrl(): string {
  return env("APP_BASE_URL");
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
export interface MsConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
  redirectUri: string;
}
export function msConfig(): MsConfig {
  return {
    clientId: env("MS_CLIENT_ID"),
    clientSecret: env("MS_CLIENT_SECRET"),
    tenant: optionalEnv("MS_TENANT") ?? "consumers",
    redirectUri: env("MS_REDIRECT_URI"),
  };
}

// --- Threads ---
export interface ThreadsConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}
export function threadsConfig(): ThreadsConfig {
  return {
    appId: env("THREADS_APP_ID"),
    appSecret: env("THREADS_APP_SECRET"),
    redirectUri: env("THREADS_REDIRECT_URI"),
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
