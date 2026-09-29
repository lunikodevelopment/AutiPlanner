import {
  isCalendarDate,
  type RoutineItem,
  type RoutineStatus,
  type RoutineTemplate,
} from "@autiplanner/core";
import {
  ICS_DATE_PROPERTY,
  ICS_DAY_PART_PROPERTY,
  ICS_ORDER_PROPERTY,
  ICS_OUTCOME_PROPERTY,
  ICS_REVISION_PROPERTY,
  ICS_ROUTINE_ID_PROPERTY,
  ICS_OUTCOME_TO_STATUS,
  ICS_TO_DAY_PART,
  MAPPED_EXTENSION_PROPERTIES,
  STATUS_TO_VTODO_STATUS,
} from "./profile.js";
import { parseRrule } from "./rrule.js";
import { foldContentLine, splitEscapedList, unescapeText } from "./text.js";
import { parseIcsTime, type ParsedIcsTime } from "./time.js";
import { type IcsIssue, type IcsIssueCode, type ParsedCalendar } from "./types.js";

/**
 * Maps the AutiPlanner iCalendar profile onto core routine items.
 * Import rules live in docs/ICS_PROFILE.md.
 *
 * This parser never infers day part from the clock and never rewrites a
 * missed or skipped outcome into completed.
 */
export function parseCalendar(input: string): ParsedCalendar {
  const source = stripBom(input);
  const logical = logicalLines(source);
  const state = createState();

  if (logical.length === 0) {
    state.issues.push(makeIssue("empty-calendar", "calendar is empty"));
    return finish(state);
  }

  let index = 0;
  while (index < logical.length) {
    const line = logical[index];
    if (!line) {
      index += 1;
      continue;
    }
    if (line.text.toUpperCase().startsWith("BEGIN:")) {
      const component = readComponent(logical, index, state.issues);
      if (!component) break;
      index = component.next;
      if (component.name === "VCALENDAR") absorbCalendar(component, state);
      else absorbComponent(component, state);
      continue;
    }
    if (line.text.toUpperCase().startsWith("END:")) {
      state.issues.push(
        makeIssue("malformed-line", "unexpected END outside a component", line.line),
      );
      index += 1;
      continue;
    }
    const parsed = parseContentLine(line);
    if (!parsed) {
      state.issues.push(makeIssue("malformed-line", "malformed calendar line", line.line));
    } else {
      applyCalendarProperty(parsed, state);
    }
    index += 1;
  }

  if (!state.sawCalendar) {
    state.issues.push(
      makeIssue("missing-calendar-envelope", "VCALENDAR envelope is missing"),
    );
  } else if (state.version === undefined) {
    state.issues.push(makeIssue("missing-version", "VCALENDAR is missing VERSION"));
  }
  noteDuplicateUids(state);
  return finish(state);
}

interface LogicalLine {
  text: string;
  line: number;
}

interface ContentLine {
  name: string;
  params: Readonly<Record<string, string>>;
  value: string;
  line: number;
}

interface Component {
  name: string;
  lines: LogicalLine[];
  next: number;
  startLine: number;
}

interface ParseState {
  prodId?: string;
  version?: string;
  calscale?: string;
  method?: string;
  calendarProperties: string[];
  items: RoutineItem[];
  series: RoutineTemplate[];
  preserved: string[];
  issues: IcsIssue[];
  sawCalendar: boolean;
  calendarCount: number;
}

function createState(): ParseState {
  return {
    calendarProperties: [],
    items: [],
    series: [],
    preserved: [],
    issues: [],
    sawCalendar: false,
    calendarCount: 0,
  };
}

function finish(state: ParseState): ParsedCalendar {
  const parsed: ParsedCalendar = {
    calendarProperties: state.calendarProperties,
    items: state.items,
    series: state.series,
    preserved: state.preserved,
    issues: state.issues,
  };
  if (state.prodId !== undefined) parsed.prodId = state.prodId;
  if (state.version !== undefined) parsed.version = state.version;
  if (state.calscale !== undefined) parsed.calscale = state.calscale;
  if (state.method !== undefined) parsed.method = state.method;
  return parsed;
}

