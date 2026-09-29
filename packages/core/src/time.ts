const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/;

export const WEEKDAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/**
 * True for a real Gregorian calendar day. This does not interpret a clock
 * or a timezone.
 */
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/**
 * ISO-8601 timestamp. A missing offset is a floating local time, not UTC.
 * Callers must not invent a timezone for that form.
 */
export function isIsoTimestamp(value: string): boolean {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const date = match[1];
  if (!date || !isCalendarDate(date)) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 60) return false;
  const offset = match[5];
  if (!offset || offset === "Z") return true;
  const offsetHour = Number(offset.slice(1, 3));
  const offsetMinute = Number(offset.slice(4, 6));
  return offsetHour <= 23 && offsetMinute <= 59;
}

/** True when the timestamp is UTC or carries a numeric offset. */
export function hasExplicitOffset(value: string): boolean {
  return isIsoTimestamp(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

export function calendarDateOf(timestamp: string): string | undefined {
  if (!isIsoTimestamp(timestamp)) return undefined;
  return timestamp.slice(0, 10);
}

export function weekdayName(date: string): Weekday | undefined {
  if (!isCalendarDate(date)) return undefined;
  const match = DATE_PATTERN.exec(date);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return weekday;
}

/**
 * Converts a numeric offset to UTC. This uses the offset already present on
 * the timestamp; it does not look up or guess a timezone name.
 */
export function toUtcTimestamp(value: string): string | undefined {
  if (!hasExplicitOffset(value)) return undefined;
  if (value.endsWith("Z")) return value;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return undefined;
  const date = match[1];
  const offset = match[5];
  if (!date || !offset || offset === "Z") return undefined;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const sign = offset.startsWith("-") ? -1 : 1;
  const offsetMinutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute - offsetMinutes, second));
  return formatUtcTimestamp(utc);
}

export function formatUtcTimestamp(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const hour = date.getUTCHours().toString().padStart(2, "0");
  const minute = date.getUTCMinutes().toString().padStart(2, "0");
  const second = date.getUTCSeconds().toString().padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}
