import type { RoutineItem } from "@autiplanner/core";

export const routinePlannerStoryItems: readonly RoutineItem[] = [
  {
    uid: "medication-20260811",
    title: "Take medication",
    description: "With water after breakfast.",
    date: "2026-08-11",
    start: "2026-08-11T08:00:00+02:00",
    dayPart: "morning",
    status: "completed",
    completedAt: "2026-08-11T08:05:00+02:00",
    order: 10,
  },
  {
    uid: "breakfast-20260811",
    title: "Eat breakfast",
    date: "2026-08-11",
    start: "2026-08-11T08:30:00+02:00",
    dayPart: "morning",
    status: "pending",
    order: 20,
  },
  {
    uid: "exercise-20260811",
    title: "Exercise",
    date: "2026-08-11",
    start: "2026-08-11T13:30:00+02:00",
    dayPart: "afternoon",
    status: "missed",
    order: 10,
  },
  {
    uid: "journal-20260811",
    title: "Optional journaling",
    date: "2026-08-11",
    start: "2026-08-11T20:00:00+02:00",
    dayPart: "evening",
    status: "skipped",
    order: 10,
  },
];

export const routinePlannerStoryStates = {
  allStates: routinePlannerStoryItems,
  empty: [],
  error: "Unable to reach Home Assistant",
} as const;