function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

function logicalLines(input: string): LogicalLine[] {
  const physical = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const logical: LogicalLine[] = [];
  for (let index = 0; index < physical.length; index += 1) {
    const physicalLine = physical[index] ?? "";
    if (physicalLine.startsWith(" ") || physicalLine.startsWith("\t")) {
      const previous = logical[logical.length - 1];
      if (previous) previous.text += physicalLine.slice(1);
      continue;
    }
    if (physicalLine.length === 0) continue;
    logical.push({ text: physicalLine, line: index + 1 });
  }
  return logical;
}

function readComponent(
  lines: readonly LogicalLine[],
  start: number,
  issues: IcsIssue[],
): Component | undefined {
  const begin = lines[start];
  if (!begin) return undefined;
  const name = begin.text.slice("BEGIN:".length).trim().toUpperCase();
  const body: LogicalLine[] = [begin];
  let depth = 1;
  let index = start + 1;
  while (index < lines.length && depth > 0) {
    const line = lines[index];
    if (!line) {
      index += 1;
      continue;
    }
    body.push(line);
    const upper = line.text.toUpperCase();
    if (upper.startsWith("BEGIN:")) depth += 1;
    else if (upper.startsWith("END:")) depth -= 1;
    index += 1;
  }
  if (depth !== 0) {
    issues.push(makeIssue("unclosed-component", `unclosed ${name}`, begin.line));
  }
  return { name, lines: body, next: index, startLine: begin.line };
}

function absorbCalendar(component: Component, state: ParseState): void {
  state.sawCalendar = true;
  state.calendarCount += 1;
  if (state.calendarCount > 1) {
    state.issues.push(
      makeIssue(
        "multiple-calendar",
        "additional VCALENDAR was merged into the first calendar",
        component.startLine,
      ),
    );
  }
  const inner = componentBody(component);
  let index = 0;
  while (index < inner.length) {
    const line = inner[index];
    if (!line) {
      index += 1;
      continue;
    }
    if (line.text.toUpperCase().startsWith("BEGIN:")) {
      const nested = readComponent(inner, index, state.issues);
      if (!nested) break;
      index = nested.next;
      absorbComponent(nested, state);
      continue;
    }
    const parsed = parseContentLine(line);
    if (!parsed) {
      state.issues.push(makeIssue("malformed-line", "malformed calendar line", line.line));
    } else {
      applyCalendarProperty(parsed, state);
    }
    index += 1;
  }
}

function absorbComponent(component: Component, state: ParseState): void {
  if (component.name !== "VTODO") {
    state.preserved.push(componentRaw(component.lines));
    return;
  }
  const properties = vtodoProperties(component, state.issues);
  const hasRrule = properties.some((property) => property.name === "RRULE");
  const hasRecurrenceId = properties.some((property) => property.name === "RECURRENCE-ID");
  if (hasRrule && hasRecurrenceId) {
    state.issues.push(
      makeIssue(
        "unsupported-recurrence",
        "a series master cannot also be an occurrence override",
        component.startLine,
      ),
    );
    state.preserved.push(componentRaw(component.lines));
    return;
  }
  if (hasRrule) {
    const series = parseSeries(component, properties, state.issues);
    if (series) state.series.push(series);
    else state.preserved.push(componentRaw(component.lines));
    return;
  }
  if (properties.some((property) => property.name === "RDATE" || property.name === "EXDATE")) {
    state.issues.push(
      makeIssue(
        "unsupported-recurrence",
        "EXDATE and RDATE belong on a series master",
        component.startLine,
      ),
    );
    state.preserved.push(componentRaw(component.lines));
    return;
  }
  const item = parseVtodo(component, properties, state.issues);
  if (item) state.items.push(item);
  else state.preserved.push(componentRaw(component.lines));
}

