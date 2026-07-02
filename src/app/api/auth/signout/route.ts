import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { baseUrlFromRequest } from "@/lib/env";

export function POST(req: NextRequest) {
  const res = NextResponse.redirect(`${baseUrlFromRequest(req)}/login`, {
    status: 303,
  });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}
