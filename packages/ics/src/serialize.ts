import {
  occurrenceUid,
  toUtcTimestamp,
  validateRoutineItem,
  type RoutineItem,
  type RoutineTemplate,
} from "@autiplanner/core";
import {
  AUTIPLANNER_PRODID,
  DAY_PART_TO_ICS,
  ICS_DATE_PROPERTY,
  ICS_DAY_PART_PROPERTY,
  ICS_ORDER_PROPERTY,
  ICS_OUTCOME_PROPERTY,
  ICS_REVISION_PROPERTY,
  ICS_ROUTINE_ID_PROPERTY,
  MAPPED_EXTENSION_PROPERTIES,
  STATUS_TO_ICS_OUTCOME,
  STATUS_TO_VTODO_STATUS,
} from "./profile.js";
import { formatRrule } from "./rrule.js";
import { escapeText, foldContentLine, joinEscapedList } from "./text.js";
import { formatBasicDate, formatBasicLocal, formatBasicUtc, formatTzidParam } from "./time.js";
import { IcsSerializeError, type SerializeOptions } from "./types.js";

const MAPPED = new Set(MAPPED_EXTENSION_PROPERTIES);

/**
 * Writes routine items as a new AutiPlanner calendar.
 * Unmodeled components are not included; use {@link serializeCalendar}
 * with a parse result to keep preserved blocks.
 */
export function serializeItems(
  items: readonly RoutineItem[],
  options: SerializeOptions = {},
): string {
  return serializeCalendar({ items }, options);
}

/**
 * Writes modeled items and appends preserved components/properties from a
 * previous parse. Modeled VTODO records are emitted from domain state, so a
 * missed or skipped item cannot be rewritten as completed by the serializer.
 */