function applyCalendarProperty(property: ContentLine, state: ParseState): void {
  if (property.name === "PRODID" && state.prodId === undefined) {
    state.prodId = unescapeText(property.value).trim();
    return;
  }
  if (property.name === "VERSION" && state.version === undefined) {
    state.version = property.value.trim();
    if (state.version !== "2.0") {
      state.issues.push(
        makeIssue(
          "unsupported-version",
          `calendar version ${state.version} is outside the implemented profile`,
          property.line,
        ),
      );
    }
    return;
  }
  if (property.name === "CALSCALE" && state.calscale === undefined) {
    state.calscale = property.value.trim().toUpperCase();
    return;
  }
  if (property.name === "METHOD" && state.method === undefined) {
    state.method = property.value.trim().toUpperCase();
    return;
  }
  state.calendarProperties.push(foldContentLine(propertyLine(property)));
}

function parseVtodo(
  component: Component,
  properties: ContentLine[],
  issues: IcsIssue[],
): RoutineItem | undefined {
  const uidProperty = firstProperty(properties, "UID", issues);
  const uid = uidProperty ? unescapeText(uidProperty.value).trim() : undefined;
  const line = component.startLine;
  let reject = false;

  if (!uid) {
    issues.push(makeIssue("missing-uid", "VTODO is missing UID", line));
    reject = true;
  }
  if (!properties.some((property) => property.name === "DTSTAMP")) {
    issues.push(makeIssue("missing-dtstamp", "VTODO is missing DTSTAMP", line, uid));
  }
  for (const property of properties) {
    if (property.name === "DURATION") {
      issues.push(
        makeIssue(
          "unsupported-property",
          "DURATION is not modeled and was not used to infer an end time",
          property.line,
          uid,
        ),
      );
    }
  }

  const summary = textValue(firstProperty(properties, "SUMMARY", issues, uid));
  if (!summary?.trim()) {
    issues.push(makeIssue("missing-summary", "VTODO is missing SUMMARY", line, uid));
    reject = true;
  }

  const dayPartToken = firstProperty(properties, ICS_DAY_PART_PROPERTY, issues, uid)
    ?.value.trim()
    .toUpperCase();
  const dayPart = dayPartToken ? ICS_TO_DAY_PART[dayPartToken] : undefined;
  if (!dayPartToken) {
    issues.push(
      makeIssue(
        "missing-daypart",
        "day part is missing and was not inferred from the clock",
        line,
        uid,
      ),
    );
    reject = true;
  } else if (!dayPart) {
    issues.push(makeIssue("invalid-daypart", `unknown day part ${dayPartToken}`, line, uid));
    reject = true;
  }

  const outcome = readOutcome(properties, issues, uid, line);
  if (outcome.reject || !outcome.status) reject = true;

  const schedule = readSchedule(properties, issues, uid, line);
  if (schedule.reject || !schedule.date) reject = true;

  const order = readInteger(properties, ICS_ORDER_PROPERTY, "invalid-order", issues, uid, true);
  const revision = readInteger(
    properties,
    ICS_REVISION_PROPERTY,
    "invalid-revision",
    issues,
    uid,
    false,
  );
  const routineId = textValue(firstProperty(properties, ICS_ROUTINE_ID_PROPERTY, issues, uid));
  const description = textValue(firstProperty(properties, "DESCRIPTION", issues, uid));
  const tags = readTags(properties, issues, uid);
  const extensions = readExtensions(properties, issues, uid);

  if (reject || !uid || !summary || !dayPart || !outcome.status || !schedule.date) {
    return undefined;
  }

  const item: RoutineItem = {
    uid,
    title: summary,
    date: schedule.date,
    dayPart,
    status: outcome.status,
  };
  if (description !== undefined && description.length > 0) item.description = description;
  if (schedule.start !== undefined) item.start = schedule.start;
  if (schedule.end !== undefined) item.end = schedule.end;
  if (schedule.due !== undefined) item.due = schedule.due;
  if (schedule.timezone !== undefined) item.timezone = schedule.timezone;
  if (outcome.completedAt !== undefined) item.completedAt = outcome.completedAt;
  if (order !== undefined) item.order = order;
  if (routineId !== undefined && routineId.length > 0) item.routineId = routineId;
  if (revision !== undefined) item.revision = revision;
  if (tags !== undefined) item.tags = tags;
  if (extensions !== undefined) item.extensions = extensions;
  return item;
}

