import {
  formatAgenda,
  markMissed,
  type RoutineItem,
} from "@autiplanner/core";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCalendar } from "./parse.js";
import { serializeCalendar, serializeItems } from "./serialize.js";
import { IcsSerializeError } from "./types.js";
import { escapeText, foldContentLine, unfoldIcs, unescapeText } from "./text.js";

const stamp = new Date("2026-08-11T06:00:00Z");
const examplePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples/autiplanner.ics",
);

function calendar(body: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AutiPlanner//Routine Calendar//EN",
    "CALSCALE:GREGORIAN",
    body,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function vtodo(lines: readonly string[]): string {
  return ["BEGIN:VTODO", ...lines, "END:VTODO"].join("\r\n");
}

function routine(overrides: Partial<RoutineItem> = {}): RoutineItem {
  return {
    uid: "item@autiplanner.local",
    title: "Take medication",
    date: "2026-08-11",
    start: "2026-08-11T08:00:00Z",
    dayPart: "morning",
    status: "pending",
    ...overrides,
  };
}

test("parses the example calendar into the four-state core model", () => {
  const parsed = parseCalendar(readFileSync(examplePath, "utf8"));
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.items, [
    {
      uid: "medication-am-20260811@autiplanner.local",
      title: "Take medication",
      date: "2026-08-11",
      start: "2026-08-11T08:00:00Z",
      dayPart: "morning",
      status: "completed",
      completedAt: "2026-08-11T08:05:00Z",
      order: 10,
    },
    {
      uid: "breakfast-20260811@autiplanner.local",
      title: "Eat breakfast",
      date: "2026-08-11",
      start: "2026-08-11T08:30:00Z",
      dayPart: "morning",
      status: "pending",
      order: 20,
    },
    {
      uid: "exercise-20260811@autiplanner.local",
      title: "Exercise",
      date: "2026-08-11",
      start: "2026-08-11T13:30:00Z",
      dayPart: "afternoon",
      status: "missed",
      order: 10,
    },
    {
      uid: "journal-20260811@autiplanner.local",
      title: "Optional journaling",
      date: "2026-08-11",
      start: "2026-08-11T20:00:00Z",
      dayPart: "evening",
      status: "skipped",
      order: 10,
    },
    {
      uid: "medication-am-20260812@autiplanner.local",
      title: "Take medication",
      date: "2026-08-12",
      start: "2026-08-12T08:00:00Z",
      dayPart: "morning",
      status: "pending",
      order: 10,
    },
  ] satisfies RoutineItem[]);
});

test("round-trips the example without losing AutiPlanner semantics", () => {
  const parsed = parseCalendar(readFileSync(examplePath, "utf8"));
  const written = serializeItems(parsed.items, { dtstamp: stamp });
  assert.equal(written.includes("\r\n"), true);
  assert.equal(written.endsWith("\r\n"), true);
  const again = parseCalendar(written);
  assert.deepEqual(again.issues, []);
  assert.deepEqual(again.items, parsed.items);

  const blocks = written.split("BEGIN:VTODO").slice(1);
  const missed = blocks.find((block) => block.includes("OUTCOME:MISSED")) ?? "";
  const skipped = blocks.find((block) => block.includes("OUTCOME:SKIPPED")) ?? "";
  const completed = blocks.find((block) => block.includes("OUTCOME:COMPLETED")) ?? "";
  assert.match(missed, /STATUS:NEEDS-ACTION/);
  assert.doesNotMatch(missed, /^COMPLETED:/m);
  assert.doesNotMatch(missed, /^STATUS:COMPLETED/m);
  assert.match(skipped, /STATUS:NEEDS-ACTION/);
  assert.doesNotMatch(skipped, /^STATUS:COMPLETED/m);
  assert.match(completed, /STATUS:COMPLETED/);
  assert.match(completed, /^COMPLETED:20260811T080500Z/m);
  assert.match(formatAgenda(again.items), /✕ Exercise/);
  assert.match(formatAgenda(again.items), /— Optional journaling/);
});