export function serializeCalendar(
  calendar: {
    prodId?: string;
    method?: string;
    calendarProperties?: readonly string[];
    items: readonly RoutineItem[];
    series?: readonly RoutineTemplate[];
    preserved?: readonly string[];
  },
  options: SerializeOptions = {},
): string {
  const dtstamp = options.dtstamp ?? new Date();
  if (Number.isNaN(dtstamp.getTime())) {
    throw new IcsSerializeError(["dtstamp is invalid"]);
  }
  assertSerializable(calendar.items);
  const prodId = calendar.prodId ?? options.prodId ?? AUTIPLANNER_PRODID;
  assertToken("PRODID", prodId, true);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    textProperty("PRODID", prodId),
    "CALSCALE:GREGORIAN",
  ];
  if (calendar.method !== undefined) {
    assertToken("METHOD", calendar.method, false);
    lines.push(`METHOD:${calendar.method}`);
  }
  for (const property of calendar.calendarProperties ?? []) {
    if (/[\r\n]/.test(property.replaceAll("\r\n ", "").replaceAll("\r\n\t", ""))) {
      throw new IcsSerializeError(["calendar property contains a bare newline"]);
    }
    lines.push(property);
  }
  for (const series of calendar.series ?? []) {
    lines.push(...serializeSeries(series, dtstamp));
  }
  for (const item of calendar.items) {
    lines.push(...serializeItem(item, dtstamp));
  }
  for (const block of calendar.preserved ?? []) {
    lines.push(block);
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function serializeSeries(series: RoutineTemplate, dtstamp: Date): string[] {
  const lines = [
    "BEGIN:VTODO",
    textProperty("UID", series.uid),
    propertyLine("DTSTAMP", formatUtcStamp(dtstamp)),
  ];
  if (series.start !== undefined) lines.push(timeProperty("DTSTART", series.start, series.timezone));
  else lines.push(dateProperty("DTSTART", series.date));
  if (series.due !== undefined) lines.push(timeProperty("DUE", series.due, series.timezone));
  lines.push(propertyLine("RRULE", formatRrule(series.recurrence)));
  if (series.exdates && series.exdates.length > 0) {
    lines.push(
      propertyLine(
        "EXDATE",
        series.exdates.map((date) => date.replaceAll("-", "")).join(","),
        ["VALUE=DATE"],
      ),
    );
  }
  if (series.rdates && series.rdates.length > 0) {
    lines.push(
      propertyLine(
        "RDATE",
        series.rdates.map((date) => date.replaceAll("-", "")).join(","),
        ["VALUE=DATE"],
      ),
    );
  }
  lines.push(textProperty("SUMMARY", series.title));
  if (series.description) lines.push(textProperty("DESCRIPTION", series.description));
  lines.push(propertyLine("STATUS", "NEEDS-ACTION"));
  lines.push(propertyLine(ICS_DATE_PROPERTY, series.date));
  lines.push(propertyLine(ICS_DAY_PART_PROPERTY, DAY_PART_TO_ICS[series.dayPart]));
  lines.push(propertyLine(ICS_OUTCOME_PROPERTY, "PENDING"));
  if (series.order !== undefined) lines.push(propertyLine(ICS_ORDER_PROPERTY, String(series.order)));
  lines.push("END:VTODO");
  return lines;
}

function serializeItem(item: RoutineItem, dtstamp: Date): string[] {
  const lines = [
    "BEGIN:VTODO",
    textProperty("UID", item.uid),
    propertyLine("DTSTAMP", formatUtcStamp(dtstamp)),
  ];
  if (item.start !== undefined) {
    lines.push(timeProperty("DTSTART", item.start, item.timezone));
  } else if (item.due === undefined && item.end === undefined) {
    lines.push(dateProperty("DTSTART", item.date));
  }
  if (item.due !== undefined) lines.push(timeProperty("DUE", item.due, item.timezone));
  if (item.end !== undefined) lines.push(timeProperty("DTEND", item.end, item.timezone));
  lines.push(textProperty("SUMMARY", item.title));
  if (item.description) lines.push(textProperty("DESCRIPTION", item.description));
  lines.push(propertyLine("STATUS", STATUS_TO_VTODO_STATUS[item.status]));
  if (item.status === "completed") {
    lines.push(propertyLine("COMPLETED", completedValue(item)));
  }
  if (item.tags && item.tags.length > 0) {
    lines.push(propertyLine("CATEGORIES", joinEscapedList(item.tags)));
  }
  lines.push(propertyLine(ICS_DATE_PROPERTY, item.date));
  lines.push(propertyLine(ICS_DAY_PART_PROPERTY, DAY_PART_TO_ICS[item.dayPart]));
  lines.push(propertyLine(ICS_OUTCOME_PROPERTY, STATUS_TO_ICS_OUTCOME[item.status]));
  if (item.routineId !== undefined && item.uid === occurrenceUid(item.routineId, item.date)) {
    lines.push(propertyLine("RECURRENCE-ID", item.date.replaceAll("-", ""), ["VALUE=DATE"]));
  }
  if (item.order !== undefined) lines.push(propertyLine(ICS_ORDER_PROPERTY, String(item.order)));
  if (item.routineId !== undefined) {
    lines.push(textProperty(ICS_ROUTINE_ID_PROPERTY, item.routineId));
  }
  if (item.revision !== undefined) {
    lines.push(propertyLine(ICS_REVISION_PROPERTY, String(item.revision)));
  }
  if (item.extensions) {
    for (const key of Object.keys(item.extensions).sort()) {
      if (MAPPED.has(key)) continue;
      const value = item.extensions[key];
      if (value === undefined) continue;
      lines.push(textProperty(key, value));
    }
  }
  lines.push("END:VTODO");
  return lines;
}

function timeProperty(name: string, timestamp: string, timezone: string | undefined): string {
  const utc = formatBasicUtc(timestamp);
  if (utc) return propertyLine(name, utc);
  if (/[+-]\d{2}:\d{2}$/.test(timestamp)) {
    const converted = toUtcTimestamp(timestamp);
    const basic = converted ? formatBasicUtc(converted) : undefined;
    if (!basic) throw new IcsSerializeError([`${name} has an invalid offset`]);
    return propertyLine(name, basic);
  }
  const local = formatBasicLocal(timestamp);
  if (!local) throw new IcsSerializeError([`${name} is not an ISO-8601 timestamp`]);
  if (timezone) return propertyLine(name, local, [formatTzidParam(timezone)]);
  return propertyLine(name, local);
}

function dateProperty(name: string, date: string): string {
  const basic = formatBasicDate(date);
  if (!basic) throw new IcsSerializeError([`${name} date is invalid`]);
  return propertyLine(name, basic, ["VALUE=DATE"]);
}

function completedValue(item: RoutineItem): string {
  if (!item.completedAt) {
    throw new IcsSerializeError(["completed items require completedAt"]);
  }
  const utc = item.completedAt.endsWith("Z")
    ? item.completedAt
    : toUtcTimestamp(item.completedAt);
  const basic = utc ? formatBasicUtc(utc) : undefined;
  if (!basic) {
    throw new IcsSerializeError(["completedAt must include a UTC or numeric offset"]);
  }
  return basic;
}

function propertyLine(name: string, value: string, params: readonly string[] = []): string {
  const encodedParams = params.length > 0 ? `;${params.join(";")}` : "";
  return foldContentLine(`${name}${encodedParams}:${value}`);
}

function textProperty(name: string, value: string): string {
  return propertyLine(name, escapeText(value));
}

function formatUtcStamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return (
    `${date.getUTCFullYear().toString().padStart(4, "0")}` +
    `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function assertSerializable(items: readonly RoutineItem[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    const errors = [...validateRoutineItem(item)];
    if (seen.has(item.uid)) errors.push(`duplicate uid: ${item.uid}`);
    seen.add(item.uid);
    if (errors.length > 0) throw new IcsSerializeError(errors);
  }
}

function assertToken(name: string, value: string, allowPunctuation: boolean): void {
  if (value.length === 0 || /[\r\n]/.test(value)) {
    throw new IcsSerializeError([`${name} contains a newline or is empty`]);
  }
  if (!allowPunctuation && !/^[A-Z0-9-]+$/.test(value)) {
    throw new IcsSerializeError([`${name} must be an uppercase token`]);
  }
}