function componentBody(component: Component): LogicalLine[] {
  const last = component.lines[component.lines.length - 1]?.text.toUpperCase() ?? "";
  return last.startsWith("END:") ? component.lines.slice(1, -1) : component.lines.slice(1);
}

function vtodoProperties(component: Component, issues: IcsIssue[]): ContentLine[] {
  const inner = componentBody(component);
  const properties: ContentLine[] = [];
  let index = 0;
  while (index < inner.length) {
    const line = inner[index];
    if (!line) {
      index += 1;
      continue;
    }
    if (line.text.toUpperCase().startsWith("BEGIN:")) {
      const nested = readComponent(inner, index, issues);
      if (!nested) break;
      issues.push(
        makeIssue(
          "dropped-nested-component",
          `nested ${nested.name} is not modeled and is omitted from a modeled rewrite`,
          line.line,
        ),
      );
      index = nested.next;
      continue;
    }
    const parsed = parseContentLine(line);
    if (!parsed) {
      issues.push(makeIssue("malformed-line", "malformed VTODO line", line.line));
    } else properties.push(parsed);
    index += 1;
  }
  return properties;
}

function readOutcome(
  properties: readonly ContentLine[],
  issues: IcsIssue[],
  uid: string | undefined,
  line: number,
): { status?: RoutineStatus; completedAt?: string; reject: boolean } {
  const outcomeProperty = firstProperty(properties, ICS_OUTCOME_PROPERTY, issues, uid);
  const statusProperty = firstProperty(properties, "STATUS", issues, uid);
  const completedProperty = firstProperty(properties, "COMPLETED", issues, uid);
  const outcomeToken = outcomeProperty?.value.trim().toUpperCase();
  const statusToken = statusProperty?.value.trim().toUpperCase();
  const completed = completedProperty
    ? parseCompleted(completedProperty, issues, uid)
    : undefined;

  if (outcomeToken) {
    const status = ICS_OUTCOME_TO_STATUS[outcomeToken];
    if (!status) {
      issues.push(makeIssue("invalid-outcome", `unknown outcome ${outcomeToken}`, line, uid));
      return { reject: true };
    }
    const expected = STATUS_TO_VTODO_STATUS[status];
    if (statusToken && statusToken !== expected) {
      issues.push(
        makeIssue(
          "outcome-status-conflict",
          `${ICS_OUTCOME_PROPERTY} ${outcomeToken} was kept; conflicting STATUS ${statusToken} was ignored`,
          line,
          uid,
        ),
      );
    }
    if (status === "completed") {
      if (!completed) {
        issues.push(
          makeIssue(
            "completed-without-timestamp",
            "completed outcome requires a UTC COMPLETED timestamp",
            line,
            uid,
          ),
        );
        return { reject: true };
      }
      return { status, completedAt: completed, reject: false };
    }
    if (completedProperty) {
      issues.push(
        makeIssue(
          "timestamp-without-completed",
          "COMPLETED was ignored because the outcome is not completed",
          line,
          uid,
        ),
      );
    }
    return { status, reject: false };
  }

  if (statusToken === "COMPLETED") {
    issues.push(
      makeIssue(
        "inferred-outcome",
        "missing AutiPlanner outcome was inferred as completed from STATUS",
        line,
        uid,
      ),
    );
    if (!completed) {
      issues.push(
        makeIssue(
          "completed-without-timestamp",
          "STATUS:COMPLETED requires a UTC COMPLETED timestamp",
          line,
          uid,
        ),
      );
      return { reject: true };
    }
    return { status: "completed", completedAt: completed, reject: false };
  }

  if (statusToken === undefined || statusToken === "NEEDS-ACTION") {
    issues.push(
      makeIssue(
        "inferred-outcome",
        "missing AutiPlanner outcome was inferred as pending",
        line,
        uid,
      ),
    );
    if (completedProperty) {
      issues.push(
        makeIssue(
          "timestamp-without-completed",
          "COMPLETED was ignored because the outcome is not completed",
          line,
          uid,
        ),
      );
    }
    return { status: "pending", reject: false };
  }

  issues.push(
    makeIssue(
      "unsupported-status",
      `STATUS ${statusToken} is not an AutiPlanner outcome and was not rewritten`,
      line,
      uid,
    ),
  );
  return { reject: true };
}

