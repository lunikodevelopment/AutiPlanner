import assert from "node:assert/strict";
import test from "node:test";
import { complete, RoutineCommandError } from "./commands.js";
import { flushQueue, resolveConflict, type QueuedCommand } from "./queue.js";
import {
  RecurrenceError,
  expandSeries,
  materializeOccurrence,
  occurrenceUid,
  type RoutineTemplate,
} from "./recurrence.js";
import type { RoutineItem } from "./model.js";

const template: RoutineTemplate = {
  uid: "meds@autiplanner.local",
  title: "Take medication",
  dayPart: "morning",
  date: "2026-08-11",
  start: "2026-08-11T08:00:00Z",
  recurrence: { freq: "daily", interval: 1 },
};

function item(): RoutineItem {
  return {
    uid: "item@autiplanner.local",
    title: "Walk",
    date: "2026-08-11",
    dayPart: "morning",
    status: "pending",
    revision: 2,
  };
}

test("expands only the requested window and does not complete the series", () => {
  const items = expandSeries(template, "2026-08-11", "2026-08-14");
  assert.deepEqual(
    items.map((entry) => entry.uid),
    [
      "meds@autiplanner.local:2026-08-11",
      "meds@autiplanner.local:2026-08-12",
      "meds@autiplanner.local:2026-08-13",
    ],
  );
  assert.equal(items.every((entry) => entry.status === "pending"), true);
  assert.equal(items.some((entry) => entry.uid === template.uid), false);
  assert.equal(items[1]?.start, "2026-08-12T08:00:00Z");
  assert.equal(items[1]?.date, "2026-08-12");
});

test("occurrence outcome replaces the generated item and is not inferred from the clock", () => {
  const override = materializeOccurrence(template, "2026-08-12", "missed");
  const items = expandSeries(template, "2026-08-11", "2026-08-13", [override]);
  assert.equal(items[1]?.status, "missed");
  assert.equal(items[1]?.dayPart, "morning");
  assert.notEqual(items[1]?.status, "completed");
});

test("rejects an unbounded window instead of cloning the future", () => {
  assert.throws(
    () => expandSeries(template, "2026-01-01", "2028-01-01"),
    (error: unknown) => error instanceof RecurrenceError,
  );
});

test("weekly BYDAY and EXDATE stay inside the subset", () => {
  const weekly: RoutineTemplate = {
    ...template,
    date: "2026-08-10",
    recurrence: { freq: "weekly", byDay: ["MO", "WE"] },
    exdates: ["2026-08-12"],
  };
  const items = expandSeries(weekly, "2026-08-10", "2026-08-20");
  assert.deepEqual(
    items.map((entry) => entry.date),
    ["2026-08-10", "2026-08-17", "2026-08-19"],
  );
});

test("revision conflicts do not write, and a retry is explicit", async () => {
  const pending = [item()];
  assert.throws(
    () => complete(pending, pending[0]!.uid, "2026-08-11T09:00:00Z", 1),
    (error: unknown) => error instanceof RoutineCommandError && error.code === "conflict",
  );
  assert.equal(pending[0]?.status, "pending");
  const done = complete(pending, pending[0]!.uid, "2026-08-11T09:00:00Z", 2);
  assert.equal(done.result.item.revision, 3);
  assert.equal(done.result.item.status, "completed");

  const command: QueuedCommand = {
    id: "1",
    name: "complete",
    uid: "item@autiplanner.local",
    completedAt: "2026-08-11T09:00:00Z",
    expectedRevision: 1,
  };
  const server = pending[0]!;
  const flushed = await flushQueue([command], async () => ({
    ok: false,
    code: "conflict",
    item: server,
    actualRevision: 2,
  }));
  assert.equal(flushed.remaining.length, 1);
  const resolved = resolveConflict("retry", command, server);
  assert.equal(resolved.command?.expectedRevision, 2);
  const kept = resolveConflict("keep-server", command, server);
  assert.equal(kept.command, undefined);
  assert.equal(occurrenceUid("series", "2026-08-11"), "series:2026-08-11");
});
