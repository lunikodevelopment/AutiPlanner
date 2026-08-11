import {
  type DayPart,
  isDayPart,
  isRoutineStatus,
  type RoutineItem,
  type RoutineStatus,
  validateRoutineItem,
} from "@autiplanner/core";
import {
  AUTIPLANNER_PRODID,
  DAY_PART_TO_ICS,
  ICS_DAY_PART_PROPERTY,
  ICS_ICON_PROPERTY,
  ICS_OUTCOME_PROPERTY,
  ICS_ORDER_PROPERTY,
  ICS_PRIORITY_PROPERTY,
  ICS_REVISION_PROPERTY,
  ICS_ROUTINE_ID_PROPERTY,
  STATUS_TO_ICS_OUTCOME,
  STATUS_TO_VTODO_STATUS,
} from "./profile.js";

export * from "./profile.js";

const KNOWN_AUTIPLANNER_PROPERTIES = new Set([
  ICS_DAY_PART_PROPERTY,
  ICS_OUTCOME_PROPERTY,
  ICS_ORDER_PROPERTY,
  ICS_ICON_PROPERTY,
  ICS_PRIORITY_PROPERTY,
  ICS_ROUTINE_ID_PROPERTY,
  ICS_REVISION_PROPERTY,
]);

const ICS_LINE_LENGTH = 75;

export type IcsWarningCode =
  | "invalid-line"
  | "invalid-component"
  | "missing-calendar-envelope"
  | "missing-component-end"
  | "missing-required-property"
  | "invalid-property"
  | "invalid-date-time"
  | "invalid-day-part"
  | "invalid-outcome"
  | "invalid-status"
  | "invalid-number"
  | "conflicting-status"
  | "unsupported-component"
  | "duplicate-uid";

export interface IcsWarning {
  code: IcsWarningCode;
  message: string;
  lineNumber?: number;
  uid?: string;
}

export interface ParseOptions {
  /** Throw on the first malformed record instead of skipping it with a warning. */
  strict?: boolean;
  /** Explicit fallback for imported tasks with no day-part extension. */
  defaultDayPart?: DayPart;
}

export interface ParseResult {
  items: readonly RoutineItem[];
  warnings: readonly IcsWarning[];
}

export interface SerializeOptions {
  prodId?: string;
  /** Defaults to the current UTC time. A fixed value makes fixtures deterministic. */
  dtstamp?: string | Date;
}

export class IcsParseError extends Error {
  readonly warning: IcsWarning;

  constructor(warning: IcsWarning) {
    super(warning.message);
    this.name = "IcsParseError";
    this.warning = warning;
  }
}

export class IcsSerializationError extends Error {
  readonly uid?: string;
  readonly validationErrors: readonly string[];

  constructor(message: string, validationErrors: readonly string[] = [], uid?: string) {
    super(message);
    this.name = "IcsSerializationError";
    this.validationErrors = validationErrors;
    if (uid !== undefined) this.uid = uid;
  }
}

interface ParsedProperty {
  name: string;
  params: Readonly<Record<string, string>>;
  rawValue: string;
  value: string;
  lineNumber: number;
}

interface ParsedDateTime {
  date: string;
  isDate: boolean;
  iso?: string;
  timezone?: string;
}

/**
 * Unfold RFC 5545 physical lines into logical content lines.
 * A continuation line begins with one space or tab, which is removed.
 */
export function unfoldLines(input: string): readonly string[] {
  const physicalLines = input.replace(/\r\n?/g, "\n").split("\n");
  const logicalLines: string[] = [];

  for (const physicalLine of physicalLines) {
    if ((physicalLine.startsWith(" ") || physicalLine.startsWith("\t")) && logicalLines.length > 0) {
      logicalLines[logicalLines.length - 1] += physicalLine.slice(1);
    } else {
      logicalLines.push(physicalLine);
    }
  }

  if (logicalLines.at(-1) === "") logicalLines.pop();
  return logicalLines;
}

/** Escape an iCalendar TEXT value. */
export function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\n");
}