test("marking missed does not serialize as completed", () => {
  const parsed = parseCalendar(readFileSync(examplePath, "utf8"));
  const changed = markMissed(
    parsed.items,
    "medication-am-20260811@autiplanner.local",
  );
  const written = serializeItems(changed.items, { dtstamp: stamp });
  const again = parseCalendar(written);
  const item = again.items.find(
    (candidate) => candidate.uid === "medication-am-20260811@autiplanner.local",
  );
  assert.equal(item?.status, "missed");
  assert.equal(item?.completedAt, undefined);
  const block = written
    .split("BEGIN:VTODO")
    .find((part) => part.includes("medication-am-20260811@autiplanner.local"));
  assert.ok(block);
  assert.match(block, /X-AUTIPLANNER-OUTCOME:MISSED/);
  assert.doesNotMatch(block, /^STATUS:COMPLETED/m);
  assert.doesNotMatch(block, /^COMPLETED:/m);
});

test("keeps an explicit local date and day part when the UTC clock disagrees", () => {
  const written = serializeItems(
    [
      routine({
        uid: "late@autiplanner.local",
        title: "Wind down",
        date: "2026-08-12",
        start: "2026-08-11T23:30:00Z",
        dayPart: "night",
      }),
    ],
    { dtstamp: stamp },
  );
  const parsed = parseCalendar(written);
  assert.equal(parsed.items[0]?.date, "2026-08-12");
  assert.equal(parsed.items[0]?.start, "2026-08-11T23:30:00Z");
  assert.equal(parsed.items[0]?.dayPart, "night");
  assert.ok(parsed.issues.some((issue) => issue.code === "date-differs-from-schedule"));
});

test("does not infer a missing day part from 11:30", () => {
  const parsed = parseCalendar(
    calendar(
      vtodo([
        "UID:walk@autiplanner.local",
        "DTSTAMP:20260811T060000Z",
        "DTSTART:20260811T113000Z",
        "SUMMARY:Walk",
        "STATUS:NEEDS-ACTION",
        "X-AUTIPLANNER-OUTCOME:PENDING",
      ]),
    ),
  );
  assert.equal(parsed.items.length, 0);
  assert.ok(parsed.issues.some((issue) => issue.code === "missing-daypart"));
  assert.equal(
    parsed.issues.some((issue) => issue.message.toLowerCase().includes("afternoon")),
    false,
  );
});

test("keeps evening when the clock is 11:30", () => {
  const parsed = parseCalendar(
    calendar(
      vtodo([
        "UID:walk@autiplanner.local",
        "DTSTAMP:20260811T060000Z",
        "DTSTART:20260811T113000Z",
        "SUMMARY:Walk",
        "STATUS:NEEDS-ACTION",
        "X-AUTIPLANNER-DAYPART:EVENING",
        "X-AUTIPLANNER-OUTCOME:PENDING",
      ]),
    ),
  );
  assert.equal(parsed.items[0]?.dayPart, "evening");
  assert.equal(parsed.issues.length, 0);
});

test("outcome wins when STATUS disagrees", () => {
  const parsed = parseCalendar(
    calendar(
      vtodo([
        "UID:exercise@autiplanner.local",
        "DTSTAMP:20260811T060000Z",
        "DTSTART:20260811T133000Z",
        "SUMMARY:Exercise",
        "STATUS:COMPLETED",
        "COMPLETED:20260811T140000Z",
        "X-AUTIPLANNER-DAYPART:AFTERNOON",
        "X-AUTIPLANNER-OUTCOME:MISSED",
      ]),
    ),
  );
  assert.equal(parsed.items[0]?.status, "missed");
  assert.equal(parsed.items[0]?.completedAt, undefined);
  assert.ok(parsed.issues.some((issue) => issue.code === "outcome-status-conflict"));
  assert.ok(parsed.issues.some((issue) => issue.code === "timestamp-without-completed"));
});

test("folds, unfolds, and escapes TEXT without splitting UTF-8", () => {
  const title = `${"💊".repeat(40)} medication, notes; path \\ here`;
  const description = "first line\nsecond line, with; punctuation";
  assert.equal(unescapeText(escapeText(description)), description);
  const folded = foldContentLine(`SUMMARY:${escapeText(title)}`);
  assert.equal(unfoldIcs(folded), `SUMMARY:${escapeText(title)}`);
  for (const line of folded.split("\r\n")) {
    assert.ok(new TextEncoder().encode(line).length <= 75);
  }

  const written = serializeItems(
    [routine({ title, description, tags: ["home", "meds,am"] })],
    { dtstamp: stamp },
  );
  const parsed = parseCalendar(written);
  assert.equal(parsed.items[0]?.title, title);
  assert.equal(parsed.items[0]?.description, description);
  assert.deepEqual(parsed.items[0]?.tags, ["home", "meds,am"]);
});

