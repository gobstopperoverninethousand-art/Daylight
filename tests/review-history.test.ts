import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, type Review } from "../lib/model";
import { reviewContextBefore, saveDatedReview } from "../lib/review-history";
import { assess, makeSnapshot } from "../lib/engine";

function report(id: string, date: string): Review {
  const state = emptyState();
  const snapshot = makeSnapshot(state, date, "", "", "");
  return {
    id,
    date,
    createdAt: date + "T12:00:00Z",
    source: "rules",
    version: "test",
    focus: "",
    blocker: "",
    accomplishment: id,
    assessment: assess(snapshot),
    snapshot,
    commitmentUpdates: [{ key: "task:task", note: id }],
  };
}

test("backdated replacement replaces the day's evidence, preserves later answers, and flags derived reports", () => {
  const state = emptyState();
  const old = report("old", "2026-11-14");
  const later = report("later", "2026-11-16");
  state.reviews = [report("earlier", "2026-11-12"), old, later];
  assert.deepEqual(
    reviewContextBefore(state, old.date).reviews.map((item) => item.id),
    ["earlier"],
  );
  const replacement = report("corrected", old.date);
  saveDatedReview(state, replacement, JSON.stringify([old]));
  assert.deepEqual(
    state.reviews.map((item) => item.id),
    ["earlier", "corrected", "later"],
  );
  assert.equal(later.accomplishment, "later");
  assert.equal(later.snapshot.earlier_report_changed, old.date);
  assert.deepEqual(replacement.snapshot.replaced_report_ids, [old.id]);
  assert.throws(
    () =>
      saveDatedReview(state, report("stale", old.date), JSON.stringify([old])),
    /changed while/,
  );
});
