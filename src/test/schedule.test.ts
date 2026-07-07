import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weekdayInTz,
  normalizeScheduleDays,
  isScheduledDay,
  formatScheduleDays,
  nextScheduledRunIso,
} from "../lib/schedule.ts";

// 2026-01-05 is a Monday. 00:00 UTC == 09:00 KST on the same date.
const MON_00_UTC = new Date("2026-01-05T00:00:00.000Z");

test("weekdayInTz: 00:00 UTC Monday is Monday (1) in Asia/Seoul", () => {
  assert.equal(weekdayInTz(MON_00_UTC, "Asia/Seoul"), 1);
});

test("weekdayInTz: falls back to UTC weekday on invalid/absent timezone", () => {
  assert.equal(weekdayInTz(MON_00_UTC, "Not/AZone"), MON_00_UTC.getUTCDay());
  assert.equal(weekdayInTz(MON_00_UTC, null), MON_00_UTC.getUTCDay());
});

test("normalizeScheduleDays: sorts, de-dupes, drops out-of-range and garbage", () => {
  assert.deepEqual(normalizeScheduleDays([3, 1, 1, 0]), [0, 1, 3]);
  assert.deepEqual(normalizeScheduleDays([7, -1, 2.5, "x", 4]), [4]);
  assert.deepEqual(normalizeScheduleDays("nope"), []);
  assert.deepEqual(normalizeScheduleDays([]), []);
});

test("isScheduledDay: default [Sun,Mon,Wed] includes Monday, excludes Tuesday", () => {
  const days = [0, 1, 3];
  assert.equal(isScheduledDay(days, "Asia/Seoul", MON_00_UTC), true);
  const tue = new Date("2026-01-06T00:00:00.000Z"); // Tuesday
  assert.equal(isScheduledDay(days, "Asia/Seoul", tue), false);
});

test("isScheduledDay: empty schedule never publishes", () => {
  assert.equal(isScheduledDay([], "Asia/Seoul", MON_00_UTC), false);
});

test("formatScheduleDays: labels, never, every day", () => {
  assert.equal(formatScheduleDays([0, 1, 3]), "Sun, Mon, Wed");
  assert.equal(formatScheduleDays([]), "never");
  assert.equal(formatScheduleDays([0, 1, 2, 3, 4, 5, 6]), "every day");
});

test("nextScheduledRunIso: from Monday, next [Sun,Mon,Wed] run is Wednesday 00:00 UTC", () => {
  const iso = nextScheduledRunIso([0, 1, 3], "Asia/Seoul", MON_00_UTC);
  assert.equal(iso, "2026-01-07T00:00:00.000Z"); // Wednesday
});

test("nextScheduledRunIso: null when nothing scheduled", () => {
  assert.equal(nextScheduledRunIso([], "Asia/Seoul", MON_00_UTC), null);
});