test("round-trips a series and its occurrence overrides", () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples/series.ics"), "utf8");
  const parsed = parseCalendar(source);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0]?.uid, "meds-am-series@autiplanner.local:2026-08-12");
  assert.equal(parsed.items[0]?.status, "missed");
  assert.equal(parsed.items[0]?.routineId, "meds-am-series@autiplanner.local");
  assert.equal(parsed.series[0]?.uid, "meds-am-series@autiplanner.local");
  assert.deepEqual(parsed.series[0]?.recurrence, {
    freq: "weekly",
    byDay: ["MO", "WE", "FR"],
  });

  const written = serializeCalendar(parsed, { dtstamp: stamp });
  assert.match(written, /RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR/);
  assert.match(written, /RECURRENCE-ID;VALUE=DATE:20260812/);
  const again = parseCalendar(written);
  assert.deepEqual(again.issues, []);
  assert.deepEqual(again.items, parsed.items);
  assert.deepEqual(again.series, parsed.series);

  // The override is never rewritten as completed.
  const blocks = written.split("BEGIN:VTODO").slice(1);
  const occurrence = blocks.find((block) => block.includes(":2026-08-12")) ?? "";
  assert.match(occurrence, /X-AUTIPLANNER-OUTCOME:MISSED/);
  assert.doesNotMatch(occurrence, /^STATUS:COMPLETED/m);
});

test("rejects an RRULE outside the supported subset", () => {
  const parsed = parseCalendar(
    calendar(
      vtodo([
        "UID:series@autiplanner.local",
        "DTSTAMP:20260811T060000Z",
        "DTSTART:20260811T080000Z",
        "SUMMARY:Series",
        "RRULE:FREQ=MONTHLY;BYDAY=2MO",
        "X-AUTIPLANNER-DAYPART:MORNING",
        "X-AUTIPLANNER-OUTCOME:PENDING",
      ]),
    ),
  );
  assert.equal(parsed.series.length, 0);
  assert.equal(parsed.items.length, 0);
  assert.ok(parsed.issues.some((issue) => issue.code === "unsupported-recurrence"));
  assert.ok(
    parsed.preserved.some((block) => block.includes("RRULE:FREQ=MONTHLY;BYDAY=2MO")),
  );
});

test("preserves unknown AutiPlanner extensions and unmodeled components", () => {
  const parsed = parseCalendar(
    calendar(
      [
        vtodo([
          "UID:meds@autiplanner.local",
          "DTSTAMP:20260811T060000Z",
          "DTSTART;VALUE=DATE:20260811",
          "SUMMARY:Take medication",
          "STATUS:NEEDS-ACTION",
          "X-AUTIPLANNER-DAYPART:MORNING",
          "X-AUTIPLANNER-OUTCOME:PENDING",
          "X-AUTIPLANNER-ICON:pill",
          "X-AUTIPLANNER-NOTE:keep me",
        ]),
        vtodo([
          "UID:series@autiplanner.local",
          "DTSTAMP:20260811T060000Z",
          "DTSTART:20260811T080000Z",
          "SUMMARY:Series master",
          "RRULE:FREQ=DAILY",
          "X-AUTIPLANNER-DAYPART:MORNING",
          "X-AUTIPLANNER-OUTCOME:PENDING",
        ]),
        [
          "BEGIN:VEVENT",
          "UID:appointment@autiplanner.local",
          "DTSTAMP:20260811T060000Z",
          "DTSTART:20260811T150000Z",
          "SUMMARY:Appointment",
          "END:VEVENT",
        ].join("\r\n"),
      ].join("\r\n"),
    ),
  );
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0]?.extensions?.["X-AUTIPLANNER-ICON"], "pill");
  assert.equal(parsed.items[0]?.extensions?.["X-AUTIPLANNER-NOTE"], "keep me");
  assert.equal(parsed.items[0]?.start, undefined);
  assert.equal(parsed.items[0]?.date, "2026-08-11");
  assert.equal(parsed.series[0]?.uid, "series@autiplanner.local");
  assert.equal(parsed.series[0]?.recurrence.freq, "daily");
  assert.equal(
    parsed.items.some((item) => item.uid === "series@autiplanner.local"),
    false,
  );

  const written = serializeCalendar(parsed, { dtstamp: stamp });
  assert.match(written, /X-AUTIPLANNER-ICON:pill/);
  assert.match(written, /BEGIN:VEVENT/);
  assert.match(written, /SUMMARY:Appointment/);
  assert.match(written, /RRULE:FREQ=DAILY/);
  const again = parseCalendar(written);
  assert.equal(again.items[0]?.extensions?.["X-AUTIPLANNER-NOTE"], "keep me");
});

