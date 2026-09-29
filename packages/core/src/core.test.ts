import assert from "node:assert/strict";
import test from "node:test";
import { formatAccessibleAgenda, formatAgenda, groupAgenda } from "./agenda.js";
import {
  commands,
  complete,
  create,
  deleteItem,
  markMissed,
  reset,
  RoutineCommandError,
  skip,
  update,
  type RoutineItemPatch,
} from "./commands.js";
import { type RoutineItem, validateRoutineItem } from "./model.js";
import {
  DAY_PART_LABEL,
  STATUS_ACCESSIBLE_LABEL,
  STATUS_SYMBOL,
  itemAccessibleName,
  statusAccessibleName,
} from "./presentation.js";
import { isCalendarDate, weekdayName } from "./time.js";

const completedAt = "2026-08-11T08:05:00Z";

function item(overrides: Partial<RoutineItem> = {}): RoutineItem {
  return {
    uid: "item@autiplanner.local",
    title: "Take medication",
    date: "2026-08-11",
    dayPart: "morning",
    status: "pending",
    ...overrides,
  };
}

test("validates the four outcomes without collapsing them", () => {
  assert.deepEqual(validateRoutineItem(item()), []);
  assert.deepEqual(
    validateRoutineItem(item({ status: "completed", completedAt })),
    [],
  );
  assert.deepEqual(validateRoutineItem(item({ status: "missed" })), []);
  assert.deepEqual(validateRoutineItem(item({ status: "skipped" })), []);
  assert.ok(
    validateRoutineItem(item({ status: "completed" })).some((error) =>
      error.includes("completedAt"),
    ),
  );
  assert.ok(
    validateRoutineItem(item({ status: "missed", completedAt })).some((error) =>
      error.includes("only completed"),
    ),
  );
  assert.ok(
    validateRoutineItem(item({ status: "skipped", completedAt })).some((error) =>
      error.includes("only completed"),
    ),
  );
});

test("rejects impossible calendar days and floating completion times", () => {
  assert.equal(isCalendarDate("2026-02-31"), false);
  assert.ok(validateRoutineItem(item({ date: "2026-02-31" })).length > 0);
  assert.ok(
    validateRoutineItem(
      item({ status: "completed", completedAt: "2026-08-11T08:05:00" }),
    ).some((error) => error.includes("offset")),
  );
  assert.ok(
    validateRoutineItem(
      item({ start: "2026-08-11T08:00:00Z", timezone: "Europe/Stockholm" }),
    ).some((error) => error.includes("floating")),
  );
});

test("commands return the resulting item and are idempotent", () => {
  const pending = [item()];
  const done = complete(pending, pending[0]!.uid, completedAt);
  assert.equal(done.result.changed, true);
  assert.equal(done.result.item.status, "completed");
  assert.equal(done.result.item.completedAt, completedAt);

  const again = complete(done.items, pending[0]!.uid, completedAt);
  assert.equal(again.result.changed, false);
  assert.equal(again.result.item, done.result.item);
  assert.equal(again.items, done.items);

  const missed = markMissed(done.items, pending[0]!.uid);
  assert.equal(missed.result.item.status, "missed");
  assert.equal(missed.result.item.completedAt, undefined);
  assert.notEqual(missed.result.item.status, "completed");

  const skipped = skip(missed.items, pending[0]!.uid);
  assert.equal(skipped.result.item.status, "skipped");
  assert.equal(skipped.result.item.completedAt, undefined);

  const pendingAgain = reset(skipped.items, pending[0]!.uid);
  assert.equal(pendingAgain.result.item.status, "pending");
  const alreadyPending = reset(pendingAgain.items, pending[0]!.uid);
  assert.equal(alreadyPending.result.changed, false);
});

test("an explicit complete can correct a missed item", () => {
  const missed = markMissed([item()], "item@autiplanner.local");
  const corrected = complete(missed.items, "item@autiplanner.local", completedAt);
  assert.equal(corrected.result.item.status, "completed");
  assert.equal(corrected.result.item.completedAt, completedAt);
});

