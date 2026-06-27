import { test } from "node:test";
import assert from "node:assert/strict";
import { syncStatusTransition } from "../lib/syncStatus.ts";

test("new doc: open task imports as unpublished", () => {
  assert.equal(syncStatusTransition(null, false), "unpublished");
});

test("new doc: completed task imports as archived", () => {
  assert.equal(syncStatusTransition(null, true), "archived");
});

test("existing unpublished + task ticked off -> archived (dropped from queue)", () => {
  assert.equal(syncStatusTransition("unpublished", true), "archived");
});

test("existing unpublished + task still open -> unchanged", () => {
  assert.equal(syncStatusTransition("unpublished", false), null);
});

test("published thought is never downgraded, even once its task is ticked off", () => {
  assert.equal(syncStatusTransition("published", true), null);
  assert.equal(syncStatusTransition("published", false), null);
});

test("failed thought is left untouched", () => {
  assert.equal(syncStatusTransition("failed", true), null);
  assert.equal(syncStatusTransition("failed", false), null);
});

test("archived thought is terminal (un-ticking does not resurrect it)", () => {
  assert.equal(syncStatusTransition("archived", false), null);
  assert.equal(syncStatusTransition("archived", true), null);
});
