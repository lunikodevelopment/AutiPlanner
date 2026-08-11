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

  /** Optional ISO-8601 scheduling timestamps. */
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    errors.push("date must use YYYY-MM-DD");
  }

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
