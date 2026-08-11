import type { DayPart, RoutineItem, RoutineStatus } from "@autiplanner/core";
import { isDayPart, isRoutineStatus, validateRoutineItem } from "@autiplanner/core";
import type { RoutineCapability, RoutineCommand } from "./capability.js";

export interface HomeAssistantTodoState {
  attributes?: Readonly<Record<string, unknown>>;
}

export interface HomeAssistantRoutineBridge {
  entityId: string;
  getTodoState(): Promise<HomeAssistantTodoState>;
  subscribeTodoState(listener: (state: HomeAssistantTodoState) => void): () => void;
  callService(
    domain: "autiplanner",
    service: RoutineCommand["type"],
    data: Readonly<Record<string, string>>,
    target: Readonly<{ entity_id: string }>,
  ): Promise<void>;
}

interface HomeAssistantRoutineRecord {
  uid: string;
  title: string;
  date: string;
  day_part: string;
  outcome: string;
  description?: unknown;
  start?: unknown;
  end?: unknown;
  due?: unknown;
  timezone?: unknown;
  completed_at?: unknown;
  order?: unknown;
  routine_id?: unknown;
  revision?: unknown;
  tags?: unknown;
  extensions?: unknown;
}

export function normalizeHomeAssistantRoutineItems(
  state: HomeAssistantTodoState,
): readonly RoutineItem[] {
  const records = state.attributes?.autiplanner_items;
  if (!Array.isArray(records)) return [];

  return records
    .map((record) => normalizeRecord(record))
    .filter((item): item is RoutineItem => item !== null)
    .sort((left, right) => {
      const orderDifference = (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
      return orderDifference || left.uid.localeCompare(right.uid);
    });
}

function normalizeRecord(value: unknown): RoutineItem | null {
  if (!isRecord(value)) return null;
  const record = value as Partial<HomeAssistantRoutineRecord>;
  if (
    typeof record.uid !== "string" ||
    typeof record.title !== "string" ||
    typeof record.date !== "string" ||
    typeof record.day_part !== "string" ||
    !isDayPart(record.day_part) ||
    typeof record.outcome !== "string" ||
    !isRoutineStatus(record.outcome)
  ) {
    return null;
  }

  const item: RoutineItem = {
    uid: record.uid,
    title: record.title,
    date: record.date,
    dayPart: record.day_part as DayPart,
    status: record.outcome as RoutineStatus,
  };
  assignOptionalString(item, "description", record.description);
  assignOptionalString(item, "start", record.start);
  assignOptionalString(item, "end", record.end);
  assignOptionalString(item, "due", record.due);
  assignOptionalString(item, "timezone", record.timezone);
  assignOptionalString(item, "completedAt", record.completed_at);
  assignOptionalString(item, "routineId", record.routine_id);
  if (typeof record.order === "number" && Number.isFinite(record.order)) item.order = record.order;
  if (typeof record.revision === "number" && Number.isFinite(record.revision)) {
    item.revision = record.revision;
  }
  if (Array.isArray(record.tags)) {
    const tags = record.tags.filter((tag): tag is string => typeof tag === "string");
    if (tags.length > 0) item.tags = tags;
  }
  if (isRecord(record.extensions)) {
    const extensions = Object.fromEntries(
      Object.entries(record.extensions).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    if (Object.keys(extensions).length > 0) item.extensions = extensions;
  }
  return validateRoutineItem(item).length === 0 ? item : null;
}

function assignOptionalString(
  item: RoutineItem,
  key: "description" | "start" | "end" | "due" | "timezone" | "completedAt" | "routineId",
  value: unknown,
): void {
  if (typeof value === "string" && value.length > 0) item[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createHomeAssistantRoutineCapability(
  bridge: HomeAssistantRoutineBridge,
): RoutineCapability {
  return {
    async getItems() {
      return normalizeHomeAssistantRoutineItems(await bridge.getTodoState());
    },
    subscribe(listener) {
      return bridge.subscribeTodoState((state) => listener(normalizeHomeAssistantRoutineItems(state)));
    },
    async execute(command) {
      const data: Record<string, string> = { uid: command.uid };
      if (command.type === "complete" && command.completedAt) data.completed_at = command.completedAt;
      await bridge.callService("autiplanner", command.type, data, { entity_id: bridge.entityId });
    },
  };
}
