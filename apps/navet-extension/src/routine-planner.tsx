import type { RoutineItem } from "@autiplanner/core";
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
  onError?: (error: unknown) => void;
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
}: RoutinePlannerWidgetProps) {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [pendingCommands, setPendingCommands] = useState<Readonly<Record<string, RoutineCommand>>>({});
  const selectedItem = selectedUid ? items.find((item) => item.uid === selectedUid) ?? null : null;
  const groupedItems = useMemo(
    () => DAY_PARTS.map((dayPart) => ({ dayPart, items: items.filter((item) => item.dayPart === dayPart) })),
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
    <section className="routine-planner" data-theme={theme} aria-labelledby="routine-planner-date">
      <header className="routine-planner__header">
        <h2 id="routine-planner-date">{formatDateLabel(date)}</h2>
        <p>{items.length} {items.length === 1 ? "routine" : "routines"}</p>
      </header>

      {loading ? <p className="routine-planner__message">Loading routines…</p> : null}
      {error ? <p className="routine-planner__message routine-planner__message--error" role="alert">{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="routine-planner__message">No routines scheduled for this day.</p>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="routine-planner__groups">
          {groupedItems.filter(({ items: dayPartItems }) => dayPartItems.length > 0).map(({ dayPart, items: dayPartItems }) => (
            <section className="routine-planner__group" key={dayPart} aria-labelledby={`routine-planner-${dayPart}`}>
              <h3 id={`routine-planner-${dayPart}`}>{DAY_PART_LABELS[dayPart]}</h3>
              <ol className="routine-planner__list">
                {dayPartItems.map((item) => (
                  <RoutineItemRow
                    key={item.uid}
                    item={item}
                    busy={Boolean(pendingCommands[item.uid])}
                    onSelect={() => setSelectedUid(item.uid)}
                    onComplete={() => void runCommand({ type: "complete", uid: item.uid })}
                  />
                ))}
              </ol>
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
}: {
  item: RoutineItem;
  busy: boolean;
  onSelect: () => void;
  onComplete: () => void;
}) {
  return (
    <li className={`routine-planner__item routine-planner__item--${item.status}`}>
      <button className="routine-planner__item-main" type="button" onClick={onSelect} disabled={busy} aria-label={`Open details for ${item.title}`}>
        <span className="routine-planner__glyph" aria-hidden="true">{STATUS_GLYPHS[item.status]}</span>
        <span className="routine-planner__item-copy">
          <span className="routine-planner__item-title">{item.title}</span>
          <span className="routine-planner__item-meta">{STATUS_LABELS[item.status]}{formatTime(item) ? ` · ${formatTime(item)}` : ""}</span>
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
            <p className="routine-planner__details-status">{STATUS_GLYPHS[item.status]} {STATUS_LABELS[item.status]}</p>
            <h3 id="routine-planner-detail-title">{item.title}</h3>
          </div>
          <button className="routine-planner__close" type="button" onClick={onClose} aria-label="Close routine details">Close</button>
        </div>
        {item.description ? <p className="routine-planner__description">{item.description}</p> : null}
        <dl className="routine-planner__facts">
          <div><dt>Day part</dt><dd>{DAY_PART_LABELS[item.dayPart]}</dd></div>
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
