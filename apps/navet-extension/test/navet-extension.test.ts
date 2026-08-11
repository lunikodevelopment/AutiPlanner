import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHomeAssistantRoutineCapability, normalizeHomeAssistantRoutineItems } from "../src/home-assistant-provider.js";
import { RoutinePlannerWidget } from "../src/routine-planner.js";
import { routinePlannerStoryItems } from "../src/story-fixtures.js";

test("the Home Assistant adapter normalizes rich attributes and ignores malformed records", async () => {
  const state = {
    attributes: {
      autiplanner_items: [
        {
          uid: "breakfast",
          title: "Eat breakfast",
          date: "2026-08-11",
          day_part: "morning",
          outcome: "pending",
          start: "2026-08-11T08:30:00+02:00",
          tags: ["care", 3],
          revision: 4,
        },
        { uid: "bad", title: "Missing day part", date: "2026-08-11", day_part: "noon", outcome: "pending" },
      ],
    },
  };
  assert.deepEqual(normalizeHomeAssistantRoutineItems(state), [
    {
      uid: "breakfast",
      title: "Eat breakfast",
      date: "2026-08-11",
      dayPart: "morning",
      status: "pending",
      start: "2026-08-11T08:30:00+02:00",
      revision: 4,
      tags: ["care"],
    },
  ]);

  const calls: unknown[][] = [];
  const capability = createHomeAssistantRoutineCapability({
    entityId: "todo.autiplanner",
    getTodoState: async () => state,
    subscribeTodoState: () => () => undefined,
    callService: async (...args) => {
      calls.push(args);
    },
  });
  assert.equal((await capability.getItems())[0]?.title, "Eat breakfast");
  await capability.execute({ type: "complete", uid: "breakfast", completedAt: "2026-08-11T08:35:00+02:00" });
  assert.deepEqual(calls, [["autiplanner", "complete", { uid: "breakfast", completed_at: "2026-08-11T08:35:00+02:00" }, { entity_id: "todo.autiplanner" }]]);
});

test("the routine widget exposes all four states and accessible detail actions", () => {
  const markup = renderToStaticMarkup(
    createElement(RoutinePlannerWidget, {
      date: "2026-08-11",
      items: routinePlannerStoryItems,
      onCommand: async () => undefined,
      theme: "light",
    }),
  );
  assert.match(markup, /✓/);
  assert.match(markup, /✕/);
  assert.match(markup, /○/);
  assert.match(markup, /—/);
  assert.match(markup, /Open details for Take medication/);
  assert.match(markup, /Complete/);
  assert.match(markup, /Morning/);
  assert.match(markup, /Afternoon/);
});