/** Unescape an iCalendar TEXT value while preserving unknown escape sequences. */
export function unescapeText(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\" || index + 1 >= value.length) {
      result += character ?? "";
      continue;
    }

    const escaped = value[index + 1];
    if (escaped === "n" || escaped === "N") result += "\n";
    else if (escaped === "\\" || escaped === ";" || escaped === ",") result += escaped;
    else result += `\\${escaped}`;
    index += 1;
  }
  return result;
}

/**
 * Fold a content line at 75 UTF-8 octets, as required by RFC 5545.
 * Continuation lines reserve one octet for their leading space.
 */
export function foldLine(line: string): string {
  if (utf8ByteLength(line) <= ICS_LINE_LENGTH) return line;

  const segments: string[] = [];
  let remaining = line;
  let first = true;

  while (remaining.length > 0) {
    const availableBytes = first ? ICS_LINE_LENGTH : ICS_LINE_LENGTH - 1;
    const segment = takeUtf8Prefix(remaining, availableBytes);
    if (segment.length === 0) {
      throw new Error("Unable to fold an iCalendar line");
    }
    segments.push(segment);
    remaining = remaining.slice(segment.length);
    first = false;
  }

  return segments.join("\r\n ");
}

/** Parse an iCalendar string and return valid AutiPlanner routine items. */
export function parseCalendar(input: string, options: ParseOptions = {}): ParseResult {
  const warnings: IcsWarning[] = [];
  const items: RoutineItem[] = [];
  const stack: string[] = [];
  let currentTodo: ParsedProperty[] | null = null;
  let todoNestedDepth = 0;
  let sawCalendar = false;
  let sawTodo = false;

  const lines = unfoldLines(input);
  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineIndex + 1;
    if (line.trim() === "") {
      addWarning(
        warnings,
        options,
        warning("invalid-line", "Blank lines are not valid iCalendar content lines", lineNumber),
      );
      continue;
    }

    const property = parsePropertyLine(line, lineNumber);
    if (property === undefined) {
      addWarning(
        warnings,
        options,
        warning("invalid-line", `Invalid iCalendar content line: ${line}`, lineNumber),
      );
      continue;
    }

    if (property.name === "BEGIN") {
      const component = property.value.trim().toUpperCase();
      if (component === "VCALENDAR") sawCalendar = true;
      if (component === "VTODO") {
        if (currentTodo !== null || todoNestedDepth > 0) {
          addWarning(
            warnings,
            options,
            warning("invalid-component", "Nested or duplicate VTODO component", lineNumber),
          );
        } else {
          currentTodo = [];
          sawTodo = true;
        }
      } else if (currentTodo !== null) {
        todoNestedDepth += 1;
      } else if (component !== "VCALENDAR") {
        addWarning(
          warnings,
          options,
          warning("unsupported-component", `Ignoring unsupported component ${component}`, lineNumber),
        );
      }
      stack.push(component);
      continue;
    }

    if (property.name === "END") {
      const component = property.value.trim().toUpperCase();
      const expected = stack.at(-1);
      if (expected !== component) {
        addWarning(
          warnings,
          options,
          warning(
            "invalid-component",
            `Unexpected END:${component}; expected END:${expected ?? "(none)"}`,
            lineNumber,
          ),
        );
      }

      if (component === "VTODO" && currentTodo !== null && todoNestedDepth === 0) {
        const item = routineItemFromProperties(currentTodo, options, warnings);
        if (item !== undefined) items.push(item);
        currentTodo = null;
        sawTodo = true;
      } else if (currentTodo !== null && todoNestedDepth > 0) {
        todoNestedDepth -= 1;
      }

      if (expected !== undefined) stack.pop();
      continue;
    }

    if (currentTodo !== null && todoNestedDepth === 0) {
      currentTodo.push(property);
    }
  }

  if (currentTodo !== null) {
    addWarning(
      warnings,
      options,
      warning("missing-component-end", "VTODO is missing END:VTODO", lines.length || 1),
    );
    const item = routineItemFromProperties(currentTodo, options, warnings);
    if (item !== undefined) items.push(item);
  }

  if (stack.length > 0) {
    addWarning(
      warnings,
      options,
      warning("missing-component-end", `Missing component end for ${stack.at(-1)}`, lines.length || 1),
    );
  }

  if (sawTodo && !sawCalendar) {
    addWarning(
      warnings,
      options,
      warning("missing-calendar-envelope", "Parsed VTODO records without a VCALENDAR envelope"),
    );
  }

  return { items, warnings };
}

