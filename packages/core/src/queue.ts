import type { RoutineItemPatch } from "./commands.js";
import type { RoutineItem } from "./model.js";

export type RoutineCommandName =
  | "complete"
  | "markMissed"
  | "skip"
  | "reset"
  | "create"
  | "update"
  | "delete";

export interface QueuedCommand {
  id: string;
  name: RoutineCommandName;
  uid?: string;
  completedAt?: string;
  expectedRevision?: number;
  item?: RoutineItem;
  patch?: RoutineItemPatch;
}

export interface CommandAck {
  ok: boolean;
  code?: "conflict" | "not-found" | "invalid" | "unavailable" | "series-completion";
  item?: RoutineItem;
  actualRevision?: number;
}

export interface FlushResult {
  applied: readonly QueuedCommand[];
  remaining: readonly QueuedCommand[];
  conflict?: {
    command: QueuedCommand;
    ack: CommandAck;
  };
}

/**
 * Replays commands in order. A conflict stops the queue. Outcomes are not
 * merged: the server item remains authoritative until the user explicitly
 * retries with the server revision or drops the command.
 */
export async function flushQueue(
  queue: readonly QueuedCommand[],
  send: (command: QueuedCommand) => Promise<CommandAck>,
): Promise<FlushResult> {
  const applied: QueuedCommand[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const command = queue[index];
    if (!command) continue;
    const ack = await send(command);
    if (!ack.ok && ack.code === "conflict") {
      return {
        applied,
        remaining: queue.slice(index),
        conflict: { command, ack },
      };
    }
    if (!ack.ok) {
      return {
        applied,
        remaining: queue.slice(index),
        conflict: { command, ack },
      };
    }
    applied.push(command);
  }
  return { applied, remaining: [] };
}

export function retryWithServerRevision(
  command: QueuedCommand,
  actualRevision: number,
): QueuedCommand {
  return { ...command, expectedRevision: actualRevision };
}

export function resolveConflict(
  choice: "keep-server" | "retry",
  command: QueuedCommand,
  serverItem: RoutineItem,
): { command?: QueuedCommand; item: RoutineItem } {
  if (choice === "keep-server") return { item: serverItem };
  return {
    item: serverItem,
    command: retryWithServerRevision(command, serverItem.revision ?? 0),
  };
}