test("reports malformed lines and still imports valid siblings", () => {
  const parsed = parseCalendar(
    calendar(
      [
        "THIS IS NOT A PROPERTY",
        vtodo([
          "UID:ok@autiplanner.local",
          "DTSTAMP:20260811T060000Z",
          "DTSTART;TZID=Europe/Stockholm:20260811T080000",
          "SUMMARY:Breakfast",
          "STATUS:NEEDS-ACTION",
          "X-AUTIPLANNER-DAYPART:morning",
          "X-AUTIPLANNER-OUTCOME:pending",
        ]),
      ].join("\r\n"),
    ),
  );
  assert.ok(parsed.issues.some((issue) => issue.code === "malformed-line"));
  assert.equal(parsed.items[0]?.title, "Breakfast");
  assert.equal(parsed.items[0]?.timezone, "Europe/Stockholm");
  assert.equal(parsed.items[0]?.start, "2026-08-11T08:00:00");
  assert.equal(parsed.items[0]?.dayPart, "morning");

  const written = serializeItems(parsed.items, { dtstamp: stamp });
  assert.match(written, /DTSTART;TZID=Europe\/Stockholm:20260811T080000/);
  assert.doesNotMatch(written, /DTSTART:20260811T080000Z/);
});

test("converts a numeric offset to UTC and keeps the explicit local date", () => {
  const written = serializeItems(
    [
      routine({
        uid: "late@autiplanner.local",
        title: "Wind down",
        date: "2026-08-11",
        start: "2026-08-11T00:30:00+02:00",
        dayPart: "night",
      }),
    ],
    { dtstamp: stamp },
  );
  const parsed = parseCalendar(written);
  assert.equal(parsed.items[0]?.start, "2026-08-10T22:30:00Z");
  assert.equal(parsed.items[0]?.date, "2026-08-11");
  assert.equal(parsed.items[0]?.dayPart, "night");
});

test("rejects mixed timezones instead of guessing one", () => {
  const parsed = parseCalendar(
    calendar(
      vtodo([
        "UID:mixed@autiplanner.local",
        "DTSTAMP:20260811T060000Z",
        "DTSTART;TZID=Europe/Stockholm:20260811T080000",
        "DUE;TZID=America/New_York:20260811T090000",
        "SUMMARY:Mixed",
        "STATUS:NEEDS-ACTION",
        "X-AUTIPLANNER-DAYPART:MORNING",
        "X-AUTIPLANNER-OUTCOME:PENDING",
      ]),
    ),
  );
  assert.equal(parsed.items.length, 0);
  assert.ok(parsed.issues.some((issue) => issue.code === "timezone-conflict"));
});

test("does not rewrite CANCELLED as skipped or missed", () => {
  const parsed = parseCalendar(
    calendar(
      vtodo([
        "UID:cancelled@autiplanner.local",
        "DTSTAMP:20260811T060000Z",
        "DTSTART:20260811T080000Z",
        "SUMMARY:Cancelled appointment",
        "STATUS:CANCELLED",
        "X-AUTIPLANNER-DAYPART:MORNING",
      ]),
    ),
  );
  assert.equal(parsed.items.length, 0);
  assert.ok(parsed.issues.some((issue) => issue.code === "unsupported-status"));
});

test("refuses to serialize an invalid missed item as completed", () => {
  assert.throws(
    () =>
      serializeItems([
        routine({ status: "missed", completedAt: "2026-08-11T08:05:00Z" }),
      ]),
    (error: unknown) => error instanceof IcsSerializeError,
  );
});
