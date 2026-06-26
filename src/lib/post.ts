// PURE, client-safe post composition. NO node imports here — this file powers
// both the live UI preview and the real publish path, so preview == reality.

export const THREADS_MAX = 500;

/**
 * Crude HTML strip: remove tags, decode common entities, collapse whitespace.
 * Accepts null/undefined and returns "".
 */
export function stripHtml(html: string | null | undefined): string {
  if (html == null) return "";
  let s = String(html);
  // Drop tags entirely (replace with space so words don't fuse).
  s = s.replace(/<[^>]*>/g, " ");
  // Decode a handful of common named entities.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    // Numeric entities (decimal + hex).
    .replace(/&#(\d+);/g, (_m, n: string) => safeCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) =>
      safeCodePoint(parseInt(n, 16))
    );
  // Collapse all whitespace runs to single spaces.
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

/**
 * Compose the full post text: the title, then a blank line, then the note —
 * but only when the note is non-empty after trimming.
 */
export function composeFullText(t: {
  title: string | null;
  note: string | null;
}): string {
  const title = (t.title ?? "").trim();
  const note = (t.note ?? "").trim();
  return note ? `${title}\n\n${note}` : title;
}

/** Year suffix: null year -> ""; otherwise a leading space + (YYYY). */
export function yearSuffix(year: number | null): string {
  return year == null ? "" : ` (${year})`;
}

/**
 * Split composed content into per-post segments, each <= THREADS_MAX including
 * the year suffix which is appended to the LAST segment only.
 *
 * - Trims content; empty content -> [].
 * - If content + suffix fits in one post, returns a single segment.
 * - Otherwise greedily packs, preferring paragraph, then sentence, then word
 *   breaks; hard-splits any single token longer than the limit.
 * - The final segment reserves room for the suffix (final + suffix <= max).
 * - Never emits an empty segment or a segment that is only the suffix.
 */
export function buildSegments(fullText: string, year: number | null): string[] {
  const content = (fullText ?? "").trim();
  const suffix = yearSuffix(year);
  const L = suffix.length;
  const max = THREADS_MAX;

  if (content.length === 0) return [];
  if (content.length + L <= max) return [content + suffix];

  const out: string[] = [];
  let rest = content;

  while (rest.length > 0) {
    rest = rest.replace(/^\s+/, "");
    if (rest.length === 0) break;

    // Final segment must leave room for the suffix.
    if (rest.length <= max - L) {
      out.push(rest);
      break;
    }

    // If the whole remainder would fit in `max` but not in `max - L`, force a
    // smaller cut so the suffix still has room on whatever ends up last.
    const limit = rest.length <= max ? max - L : max;
    let cut = findCut(rest, limit);
    if (cut < 1) cut = Math.min(limit, rest.length);
    cut = avoidSurrogateSplit(rest, cut);

    let chunk = rest.slice(0, cut).replace(/\s+$/, "");
    if (chunk.length === 0) {
      // Degenerate guard: hard cut.
      cut = avoidSurrogateSplit(rest, Math.min(limit, rest.length));
      chunk = rest.slice(0, cut);
    }
    out.push(chunk);
    rest = rest.slice(cut);
  }

  if (out.length === 0) return [];
  out[out.length - 1] = out[out.length - 1] + suffix;
  return out;
}

/**
 * If `cut` would land between the two halves of a UTF-16 surrogate pair (an
 * emoji / astral character), back up by one so we never slice a character in
 * half. Won't return 0 (accepts the rare split rather than emitting nothing).
 */
function avoidSurrogateSplit(text: string, cut: number): number {
  if (cut > 1 && cut < text.length) {
    const hi = text.charCodeAt(cut - 1);
    const lo = text.charCodeAt(cut);
    if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) {
      return cut - 1;
    }
  }
  return cut;
}

/**
 * Find the cut index in `text` (1..limit) where the chunk text.slice(0, cut)
 * should end. Prefers paragraph, then sentence, then whitespace breaks; falls
 * back to a hard split at `limit`.
 */
function findCut(text: string, limit: number): number {
  if (text.length <= limit) return text.length;

  // 1. Paragraph boundary: last blank-line run starting at/<= limit.
  let best = -1;
  const paraRe = /\n[ \t]*\n/g;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(text)) !== null) {
    if (m.index <= limit) {
      if (m.index > 0) best = m.index;
    } else {
      break;
    }
  }
  if (best > 0) return best;

  // 2. Sentence boundary: last . ! ? followed by whitespace, ending <= limit.
  best = -1;
  const sLen = Math.min(limit, text.length - 1);
  for (let i = 0; i < sLen; i++) {
    const c = text[i];
    if ((c === "." || c === "!" || c === "?") && /\s/.test(text[i + 1])) {
      best = i + 1; // include the punctuation in the chunk
    }
  }
  if (best > 0) return best;

  // 3. Last whitespace at index <= limit.
  const wMax = Math.min(limit, text.length - 1);
  for (let i = wMax; i >= 1; i--) {
    if (/\s/.test(text[i])) return i;
  }

  // 4. Hard split (overlong token).
  return limit;
}

/** Build the live preview segment array for a thought-like object. */
export function buildPreview(t: {
  title: string | null;
  note: string | null;
  year: number | null;
}): string[] {
  return buildSegments(composeFullText(t), t.year);
}
