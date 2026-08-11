export const DAY_PARTS = ["morning", "afternoon", "evening", "night"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

export const ROUTINE_STATUSES = [
  "pending",
  "completed",
  "missed",
  "skipped",
] as const;
export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];

export const ROUTINE_PRIORITIES = ["must_do", "preferably", "optional"] as const;
export type RoutinePriority = (typeof ROUTINE_PRIORITIES)[number];

export interface RoutineItem {
  /** Stable calendar identity. Never derive this from the mutable title. */
  uid: string;
  title: string;
  description?: string;

  /** Optional icon-font token, for example `mdi:coffee` or `fa:coffee`. */
  icon?: string;

  /** Local calendar day, encoded as YYYY-MM-DD. */
  date: string;

  /** Optional ISO-8601 scheduling timestamps. */
  start?: string;
  end?: string;
  due?: string;
  timezone?: string;

  /** Explicit semantic grouping; it is not inferred from `start`. */
  dayPart: DayPart;

  /** Four-state AutiPlanner outcome. */
  status: RoutineStatus;
  /** User-controlled urgency/color category. */
  priority?: RoutinePriority;
  completedAt?: string;

  /** Optional stable ordering/template/concurrency fields. */
  order?: number;
  routineId?: string;
  revision?: number;

  /** Standard iCalendar recurrence fields. A recurring master remains pending; outcomes belong to occurrences. */
  rrule?: string;
  rdate?: readonly string[];
  exdate?: readonly string[];
  recurrenceId?: string;

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

export function isDayPart(value: string): value is DayPart {
  return (DAY_PARTS as readonly string[]).includes(value);
}

export function isRoutineStatus(value: string): value is RoutineStatus {
  return (ROUTINE_STATUSES as readonly string[]).includes(value);
}

export function isRoutinePriority(value: string): value is RoutinePriority {
  return (ROUTINE_PRIORITIES as readonly string[]).includes(value);
}

export function validateRoutineItem(item: RoutineItem): readonly string[] {
  const errors: string[] = [];

  if (!item.uid.trim()) errors.push("uid must not be empty");
  if (!item.title.trim()) errors.push("title must not be empty");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !isValidCalendarDate(item.date)) {
    errors.push("date must use YYYY-MM-DD");
  }
  if (!isDayPart(item.dayPart)) errors.push("dayPart must be a supported day part");
  if (!isRoutineStatus(item.status)) errors.push("status must be a supported routine status");
  if (item.priority !== undefined && !isRoutinePriority(item.priority)) errors.push("priority must be supported");

  if (item.status === "completed" && !item.completedAt) {
    errors.push("completed items require completedAt");
  }

  if (item.status !== "completed" && item.completedAt) {
    errors.push("only completed items may carry completedAt");
  }

  if (item.revision !== undefined && item.revision < 0) {
    errors.push("revision must be non-negative");
  }

  return errors;
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