function parseCompleted(
  property: ContentLine,
  issues: IcsIssue[],
  uid: string | undefined,
): string | undefined {
  const parsed = parseIcsTime(property.value, property.params);
  if (!parsed || parsed.form !== "utc" || !parsed.timestamp) {
    issues.push(
      makeIssue(
        "invalid-datetime",
        "COMPLETED must be a UTC date-time and was not converted from a guessed timezone",
        property.line,
        uid,
      ),
    );
    return undefined;
  }
  return parsed.timestamp;
}

interface ScheduleRead {
  date?: string;
  start?: string;
  end?: string;
  due?: string;
  timezone?: string;
  reject: boolean;
}

function readSchedule(
  properties: readonly ContentLine[],
  issues: IcsIssue[],
  uid: string | undefined,
  line: number,
): ScheduleRead {
  const explicit = readExplicitDate(properties, issues, uid);
  const start = readTimed(properties, "DTSTART", issues, uid);
  const due = readTimed(properties, "DUE", issues, uid);
  const end = readTimed(properties, "DTEND", issues, uid);
  if (start.invalid || due.invalid || end.invalid || explicit.invalid) {
    return { reject: true };
  }

  const timed = [start.parsed, due.parsed, end.parsed].filter(
    (parsed): parsed is ParsedIcsTime => parsed !== undefined && parsed.form !== "date",
  );
  const zones = new Set(
    timed.flatMap((parsed) => (parsed.timezone ? [parsed.timezone] : [])),
  );
  const hasFloating = timed.some((parsed) => parsed.form === "floating");
  if (zones.size > 1 || (hasFloating && zones.size > 0)) {
    issues.push(
      makeIssue(
        "timezone-conflict",
        "scheduling fields disagree about timezone and were not guessed",
        line,
        uid,
      ),
    );
    return { reject: true };
  }

  const derived =
    start.parsed?.date ?? due.parsed?.date ?? end.parsed?.date ?? undefined;
  const date = explicit.date ?? derived;
  if (!date) {
    issues.push(
      makeIssue(
        "missing-schedule",
        "routine item has no local date or scheduling field",
        line,
        uid,
      ),
    );
    return { reject: true };
  }
  if (explicit.date && derived && explicit.date !== derived) {
    issues.push(
      makeIssue(
        "date-differs-from-schedule",
        "X-AUTIPLANNER-DATE was kept instead of recomputing the local day from the clock",
        line,
        uid,
      ),
    );
  }

  const schedule: ScheduleRead = { date, reject: false };
  if (start.parsed?.form !== "date" && start.parsed?.timestamp) {
    schedule.start = start.parsed.timestamp;
  }
  if (due.parsed?.timestamp) schedule.due = due.parsed.timestamp;
  if (end.parsed?.timestamp) schedule.end = end.parsed.timestamp;
  const timezone = zones.values().next().value;
  if (typeof timezone === "string") schedule.timezone = timezone;
  return schedule;
}

function readExplicitDate(
  properties: readonly ContentLine[],
  issues: IcsIssue[],
  uid: string | undefined,
): { date?: string; invalid: boolean } {
  const property = firstProperty(properties, ICS_DATE_PROPERTY, issues, uid);
  if (!property) return { invalid: false };
  const raw = property.value.trim();
  const date = raw.includes("-") ? raw : raw.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  if (!isCalendarDate(date)) {
    issues.push(makeIssue("invalid-date", `invalid ${ICS_DATE_PROPERTY}`, property.line, uid));
    return { invalid: true };
  }
  return { date, invalid: false };
}

