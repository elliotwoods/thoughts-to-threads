import { test } from "node:test";
import assert from "node:assert/strict";
import {
  insertIndexFor,
  reconcileOrder,
  sameOrder,
} from "../lib/queueOrder.ts";

test("reconcileOrder keeps eligible ids in order", () => {
  const eligible = new Set(["a", "b", "c"]);
  assert.deepEqual(reconcileOrder(eligible, ["c", "a", "b"]), ["c", "a", "b"]);
});

test("reconcileOrder drops ineligible ids (published/skipped/missing)", () => {
  const eligible = new Set(["a", "c"]);
  assert.deepEqual(reconcileOrder(eligible, ["a", "b", "c", "x"]), ["a", "c"]);
});

test("reconcileOrder de-duplicates, keeping first occurrence", () => {
  const eligible = new Set(["a", "b"]);
  assert.deepEqual(reconcileOrder(eligible, ["a", "b", "a"]), ["a", "b"]);
});

test("reconcileOrder on empty stored returns empty", () => {
  assert.deepEqual(reconcileOrder(new Set(["a"]), []), []);
});

test("insertIndexFor: next is front, last is end", () => {
  assert.equal(insertIndexFor("next", 5), 0);
  assert.equal(insertIndexFor("last", 5), 5);
});

test("insertIndexFor clamps a numeric index into [0, length]", () => {
  assert.equal(insertIndexFor(2, 5), 2);
  assert.equal(insertIndexFor(-3, 5), 0);
  assert.equal(insertIndexFor(99, 5), 5);
  assert.equal(insertIndexFor(2.9, 5), 2); // floored
});

test("sameOrder compares element-wise", () => {
  assert.equal(sameOrder(["a", "b"], ["a", "b"]), true);
  assert.equal(sameOrder(["a", "b"], ["b", "a"]), false);
  assert.equal(sameOrder(["a"], ["a", "b"]), false);
});
