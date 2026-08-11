import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  IcsParseError,
  escapeText,
  foldLine,
  parseCalendar,
  serializeCalendar,
  unescapeText,
} from "../src/index.ts";
import type { RoutineItem } from "@autiplanner/core";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const example = readFileSync(`${repositoryRoot}/examples/autiplanner.ics`, "utf8");
const edgeCases = readFileSync(new URL("./fixtures/edge-cases.ics", import.meta.url), "utf8");

test("the example calendar parses into all four routine outcomes", () => {
  const result = parseCalendar(example);

  assert.equal(result.warnings.length, 0);
  assert.equal(result.items.length, 5);
  assert.deepEqual(
    result.items.map(({ title, dayPart, status, order }) => ({ title, dayPart, status, order })),
    [
      { title: "Take medication", dayPart: "morning", status: "completed", order: 10 },
      { title: "Eat breakfast", dayPart: "morning", status: "pending", order: 20 },
      { title: "Exercise", dayPart: "afternoon", status: "missed", order: 10 },
      { title: "Optional journaling", dayPart: "evening", status: "skipped", order: 10 },
      { title: "Take medication", dayPart: "morning", status: "pending", order: 10 },
    ],
  );
  assert.equal(result.items[0]?.completedAt, "2026-08-11T08:05:00Z");
});

test("example records round-trip without losing AutiPlanner semantics", () => {
  const original = parseCalendar(example);
  const serialized = serializeCalendar(original.items, { dtstamp: "2026-08-11T06:00:00Z" });
  const reparsed = parseCalendar(serialized);

  assert.equal(reparsed.warnings.length, 0);
  assert.deepEqual(reparsed.items, original.items);
  assert.match(serialized, /BEGIN:VCALENDAR\r\n/);
  assert.match(serialized, /X-AUTIPLANNER-OUTCOME:MISSED\r\n/);
});

test("edge-case text, tags, timezone, and unknown extensions survive a round trip", () => {
  const parsed = parseCalendar(edgeCases);
  assert.equal(parsed.warnings.length, 0);
  assert.deepEqual(parsed.items[0], {
    uid: "edge-case-20260811@autiplanner.local",
    title: "Prepare, pack; leave",
    description: "First line\nSecond line",
    date: "2026-08-11",
    start: "2026-08-11T08:30:00",
    due: "2026-08-11T09:00:00",
    timezone: "Europe/Amsterdam",
    dayPart: "morning",
    status: "skipped",
    tags: ["home,care", "important"],
    extensions: { "X-AUTIPLANNER-ICON": "coffee" },
  });

  const serialized = serializeCalendar(parsed.items, { dtstamp: "2026-08-11T06:00:00Z" });
  const reparsed = parseCalendar(serialized);
  assert.deepEqual(reparsed.items, parsed.items);
  assert.match(serialized, /TZID="Europe\/Amsterdam"/);
  assert.match(serialized, /X-AUTIPLANNER-ICON:coffee/);
});

test("long UTF-8 lines fold and unfold without splitting characters", () => {
  const title = `${"Routine ".repeat(20)}☕`;
  const item: RoutineItem = {
    uid: "folded-item",
    title,
    description: "A description with \\slashes, commas, semicolons; and\nnewlines.",
    date: "2026-08-11",
    dayPart: "morning",
    status: "pending",
    extensions: { "X-AUTIPLANNER-NOTE": "Keep this metadata" },
  };
  const serialized = serializeCalendar([item], { dtstamp: "2026-08-11T06:00:00Z" });
  assert.match(serialized, /\r\n /);
  assert.deepEqual(parseCalendar(serialized).items, [item]);

  assert.equal(unescapeText(escapeText("a,b;c\\d\ne")), "a,b;c\\d\ne");
  assert.equal(physicalLineByteLengths(serialized).every((length) => length <= 75), true);
});

test("standard recurrence properties survive a round trip", () => {
  const source = [
    "BEGIN:VCALENDAR",
    "BEGIN:VTODO",
    "UID:medication-series",
    "DTSTART;VALUE=DATE:20260811",
    "SUMMARY:Medication",
    "STATUS:NEEDS-ACTION",
    "RRULE:FREQ=DAILY;COUNT=3",
    "RDATE;VALUE=DATE:20260820",
    "EXDATE;VALUE=DATE:20260812",
    "RECURRENCE-ID;VALUE=DATE:20260811",
    "X-AUTIPLANNER-DAYPART:MORNING",
    "X-AUTIPLANNER-OUTCOME:PENDING",
    "END:VTODO",
    "END:VCALENDAR",
  ].join("\r\n");
  const parsed = parseCalendar(source);
  assert.equal(parsed.warnings.length, 0);
  assert.deepEqual(parsed.items[0], {
    uid: "medication-series",
    title: "Medication",
    date: "2026-08-11",
    dayPart: "morning",
    status: "pending",
    rrule: "FREQ=DAILY;COUNT=3",
    rdate: ["2026-08-20"],
    exdate: ["2026-08-12"],
    recurrenceId: "2026-08-11",
  });
  assert.deepEqual(parseCalendar(serializeCalendar(parsed.items, { dtstamp: "2026-08-11T06:00:00Z" })).items, parsed.items);
});

test("an explicit fallback can import a VTODO with no day-part, while strict mode rejects it", () => {
  const source = [
    "BEGIN:VCALENDAR",
    "BEGIN:VTODO",
    "UID:imported-task",
    "DTSTART;VALUE=DATE:20260811",
    "SUMMARY:Imported task",
    "STATUS:NEEDS-ACTION",
    "END:VTODO",
    "END:VCALENDAR",
  ].join("\r\n");

  const tolerant = parseCalendar(source, { defaultDayPart: "afternoon" });
  assert.equal(tolerant.items[0]?.dayPart, "afternoon");
  assert.equal(tolerant.warnings.some(({ code }) => code === "missing-required-property"), true);
  assert.throws(() => parseCalendar(source, { strict: true }), IcsParseError);
});

test("a completed record requires a completion timestamp and never downgrades missed/skipped", () => {
  const source = [
    "BEGIN:VCALENDAR",
    "BEGIN:VTODO",
    "UID:bad-completed",
    "DTSTART:20260811T080000Z",
    "SUMMARY:Bad completed",
    "STATUS:COMPLETED",
    "X-AUTIPLANNER-DAYPART:MORNING",
    "X-AUTIPLANNER-OUTCOME:COMPLETED",
    "END:VTODO",
    "BEGIN:VTODO",
    "UID:missed-wins",
    "DTSTART:20260811T080000Z",
    "SUMMARY:Missed wins",
    "STATUS:COMPLETED",
    "COMPLETED:20260811T081000Z",
    "X-AUTIPLANNER-DAYPART:MORNING",
    "X-AUTIPLANNER-OUTCOME:MISSED",
    "END:VTODO",
    "END:VCALENDAR",
  ].join("\r\n");

  const result = parseCalendar(source);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.status, "missed");
  assert.equal(result.items[0]?.completedAt, undefined);
  assert.equal(result.warnings.some(({ code }) => code === "conflicting-status"), true);
  assert.equal(result.warnings.some(({ code }) => code === "missing-required-property"), true);
});

function physicalLineByteLengths(serialized: string): readonly number[] {
  return serialized
    .split("\r\n")
    .filter(Boolean)
    .map((line) => new TextEncoder().encode(line).length);
}
