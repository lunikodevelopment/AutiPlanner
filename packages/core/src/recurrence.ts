import type { DayPart, RoutineItem, RoutineStatus } from "./model.js";
import { isCalendarDate } from "./time.js";

export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export interface RecurrenceRule {
  freq: "daily" | "weekly" | "monthly";
  /** Defaults to 1. Must be at least 1. */
  interval?: number;
  /** Limits generated instances before EXDATE removal. */
  count?: number;
  /** Inclusive calendar day. Not converted from another timezone. */
  until?: string;
  /** Weekly only. Without it, weekly repeats the anchor weekday. */
  byDay?: readonly WeekdayCode[];
}

/**
 * A reusable series or template. Completion never belongs on this object.
 * Callers expand a bounded window; this module does not materialize an
 * open-ended future calendar.
 */
export interface RoutineTemplate {
  uid: string;
  title: string;
  dayPart: DayPart;
  /** Anchor local date. Occurrences start here. */
  date: string;
  recurrence: RecurrenceRule;
  description?: string;
  start?: string;
  due?: string;
  timezone?: string;
  order?: number;
  tags?: readonly string[];
  extensions?: Readonly<Record<string, string>>;
  exdates?: readonly string[];
  rdates?: readonly string[];
}

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurrenceError";
  }
}

/** A requested window larger than this is rejected instead of truncated. */
export const MAX_WINDOW_DAYS = 366;
const MAX_STEPS = 10000;

const WEEKDAY_FROM_CODE: Readonly<Record<WeekdayCode, number>> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

export function occurrenceUid(seriesUid: string, date: string): string {
  return `${seriesUid}:${date}`;
}

export function isOccurrenceUid(uid: string, seriesUid: string, date: string): boolean {
  return uid === occurrenceUid(seriesUid, date);
}

/**
 * Expands a series inside [rangeStart, rangeEnd). The series master is never
 * returned as a completed item. An occurrence document replaces the generated
 * pending item for that date, including when the date is listed in EXDATE.
 */
export function expandSeries(
  template: RoutineTemplate,
  rangeStart: string,
  rangeEnd: string,
  overrides: readonly RoutineItem[] = [],
): readonly RoutineItem[] {
  assertWindow(rangeStart, rangeEnd);
  const dates = occurrenceDates(template, rangeStart, rangeEnd);
  const extras = (template.rdates ?? []).filter(
    (date) => date >= rangeStart && date < rangeEnd && isCalendarDate(date),
  );
  const unique = [...new Set([...dates, ...extras])].sort();
  return unique.map((date) => overrideFor(template, date, overrides) ?? synthesize(template, date));
}

/** Pending occurrence used when a command first records state for a date. */
export function materializeOccurrence(
  template: RoutineTemplate,
  date: string,
  status: RoutineStatus = "pending",
  completedAt?: string,
): RoutineItem {
  if (!isCalendarDate(date)) {
    throw new RecurrenceError("occurrence date must be YYYY-MM-DD");
  }
  const item = synthesize(template, date);
  item.status = status;
  if (completedAt !== undefined) item.completedAt = completedAt;
  return item;
}

export function applyTemplate(template: RoutineTemplate, date: string): RoutineItem {
  return materializeOccurrence(template, date);
}

function occurrenceDates(
  template: RoutineTemplate,
  rangeStart: string,
  rangeEnd: string,
): string[] {
  const rule = template.recurrence;
  const interval = rule.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1) {
    throw new RecurrenceError("recurrence interval must be a positive integer");
  }
  if (rule.count !== undefined && (!Number.isInteger(rule.count) || rule.count < 1)) {
    throw new RecurrenceError("recurrence count must be a positive integer");
  }
  if (rule.until !== undefined && !isCalendarDate(rule.until)) {
    throw new RecurrenceError("recurrence until must be YYYY-MM-DD");
  }
  if (!isCalendarDate(template.date)) {
    throw new RecurrenceError("series anchor date is invalid");
  }
  if (rule.freq === "monthly" && rule.byDay && rule.byDay.length > 0) {
    throw new RecurrenceError("monthly BYDAY is outside the implemented subset");
  }

  const excluded = new Set(template.exdates ?? []);
  const dates: string[] = [];
  let generated = 0;
  let steps = 0;
  let cursor = template.date;

  while (cursor < rangeEnd && steps < MAX_STEPS) {
    steps += 1;
    if (rule.count !== undefined && generated >= rule.count) break;
    if (rule.until !== undefined && cursor > rule.until) break;
    const matches = datesMatching(template, cursor);
    for (const date of matches) {
      if (rule.count !== undefined && generated >= rule.count) break;
      if (rule.until !== undefined && date > rule.until) continue;
      if (date < template.date) continue;
      generated += 1;
      if (date >= rangeStart && date < rangeEnd && !excluded.has(date)) dates.push(date);
    }
    cursor = advanceCursor(template, cursor, interval);
    if (cursor <= template.date && rule.freq !== "daily") break;
  }
  if (steps >= MAX_STEPS) {
    throw new RecurrenceError("recurrence exceeded the safety step limit");
  }
  return dates;
}

