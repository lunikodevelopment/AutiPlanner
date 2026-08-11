import type { DayPart, RoutineStatus } from "@autiplanner/core";

export const AUTIPLANNER_PRODID = "-//AutiPlanner//Routine Calendar//EN";

export const ICS_DAY_PART_PROPERTY = "X-AUTIPLANNER-DAYPART";
export const ICS_OUTCOME_PROPERTY = "X-AUTIPLANNER-OUTCOME";
export const ICS_ORDER_PROPERTY = "X-AUTIPLANNER-ORDER";
export const ICS_ROUTINE_ID_PROPERTY = "X-AUTIPLANNER-ROUTINE-ID";
export const ICS_REVISION_PROPERTY = "X-AUTIPLANNER-REVISION";

export const DAY_PART_TO_ICS: Readonly<Record<DayPart, string>> = {
  morning: "MORNING",
  afternoon: "AFTERNOON",
  evening: "EVENING",
  night: "NIGHT",
};

export const STATUS_TO_ICS_OUTCOME: Readonly<Record<RoutineStatus, string>> = {
  pending: "PENDING",
  completed: "COMPLETED",
  missed: "MISSED",
  skipped: "SKIPPED",
};

export const STATUS_TO_VTODO_STATUS: Readonly<Record<RoutineStatus, string>> = {
  pending: "NEEDS-ACTION",
  completed: "COMPLETED",
  missed: "NEEDS-ACTION",
  skipped: "NEEDS-ACTION",
};
