import type { DayPart, RoutineStatus } from "@autiplanner/core";

export const AUTIPLANNER_PRODID = "-//AutiPlanner//Routine Calendar//EN";

export const ICS_DAY_PART_PROPERTY = "X-AUTIPLANNER-DAYPART";
export const ICS_OUTCOME_PROPERTY = "X-AUTIPLANNER-OUTCOME";
export const ICS_ORDER_PROPERTY = "X-AUTIPLANNER-ORDER";
export const ICS_ROUTINE_ID_PROPERTY = "X-AUTIPLANNER-ROUTINE-ID";
export const ICS_REVISION_PROPERTY = "X-AUTIPLANNER-REVISION";
export const ICS_DATE_PROPERTY = "X-AUTIPLANNER-DATE";
export const ICS_ICON_PROPERTY = "X-AUTIPLANNER-ICON";

export const MAPPED_EXTENSION_PROPERTIES: readonly string[] = [
  ICS_DAY_PART_PROPERTY,
  ICS_OUTCOME_PROPERTY,
  ICS_ORDER_PROPERTY,
  ICS_ROUTINE_ID_PROPERTY,
  ICS_REVISION_PROPERTY,
  ICS_DATE_PROPERTY,
];

export const DAY_PART_TO_ICS: Readonly<Record<DayPart, string>> = {
  morning: "MORNING",
  afternoon: "AFTERNOON",
  evening: "EVENING",
  night: "NIGHT",
};

export const ICS_TO_DAY_PART: Readonly<Record<string, DayPart>> = {
  MORNING: "morning",
  AFTERNOON: "afternoon",
  EVENING: "evening",
  NIGHT: "night",
};

export const STATUS_TO_ICS_OUTCOME: Readonly<Record<RoutineStatus, string>> = {
  pending: "PENDING",
  completed: "COMPLETED",
  missed: "MISSED",
  skipped: "SKIPPED",
};

export const ICS_OUTCOME_TO_STATUS: Readonly<Record<string, RoutineStatus>> = {
  PENDING: "pending",
  COMPLETED: "completed",
  MISSED: "missed",
  SKIPPED: "skipped",
};

export const STATUS_TO_VTODO_STATUS: Readonly<Record<RoutineStatus, string>> = {
  pending: "NEEDS-ACTION",
  completed: "COMPLETED",
  missed: "NEEDS-ACTION",
  skipped: "NEEDS-ACTION",
};
