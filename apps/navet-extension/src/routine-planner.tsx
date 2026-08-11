import type { RoutineItem, RoutinePriority } from "@autiplanner/core";
import { useEffect, useMemo, useState } from "react";
import type { RoutineCommand } from "./capability.js";
import { commandTargetStatus } from "./capability.js";

export type RoutinePlannerTheme = "glass" | "dark" | "light" | "black";

export interface RoutinePlannerWidgetProps {
  date: string;
  items: readonly RoutineItem[];
  onCommand: (command: RoutineCommand) => Promise<void>;
  theme?: RoutinePlannerTheme;
  loading?: boolean;
  error?: string;
  onError?: ((error: unknown) => void) | undefined;
  iconFontFamily?: string | undefined;
}

const DAY_PARTS = ["morning", "afternoon", "evening", "night"] as const;
const DAY_PART_LABELS: Record<(typeof DAY_PARTS)[number], string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};
const STATUS_GLYPHS = { pending: "○", completed: "✓", missed: "✕", skipped: "—" } as const;
const STATUS_LABELS = { pending: "Pending", completed: "Completed", missed: "Missed", skipped: "Skipped" } as const;

export function RoutinePlannerWidget({
  date,
  items,
  onCommand,
  theme = "light",
  loading = false,
  error,
  onError,
  iconFontFamily,
}: RoutinePlannerWidgetProps) {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [pendingCommands, setPendingCommands] = useState<Readonly<Record<string, RoutineCommand>>>({});
  const selectedItem = selectedUid ? items.find((item) => item.uid === selectedUid) ?? null : null;
  const groupedItems = useMemo(
    () => DAY_PARTS.map((dayPart) => ({ dayPart, items: items.filter((item) => item.dayPart === dayPart).slice().sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority)) })),
    [items],
  );

  useEffect(() => {
    if (selectedUid && !items.some((item) => item.uid === selectedUid)) setSelectedUid(null);
  }, [items, selectedUid]);

  useEffect(() => {
    setPendingCommands((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([uid, command]) => {
          const item = items.find((candidate) => candidate.uid === uid);
          return !item || item.status !== commandTargetStatus(command);
        }),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [items]);

  const runCommand = async (command: RoutineCommand) => {
    setPendingCommands((current) => ({ ...current, [command.uid]: command }));
    try {
      await onCommand(command);
    } catch (caught) {
      setPendingCommands((current) => {
        const next = { ...current };
        delete next[command.uid];
        return next;
      });
      onError?.(caught);
    }
  };

  return (
    <section className="routine-planner" data-theme={theme} data-icon-font={iconFontFamily ?? undefined} aria-labelledby="routine-planner-date">
      <header className="routine-planner__header">
        <h2 id="routine-planner-date">{formatDateLabel(date)}</h2>
        <p>{items.length} {items.length === 1 ? "routine" : "routines"}</p>
      </header>
      <PriorityLegend />

      {loading ? <p className="routine-planner__message">Loading routines…</p> : null}
      {error ? <p className="routine-planner__message routine-planner__message--error" role="alert">{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="routine-planner__message">No routines scheduled for this day.</p>
      ) : null}

      {!loading && !error ? (
        <div className="routine-planner__groups">
          {groupedItems.map(({ dayPart, items: dayPartItems }) => (
            <section className="routine-planner__group" key={dayPart} aria-labelledby={`routine-planner-${dayPart}`}>
              <h3 id={`routine-planner-${dayPart}`}>{DAY_PART_LABELS[dayPart]}</h3>
              {dayPartItems.length > 0 ? <ol className="routine-planner__list">
                {dayPartItems.map((item) => (
                  <RoutineItemRow
                    key={item.uid}
                    item={item}
                    busy={Boolean(pendingCommands[item.uid])}
                    onSelect={() => setSelectedUid(item.uid)}
                    iconFontFamily={iconFontFamily}
                    onComplete={() => void runCommand({ type: "complete", uid: item.uid })}
                  />
                ))}
              </ol> : <p className="routine-planner__empty-period">No routines</p>}
            </section>
          ))}
        </div>
      ) : null}

      {selectedItem ? (
        <RoutineItemDetails
          item={selectedItem}
          busy={Boolean(pendingCommands[selectedItem.uid])}
          onClose={() => setSelectedUid(null)}
          onCommand={runCommand}
        />
      ) : null}
    </section>
  );
}

function RoutineItemRow({
  item,
  busy,
  onSelect,
  onComplete,
  iconFontFamily,
}: {
  item: RoutineItem;
  busy: boolean;
  onSelect: () => void;
  onComplete: () => void;
  iconFontFamily?: string | undefined;
}) {
  return (
    <li className={`routine-planner__item routine-planner__item--${item.status} routine-planner__item--priority-${item.priority ?? "preferably"}`}>
      <button className="routine-planner__item-main" type="button" onClick={onSelect} disabled={busy} aria-label={`Open details for ${item.title}`}>
        <span className="routine-planner__glyph" aria-hidden="true">{STATUS_GLYPHS[item.status]}</span>
        {item.icon ? <span className="routine-planner__event-icon" aria-hidden="true" style={iconFontFamily ? { fontFamily: iconFontFamily } : undefined}>{renderIcon(item.icon)}</span> : null}
        <span className="routine-planner__item-copy">
          <span className="routine-planner__item-title"><span className="routine-planner__priority-dot" aria-label={priorityLabel(item.priority)} title={priorityLabel(item.priority)} aria-hidden="true">●</span> {item.title}</span>
          <span className="routine-planner__item-meta">{priorityLabel(item.priority)} · {STATUS_LABELS[item.status]}{formatTime(item) ? ` · ${formatTime(item)}` : ""}</span>
        </span>
      </button>
      {item.status === "pending" ? (
        <button className="routine-planner__complete" type="button" onClick={onComplete} disabled={busy}>
          {busy ? "Saving…" : "Complete"}
        </button>
      ) : null}
    </li>
  );
}

function RoutineItemDetails({
  item,
  busy,
  onClose,
  onCommand,
}: {
  item: RoutineItem;
  busy: boolean;
  onClose: () => void;
  onCommand: (command: RoutineCommand) => Promise<void>;
}) {
  return (
    <div className="routine-planner__details-backdrop" role="presentation" onClick={onClose}>
      <div className="routine-planner__details" role="dialog" aria-modal="true" aria-labelledby="routine-planner-detail-title" onClick={(event) => event.stopPropagation()}>
        <div className="routine-planner__details-header">
          <div>
            <p className="routine-planner__details-status">{STATUS_GLYPHS[item.status]} {STATUS_LABELS[item.status]}{item.icon ? ` · ${renderIcon(item.icon)}` : ""}</p>
            <h3 id="routine-planner-detail-title">{item.title}</h3>
          </div>
          <button className="routine-planner__close" type="button" onClick={onClose} aria-label="Close routine details">Close</button>
        </div>
        {item.description ? <p className="routine-planner__description">{item.description}</p> : null}
        <dl className="routine-planner__facts">
          <div><dt>Day part</dt><dd>{DAY_PART_LABELS[item.dayPart]}</dd></div>
          {item.icon ? <div><dt>Icon</dt><dd>{item.icon}</dd></div> : null}
          <div><dt>Priority</dt><dd>{priorityLabel(item.priority)}</dd></div>
          <div><dt>Time</dt><dd>{formatTime(item) ?? "Any time"}</dd></div>
          {item.completedAt ? <div><dt>Completed</dt><dd>{formatDateTime(item.completedAt)}</dd></div> : null}
        </dl>
        <div className="routine-planner__actions">
          {item.status === "pending" ? <button type="button" onClick={() => void onCommand({ type: "complete", uid: item.uid })} disabled={busy}>Complete</button> : null}
          {item.status !== "missed" ? <button type="button" onClick={() => void onCommand({ type: "mark_missed", uid: item.uid })} disabled={busy}>Mark missed</button> : null}
          {item.status !== "skipped" ? <button type="button" onClick={() => void onCommand({ type: "skip", uid: item.uid })} disabled={busy}>Skip</button> : null}
          {item.status !== "pending" ? <button type="button" onClick={() => void onCommand({ type: "reset", uid: item.uid })} disabled={busy}>Reset</button> : null}
        </div>
      </div>
    </div>
  );
}

function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(parsed);
}

