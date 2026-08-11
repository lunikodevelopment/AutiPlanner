import type { DayPart, RoutineItem, RoutineStatus } from "./model.js";

export interface RecurrenceWindow {
  from: string;
  to: string;
  /** Bounds expansion even when an RRULE has no COUNT/UNTIL. */
  maxOccurrences?: number;
}

export interface RoutineOccurrenceOverride {
  status: RoutineStatus;
  completedAt?: string;
}

export type RoutineOccurrenceOverrides = Readonly<Record<string, RoutineOccurrenceOverride>>;

export interface RoutineOccurrence extends RoutineItem {
  /** UID of the recurring master/template. */
  seriesUid: string;
}

export interface RoutineTemplate {
  routineId: string;
  title: string;
  date: string;
  dayPart: DayPart;
  rrule: string;
  description?: string;
  start?: string;
  due?: string;
  timezone?: string;
  tags?: readonly string[];
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const DEFAULT_MAX_OCCURRENCES = 1000;

/** Create the stable identity used for one date in a routine series. */
export function occurrenceUid(seriesUid: string, date: string): string {
  return `${seriesUid}::${date}`;
}

/** Convert a reusable template into one pending recurring master. */
export function routineTemplateToMaster(template: RoutineTemplate): RoutineItem {
  const master: RoutineItem = {
    uid: `template:${template.routineId}`,
    title: template.title,
    date: template.date,
    dayPart: template.dayPart,
    status: "pending",
    rrule: template.rrule,
    routineId: template.routineId,
  };
  if (template.description !== undefined) master.description = template.description;
  if (template.start !== undefined) master.start = template.start;
  if (template.due !== undefined) master.due = template.due;
  if (template.timezone !== undefined) master.timezone = template.timezone;
  if (template.tags !== undefined) master.tags = template.tags;
  return master;
}

/** Expand a routine only inside the requested window. */
export function expandRoutineItem(
  item: RoutineItem,
  window: RecurrenceWindow,
  overrides: RoutineOccurrenceOverrides = {},
): readonly RoutineOccurrence[] {
  assertDateRange(window);
  const maxOccurrences = window.maxOccurrences ?? DEFAULT_MAX_OCCURRENCES;
  if (!Number.isInteger(maxOccurrences) || maxOccurrences < 1) {
    throw new Error("maxOccurrences must be a positive integer");
  }

  const recurrenceDates = item.rrule === undefined && item.rdate === undefined
    ? [item.date]
    : collectRecurrenceDates(item, window, maxOccurrences);

  return recurrenceDates
    .filter((date) => date >= window.from && date <= window.to)
    .slice(0, maxOccurrences)
    .map((date) => toOccurrence(item, date, overrides[occurrenceUid(item.uid, date)]));
}

function collectRecurrenceDates(
  item: RoutineItem,
  window: RecurrenceWindow,
  maxOccurrences: number,
): readonly string[] {
  const dates = new Set<string>();
  const rule = item.rrule === undefined ? undefined : parseRule(item.rrule);
  const until = rule?.UNTIL === undefined ? undefined : recurrenceDateKey(rule.UNTIL);
  const count = rule?.COUNT === undefined ? undefined : parsePositiveInteger(rule.COUNT, "COUNT");
  let occurrenceCount = 0;

  const start = parseDate(item.date);
  const end = parseDate(window.to);
  for (let cursor = start; cursor <= end && dates.size < maxOccurrences; cursor = addDays(cursor, 1)) {
    if (until !== undefined && cursor > parseDate(until)) break;
    if (matchesRule(cursor, start, rule) && (count === undefined || occurrenceCount < count)) {
      dates.add(formatDate(cursor));
      occurrenceCount += 1;
    }
  }

  for (const value of item.rdate ?? []) {
    const date = recurrenceDateKey(value);
    if (date >= item.date && date <= window.to) dates.add(date);
  }
  for (const value of item.exdate ?? []) dates.delete(recurrenceDateKey(value));
  return [...dates].sort();
}

function toOccurrence(
  master: RoutineItem,
  date: string,
  override: RoutineOccurrenceOverride | undefined,
): RoutineOccurrence {
  const uid = occurrenceUid(master.uid, date);
  const status = override?.status ?? "pending";
  if (status === "completed" && !override?.completedAt) {
    throw new Error(`Completed occurrence ${uid} requires completedAt`);
  }
  const occurrence: RoutineOccurrence = {
    uid,
    seriesUid: master.uid,
    title: master.title,
    date,
    dayPart: master.dayPart,
    status,
    recurrenceId: date,
  };
  if (master.description !== undefined) occurrence.description = master.description;
  const start = shiftDate(master.start, master.date, date);
  if (start !== undefined) occurrence.start = start;
  const end = shiftDate(master.end, master.date, date);
  if (end !== undefined) occurrence.end = end;
  const due = shiftDate(master.due, master.date, date);
  if (due !== undefined) occurrence.due = due;
  if (master.timezone !== undefined) occurrence.timezone = master.timezone;
  if (status === "completed" && override?.completedAt !== undefined) occurrence.completedAt = override.completedAt;
  if (master.order !== undefined) occurrence.order = master.order;
  occurrence.routineId = master.routineId ?? master.uid;
  if (master.revision !== undefined) occurrence.revision = master.revision;
  if (master.tags !== undefined) occurrence.tags = master.tags;
  if (master.extensions !== undefined) occurrence.extensions = master.extensions;
  return occurrence;
}

function matchesRule(cursor: Date, start: Date, rule: Readonly<Record<string, string>> | undefined): boolean {
  if (rule === undefined) return cursor.getTime() === start.getTime();
  const frequency = rule.FREQ;
  const interval = rule.INTERVAL === undefined ? 1 : parsePositiveInteger(rule.INTERVAL, "INTERVAL");
  const byDay = rule.BYDAY?.split(",").map((value) => value.slice(-2)) ?? [];

  if (frequency === "DAILY") {
    return dayDifference(start, cursor) % interval === 0 && (byDay.length === 0 || byDay.includes(weekdayAt(cursor)));
  }
  if (frequency === "WEEKLY") {
    const weekDifference = Math.floor(dayDifference(startOfWeek(start), startOfWeek(cursor)) / 7);
    const days = byDay.length > 0 ? byDay : [weekdayAt(start)];
    return weekDifference % interval === 0 && days.includes(weekdayAt(cursor));
  }
  if (frequency === "MONTHLY") {
    const monthDifference = (cursor.getUTCFullYear() - start.getUTCFullYear()) * 12 + cursor.getUTCMonth() - start.getUTCMonth();
    const day = rule.BYMONTHDAY === undefined ? start.getUTCDate() : Number(rule.BYMONTHDAY);
    return monthDifference >= 0 && monthDifference % interval === 0 && cursor.getUTCDate() === day;
  }
  throw new Error(`Unsupported RRULE frequency: ${frequency ?? "(missing)"}`);
}

function parseRule(value: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid RRULE part: ${part}`);
    const key = part.slice(0, separator).trim().toUpperCase();
    const entry = part.slice(separator + 1).trim().toUpperCase();
    if (!key || !entry) throw new Error(`Invalid RRULE part: ${part}`);
    result[key] = entry;
  }
  if (result.FREQ === undefined) throw new Error("RRULE requires FREQ");
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(result.FREQ)) {
    throw new Error(`Unsupported RRULE frequency: ${result.FREQ}`);
  }
  return result;
}

function recurrenceDateKey(value: string): string {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value.trim());
  if (match === null) throw new Error(`Invalid recurrence date: ${value}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parsePositiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

function shiftDate(value: string | undefined, originalDate: string, occurrenceDate: string): string | undefined {
  return value === undefined ? undefined : value.startsWith(originalDate) ? `${occurrenceDate}${value.slice(originalDate.length)}` : value;
}

function assertDateRange(window: RecurrenceWindow): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(window.from) || !/^\d{4}-\d{2}-\d{2}$/.test(window.to) || window.from > window.to) {
    throw new Error("Recurrence window must contain an ordered YYYY-MM-DD range");
  }
}

function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  return parsed;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dayDifference(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function startOfWeek(value: Date): Date {
  return addDays(value, -value.getUTCDay());
}

function weekdayAt(value: Date): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[value.getUTCDay()] ?? "SU";
}
