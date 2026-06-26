// Best-effort notifier. POSTs JSON to NOTIFY_WEBHOOK_URL if configured.
// Never throws — alerting must not break the tick.

import { notifyWebhookUrl } from "./env";

export async function notify(
  message: string,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    const url = notifyWebhookUrl();
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: message,
        message,
        timestamp: new Date().toISOString(),
        ...(extra ?? {}),
      }),
    });
  } catch {
    // Swallow all errors — notifications are best-effort.
  }
}
