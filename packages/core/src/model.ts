import { hasExplicitOffset, isCalendarDate, isIsoTimestamp } from "./time.js";

export const DAY_PARTS = ["morning", "afternoon", "evening", "night"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

export const ROUTINE_STATUSES = [
  "pending",
  "completed",
  "missed",
  "skipped",
] as const;
export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];

export interface RoutineItem {
  /** Stable calendar identity. Never derive this from the mutable title. */
  uid: string;
  title: string;
  description?: string;

  /** Local calendar day, encoded as YYYY-MM-DD. */
  date: string;

  /**
   * Optional ISO-8601 scheduling timestamps.
   * A missing offset is a floating local time, not UTC.
   * `completedAt` is stricter: it must carry `Z` or a numeric offset.
   */
  start?: string;
  end?: string;
  due?: string;
  timezone?: string;

  /** Explicit semantic grouping; it is not inferred from `start`. */
  dayPart: DayPart;

  /** Four-state AutiPlanner outcome. */
  status: RoutineStatus;
  completedAt?: string;

  /** Optional stable ordering/template/concurrency fields. */
  order?: number;
  routineId?: string;
  revision?: number;

  tags?: readonly string[];

  /** Unknown AutiPlanner extension properties preserved during round trips. */
  extensions?: Readonly<Record<string, string>>;
}

export interface RoutineDay {
  date: string;
  items: readonly RoutineItem[];
}

export interface RoutineMutationResult {
  item: RoutineItem;
  changed: boolean;
}

const EXTENSION_KEY = /^X-AUTIPLANNER-[A-Z0-9-]+$/;

export function isDayPart(value: string): value is DayPart {
  return (DAY_PARTS as readonly string[]).includes(value);
}

export function isRoutineStatus(value: string): value is RoutineStatus {
  return (ROUTINE_STATUSES as readonly string[]).includes(value);
}

export function validateRoutineItem(item: RoutineItem): readonly string[] {
  const errors: string[] = [];

  if (!item.uid.trim()) errors.push("uid must not be empty");
  if (!item.title.trim()) errors.push("title must not be empty");
  if (!isCalendarDate(item.date)) {
    errors.push("date must be a real calendar day in YYYY-MM-DD");
  }
  if (!isDayPart(item.dayPart)) errors.push("dayPart is not a known day part");
  if (!isRoutineStatus(item.status)) {
    errors.push("status is not a known outcome");
  }

  if (item.start !== undefined && !isIsoTimestamp(item.start)) {
    errors.push("start must be an ISO-8601 timestamp");
  }
  if (item.end !== undefined && !isIsoTimestamp(item.end)) {
    errors.push("end must be an ISO-8601 timestamp");
  }
  if (item.due !== undefined && !isIsoTimestamp(item.due)) {
    errors.push("due must be an ISO-8601 timestamp");
  }
  if (item.timezone !== undefined) {
    if (!item.timezone.trim()) errors.push("timezone must not be empty");
    else if (/[\r\n";,]/.test(item.timezone)) {
      errors.push("timezone contains unsupported characters");
    } else if (!hasFloatingLocalTime(item)) {
      errors.push("timezone requires a floating local timestamp");
    }
  }

  if (item.status === "completed" && !item.completedAt) {
    errors.push("completed items require completedAt");
  }
  if (item.status !== "completed" && item.completedAt) {
    errors.push("only completed items may carry completedAt");
  }
  if (item.completedAt !== undefined && !hasExplicitOffset(item.completedAt)) {
    errors.push("completedAt must include a UTC or numeric offset");
  }

  if (item.order !== undefined && !Number.isSafeInteger(item.order)) {
    errors.push("order must be an integer");
  }
  if (item.revision !== undefined && !Number.isSafeInteger(item.revision)) {
    errors.push("revision must be an integer");
  }
  if (item.revision !== undefined && item.revision < 0) {
    errors.push("revision must be non-negative");
  }
  if (item.routineId !== undefined && !item.routineId.trim()) {
    errors.push("routineId must not be empty");
  }
  if (item.tags?.some((tag) => tag.length === 0)) {
    errors.push("tags must not contain empty values");
  }
  if (item.extensions) {
    for (const key of Object.keys(item.extensions)) {
      if (!EXTENSION_KEY.test(key)) {
        errors.push(`extension key is not an AutiPlanner property: ${key}`);
      }
    }
  }

  return errors;
}

function hasFloatingLocalTime(item: RoutineItem): boolean {
  return [item.start, item.end, item.due].some(
    (value) =>
      value !== undefined &&
      !value.endsWith("Z") &&
      !/[+-]\d{2}:\d{2}$/.test(value),
  );
}
