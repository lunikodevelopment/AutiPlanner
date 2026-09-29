import { DAY_PARTS, type DayPart, type RoutineItem } from "./model.js";
import {
  DAY_PART_HEADING,
  DAY_PART_LABEL,
  STATUS_ACCESSIBLE_LABEL,
  STATUS_SYMBOL,
  formatClock,
} from "./presentation.js";
import { weekdayName } from "./time.js";

export interface DayPartSection {
  dayPart: DayPart;
  heading: string;
  items: readonly RoutineItem[];
}

export interface AgendaDay {
  date: string;
  heading: string;
  sections: readonly DayPartSection[];
}

export interface AgendaOptions {
  /** Include day parts that have no items. Defaults to false. */
  includeEmpty?: boolean;
}

/**
 * Groups routine items by local calendar date, then by explicit day part.
 * Day part is never inferred from the clock. Ordering inside a day part is
 * `order`, then title, then uid.
 */
export function groupAgenda(
  items: readonly RoutineItem[],
  options: AgendaOptions = {},
): readonly AgendaDay[] {
  const includeEmpty = options.includeEmpty ?? false;
  const byDate = new Map<string, RoutineItem[]>();
  for (const item of items) {
    const existing = byDate.get(item.date);
    if (existing) existing.push(item);
    else byDate.set(item.date, [item]);
  }

  return [...byDate.keys()].sort().map((date) => {
    const dayItems = byDate.get(date) ?? [];
    const sections = DAY_PARTS.flatMap((dayPart) => {
      const sectionItems = dayItems
        .filter((item) => item.dayPart === dayPart)
        .sort(compareItems);
      if (!includeEmpty && sectionItems.length === 0) return [];
      return [
        {
          dayPart,
          heading: DAY_PART_HEADING[dayPart],
          items: sectionItems,
        },
      ];
    });
    const weekday = weekdayName(date) ?? "DATE";
    return {
      date,
      heading: `${weekday} — ${date}`,
      sections,
    };
  });
}

/**
 * Canonical visual agenda. Glyphs match the product invariant; they are text,
 * not a color key. Prefer {@link formatAccessibleAgenda} for assistive output.
 */
export function formatAgenda(items: readonly RoutineItem[]): string {
  return groupAgenda(items).map(formatVisualDay).join("\n\n");
}

/** Same grouping, with outcome words instead of glyphs. */
export function formatAccessibleAgenda(items: readonly RoutineItem[]): string {
  return groupAgenda(items).map(formatAccessibleDay).join("\n\n");
}

function formatVisualDay(day: AgendaDay): string {
  const lines = [day.heading];
  for (const section of day.sections) {
    lines.push(`  ${section.heading}`);
    for (const item of section.items) {
      lines.push(`    ${STATUS_SYMBOL[item.status]} ${item.title}${timeSuffix(item)}`);
    }
  }
  return lines.join("\n");
}

function formatAccessibleDay(day: AgendaDay): string {
  const lines = [day.heading];
  for (const section of day.sections) {
    lines.push(`  ${DAY_PART_LABEL[section.dayPart]}`);
    for (const item of section.items) {
      const clock = itemClock(item);
      const when = clock ? `, ${clock}` : "";
      lines.push(
        `    ${STATUS_ACCESSIBLE_LABEL[item.status]}: ${item.title}${when}`,
      );
    }
  }
  return lines.join("\n");
}

function timeSuffix(item: RoutineItem): string {
  const clock = itemClock(item);
  return clock ? `  ${clock}` : "";
}

function itemClock(item: RoutineItem): string | undefined {
  const timestamp = item.start ?? item.due;
  if (!timestamp) return undefined;
  const clock = formatClock(timestamp);
  if (!clock) return undefined;
  if (
    item.timezone &&
    !timestamp.endsWith("Z") &&
    !/[+-]\d{2}:\d{2}$/.test(timestamp)
  ) {
    return `${clock} ${item.timezone}`;
  }
  return clock;
}

function compareItems(left: RoutineItem, right: RoutineItem): number {
  const leftOrder = left.order ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.order ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const byTitle = left.title.localeCompare(right.title);
  if (byTitle !== 0) return byTitle;
  return left.uid.localeCompare(right.uid);
}
