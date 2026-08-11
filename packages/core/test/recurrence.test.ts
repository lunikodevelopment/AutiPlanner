import assert from "node:assert/strict";
import { test } from "node:test";
import { expandRoutineItem, occurrenceUid, routineTemplateToMaster } from "../src/recurrence.ts";
import type { RoutineItem } from "../src/model.ts";

const weekly: RoutineItem = {
  uid: "walk-series",
  title: "Morning walk",
  date: "2026-08-03",
  dayPart: "morning",
  status: "pending",
  start: "2026-08-03T08:00:00",
  rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
};

test("occurrence identity is deterministic and occurrence outcomes stay separate", () => {
  const monday = occurrenceUid("walk-series", "2026-08-10");
  assert.equal(monday, "walk-series::2026-08-10");
  const occurrences = expandRoutineItem(weekly, { from: "2026-08-10", to: "2026-08-16" }, {
    [monday]: { status: "completed", completedAt: "2026-08-10T08:05:00Z" },
  });
  assert.deepEqual(occurrences.map(({ uid, date, status, completedAt }) => ({ uid, date, status, completedAt })), [
    { uid: monday, date: "2026-08-10", status: "completed", completedAt: "2026-08-10T08:05:00Z" },
    { uid: occurrenceUid("walk-series", "2026-08-12"), date: "2026-08-12", status: "pending", completedAt: undefined },
    { uid: occurrenceUid("walk-series", "2026-08-14"), date: "2026-08-14", status: "pending", completedAt: undefined },
  ]);
  assert.equal(occurrences[0]?.start, "2026-08-10T08:00:00");
});

test("RDATE and EXDATE are bounded and do not expand an unbounded future", () => {
  const item: RoutineItem = {
    uid: "medication-template",
    title: "Medication",
    date: "2026-08-11",
    dayPart: "morning",
    status: "pending",
    rrule: "FREQ=DAILY",
    rdate: ["2026-08-20"],
    exdate: ["2026-08-13"],
  };
  const occurrences = expandRoutineItem(item, { from: "2026-08-11", to: "2026-08-15", maxOccurrences: 10 });
  assert.deepEqual(occurrences.map(({ date }) => date), ["2026-08-11", "2026-08-12", "2026-08-14", "2026-08-15"]);
});

test("templates create a pending series master with a stable series identity", () => {
  const master = routineTemplateToMaster({
    routineId: "morning-medication",
    title: "Take medication",
    date: "2026-08-11",
    dayPart: "morning",
    rrule: "FREQ=DAILY",
  });
  assert.deepEqual(master, {
    uid: "template:morning-medication",
    title: "Take medication",
    date: "2026-08-11",
    dayPart: "morning",
    status: "pending",
    rrule: "FREQ=DAILY",
    routineId: "morning-medication",
  });
});
