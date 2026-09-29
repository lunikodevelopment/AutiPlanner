import type { DayPart, RoutineItem, RoutineStatus } from "@autiplanner/core";

/**
 * Provider-neutral view of a routine item.
 *
 * This is the only shape the shared widget consumes. It must stay independent
 * of Home Assistant entity ids, service payloads, and websocket frames.
 */
export interface RoutineView {
  /** Provider-scoped identity, stable for the household. */
  readonly id: string;
  readonly title: string;
  /** Local calendar day, YYYY-MM-DD. */
  readonly date: string;
  readonly dayPart: DayPart;
  readonly status: RoutineStatus;
  readonly start?: string;
  readonly due?: string;
  readonly completedAt?: string;
  /** Display order within a day part. Not a concurrency token. */
  readonly order?: number;
  readonly revision?: number;
  readonly description?: string;
}

export interface DayPartSectionView {
  readonly dayPart: DayPart;
  readonly heading: string;
  readonly items: readonly RoutineView[];
}

export interface RoutineDayView {
  readonly date: string;
  readonly heading: string;
  readonly sections: readonly DayPartSectionView[];
}

export type RoutineCommandName =
  | "complete"
  | "markMissed"
  | "skip"
  | "reset"
  | "create"
  | "update"
  | "delete";

/** Result of a command. The confirmed item is the point, not a boolean. */
export interface RoutineCommandResult {
  readonly ok: boolean;
  readonly item?: RoutineView;
  readonly code?: "conflict" | "not-found" | "invalid" | "unavailable";
  readonly message?: string;
}

/**
 * The capability a provider must supply. Shared UI depends on this and never
 * on a provider SDK.
 */
export interface RoutineProvider {
  readonly id: string;
  /** Reads a normalized agenda for a window. */
  listDays(fromDate: string, days: number): Promise<readonly RoutineView[]>;
  complete(id: string, expectedRevision?: number): Promise<RoutineCommandResult>;
  markMissed(id: string, expectedRevision?: number): Promise<RoutineCommandResult>;
  skip(id: string, expectedRevision?: number): Promise<RoutineCommandResult>;
  reset(id: string, expectedRevision?: number): Promise<RoutineCommandResult>;
  create(item: RoutineInput): Promise<RoutineCommandResult>;
  update(
    id: string,
    patch: RoutineInput,
    expectedRevision?: number,
  ): Promise<RoutineCommandResult>;
  delete(id: string, expectedRevision?: number): Promise<RoutineCommandResult>;
  /** Notifies after another client changed the calendar. */
  subscribe(listener: () => void): () => void;
}

export interface RoutineInput {
  readonly id?: string;
  readonly title: string;
  readonly date: string;
  readonly dayPart: DayPart;
  readonly start?: string;
  readonly due?: string;
  readonly description?: string;
}

/** Minimal shape the widget needs from a core item. */
export function toRoutineView(item: RoutineItem, id = item.uid): RoutineView {
  const view: RoutineView = {
    id,
    title: item.title,
    date: item.date,
    dayPart: item.dayPart,
    status: item.status,
  };
  if (item.start !== undefined) Object.assign(view, { start: item.start });
  if (item.due !== undefined) Object.assign(view, { due: item.due });
  if (item.completedAt !== undefined) Object.assign(view, { completedAt: item.completedAt });
  if (item.order !== undefined) Object.assign(view, { order: item.order });
  if (item.revision !== undefined) Object.assign(view, { revision: item.revision });
  if (item.description !== undefined) Object.assign(view, { description: item.description });
  return view;
}
