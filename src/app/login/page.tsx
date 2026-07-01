"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "This Google account is not authorised to access this app.",
  auth_failed: "Sign-in failed. Please try again.",
  oauth_error: "Google sign-in was cancelled.",
  invalid_state: "Session expired. Please try again.",
  missing_code: "Sign-in failed. Please try again.",
};

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");
  const errorMsg = error ? (ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again.") : null;

  return (
    <div>
      <h1>Sign in</h1>
      <p className="page-sub">Thoughts to Threads is a private app.</p>
      {errorMsg && <div className="banner banner-error">{errorMsg}</div>}
      <a href="/api/auth/google/start" className="btn btn-primary">
        Sign in with Google
      </a>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