function formatTime(item: RoutineItem): string | null {
  const value = item.start ?? item.due;
  if (!value) return null;
  const match = /T(\d{2}:\d{2})/.exec(value);
  return match?.[1] ?? null;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export interface RoutinePlannerCalendarProps extends Omit<RoutinePlannerWidgetProps, "date" | "items"> {
  month: string;
  items: readonly RoutineItem[];
  selectedDate?: string;
  onSelectDate: (date: string) => void;
}

/** Monthly Navet/home view with ISO week numbers and a selected day detail pane. */
export function RoutinePlannerCalendar({
  month,
  items,
  selectedDate,
  onSelectDate,
  onCommand,
  theme = "light",
  loading = false,
  error,
  onError,
  iconFontFamily,
}: RoutinePlannerCalendarProps) {
  const days = monthDays(month);
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7));
  const activeDate = selectedDate ?? days.find((day) => day.inMonth)?.date ?? days[0]?.date ?? month;
  const selectedItems = items.filter((item) => item.date === activeDate);
  const byDate = new Map<string, RoutineItem[]>();
  for (const item of items) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);

  return (
    <section className="routine-planner routine-planner--calendar" data-theme={theme} data-icon-font={iconFontFamily ?? undefined} aria-labelledby="routine-planner-calendar-title">
      <header className="routine-planner__header">
        <h2 id="routine-planner-calendar-title">{formatMonthLabel(month)}</h2>
        <p>{items.length} {items.length === 1 ? "routine" : "routines"}</p>
      </header>
      <PriorityLegend />
      {error ? <p className="routine-planner__message routine-planner__message--error" role="alert">{error}</p> : null}
      <div className="routine-planner__month-grid" role="grid" aria-label={formatMonthLabel(month)}>
        <div className="routine-planner__calendar-head"><div className="routine-planner__week-heading" role="columnheader">Wk</div>
          {WEEKDAYS.map((day) => <div className="routine-planner__day-heading" role="columnheader" key={day}>{day}</div>)}
        </div>
        {weeks.map((week) => <div className="routine-planner__calendar-row" role="row" key={week[0]?.date}>
          <span className="routine-planner__week-number" aria-label={`Week ${week[0]?.weekNumber ?? ""}`}>{week[0]?.weekNumber ?? ""}</span>
          {week.map((day) => {
            const dayItems = byDate.get(day.date) ?? [];
            const priority = dayItems.slice().sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))[0]?.priority;
            return <button
              className={`routine-planner__day${day.date === activeDate ? " is-selected" : ""}${day.inMonth ? "" : " is-outside"}`}
              type="button"
              role="gridcell"
              aria-label={`${formatDateLabel(day.date)}${dayItems.length ? `, ${dayItems.length} routines` : ", no routines"}`}
              aria-pressed={day.date === activeDate}
              onClick={() => onSelectDate(day.date)}
              key={day.date}
            >
              <span className="routine-planner__day-number">{day.day}</span>
              {dayItems.length > 0 ? <span className={`routine-planner__day-count routine-planner__day-count--${priority ?? "preferably"}`}>{dayItems.length}</span> : null}
            </button>;
          })}
        </div>)}
      </div>
      {loading ? <p className="routine-planner__message">Loading routines…</p> : null}
      {!loading ? <RoutinePlannerWidget date={activeDate} items={selectedItems} onCommand={onCommand} theme={theme} onError={onError} iconFontFamily={iconFontFamily} /> : null}
    </section>
  );
}

