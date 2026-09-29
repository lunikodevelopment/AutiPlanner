import {
  validateRoutineItem,
  type RoutineItem,
  type RoutineMutationResult,
  type RoutineStatus,
} from "./model.js";
import { hasExplicitOffset } from "./time.js";

export type CommandErrorCode =
  | "not-found"
  | "duplicate-uid"
  | "invalid-item"
  | "invalid-patch"
  | "conflict"
  | "series-completion";

export class RoutineCommandError extends Error {
  readonly code: CommandErrorCode;
  readonly details: readonly string[];

  constructor(
    code: CommandErrorCode,
    message: string,
    details: readonly string[] = [],
  ) {
    super(message);
    this.name = "RoutineCommandError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Patch fields replace the current value. `null` clears an optional field.
 * `uid` cannot be patched. Omitted fields stay unchanged.
 */
export interface RoutineItemPatch {
  title?: string;
  description?: string | null;
  date?: string;
  start?: string | null;
  end?: string | null;
  due?: string | null;
  timezone?: string | null;
  dayPart?: RoutineItem["dayPart"];
  status?: RoutineStatus;
  completedAt?: string | null;
  order?: number | null;
  routineId?: string | null;
  revision?: number | null;
  tags?: readonly string[] | null;
  extensions?: Readonly<Record<string, string>> | null;
}

export interface CollectionMutation {
  items: readonly RoutineItem[];
  result: RoutineMutationResult;
}

export interface DeleteMutation {
  items: readonly RoutineItem[];
  item: RoutineItem;
  changed: true;
}

export function complete(
  items: readonly RoutineItem[],
  uid: string,
  completedAt: string,
  expectedRevision?: number,
): CollectionMutation {
  return applyStatus(items, uid, "completed", completedAt, expectedRevision);
}

export function markMissed(
  items: readonly RoutineItem[],
  uid: string,
  expectedRevision?: number,
): CollectionMutation {
  return applyStatus(items, uid, "missed", undefined, expectedRevision);
}

export function skip(
  items: readonly RoutineItem[],
  uid: string,
  expectedRevision?: number,
): CollectionMutation {
  return applyStatus(items, uid, "skipped", undefined, expectedRevision);
}

export function reset(
  items: readonly RoutineItem[],
  uid: string,
  expectedRevision?: number,
): CollectionMutation {
  return applyStatus(items, uid, "pending", undefined, expectedRevision);
}

export function create(
  items: readonly RoutineItem[],
  item: RoutineItem,
): CollectionMutation {
  const errors = validateRoutineItem(item);
  if (errors.length > 0) {
    throw new RoutineCommandError("invalid-item", "item is invalid", errors);
  }
  if (items.some((existing) => existing.uid === item.uid)) {
    throw new RoutineCommandError(
      "duplicate-uid",
      `uid already exists: ${item.uid}`,
    );
  }
  const stored = cloneItem(item);
  if (stored.revision === undefined) stored.revision = 0;
  return {
    items: [...items, stored],
    result: { item: stored, changed: true },
  };
}

export function update(
  items: readonly RoutineItem[],
  uid: string,
  patch: RoutineItemPatch,
  expectedRevision?: number,
): CollectionMutation {
  if ("uid" in patch) {
    throw new RoutineCommandError("invalid-patch", "uid is immutable");
  }
  const current = requireItem(items, uid);
  assertExpectedRevision(current, expectedRevision);
  const next = applyPatch(current, patch);
  const errors = validateRoutineItem(next);
  if (errors.length > 0) {
    throw new RoutineCommandError(
      "invalid-patch",
      "patch produced an invalid item",
      errors,
    );
  }
  if (sameItem(current, next)) {
    return { items, result: { item: current, changed: false } };
  }
  const bumped = bumpRevision(next);
  return {
    items: replaceItem(items, uid, bumped),
    result: { item: bumped, changed: true },
  };
}

/** Architecture command `delete(uid)`. `delete` is a reserved word. */
export function deleteItem(
  items: readonly RoutineItem[],
  uid: string,
  expectedRevision?: number,
): DeleteMutation {
  const item = requireItem(items, uid);
  assertExpectedRevision(item, expectedRevision);
  return {
    items: items.filter((candidate) => candidate.uid !== uid),
    item,
    changed: true,
  };
}

export const commands = {
  complete,
  markMissed,
  skip,
  reset,
  create,
  update,
  delete: deleteItem,
} as const;

function applyStatus(
  items: readonly RoutineItem[],
  uid: string,
  status: RoutineStatus,
  completedAt?: string,
  expectedRevision?: number,
): CollectionMutation {
  const current = requireItem(items, uid);
  assertExpectedRevision(current, expectedRevision);
  const result = transition(current, status, completedAt);
  if (!result.changed) return { items, result };
  const bumped = bumpRevision(result.item);
  return {
    items: replaceItem(items, uid, bumped),
    result: { item: bumped, changed: true },
  };
}

function assertExpectedRevision(item: RoutineItem, expected: number | undefined): void {
  if (expected === undefined) return;
  const actual = item.revision ?? 0;
  if (expected !== actual) {
    throw new RoutineCommandError(
      "conflict",
      `revision conflict for ${item.uid}`,
      [`expected ${expected}`, `actual ${actual}`],
    );
  }
}

function bumpRevision(item: RoutineItem): RoutineItem {
  return { ...item, revision: (item.revision ?? 0) + 1 };
}

function transition(
  item: RoutineItem,
  status: RoutineStatus,
  completedAt?: string,
): RoutineMutationResult {
  if (status === "completed") {
    if (!completedAt || !hasExplicitOffset(completedAt)) {
      throw new RoutineCommandError(
        "invalid-patch",
        "completedAt must be an ISO-8601 timestamp with a UTC or numeric offset",
      );
    }
    if (item.status === "completed" && item.completedAt === completedAt) {
      return { item, changed: false };
    }
    return {
      item: cloneItem({ ...itemWithoutCompletedAt(item), status, completedAt }),
      changed: true,
    };
  }

  if (completedAt !== undefined) {
    throw new RoutineCommandError(
      "invalid-patch",
      "only completed items may carry completedAt",
    );
  }

  if (item.status === status && item.completedAt === undefined) {
    return { item, changed: false };
  }

  return {
    item: cloneItem({ ...itemWithoutCompletedAt(item), status }),
    changed: true,
  };
}

function applyPatch(item: RoutineItem, patch: RoutineItemPatch): RoutineItem {
  const status = patch.status ?? item.status;
  let completedAt = pick(patch.completedAt, item.completedAt);
  if (status !== "completed" && patch.completedAt === undefined) {
    completedAt = undefined;
  }

  const next: RoutineItem = {
    uid: item.uid,
    title: patch.title ?? item.title,
    date: patch.date ?? item.date,
    dayPart: patch.dayPart ?? item.dayPart,
    status,
  };
  assign(next, "description", pick(patch.description, item.description));
  assign(next, "start", pick(patch.start, item.start));
  assign(next, "end", pick(patch.end, item.end));
  assign(next, "due", pick(patch.due, item.due));
  assign(next, "timezone", pick(patch.timezone, item.timezone));
  assign(next, "completedAt", completedAt);
  assign(next, "order", pick(patch.order, item.order));
  assign(next, "routineId", pick(patch.routineId, item.routineId));
  assign(next, "revision", pick(patch.revision, item.revision));
  assign(next, "tags", copyTags(pick(patch.tags, item.tags)));
  assign(next, "extensions", copyExtensions(pick(patch.extensions, item.extensions)));
  return next;
}

function pick<T>(patchValue: T | null | undefined, current: T | undefined): T | undefined {
  if (patchValue === null) return undefined;
  if (patchValue !== undefined) return patchValue;
  return current;
}

function assign<K extends keyof RoutineItem>(
  target: RoutineItem,
  key: K,
  value: RoutineItem[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function itemWithoutCompletedAt(item: RoutineItem): RoutineItem {
  const next = cloneItem(item);
  delete next.completedAt;
  return next;
}

function cloneItem(item: RoutineItem): RoutineItem {
  const next: RoutineItem = {
    uid: item.uid,
    title: item.title,
    date: item.date,
    dayPart: item.dayPart,
    status: item.status,
  };
  assign(next, "description", item.description);
  assign(next, "start", item.start);
  assign(next, "end", item.end);
  assign(next, "due", item.due);
  assign(next, "timezone", item.timezone);
  assign(next, "completedAt", item.completedAt);
  assign(next, "order", item.order);
  assign(next, "routineId", item.routineId);
  assign(next, "revision", item.revision);
  assign(next, "tags", copyTags(item.tags));
  assign(next, "extensions", copyExtensions(item.extensions));
  return next;
}

function copyTags(
  tags: readonly string[] | undefined,
): readonly string[] | undefined {
  return tags ? [...tags] : undefined;
}

function copyExtensions(
  extensions: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  return extensions ? { ...extensions } : undefined;
}

function replaceItem(
  items: readonly RoutineItem[],
  uid: string,
  next: RoutineItem,
): RoutineItem[] {
  return items.map((item) => (item.uid === uid ? next : item));
}

function requireItem(items: readonly RoutineItem[], uid: string): RoutineItem {
  const item = items.find((candidate) => candidate.uid === uid);
  if (!item) {
    throw new RoutineCommandError("not-found", `no routine item with uid ${uid}`);
  }
  return item;
}

function sameItem(left: RoutineItem, right: RoutineItem): boolean {
  return stable(left) === stable(right);
}

function stable(item: RoutineItem): string {
  const extensionKeys = item.extensions ? Object.keys(item.extensions).sort() : [];
  return JSON.stringify({
    uid: item.uid,
    title: item.title,
    description: item.description ?? null,
    date: item.date,
    start: item.start ?? null,
    end: item.end ?? null,
    due: item.due ?? null,
    timezone: item.timezone ?? null,
    dayPart: item.dayPart,
    status: item.status,
    completedAt: item.completedAt ?? null,
    order: item.order ?? null,
    routineId: item.routineId ?? null,
    revision: item.revision ?? null,
    tags: item.tags ? [...item.tags] : [],
    extensions: extensionKeys.map((key) => [key, item.extensions?.[key] ?? null]),
  });
}
