import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSegments,
  buildPreview,
  composeFullText,
  stripHtml,
  yearSuffix,
  THREADS_MAX,
} from "../lib/post.ts";

function words(n: number): string {
  // Produce roughly n characters of space-separated 4-letter words.
  const out: string[] = [];
  let len = 0;
  let i = 0;
  while (len <= n) {
    const w = `wd${(i++ % 100).toString().padStart(2, "0")}`;
    out.push(w);
    len += w.length + 1;
  }
  return out.join(" ");
}

test("short text gets the year suffix", () => {
  const segs = buildSegments("a quiet thought", 2024);
  assert.deepEqual(segs, ["a quiet thought (2024)"]);
});

test("null year omits the suffix", () => {
  const segs = buildSegments("a quiet thought", null);
  assert.deepEqual(segs, ["a quiet thought"]);
});

test("empty text returns []", () => {
  assert.deepEqual(buildSegments("", 2024), []);
  assert.deepEqual(buildSegments("   \n  ", 2024), []);
  assert.deepEqual(buildSegments("", null), []);
});

test(">500 chars splits into multiple segments, each <=500, suffix only on last", () => {
  const text = words(900);
  assert.ok(text.length > THREADS_MAX);
  const segs = buildSegments(text, 2024);
  assert.ok(segs.length > 1, "expected multiple segments");
  for (const s of segs) {
    assert.ok(s.length <= THREADS_MAX, `segment too long: ${s.length}`);
    assert.ok(s.trim().length > 0, "segment must not be empty");
  }
  // Suffix on the last only.
  assert.ok(segs[segs.length - 1].endsWith(" (2024)"));
  for (let i = 0; i < segs.length - 1; i++) {
    assert.ok(!segs[i].endsWith(" (2024)"));
  }
  // No segment is only the suffix.
  for (const s of segs) {
    assert.notEqual(s.trim(), "(2024)");
  }
});

test("an ~1100-char paragraph splits into multiple parts that each fit", () => {
  const text = words(1100);
  assert.ok(text.length >= 1100);
  const segs = buildSegments(text, 2025);
  assert.ok(segs.length >= 3, `expected >=3 parts, got ${segs.length}`);
  for (const s of segs) {
    assert.ok(s.length <= THREADS_MAX);
  }
  assert.ok(segs[segs.length - 1].endsWith(" (2025)"));
  // Reassembled (minus suffix) should contain all the words in order.
  const joined = segs.join(" ").replace(" (2025)", "");
  const original = text.split(/\s+/);
  const back = joined.split(/\s+/);
  assert.deepEqual(back, original);
});

test("a single 600-char word hard-splits", () => {
  const text = "x".repeat(600);
  const segs = buildSegments(text, 2024);
  assert.ok(segs.length > 1, "expected hard split into multiple segments");
  for (const s of segs) {
    assert.ok(s.length <= THREADS_MAX, `segment too long: ${s.length}`);
  }
  assert.ok(segs[segs.length - 1].endsWith(" (2024)"));
  // All x's preserved (count of 'x' equals 600).
  const xs = segs.join("").split("").filter((c) => c === "x").length;
  assert.equal(xs, 600);
});

test("final segment reserves room for suffix (last + suffix <= 500)", () => {
  // Content just over the boundary so the suffix forces a split.
  const text = "y".repeat(498) + " tail";
  const segs = buildSegments(text, 2024);
  for (const s of segs) {
    assert.ok(s.length <= THREADS_MAX);
  }
  assert.ok(segs[segs.length - 1].endsWith(" (2024)"));
});

test("a long emoji-only token hard-splits without breaking surrogate pairs", () => {
  // 600 astral chars (each is a surrogate pair in UTF-16) with no break points.
  const text = "😀".repeat(600);
  const segs = buildSegments(text, 2024);
  assert.ok(segs.length > 1, "expected hard split into multiple segments");
  for (const s of segs) {
    assert.ok(s.length <= THREADS_MAX, `segment too long: ${s.length}`);
    // No segment may start/end on a lone surrogate (a split emoji).
    const first = s.charCodeAt(0);
    const last = s.charCodeAt(s.length - 1);
    assert.ok(
      !(last >= 0xd800 && last <= 0xdbff),
      "segment ends on a high surrogate (split emoji)"
    );
    assert.ok(
      !(first >= 0xdc00 && first <= 0xdfff),
      "segment starts on a low surrogate (split emoji)"
    );
  }
  assert.ok(segs[segs.length - 1].endsWith(" (2024)"));
  // All 600 emoji preserved intact.
  const count = Array.from(segs.join("").replace(" (2024)", "")).filter(
    (c) => c === "😀"
  ).length;
  assert.equal(count, 600);
});

test("yearSuffix and composeFullText basics", () => {
  assert.equal(yearSuffix(null), "");
  assert.equal(yearSuffix(2024), " (2024)");
  assert.equal(composeFullText({ title: "Title", note: null }), "Title");
  assert.equal(
    composeFullText({ title: "Title", note: "the body" }),
    "Title\n\nthe body"
  );
  assert.equal(composeFullText({ title: "Title", note: "   " }), "Title");
});

test("stripHtml strips tags, decodes entities, collapses whitespace", () => {
  assert.equal(stripHtml(null), "");
  assert.equal(stripHtml(undefined), "");
  assert.equal(
    stripHtml("<p>hello&nbsp;&amp; world</p>\n\n<br>more"),
    "hello & world more"
  );
});

test("buildPreview composes then segments with year suffix on the last", () => {
  const segs = buildPreview({
    title: "My title",
    note: "a short note",
    year: 2023,
  });
  assert.deepEqual(segs, ["My title\n\na short note (2023)"]);
});

test("buildPreview splits a long title+note across the paragraph boundary", () => {
  const segs = buildPreview({
    title: words(400),
    note: words(400),
    year: 2022,
  });
  assert.ok(segs.length > 1);
  for (const s of segs) assert.ok(s.length <= THREADS_MAX);
  assert.ok(segs[segs.length - 1].endsWith(" (2022)"));
});