/** Compatibility alias for callers that prefer the shorter iCalendar name. */
export function parseIcs(input: string, options: ParseOptions = {}): ParseResult {
  return parseCalendar(input, options);
}

/** Parse and return only valid routine items; warnings are available through parseCalendar. */
export function parseRoutineItems(input: string, options: ParseOptions = {}): readonly RoutineItem[] {
  return parseCalendar(input, options).items;
}

/** Serialize routine items into a complete VCALENDAR document. */
export function serializeCalendar(
  items: readonly RoutineItem[],
  options: SerializeOptions = {},
): string {
  const dtstamp = formatDtstamp(options.dtstamp);
  const prodId = options.prodId ?? AUTIPLANNER_PRODID;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${escapeText(prodId)}`,
    "CALSCALE:GREGORIAN",
  ];

  for (const item of items) {
    lines.push(...serializeVtodo(item, dtstamp));
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** Compatibility alias for callers that prefer the shorter iCalendar name. */
export function serializeIcs(
  items: readonly RoutineItem[],
  options: SerializeOptions = {},
): string {
  return serializeCalendar(items, options);
}

function serializeVtodo(item: RoutineItem, dtstamp: string): readonly string[] {
  const validationErrors = validateRoutineItem(item);
  if (validationErrors.length > 0) {
    throw new IcsSerializationError(
      `Cannot serialize routine item ${item.uid || "(unknown UID)"}: ${validationErrors.join("; ")}`,
      validationErrors,
      item.uid,
    );
  }

  const lines = [
    "BEGIN:VTODO",
    `UID:${escapeText(item.uid)}`,
    `DTSTAMP:${dtstamp}`,
  ];

  if (item.start !== undefined) lines.push(formatScheduleProperty("DTSTART", item.start, item.timezone));
  else lines.push(`DTSTART;VALUE=DATE:${formatDate(item.date)}`);
  if (item.due !== undefined) lines.push(formatScheduleProperty("DUE", item.due, item.timezone));
  if (item.end !== undefined) lines.push(formatScheduleProperty("DTEND", item.end, item.timezone));
  if (item.rrule !== undefined) lines.push(`RRULE:${item.rrule}`);
  if (item.rdate !== undefined && item.rdate.length > 0) lines.push(formatRecurrenceList("RDATE", item.rdate, item.timezone));
  if (item.exdate !== undefined && item.exdate.length > 0) lines.push(formatRecurrenceList("EXDATE", item.exdate, item.timezone));
  if (item.recurrenceId !== undefined) lines.push(formatScheduleProperty("RECURRENCE-ID", item.recurrenceId, item.timezone));

  lines.push(`SUMMARY:${escapeText(item.title)}`);
  if (item.description !== undefined) lines.push(`DESCRIPTION:${escapeText(item.description)}`);
  if (item.icon !== undefined) lines.push(`${ICS_ICON_PROPERTY}:${escapeText(item.icon)}`);
  if (item.priority !== undefined) lines.push(`${ICS_PRIORITY_PROPERTY}:${item.priority.toUpperCase()}`);
  lines.push(`STATUS:${STATUS_TO_VTODO_STATUS[item.status]}`);
  if (item.status === "completed") {
    if (item.completedAt === undefined) {
      throw new IcsSerializationError(`Completed routine item ${item.uid} is missing completedAt`, [], item.uid);
    }
    lines.push(`COMPLETED:${formatCompletedAt(item.completedAt)}`);
  }

  lines.push(`${ICS_DAY_PART_PROPERTY}:${DAY_PART_TO_ICS[item.dayPart]}`);
  lines.push(`${ICS_OUTCOME_PROPERTY}:${STATUS_TO_ICS_OUTCOME[item.status]}`);
  if (item.order !== undefined) lines.push(`${ICS_ORDER_PROPERTY}:${formatInteger(item.order, "order", item.uid)}`);
  if (item.routineId !== undefined) lines.push(`${ICS_ROUTINE_ID_PROPERTY}:${escapeText(item.routineId)}`);
  if (item.revision !== undefined) {
    lines.push(`${ICS_REVISION_PROPERTY}:${formatInteger(item.revision, "revision", item.uid)}`);
  }
  if (item.tags !== undefined && item.tags.length > 0) {
    lines.push(`CATEGORIES:${item.tags.map(escapeText).join(",")}`);
  }

  for (const [name, value] of Object.entries(item.extensions ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const normalizedName = name.toUpperCase();
    if (!/^X-AUTIPLANNER-[A-Z0-9-]+$/.test(normalizedName)) {
      throw new IcsSerializationError(`Invalid AutiPlanner extension property name ${name}`, [], item.uid);
    }
    if (KNOWN_AUTIPLANNER_PROPERTIES.has(normalizedName)) continue;
    lines.push(`${normalizedName}:${escapeText(value)}`);
  }

  lines.push("END:VTODO");
  return lines;
}

function routineItemFromProperties(
  properties: readonly ParsedProperty[],
  options: ParseOptions,
  warnings: IcsWarning[],
): RoutineItem | undefined {
  const uidProperty = firstProperty(properties, "UID");
  const uid = uidProperty?.value.trim();
  const titleProperty = firstProperty(properties, "SUMMARY");
  const title = titleProperty?.value ?? "";
  const recordLine = uidProperty?.lineNumber ?? titleProperty?.lineNumber;

  if (!uid) {
    addWarning(
      warnings,
      options,
      warning("missing-required-property", "VTODO is missing a non-empty UID", recordLine),
    );
    return undefined;
  }
  if (!title.trim()) {
    addWarning(
      warnings,
      options,
      warning("missing-required-property", `VTODO ${uid} is missing a non-empty SUMMARY`, recordLine, uid),
    );
    return undefined;
  }

  const scheduleProperties = [
    ["start", firstProperty(properties, "DTSTART")],
    ["due", firstProperty(properties, "DUE")],
    ["end", firstProperty(properties, "DTEND")],
  ] as const;
  const parsedSchedules = new Map<string, ParsedDateTime>();
  for (const [field, property] of scheduleProperties) {
    if (property === undefined) continue;
    const parsed = parseDateTime(property.value, property.params);
    if (parsed === undefined) {
      addWarning(
        warnings,
        options,
        warning(
          "invalid-date-time",
          `VTODO ${uid} has an invalid ${property.name} value: ${property.value}`,
          property.lineNumber,
          uid,
        ),
      );
      continue;
    }
    parsedSchedules.set(field, parsed);
  }

  const start = parsedSchedules.get("start");
  const due = parsedSchedules.get("due");
  const end = parsedSchedules.get("end");
  const dateSource = start ?? due ?? end;
  if (dateSource === undefined) {
    addWarning(
      warnings,
      options,
      warning("missing-required-property", `VTODO ${uid} has no usable DTSTART, DUE, or DTEND`, recordLine, uid),
    );
    return undefined;
  }

  const dayPartProperty = firstProperty(properties, ICS_DAY_PART_PROPERTY);
  const rawDayPart = dayPartProperty?.value.trim().toLowerCase();
  let dayPart: DayPart | undefined;
  if (rawDayPart !== undefined && isDayPart(rawDayPart)) {
    dayPart = rawDayPart;
  } else if (rawDayPart === undefined && options.defaultDayPart !== undefined) {
    dayPart = options.defaultDayPart;
    addWarning(
      warnings,
      options,
      warning(
        "missing-required-property",
        `VTODO ${uid} has no day-part; using the explicit parser default ${options.defaultDayPart}`,
        recordLine,
        uid,
      ),
    );
  } else {
    addWarning(
      warnings,
      options,
      warning(
        rawDayPart === undefined ? "missing-required-property" : "invalid-day-part",
        rawDayPart === undefined
          ? `VTODO ${uid} is missing ${ICS_DAY_PART_PROPERTY}`
          : `VTODO ${uid} has an invalid day-part: ${dayPartProperty?.value}`,
        dayPartProperty?.lineNumber ?? recordLine,
        uid,
      ),
    );
    return undefined;
  }
  if (dayPart === undefined) return undefined;

  const statusProperty = firstProperty(properties, "STATUS");
  const outcomeProperty = firstProperty(properties, ICS_OUTCOME_PROPERTY);
  const parsedOutcome = outcomeProperty === undefined
    ? undefined
    : parseRoutineStatus(outcomeProperty.value);
  const standardStatus = statusProperty?.value.trim().toUpperCase();

  if (outcomeProperty !== undefined && parsedOutcome === undefined) {
    addWarning(
      warnings,
      options,
      warning(
        "invalid-outcome",
        `VTODO ${uid} has an invalid ${ICS_OUTCOME_PROPERTY}: ${outcomeProperty.value}`,
        outcomeProperty.lineNumber,
        uid,
      ),
    );
  }

  let status: RoutineStatus | undefined = parsedOutcome;
  if (status === undefined) {
    if (standardStatus === "COMPLETED") status = "completed";
    else if (standardStatus === undefined || standardStatus === "NEEDS-ACTION") status = "pending";
    else {
      addWarning(
        warnings,
        options,
        warning(
          "invalid-status",
          `VTODO ${uid} has unsupported STATUS: ${statusProperty?.value}`,
          statusProperty?.lineNumber ?? recordLine,
          uid,
        ),
      );
      return undefined;
    }
  }

  if (parsedOutcome !== undefined && standardStatus !== undefined) {
    const expectedStandardStatus = STATUS_TO_VTODO_STATUS[parsedOutcome];
    if (standardStatus !== expectedStandardStatus) {
      addWarning(
        warnings,
        options,
        warning(
          "conflicting-status",
          `VTODO ${uid} has ${ICS_OUTCOME_PROPERTY}:${outcomeProperty?.value} but STATUS:${standardStatus}; the AutiPlanner outcome wins`,
          statusProperty?.lineNumber ?? outcomeProperty?.lineNumber ?? recordLine,
          uid,
        ),
      );
    }
  } else if (outcomeProperty === undefined) {
    addWarning(
      warnings,
      options,
      warning(
        "missing-required-property",
        `VTODO ${uid} is missing ${ICS_OUTCOME_PROPERTY}; derived ${status}`,
        statusProperty?.lineNumber ?? recordLine,
        uid,
      ),
    );
  }

  const completedProperty = firstProperty(properties, "COMPLETED");
  let completedAt: string | undefined;
  if (completedProperty !== undefined) {
    const parsedCompleted = parseDateTime(completedProperty.value, completedProperty.params);
    if (parsedCompleted?.iso === undefined || parsedCompleted.isDate) {
      addWarning(
        warnings,
        options,
        warning(
          "invalid-date-time",
          `VTODO ${uid} has an invalid COMPLETED value: ${completedProperty.value}`,
          completedProperty.lineNumber,
          uid,
        ),
      );
    } else if (status === "completed") {
      completedAt = parsedCompleted.iso;
    }
  }

  if (status === "completed" && completedAt === undefined) {
    addWarning(
      warnings,
      options,
      warning("missing-required-property", `Completed VTODO ${uid} is missing a valid COMPLETED timestamp`, recordLine, uid),
    );
    return undefined;
  }
  if (status === undefined) return undefined;

  const item: RoutineItem = {
    uid,
    title,
    date: dateSource.date,
    dayPart,
    status,
  };
  if (start?.iso !== undefined) item.start = start.iso;
  if (due?.iso !== undefined) item.due = due.iso;
  if (end?.iso !== undefined) item.end = end.iso;
  if (completedAt !== undefined) item.completedAt = completedAt;

  const recurrenceRule = firstProperty(properties, "RRULE");
  if (recurrenceRule !== undefined && recurrenceRule.value.trim()) item.rrule = recurrenceRule.value.trim();
  const recurrenceId = firstProperty(properties, "RECURRENCE-ID");
  if (recurrenceId !== undefined) {
    const parsed = parseDateTime(recurrenceId.value, recurrenceId.params);
    if (parsed === undefined) {
      addWarning(warnings, options, warning("invalid-date-time", `VTODO ${uid} has an invalid RECURRENCE-ID value: ${recurrenceId.value}`, recurrenceId.lineNumber, uid));
    } else {
      item.recurrenceId = parsed.iso ?? parsed.date;
    }
  }
  const rdate = readRecurrenceValues(properties, "RDATE", uid, options, warnings);
  if (rdate.length > 0) item.rdate = rdate;
  const exdate = readRecurrenceValues(properties, "EXDATE", uid, options, warnings);
  if (exdate.length > 0) item.exdate = exdate;

  const descriptionProperty = firstProperty(properties, "DESCRIPTION");
  if (descriptionProperty !== undefined) item.description = descriptionProperty.value;
  const iconProperty = firstProperty(properties, ICS_ICON_PROPERTY);
  if (iconProperty !== undefined && iconProperty.value.trim()) item.icon = iconProperty.value.trim();
  const priorityProperty = firstProperty(properties, ICS_PRIORITY_PROPERTY);
  if (priorityProperty !== undefined) {
    const priority = priorityProperty.value.trim().toLowerCase();
    if (priority === "must_do" || priority === "preferably" || priority === "optional") item.priority = priority;
  }

  const timezone = firstTimezone(start, due, end);
  if (timezone !== undefined) item.timezone = timezone;
  if (start?.timezone !== undefined && timezone !== start.timezone) {
    addWarning(warnings, options, warning("invalid-property", `VTODO ${uid} uses multiple timezones`, recordLine, uid));
  }

  const order = readIntegerProperty(properties, ICS_ORDER_PROPERTY, uid, options, warnings);
  if (order !== undefined) item.order = order;
  const routineIdProperty = firstProperty(properties, ICS_ROUTINE_ID_PROPERTY);
  if (routineIdProperty !== undefined) item.routineId = routineIdProperty.value;
  const revision = readIntegerProperty(properties, ICS_REVISION_PROPERTY, uid, options, warnings);
  if (revision !== undefined) item.revision = revision;

  const categories = properties
    .filter((property) => property.name === "CATEGORIES")
    .flatMap((property) => splitEscapedList(property.rawValue).map(unescapeText));
  if (categories.length > 0) item.tags = [...new Set(categories)];

  const extensions: Record<string, string> = {};
  for (const property of properties) {
    if (property.name.startsWith("X-AUTIPLANNER-") && !KNOWN_AUTIPLANNER_PROPERTIES.has(property.name)) {
      extensions[property.name] = property.value;
    }
  }
  if (Object.keys(extensions).length > 0) item.extensions = extensions;

  const validationErrors = validateRoutineItem(item);
  if (validationErrors.length > 0) {
    addWarning(
      warnings,
      options,
      warning("invalid-property", `VTODO ${uid} is invalid: ${validationErrors.join("; ")}`, recordLine, uid),
    );
    return undefined;
  }

  return item;
}

function parsePropertyLine(line: string, lineNumber: number): ParsedProperty | undefined {
  const colon = line.indexOf(":");
  if (colon <= 0) return undefined;

  const left = line.slice(0, colon);
  const parts = splitUnquoted(left, ";");
  const name = parts.shift()?.trim().toUpperCase();
  if (name === undefined || !/^[A-Z0-9-]+$/.test(name)) return undefined;

  const params: Record<string, string> = {};
  for (const part of parts) {
    const equals = part.indexOf("=");
    if (equals <= 0) return undefined;
    const key = part.slice(0, equals).trim().toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(key)) return undefined;
    let value = part.slice(equals + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    params[key] = unescapeText(value);
  }

  const rawValue = line.slice(colon + 1);
  return { name, params, rawValue, value: unescapeText(rawValue), lineNumber };
}

function firstProperty(properties: readonly ParsedProperty[], name: string): ParsedProperty | undefined {
  return properties.find((property) => property.name === name);
}

function parseRoutineStatus(value: string): RoutineStatus | undefined {
  const normalized = value.trim().toLowerCase();
  return isRoutineStatus(normalized) ? normalized : undefined;
}

function parseDateTime(value: string, params: Readonly<Record<string, string>>): ParsedDateTime | undefined {
  const normalized = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(normalized);
  if (dateOnly !== null) {
    const date = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    return isValidCalendarDate(date) ? { date, isDate: true } : undefined;
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(normalized);
  if (dateTime === null) return undefined;
  const date = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}`;
  const hour = Number(dateTime[4]);
  const minute = Number(dateTime[5]);
  const second = Number(dateTime[6]);
  if (!isValidCalendarDate(date) || hour > 23 || minute > 59 || second > 59) return undefined;

  const iso = `${date}T${dateTime[4]}:${dateTime[5]}:${dateTime[6]}${dateTime[7] === "Z" ? "Z" : ""}`;
  const timezone = dateTime[7] === "Z" ? undefined : params.TZID;
  const result: ParsedDateTime = { date, isDate: false, iso };
  if (timezone !== undefined) result.timezone = timezone;
  return result;
}

