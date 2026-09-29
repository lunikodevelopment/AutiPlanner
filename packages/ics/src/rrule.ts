import {
  WEEKDAY_CODES,
  type RecurrenceRule,
  type WeekdayCode,
} from "@autiplanner/core";

const FREQ = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
} as const;

export function parseRrule(value: string): RecurrenceRule | undefined {
  const parts = new Map<string, string>();
  for (const piece of value.split(";")) {
    const separator = piece.indexOf("=");
    if (separator <= 0) return undefined;
    parts.set(piece.slice(0, separator).trim().toUpperCase(), piece.slice(separator + 1).trim());
  }
  const freqToken = parts.get("FREQ");
  const freq = freqToken ? FREQ[freqToken as keyof typeof FREQ] : undefined;
  if (!freq) return undefined;
  if (parts.has("COUNT") && parts.has("UNTIL")) return undefined;

  const rule: RecurrenceRule = { freq };
  const interval = parts.get("INTERVAL");
  if (interval !== undefined) {
    if (!/^\d+$/.test(interval) || Number(interval) < 1) return undefined;
    rule.interval = Number(interval);
  }
  const count = parts.get("COUNT");
  if (count !== undefined) {
    if (!/^\d+$/.test(count) || Number(count) < 1) return undefined;
    rule.count = Number(count);
  }
  const until = parts.get("UNTIL");
  if (until !== undefined) {
    const date = untilDate(until);
    if (!date) return undefined;
    rule.until = date;
  }
  const byDay = parts.get("BYDAY");
  if (byDay !== undefined) {
    if (freq === "monthly") return undefined;
    const days = byDay.split(",").map((day) => day.trim().toUpperCase());
    if (days.some((day) => !isWeekday(day))) return undefined;
    rule.byDay = days as WeekdayCode[];
  }
  return rule;
}

export function formatRrule(rule: RecurrenceRule): string {
  const freq = rule.freq.toUpperCase();
  const parts = [`FREQ=${freq}`];
  if (rule.interval !== undefined && rule.interval !== 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) parts.push(`UNTIL=${rule.until.replaceAll("-", "")}`);
  if (rule.byDay && rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  return parts.join(";");
}

function untilDate(value: string): string | undefined {
  const date = value.includes("-")
    ? value.slice(0, 10)
    : value.replace(/^(\d{4})(\d{2})(\d{2}).*$/, "$1-$2-$3");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function isWeekday(value: string): value is WeekdayCode {
  return (WEEKDAY_CODES as readonly string[]).includes(value);
}