function readTimed(
  properties: readonly ContentLine[],
  name: string,
  issues: IcsIssue[],
  uid: string | undefined,
): { parsed?: ParsedIcsTime; invalid: boolean } {
  const property = firstProperty(properties, name, issues, uid);
  if (!property) return { invalid: false };
  const parsed = parseIcsTime(property.value, property.params);
  if (!parsed) {
    issues.push(makeIssue("invalid-datetime", `invalid ${name}`, property.line, uid));
    return { invalid: true };
  }
  return { parsed, invalid: false };
}

function readInteger(
  properties: readonly ContentLine[],
  name: string,
  code: "invalid-order" | "invalid-revision",
  issues: IcsIssue[],
  uid: string | undefined,
  allowNegative: boolean,
): number | undefined {
  const property = firstProperty(properties, name, issues, uid);
  if (!property) return undefined;
  const raw = property.value.trim();
  const pattern = allowNegative ? /^-?\d+$/ : /^\d+$/;
  if (!pattern.test(raw)) {
    issues.push(makeIssue(code, `invalid ${name}`, property.line, uid));
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    issues.push(makeIssue(code, `invalid ${name}`, property.line, uid));
    return undefined;
  }
  return value;
}

function readTags(
  properties: readonly ContentLine[],
  issues: IcsIssue[],
  uid: string | undefined,
): readonly string[] | undefined {
  const property = firstProperty(properties, "CATEGORIES", issues, uid);
  if (!property) return undefined;
  const tags = splitEscapedList(property.value);
  return tags.length > 0 ? tags : undefined;
}

function readExtensions(
  properties: readonly ContentLine[],
  issues: IcsIssue[],
  uid: string | undefined,
): Readonly<Record<string, string>> | undefined {
  const extensions: Record<string, string> = {};
  const seen = new Set<string>();
  for (const property of properties) {
    if (!property.name.startsWith("X-AUTIPLANNER-")) continue;
    if (MAPPED_EXTENSION_PROPERTIES.includes(property.name)) continue;
    if (seen.has(property.name)) {
      issues.push(
        makeIssue(
          "duplicate-property",
          `duplicate ${property.name}`,
          property.line,
          uid,
        ),
      );
      continue;
    }
    seen.add(property.name);
    extensions[property.name] = unescapeText(property.value);
  }
  return Object.keys(extensions).length > 0 ? extensions : undefined;
}

function parseSeries(
  component: Component,
  properties: ContentLine[],
  issues: IcsIssue[],
): RoutineTemplate | undefined {
  const line = component.startLine;
  const uidProperty = firstProperty(properties, "UID", issues);
  const uid = uidProperty ? unescapeText(uidProperty.value).trim() : undefined;
  if (!uid) {
    issues.push(makeIssue("missing-uid", "series is missing UID", line));
    return undefined;
  }
  const summary = textValue(firstProperty(properties, "SUMMARY", issues, uid));
  if (!summary?.trim()) {
    issues.push(makeIssue("missing-summary", "series is missing SUMMARY", line, uid));
    return undefined;
  }
  const dayPartToken = firstProperty(properties, ICS_DAY_PART_PROPERTY, issues, uid)
    ?.value.trim()
    .toUpperCase();
  const dayPart = dayPartToken ? ICS_TO_DAY_PART[dayPartToken] : undefined;
  if (!dayPart) {
    issues.push(
      makeIssue("missing-daypart", "series day part is missing and was not inferred", line, uid),
    );
    return undefined;
  }
  const schedule = readSchedule(properties, issues, uid, line);
  if (schedule.reject || !schedule.date) return undefined;
  const rrule = firstProperty(properties, "RRULE", issues, uid);
  const recurrence = rrule ? parseRrule(rrule.value) : undefined;
  if (!recurrence) {
    issues.push(
      makeIssue(
        "unsupported-recurrence",
        "RRULE is outside the daily/weekly/monthly subset",
        line,
        uid,
      ),
    );
    return undefined;
  }
  const series: RoutineTemplate = {
    uid,
    title: summary,
    dayPart,
    date: schedule.date,
    recurrence,
  };
  if (schedule.start !== undefined) series.start = schedule.start;
  if (schedule.due !== undefined) series.due = schedule.due;
  if (schedule.timezone !== undefined) series.timezone = schedule.timezone;
  const description = textValue(firstProperty(properties, "DESCRIPTION", issues, uid));
  if (description) series.description = description;
  const order = readInteger(properties, ICS_ORDER_PROPERTY, "invalid-order", issues, uid, true);
  if (order !== undefined) series.order = order;
  const exdates = readDateList(properties, "EXDATE");
  const rdates = readDateList(properties, "RDATE");
  if (exdates.length > 0) series.exdates = exdates;
  if (rdates.length > 0) series.rdates = rdates;
  const extensions = readExtensions(properties, issues, uid);
  if (extensions !== undefined) series.extensions = extensions;
  return series;
}