function readIntegerProperty(
  properties: readonly ParsedProperty[],
  name: string,
  uid: string,
  options: ParseOptions,
  warnings: IcsWarning[],
): number | undefined {
  const property = firstProperty(properties, name);
  if (property === undefined) return undefined;
  if (!/^-?\d+$/.test(property.value.trim())) {
    addWarning(
      warnings,
      options,
      warning("invalid-number", `VTODO ${uid} has an invalid ${name}: ${property.value}`, property.lineNumber, uid),
    );
    return undefined;
  }
  const value = Number(property.value);
  if (!Number.isSafeInteger(value) || (name === ICS_REVISION_PROPERTY && value < 0)) {
    addWarning(
      warnings,
      options,
      warning("invalid-number", `VTODO ${uid} has an invalid ${name}: ${property.value}`, property.lineNumber, uid),
    );
    return undefined;
  }
  return value;
}

function firstTimezone(...values: readonly (ParsedDateTime | undefined)[]): string | undefined {
  for (const value of values) {
    if (value?.timezone !== undefined) return value.timezone;
  }
  return undefined;
}

function formatScheduleProperty(name: string, value: string, timezone: string | undefined): string {
  const parsed = parseIsoTimestamp(value);
  if (parsed === undefined) throw new IcsSerializationError(`Invalid ${name} timestamp: ${value}`);
  if (parsed.isDate) return `${name};VALUE=DATE:${formatDate(parsed.date)}`;

  if (parsed.offset !== undefined) return `${name}:${formatUtcDateTime(parsed)}`;
  const timezoneParameter = timezone === undefined ? "" : `;TZID=${formatParameterValue(timezone)}`;
  return `${name}${timezoneParameter}:${formatLocalDateTime(parsed)}`;
}

