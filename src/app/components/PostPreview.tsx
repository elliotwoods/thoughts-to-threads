"use client";

// PostPreview — the heart of requirement 4. Renders a string[] of published
// segments as numbered, phone-like thread bubbles (1..N), each showing its text
// and a length/500 counter. The final bubble carries the year suffix and is
// highlighted. Segments are computed server-side via the shared pure
// buildPreview() so this preview is byte-for-byte what will be published.

import { THREADS_MAX } from "@/lib/post";

export default function PostPreview({ segments }: { segments: string[] }) {
  if (!segments || segments.length === 0) {
    return (
      <p className="preview-empty">
        Nothing to publish — this thought composes to empty content.
      </p>
    );
  }

  const total = segments.length;

  return (
    <div className="thread-preview" aria-label="Post preview">
      {segments.map((seg, i) => {
        const len = seg.length;
        const over = len > THREADS_MAX;
        const isLast = i === total - 1;
        return (
          <div
            key={i}
            className="post-bubble"
            style={
              isLast && total > 1
                ? { borderColor: "var(--accent)" }
                : undefined
            }
          >
            <div className="post-bubble-head">
              <span className="post-bubble-index">{i + 1}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {total > 1 ? `Post ${i + 1} of ${total}` : "Single post"}
                {isLast && total > 1 ? " · year suffix here" : ""}
              </span>
              <span className={`post-bubble-count${over ? " over" : ""}`}>
                {len}/{THREADS_MAX}
              </span>
            </div>
            <div className="post-bubble-text">{seg}</div>
          </div>
        );
      })}
    </div>
  );
}
