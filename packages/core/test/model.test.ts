import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRoutineItem } from "../src/index.ts";

test("validateRoutineItem enforces the four-state completion invariant", () => {
  const base = {
    uid: "breakfast-20260811",
    title: "Eat breakfast",
    date: "2026-08-11",
    dayPart: "morning" as const,
    status: "pending" as const,
  };

  assert.deepEqual(validateRoutineItem(base), []);
  assert.deepEqual(
    validateRoutineItem({ ...base, status: "completed" }),
    ["completed items require completedAt"],
  );
  assert.deepEqual(
    validateRoutineItem({ ...base, completedAt: "2026-08-11T08:45:00Z" }),
    ["only completed items may carry completedAt"],
  );
});