test("create, update, and delete keep uid stable", () => {
  const created = create([], item({ title: "Eat breakfast" }));
  assert.equal(created.result.changed, true);
  assert.throws(
    () => create(created.items, item()),
    (error: unknown) => error instanceof RoutineCommandError && error.code === "duplicate-uid",
  );

  const renamed = update(created.items, "item@autiplanner.local", {
    title: "Eat breakfast slowly",
  });
  assert.equal(renamed.result.item.uid, "item@autiplanner.local");
  assert.equal(renamed.result.item.title, "Eat breakfast slowly");

  assert.throws(
    () =>
      update(created.items, "item@autiplanner.local", {
        uid: "other",
      } as RoutineItemPatch),
    (error: unknown) => error instanceof RoutineCommandError && error.code === "invalid-patch",
  );

  const removed = deleteItem(renamed.items, "item@autiplanner.local");
  assert.equal(removed.changed, true);
  assert.equal(removed.items.length, 0);
  assert.equal(removed.item.title, "Eat breakfast slowly");
  assert.equal(commands.delete, deleteItem);
});

test("groups by explicit day part and does not infer it from the clock", () => {
  const items = [
    item({
      uid: "late@autiplanner.local",
      title: "Wind down",
      dayPart: "evening",
      start: "2026-08-11T11:30:00Z",
      order: 5,
    }),
    item({
      uid: "night@autiplanner.local",
      title: "Sleep",
      dayPart: "night",
      start: "2026-08-11T23:00:00Z",
    }),
    item({ uid: "second@autiplanner.local", title: "Breakfast", order: 20 }),
    item({ uid: "first@autiplanner.local", title: "Medication", order: 10 }),
  ];
  const [day] = groupAgenda(items);
  assert.equal(day?.heading, "TUESDAY — 2026-08-11");
  assert.deepEqual(
    day?.sections.map((section) => section.heading),
    ["MORNING", "EVENING", "NIGHT"],
  );
  assert.deepEqual(
    day?.sections[0]?.items.map((entry) => entry.uid),
    ["first@autiplanner.local", "second@autiplanner.local"],
  );
  assert.equal(day?.sections[1]?.items[0]?.dayPart, "evening");
  assert.equal(weekdayName("2026-08-11"), "TUESDAY");
});

test("formats the canonical agenda with accessible outcome names", () => {
  const items = [
    item({ status: "completed", completedAt, start: "2026-08-11T08:00:00Z" }),
    item({
      uid: "missed@autiplanner.local",
      title: "Exercise",
      dayPart: "afternoon",
      status: "missed",
      start: "2026-08-11T13:30:00Z",
    }),
    item({
      uid: "skipped@autiplanner.local",
      title: "Optional journaling",
      dayPart: "evening",
      status: "skipped",
      start: "2026-08-11T20:00:00Z",
    }),
  ];
  assert.equal(
    formatAgenda(items),
    [
      "TUESDAY — 2026-08-11",
      "  MORNING",
      "    ✓ Take medication  08:00 UTC",
      "  AFTERNOON",
      "    ✕ Exercise  13:30 UTC",
      "  EVENING",
      "    — Optional journaling  20:00 UTC",
    ].join("\n"),
  );
  assert.match(formatAccessibleAgenda(items), /Missed: Exercise/);
  assert.match(formatAccessibleAgenda(items), /Skipped: Optional journaling/);
  assert.equal(statusAccessibleName(items[0]!), "Completed: Take medication");
  assert.equal(itemAccessibleName(items[1]!), "Afternoon, Missed: Exercise");
  assert.deepEqual(Object.values(STATUS_SYMBOL), ["○", "✓", "✕", "—"]);
  assert.deepEqual(Object.values(STATUS_ACCESSIBLE_LABEL), [
    "Pending",
    "Completed",
    "Missed",
    "Skipped",
  ]);
  assert.equal(DAY_PART_LABEL.night, "Night");
});