function formatRecurrenceList(name: string, values: readonly string[], timezone: string | undefined): string {
  const parsed = values.map((value) => {
    const result = parseIsoTimestamp(value);
    if (result === undefined) throw new IcsSerializationError(`Invalid ${name} value: ${value}`);
    return result;
  });
  const dateOnly = parsed.every((value) => value.isDate);
  if (!dateOnly && parsed.some((value) => value.isDate)) {
    throw new IcsSerializationError(`${name} values must use one date/time shape`);
  }
  if (dateOnly) return `${name};VALUE=DATE:${parsed.map((value) => formatDate(value.date)).join(",")}`;
  if (parsed.some((value) => value.offset !== undefined)) {
    return `${name}:${parsed.map(formatUtcDateTime).join(",")}`;
  }
  const timezoneParameter = timezone === undefined ? "" : `;TZID=${formatParameterValue(timezone)}`;
  return `${name}${timezoneParameter}:${parsed.map(formatLocalDateTime).join(",")}`;
}

function readRecurrenceValues(
  properties: readonly ParsedProperty[],
  name: "RDATE" | "EXDATE",
  uid: string,
  options: ParseOptions,
  warnings: IcsWarning[],
): string[] {
  const values: string[] = [];
  for (const property of properties.filter((candidate) => candidate.name === name)) {
    for (const value of property.value.split(",")) {
      const parsed = parseDateTime(value, property.params);
      if (parsed === undefined) {
        addWarning(warnings, options, warning("invalid-date-time", `VTODO ${uid} has an invalid ${name} value: ${value}`, property.lineNumber, uid));
      } else {
        values.push(parsed.iso ?? parsed.date);
      }
    }
  }
  return values;
}

