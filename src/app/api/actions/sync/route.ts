// POST /api/actions/sync — manual sync now. Refreshes the Microsoft access
// token (rotating the refresh token) then pulls the configured To Do list into
// the thoughts store. Returns the add/update/archive counts.

import { NextResponse } from "next/server";
import { getConfig } from "@/lib/firestore";
import { refreshAccessToken, syncTasks } from "@/lib/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const config = await getConfig();
    if (!config.sourceListId) {
      return NextResponse.json(
        { error: "No source list configured. Set one in Settings first." },
        { status: 400 }
      );
    }
    const accessToken = await refreshAccessToken();
    const result = await syncTasks(accessToken, config.sourceListId);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
