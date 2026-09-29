import { isCalendarDate } from "@autiplanner/core";

const BASIC_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const BASIC_DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

export type IcsTimeForm = "date" | "utc" | "zoned" | "floating";

export interface ParsedIcsTime {
  date: string;
  timestamp?: string;
  timezone?: string;
  form: IcsTimeForm;
}

/**
 * Parses an iCalendar DATE or DATE-TIME without guessing a timezone.
 * UTC, TZID, floating local time, and all-day dates stay distinct.
 */
export function parseIcsTime(
  value: string,
  params: Readonly<Record<string, string>>,
): ParsedIcsTime | undefined {
  const trimmed = value.trim();
  const valueType = params.VALUE?.toUpperCase();
  const timezone = params.TZID?.trim();
  if (timezone === "") return undefined;

  if (trimmed.includes("T")) {
    if (valueType === "DATE") return undefined;
    return parseDateTime(trimmed, timezone);
  }

  if (valueType === "DATE-TIME") return undefined;
  return parseDate(trimmed, timezone);
}

export function formatBasicUtc(timestamp: string): string | undefined {
  if (!timestamp.endsWith("Z")) return undefined;
  return timestamp.replaceAll("-", "").replaceAll(":", "");
}

export function formatBasicLocal(timestamp: string): string | undefined {
  if (timestamp.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(timestamp)) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(timestamp)) return undefined;
  return timestamp.replaceAll("-", "").replaceAll(":", "");
}

export function formatBasicDate(date: string): string | undefined {
  if (!isCalendarDate(date)) return undefined;
  return date.replaceAll("-", "");
}

export function formatTzidParam(timezone: string): string {
  if (/^[A-Za-z0-9_/+.-]+$/.test(timezone)) return `TZID=${timezone}`;
  return `TZID="${timezone.replaceAll('"', "")}"`;
}

function parseDate(value: string, timezone: string | undefined): ParsedIcsTime | undefined {
  if (timezone) return undefined;
  const match = BASIC_DATE.exec(value);
  if (!match) return undefined;
  const date = isoDate(match[1], match[2], match[3]);
  if (!date) return undefined;
  return { date, form: "date" };
}

function parseDateTime(
  value: string,
  timezone: string | undefined,
): ParsedIcsTime | undefined {
  const match = BASIC_DATE_TIME.exec(value);
  if (!match) return undefined;
  const date = isoDate(match[1], match[2], match[3]);
  if (!date) return undefined;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 60) return undefined;
  const clock = `${match[4]}:${match[5]}:${match[6]}`;
  if (match[7] === "Z") {
    if (timezone) return undefined;
    return { date, timestamp: `${date}T${clock}Z`, form: "utc" };
  }
  if (timezone) {
    if (/[\r\n";,]/.test(timezone)) return undefined;
    return { date, timestamp: `${date}T${clock}`, timezone, form: "zoned" };
  }
  return { date, timestamp: `${date}T${clock}`, form: "floating" };
}

function isoDate(
  year: string | undefined,
  month: string | undefined,
  day: string | undefined,
): string | undefined {
  if (!year || !month || !day) return undefined;
  const date = `${year}-${month}-${day}`;
  return isCalendarDate(date) ? date : undefined;
}