function readDateList(properties: readonly ContentLine[], name: string): string[] {
  const dates: string[] = [];
  for (const property of properties) {
    if (property.name !== name) continue;
    for (const piece of property.value.split(",")) {
      const parsed = parseIcsTime(piece.trim(), property.params);
      if (parsed) dates.push(parsed.date);
    }
  }
  return dates;
}

function textValue(property: ContentLine | undefined): string | undefined {
  if (!property) return undefined;
  return unescapeText(property.value);
}

function firstProperty(
  properties: readonly ContentLine[],
  name: string,
  issues: IcsIssue[],
  uid?: string,
): ContentLine | undefined {
  const matches = properties.filter((property) => property.name === name);
  if (matches.length > 1) {
    issues.push(
      makeIssue("duplicate-property", `duplicate ${name}`, matches[1]?.line, uid),
    );
  }
  return matches[0];
}

function noteDuplicateUids(state: ParseState): void {
  const seen = new Set<string>();
  for (const item of state.items) {
    if (seen.has(item.uid)) {
      state.issues.push(makeIssue("duplicate-uid", `duplicate uid ${item.uid}`, undefined, item.uid));
    }
    seen.add(item.uid);
  }
}

function parseContentLine(line: LogicalLine): ContentLine | undefined {
  const split = splitProperty(line.text);
  if (!split) return undefined;
  const parsedLeft = parseLeft(split.left);
  if (!parsedLeft) return undefined;
  return {
    name: parsedLeft.name,
    params: parsedLeft.params,
    value: split.value,
    line: line.line,
  };
}

function splitProperty(text: string): { left: string; value: string } | undefined {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ":" && !quoted) {
      return { left: text.slice(0, index), value: text.slice(index + 1) };
    }
  }
  return undefined;
}

function parseLeft(left: string): { name: string; params: Record<string, string> } | undefined {
  const parts = splitSemicolons(left);
  const rawName = parts[0]?.trim();
  if (!rawName) return undefined;
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const separator = part.indexOf("=");
    if (separator <= 0) return undefined;
    const key = part.slice(0, separator).trim().toUpperCase();
    let value = part.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (!key) return undefined;
    params[key] = value;
  }
  return { name: rawName.toUpperCase(), params };
}

function splitSemicolons(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === ";" && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char ?? "";
  }
  parts.push(current);
  return parts;
}

function propertyLine(property: ContentLine): string {
  const params = Object.entries(property.params).map(([key, value]) => `${key}=${value}`);
  const suffix = params.length > 0 ? `;${params.join(";")}` : "";
  return `${property.name}${suffix}:${property.value}`;
}

function componentRaw(lines: readonly LogicalLine[]): string {
  return lines.map((line) => foldContentLine(line.text)).join("\r\n");
}

function makeIssue(
  code: IcsIssueCode,
  message: string,
  line?: number,
  uid?: string,
): IcsIssue {
  const issue: IcsIssue = { code, message };
  if (line !== undefined) issue.line = line;
  if (uid !== undefined) issue.uid = uid;
  return issue;
}


