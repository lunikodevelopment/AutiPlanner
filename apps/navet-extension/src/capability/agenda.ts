import {
  DAY_PARTS,
  DAY_PART_HEADING,
  STATUS_ACCESSIBLE_LABEL,
  STATUS_SYMBOL,
  formatClock,
  weekdayName,
  type DayPart,
  type RoutineStatus,
} from "@autiplanner/core";
import type { DayPartSectionView, RoutineDayView, RoutineView } from "./types.js";

/**
 * Groups normalized views into the canonical agenda.
 *
 * Day part comes from the item, never from the clock. This mirrors the core
 * agenda so the dashboard and the mobile client cannot disagree.
 */
export function groupDays(
  items: readonly RoutineView[],
  options: { includeEmpty?: boolean } = {},
): readonly RoutineDayView[] {
  const includeEmpty = options.includeEmpty ?? false;
  const byDate = new Map<string, RoutineView[]>();
  for (const item of items) {
    const bucket = byDate.get(item.date);
    if (bucket) bucket.push(item);
    else byDate.set(item.date, [item]);
  }

  return [...byDate.keys()].sort().map((date) => {
    const dayItems = byDate.get(date) ?? [];
    const sections = DAY_PARTS.flatMap((dayPart) => {
      const sectionItems = dayItems
        .filter((item) => item.dayPart === dayPart)
        .sort(compareItems);
      if (!includeEmpty && sectionItems.length === 0) return [];
      return [{ dayPart, heading: DAY_PART_HEADING[dayPart], items: sectionItems }];
    });
    const weekday = weekdayName(date) ?? "DATE";
    return { date, heading: `${weekday} — ${date}`, sections };
  });
}

export interface OutcomeControl {
  readonly status: RoutineStatus;
  readonly symbol: string;
  /** Required. Status is never communicated by glyph or color alone. */
  readonly accessibleLabel: string;
  /** Minimum touch target. 48dp keeps the control usable on a tablet. */
  readonly minTouchTargetPx: number;
  /** The next state a single tap should apply, or undefined when terminal. */
  readonly nextStatus?: RoutineStatus;
  readonly destructive: boolean;
}

const TOUCH_TARGET = 48;

/**
 * The four states, with a spoken label and an explicit next action.
 *
 * A single tap never performs a destructive one-tap change: a pending item
 * becomes completed, and missed/skipped are reached through the secondary menu
 * where an undo path is always visible.
 */
export function outcomeControls(
  current: RoutineStatus,
  options: { canUndo?: boolean } = {},
): readonly OutcomeControl[] {
  const canUndo = options.canUndo ?? true;
  const order: readonly RoutineStatus[] = ["pending", "completed", "missed", "skipped"];
  return order.map((status) => {
    const base: OutcomeControl = {
      status,
      symbol: STATUS_SYMBOL[status],
      accessibleLabel: STATUS_ACCESSIBLE_LABEL[status],
      minTouchTargetPx: TOUCH_TARGET,
      destructive: status === "missed" || status === "skipped",
    };
    if (status === current) {
      // Tapping the current state resets it, so a mis-tap is reversible.
      return canUndo && current !== "pending" ? { ...base, nextStatus: "pending" } : base;
    }
    // A single tap completes. Missed and skipped need the secondary menu.
    return status === "completed" ? { ...base, nextStatus: "completed" } : base;
  });
}

export function describeItem(item: RoutineView): string {
  const label = STATUS_ACCESSIBLE_LABEL[item.status];
  const clock = itemClock(item);
  return clock ? `${label}: ${item.title}, ${clock}` : `${label}: ${item.title}`;
}

export function describeDay(day: RoutineDayView): string {
  const lines = [day.heading];
  for (const section of day.sections) {
    for (const item of section.items) lines.push(`  ${describeItem(item)}`);
  }
  return lines.join("\n");
}

/** Total items per outcome, so a summary never collapses the four states. */
export function outcomeSummary(
  items: readonly RoutineView[],
): Readonly<Record<RoutineStatus, number>> {
  const summary: Record<RoutineStatus, number> = {
    pending: 0,
    completed: 0,
    missed: 0,
    skipped: 0,
  };
  for (const item of items) summary[item.status] += 1;
  return summary;
}

export type { DayPart, DayPartSectionView, RoutineDayView, RoutineView };

function itemClock(item: RoutineView): string | undefined {
  const timestamp = item.start ?? item.due;
  if (!timestamp) return undefined;
  return formatClock(timestamp);
}

function compareItems(left: RoutineView, right: RoutineView): number {
  const leftOrder = left.order ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.order ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const byTitle = left.title.localeCompare(right.title);
  if (byTitle !== 0) return byTitle;
  return left.id.localeCompare(right.id);
}
