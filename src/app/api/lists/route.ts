// GET /api/lists — the To Do lists for the settings source-list picker.
// Refreshes the Microsoft access token first, then queries /me/todo/lists.

import { NextResponse } from "next/server";
import { listTodoLists, refreshAccessToken } from "@/lib/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const accessToken = await refreshAccessToken();
    const lists = await listTodoLists(accessToken);
    return NextResponse.json({ lists });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