function formatCompletedAt(value: string): string {
  const parsed = parseIsoTimestamp(value);
  if (parsed === undefined || parsed.isDate) {
    throw new IcsSerializationError(`Invalid COMPLETED timestamp: ${value}`);
  }
  return parsed.offset === undefined ? formatLocalDateTime(parsed) : formatUtcDateTime(parsed);
}

function formatDtstamp(value: string | Date | undefined): string {
  const source = value instanceof Date ? value.toISOString() : value ?? new Date().toISOString();
  const parsed = parseIsoTimestamp(source);
  if (parsed === undefined || parsed.isDate) throw new IcsSerializationError(`Invalid DTSTAMP timestamp: ${source}`);
  return formatUtcDateTime(parsed);
}

interface ParsedIsoTimestamp {
  date: string;
  hour: number;
  minute: number;
  second: number;
  offset?: string;
  isDate: boolean;
}

function parseIsoTimestamp(value: string): ParsedIsoTimestamp | undefined {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly !== null) {
    const date = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    return isValidCalendarDate(date) ? { date, hour: 0, minute: 0, second: 0, isDate: true } : undefined;
  }

  const dateTime = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (dateTime === null) return undefined;
  const date = dateTime[1];
  const hourText = dateTime[2];
  const minuteText = dateTime[3];
  if (date === undefined || hourText === undefined || minuteText === undefined) return undefined;
  const hour = Number(dateTime[2]);
  const minute = Number(dateTime[3]);
  const second = Number(dateTime[4] ?? "0");
  const offset = dateTime[5];
  if (!isValidCalendarDate(date) || hour > 23 || minute > 59 || second > 59) return undefined;
  if (offset !== undefined && offset !== "Z" && !/^[-+]\d{2}:?\d{2}$/.test(offset)) return undefined;
  const result: ParsedIsoTimestamp = { date, hour, minute, second, isDate: false };
  if (offset !== undefined) result.offset = offset;
  return result;
}

