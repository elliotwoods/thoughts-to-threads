// PUT /api/config — update app settings. Only known config keys are accepted;
// values are lightly validated/coerced before persisting.

import { NextResponse } from "next/server";
import { updateConfig } from "@/lib/firestore";
import type { AppConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
    }
    const b = body as Record<string, unknown>;
    const patch: Partial<AppConfig> = {};

    if ("sourceListId" in b) {
      patch.sourceListId =
        b.sourceListId == null ? null : String(b.sourceListId);
    }
    if ("cadence" in b && b.cadence === "daily") {
      patch.cadence = "daily";
    }
    if ("postsPerRun" in b) {
      const n = Number(b.postsPerRun);
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json(
          { error: "postsPerRun must be a number >= 1" },
          { status: 400 }
        );
      }
      patch.postsPerRun = Math.floor(n);
    }
    if ("onExhaustion" in b) {
      if (b.onExhaustion !== "stop" && b.onExhaustion !== "reshuffle") {
        return NextResponse.json(
          { error: "onExhaustion must be 'stop' or 'reshuffle'" },
          { status: 400 }
        );
      }
      patch.onExhaustion = b.onExhaustion;
    }
    if ("writeBackComplete" in b) {
      patch.writeBackComplete = Boolean(b.writeBackComplete);
    }
    if ("paused" in b) {
      patch.paused = Boolean(b.paused);
    }
    if ("timezone" in b && typeof b.timezone === "string" && b.timezone.trim()) {
      patch.timezone = b.timezone;
    }
    if ("postTimeJitter" in b) {
      patch.postTimeJitter = Boolean(b.postTimeJitter);
    }

    const config = await updateConfig(patch);
    return NextResponse.json({ config });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
