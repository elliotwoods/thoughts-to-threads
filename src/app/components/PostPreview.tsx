"use client";

// PostPreview — the heart of requirement 4. Renders a string[] of published
// segments as manuscript placards (01..N): a marginal folio number, the text
// set in serif as it will read on Threads, and a caption with the post counter
// and its length/500. The final placard carries the year suffix. Segments are
// computed server-side via the shared pure buildPreview() so this preview is
// byte-for-byte what will be published.

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
          <div key={i} className="placard">
            <div className="placard-folio">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div>
              <div className="placard-text">{seg}</div>
              <div className="placard-caption">
                <span>{total > 1 ? `Post ${i + 1} of ${total}` : "Single post"}</span>
                {isLast && total > 1 && (
                  <>
                    <span className="sep">·</span>
                    <span>year suffix</span>
                  </>
                )}
                <span className="sep">·</span>
                <span className={`placard-count${over ? " over" : ""}`}>
                  {len} / {THREADS_MAX}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