function formatLocalDateTime(value: ParsedIsoTimestamp): string {
  return `${formatDate(value.date)}T${twoDigits(value.hour)}${twoDigits(value.minute)}${twoDigits(value.second)}`;
}

function formatUtcDateTime(value: ParsedIsoTimestamp): string {
  if (value.offset === undefined || value.offset === "Z") return `${formatLocalDateTime(value)}Z`;

  const isoOffset = value.offset.length === 5
    ? `${value.offset.slice(0, 3)}:${value.offset.slice(3)}`
    : value.offset;
  const date = new Date(`${value.date}T${twoDigits(value.hour)}:${twoDigits(value.minute)}:${twoDigits(value.second)}${isoOffset}`);
  if (Number.isNaN(date.getTime())) throw new IcsSerializationError(`Invalid timestamp offset ${value.offset}`);
  return `${date.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "")}Z`;
}

function formatDate(value: string): string {
  return value.replaceAll("-", "");
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function formatInteger(value: number, field: string, uid: string): string {
  if (!Number.isSafeInteger(value) || (field === "revision" && value < 0)) {
    throw new IcsSerializationError(`Invalid ${field} for routine item ${uid}`, [], uid);
  }
  return String(value);
}

function formatParameterValue(value: string): string {
  if (/^[A-Za-z0-9._-]+$/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function splitUnquoted(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const character of value) {
    if (character === '"') quoted = !quoted;
    if (character === delimiter && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts;
}

function splitEscapedList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && index + 1 < value.length) {
      current += character;
      current += value[index + 1];
      index += 1;
    } else if (character === ",") {
      parts.push(current);
      current = "";
    } else {
      current += character ?? "";
    }
  }
  parts.push(current);
  return parts;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function takeUtf8Prefix(value: string, maxBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function warning(
  code: IcsWarningCode,
  message: string,
  lineNumber?: number,
  uid?: string,
): IcsWarning {
  const result: IcsWarning = { code, message };
  if (lineNumber !== undefined) result.lineNumber = lineNumber;
  if (uid !== undefined) result.uid = uid;
  return result;
}

function addWarning(warnings: IcsWarning[], options: ParseOptions, entry: IcsWarning): void {
  if (options.strict) throw new IcsParseError(entry);
  warnings.push(entry);
}