function datesMatching(template: RoutineTemplate, cursor: string): string[] {
  const rule = template.recurrence;
  if (rule.freq === "daily") return [cursor];
  if (rule.freq === "monthly") {
    return dayOfMonth(cursor) === dayOfMonth(template.date) ? [cursor] : [];
  }
  const byDay = [
    ...new Set(rule.byDay && rule.byDay.length > 0 ? rule.byDay : [weekdayCode(template.date)]),
  ];
  const weekStart = startOfWeek(cursor);
  const dates: string[] = [];
  for (const code of byDay) {
    const date = addDays(weekStart, WEEKDAY_FROM_CODE[code]);
    if (date >= template.date) dates.push(date);
  }
  return dates.sort();
}

function advanceCursor(template: RoutineTemplate, cursor: string, interval: number): string {
  if (template.recurrence.freq === "daily") return addDays(cursor, interval);
  if (template.recurrence.freq === "weekly") return addDays(startOfWeek(cursor), 7 * interval);
  return addMonths(cursor, interval, dayOfMonth(template.date));
}

function overrideFor(
  template: RoutineTemplate,
  date: string,
  overrides: readonly RoutineItem[],
): RoutineItem | undefined {
  const uid = occurrenceUid(template.uid, date);
  return overrides.find(
    (item) => item.uid === uid || (item.routineId === template.uid && item.date === date),
  );
}

function synthesize(template: RoutineTemplate, date: string): RoutineItem {
  const item: RoutineItem = {
    uid: occurrenceUid(template.uid, date),
    title: template.title,
    date,
    dayPart: template.dayPart,
    status: "pending",
    routineId: template.uid,
  };
  const start = shiftClock(template.start, date);
  const due = shiftClock(template.due, date);
  if (template.description !== undefined) item.description = template.description;
  if (start !== undefined) item.start = start;
  if (due !== undefined) item.due = due;
  if (template.timezone !== undefined) item.timezone = template.timezone;
  if (template.order !== undefined) item.order = template.order;
  if (template.tags !== undefined) item.tags = [...template.tags];
  if (template.extensions !== undefined) item.extensions = { ...template.extensions };
  return item;
}

function shiftClock(timestamp: string | undefined, date: string): string | undefined {
  if (timestamp === undefined) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(
    timestamp,
  );
  if (!match) return undefined;
  return `${date}T${match[2]}${match[3] ?? ""}`;
}

function assertWindow(rangeStart: string, rangeEnd: string): void {
  if (!isCalendarDate(rangeStart) || !isCalendarDate(rangeEnd)) {
    throw new RecurrenceError("range must use YYYY-MM-DD");
  }
  if (rangeEnd < rangeStart) throw new RecurrenceError("range end is before start");
  const days = differenceInDays(rangeStart, rangeEnd);
  if (days > MAX_WINDOW_DAYS) {
    throw new RecurrenceError(
      `range is ${days} days; expansion is limited to ${MAX_WINDOW_DAYS} days`,
    );
  }
}

function weekdayCode(date: string): WeekdayCode {
  const utc = utcDate(date);
  const index = utc.getUTCDay();
  const code = WEEKDAY_CODES.find((candidate) => WEEKDAY_FROM_CODE[candidate] === index);
  if (!code) throw new RecurrenceError("invalid weekday");
  return code;
}

function startOfWeek(date: string): string {
  return addDays(date, -utcDate(date).getUTCDay());
}

function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

function addDays(date: string, days: number): string {
  const utc = utcDate(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return formatUtcDate(utc);
}

function addMonths(date: string, months: number, day: number): string {
  const utc = utcDate(date);
  const targetMonth = utc.getUTCMonth() + months;
  const year = utc.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (day > lastDay) {
    const nextMonth = new Date(Date.UTC(year, month + 1, 1));
    return formatUtcDate(nextMonth);
  }
  return formatUtcDate(new Date(Date.UTC(year, month, day)));
}

function differenceInDays(start: string, end: string): number {
  const ms = utcDate(end).getTime() - utcDate(start).getTime();
  return Math.round(ms / 86_400_000);
}

function utcDate(date: string): Date {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}