const ICON_GLYPHS: Readonly<Record<string, string>> = {
  "fa:coffee": "\uf0f4",
  "fa:medkit": "\uf0fa",
  "fa:heart": "\uf004",
  "fa:bed": "\uf236",
  "fa:walking": "\uf554",
  "mdi:coffee": "☕",
  "mdi:pill": "💊",
  "mdi:heart": "♥",
  "mdi:sleep": "☾",
};
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

function renderIcon(value: string): string {
  return ICON_GLYPHS[value.toLowerCase()] ?? (value.startsWith("unicode:") ? value.slice("unicode:".length) : value);
}

function priorityRank(value: RoutinePriority | undefined): number {
  return value === "must_do" ? 0 : value === "optional" ? 2 : 1;
}

function priorityLabel(value: RoutinePriority | undefined): string {
  return value === "must_do" ? "Must do" : value === "optional" ? "Optional" : "Preferably";
}

function PriorityLegend() {
  return <div className="routine-planner__legend" aria-label="Routine priority legend">
    <span><i className="routine-planner__legend-dot routine-planner__legend-dot--must_do" aria-hidden="true" />Must do</span>
    <span><i className="routine-planner__legend-dot routine-planner__legend-dot--preferably" aria-hidden="true" />Preferably</span>
    <span><i className="routine-planner__legend-dot routine-planner__legend-dot--optional" aria-hidden="true" />Optional</span>
  </div>;
}

function formatMonthLabel(value: string): string {
  const date = new Date(`${value}-01T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  weekNumber: number | null;
}

function monthDays(month: string): CalendarDay[] {
  const parsed = new Date(`${month}-01T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return [];
  const first = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
  const start = new Date(first);
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  const last = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0));
  const end = new Date(last);
  end.setUTCDate(end.getUTCDate() + (7 - ((last.getUTCDay() + 6) % 7) - 1));
  const days: CalendarDay[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = new Date(cursor);
    days.push({
      date: day.toISOString().slice(0, 10),
      day: day.getUTCDate(),
      inMonth: day.getUTCMonth() === parsed.getUTCMonth(),
      weekNumber: day.getUTCDay() === 1 ? isoWeekNumber(day) : null,
    });
  }
  return days;
}

function isoWeekNumber(value: Date): number {
  const thursday = new Date(value);
  thursday.setUTCDate(value.getUTCDate() + 3 - ((value.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}
