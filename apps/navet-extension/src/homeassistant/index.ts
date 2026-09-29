import type { DayPart, RoutineStatus } from "@autiplanner/core";
import type {
  RoutineCommandResult,
  RoutineInput,
  RoutineProvider,
  RoutineView,
} from "../capability/types.js";
import { toRoutineView } from "../capability/types.js";

/**
 * The narrow transport this adapter is allowed to depend on.
 *
 * Navet owns the real WebSocket/session plumbing; this adapter only needs to
 * send a frame and receive the reply. That keeps provider code out of the
 * shared widget.
 */
export interface HomeAssistantTransport {
  send(frame: Record<string, unknown>): Promise<Record<string, unknown>>;
  subscribe(type: string, listener: (frame: Record<string, unknown>) => void): () => void;
}

export interface HomeAssistantRoutineOptions {
  readonly transport: HomeAssistantTransport;
  /** `todo.<name>` or `calendar.<name>`, or the agenda sensor id. */
  readonly entityId: string;
  /** Days of history and future to request. */
  readonly windowDays?: number;
  /** Called for every frame type this adapter subscribes to. */
  readonly onEventType?: string;
}

interface AgendaFrame {
  items?: unknown[];
}

const STATUSES: readonly RoutineStatus[] = ["pending", "completed", "missed", "skipped"];
const DAY_PARTS: readonly DayPart[] = ["morning", "afternoon", "evening", "night"];

export class HomeAssistantRoutineProvider implements RoutineProvider {
  readonly id = "homeassistant";
  private readonly _transport: HomeAssistantTransport;
  private readonly _entityId: string;
  private readonly _windowDays: number;
  private readonly _eventType: string;

  constructor(options: HomeAssistantRoutineOptions) {
    this._transport = options.transport;
    this._entityId = options.entityId;
    this._windowDays = options.windowDays ?? 14;
    this._eventType = options.onEventType ?? "autiplanner/agenda/subscribed";
  }

  async listDays(fromDate: string, days: number): Promise<readonly RoutineView[]> {
    const frame = await this._transport.send({
      type: "autiplanner/agenda",
      entity_id: [this._entityId],
      limit: days,
      from: fromDate,
    });
    return readItems(frame);
  }

  async complete(id: string, expectedRevision?: number): Promise<RoutineCommandResult> {
    return this._command("complete", id, expectedRevision);
  }

  async markMissed(id: string, expectedRevision?: number): Promise<RoutineCommandResult> {
    return this._command("mark_missed", id, expectedRevision);
  }

  async skip(id: string, expectedRevision?: number): Promise<RoutineCommandResult> {
    return this._command("skip", id, expectedRevision);
  }

  async reset(id: string, expectedRevision?: number): Promise<RoutineCommandResult> {
    return this._command("reset", id, expectedRevision);
  }

  async create(item: RoutineInput): Promise<RoutineCommandResult> {
    const frame = await this._transport.send({
      type: "autiplanner/command",
      command: "create",
      entity_id: [this._entityId],
      item: toPayload(item),
    });
    return readResult(frame);
  }

  async update(
    id: string,
    patch: RoutineInput,
    expectedRevision?: number,
  ): Promise<RoutineCommandResult> {
    const frame = await this._transport.send({
      type: "autiplanner/command",
      command: "update",
      entity_id: [this._entityId],
      uid: id,
      patch: toPayload(patch),
      ...(expectedRevision !== undefined ? { expected_revision: expectedRevision } : {}),
    });
    return readResult(frame);
  }

  async delete(id: string, expectedRevision?: number): Promise<RoutineCommandResult> {
    const frame = await this._transport.send({
      type: "autiplanner/command",
      command: "delete",
      entity_id: [this._entityId],
      uid: id,
      ...(expectedRevision !== undefined ? { expected_revision: expectedRevision } : {}),
    });
    return readResult(frame);
  }

  subscribe(listener: () => void): () => void {
    this._transport.send({
      type: "autiplanner/agenda/subscribe",
      entity_id: [this._entityId],
      limit: this._windowDays,
    });
    return this._transport.subscribe(this._eventType, listener);
  }

  private async _command(
    command: string,
    id: string,
    expectedRevision?: number,
  ): Promise<RoutineCommandResult> {
    const frame = await this._transport.send({
      type: "autiplanner/command",
      command,
      entity_id: [this._entityId],
      uid: id,
      ...(expectedRevision !== undefined ? { expected_revision: expectedRevision } : {}),
    });
    return readResult(frame);
  }
}

/**
 * Normalizes an integration payload into a view.
 *
 * Day part and outcome come from AutiPlanner fields. A payload without both is
 * rejected instead of being guessed from the clock.
 */
export function readItems(frame: Record<string, unknown>): RoutineView[] {
  const agenda = frame as AgendaFrame;
  const rows = Array.isArray(agenda.items) ? agenda.items : [];
  const views: RoutineView[] = [];
  for (const row of rows) {
    const view = parseItem(row);
    if (view) views.push(view);
  }
  return views;
}

function readResult(frame: Record<string, unknown>): RoutineCommandResult {
  if (frame.success === false) {
    const error = frame.error as { code?: string; message?: string } | undefined;
    const result: RoutineCommandResult = { ok: false };
    if (error?.code) Object.assign(result, { code: mapCode(error.code) });
    if (error?.message) Object.assign(result, { message: error.message });
    return result;
  }
  const item = parseItem(frame.item);
  return {
    ok: true,
    ...(item ? { item } : {}),
  };
}

type FailureCode = NonNullable<RoutineCommandResult["code"]>;

function mapCode(code: string): FailureCode {
  if (code.includes("conflict")) return "conflict";
  if (code.includes("not_found") || code.includes("not-found")) return "not-found";
  if (code.includes("invalid")) return "invalid";
  return "unavailable";
}

function parseItem(row: unknown): RoutineView | undefined {
  if (!row || typeof row !== "object") return undefined;
  const value = row as Record<string, unknown>;
  const uid = typeof value.uid === "string" ? value.uid : undefined;
  const title = typeof value.title === "string" ? value.title : undefined;
  const date = typeof value.date === "string" ? value.date : undefined;
  const dayPart = value.dayPart;
  const status = value.status;
  if (!uid || !title || !date) return undefined;
  if (typeof dayPart !== "string" || !DAY_PARTS.includes(dayPart as DayPart)) return undefined;
  if (typeof status !== "string" || !STATUSES.includes(status as RoutineStatus)) return undefined;

  const view = toRoutineView(
    {
      uid,
      title,
      date,
      dayPart: dayPart as DayPart,
      status: status as RoutineStatus,
      ...(typeof value.start === "string" ? { start: value.start } : {}),
      ...(typeof value.due === "string" ? { due: value.due } : {}),
      ...(typeof value.timezone === "string" ? { timezone: value.timezone } : {}),
      ...(typeof value.completedAt === "string" ? { completedAt: value.completedAt } : {}),
      ...(typeof value.description === "string" ? { description: value.description } : {}),
      ...(typeof value.order === "number" ? { order: value.order } : {}),
      ...(typeof value.revision === "number" ? { revision: value.revision } : {}),
    },
    uid,
  );
  return view;
}

function toPayload(item: RoutineInput): Record<string, unknown> {
  return {
    uid: item.id,
    title: item.title,
    date: item.date,
    day_part: item.dayPart,
    ...(item.start !== undefined ? { start: item.start } : {}),
    ...(item.due !== undefined ? { due: item.due } : {}),
    ...(item.description !== undefined ? { description: item.description } : {}),
  };
}
