import type { RoutineItem, RoutineStatus } from "@autiplanner/core";

export type RoutineCommand =
  | { type: "complete"; uid: string; completedAt?: string }
  | { type: "mark_missed"; uid: string }
  | { type: "skip"; uid: string }
  | { type: "reset"; uid: string };

export interface RoutineCapability {
  getItems(): Promise<readonly RoutineItem[]>;
  subscribe(listener: (items: readonly RoutineItem[]) => void): () => void;
  execute(command: RoutineCommand): Promise<void>;
}

export const ROUTINE_COMMAND_TARGETS: Readonly<Record<RoutineCommand["type"], RoutineStatus>> = {
  complete: "completed",
  mark_missed: "missed",
  skip: "skipped",
  reset: "pending",
};

export function commandTargetStatus(command: RoutineCommand): RoutineStatus {
  return ROUTINE_COMMAND_TARGETS[command.type];
}
