import assert from "node:assert/strict";
import test from "node:test";
import { describeDay, groupDays, outcomeControls, outcomeSummary } from "./agenda.js";
import type { RoutineView } from "./types.js";
import { HomeAssistantRoutineProvider, type HomeAssistantTransport } from "../homeassistant/index.js";

function view(overrides: Partial<RoutineView> = {}): RoutineView {
  return {
    id: "item@autiplanner.local",
    title: "Take medication",
    date: "2026-08-11",
    dayPart: "morning",
    status: "pending",
    ...overrides,
  };
}

class FakeTransport implements HomeAssistantTransport {
  readonly sent: Record<string, unknown>[] = [];
  private listeners = new Map<string, ((frame: Record<string, unknown>) => void)[]>();
  response: Record<string, unknown> = { success: true, item: undefined };

  async send(frame: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.sent.push(frame);
    return this.response;
  }

  subscribe(type: string, listener: (frame: Record<string, unknown>) => void): () => void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
    return () => {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
    };
  }

  emit(type: string, frame: Record<string, unknown>): void {
    for (const listener of this.listeners.get(type) ?? []) listener(frame);
  }
}

test("groups by day part without inferring it from the clock", () => {
  const days = groupDays([
    view({ id: "a", title: "Wind down", dayPart: "night", start: "2026-08-11T11:30:00Z" }),
    view({ id: "b", title: "Breakfast", order: 20 }),
    view({ id: "c", title: "Medication", order: 10 }),
  ]);
  assert.equal(days[0]?.heading, "TUESDAY — 2026-08-11");
  assert.deepEqual(days[0]?.sections.map((section) => section.heading), ["MORNING", "NIGHT"]);
  assert.deepEqual(days[0]?.sections[0]?.items.map((entry) => entry.id), ["c", "b"]);
  assert.equal(days[0]?.sections[1]?.items[0]?.dayPart, "night");
});

test("every outcome control has a label and a large touch target", () => {
  for (const status of ["pending", "completed", "missed", "skipped"] as const) {
    const controls = outcomeControls(status);
    assert.equal(controls.length, 4);
    for (const control of controls) {
      assert.ok(control.accessibleLabel.length > 0);
      assert.ok(control.symbol.length > 0);
      assert.ok(control.minTouchTargetPx >= 48);
    }
    // Only "complete" is a single-tap action, and only from another state.
    const complete = controls.find((control) => control.status === "completed");
    assert.equal(complete?.nextStatus, status === "completed" ? "pending" : "completed");
    // Missed and skipped are never a single-tap action from another state.
    for (const destructive of ["missed", "skipped"] as const) {
      const control = controls.find((entry) => entry.status === destructive);
      assert.equal(
        control?.nextStatus,
        status === destructive ? "pending" : undefined,
      );
    }
  }
  // Tapping the current state resets it, so a mis-tap is reversible.
  const missed = outcomeControls("missed").find((control) => control.status === "missed");
  assert.equal(missed?.nextStatus, "pending");
  // Pending has nothing to undo to.
  const pending = outcomeControls("pending").find((control) => control.status === "pending");
  assert.equal(pending?.nextStatus, undefined);
  // Missed and skipped are flagged so the UI can require confirmation.
  assert.equal(
    outcomeControls("pending").find((control) => control.status === "missed")?.destructive,
    true,
  );
  assert.equal(
    outcomeControls("pending").find((control) => control.status === "completed")?.destructive,
    false,
  );
});

test("summary keeps the four states separate", () => {
  const summary = outcomeSummary([
    view(),
    view({ id: "b", status: "completed" }),
    view({ id: "c", status: "missed" }),
    view({ id: "d", status: "skipped" }),
  ]);
  assert.deepEqual(summary, { pending: 1, completed: 1, missed: 1, skipped: 1 });
});

test("accessible description names the outcome and the clock", () => {
  const days = groupDays([view({ status: "missed", start: "2026-08-11T13:30:00Z" })]);
  assert.match(describeDay(days[0]!), /Missed: Take medication, 13:30 UTC/);
});

test("provider rejects a payload without day part or outcome", async () => {
  const transport = new FakeTransport();
  transport.response = {
    success: true,
    items: [
      { uid: "ok@x", title: "Walk", date: "2026-08-11", dayPart: "evening", status: "missed" },
      { uid: "no-day@x", title: "Walk", date: "2026-08-11", status: "missed" },
      { uid: "no-status@x", title: "Walk", date: "2026-08-11", dayPart: "morning" },
    ],
  };
  const provider = new HomeAssistantRoutineProvider({
    transport,
    entityId: "sensor.routine_agenda",
  });
  const items = await provider.listDays("2026-08-11", 14);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.status, "missed");
  assert.equal(items[0]?.dayPart, "evening");
});

test("command returns the confirmed item rather than a boolean", async () => {
  const transport = new FakeTransport();
  transport.response = {
    success: true,
    item: {
      uid: "ok@x",
      title: "Walk",
      date: "2026-08-11",
      dayPart: "evening",
      status: "completed",
      completedAt: "2026-08-11T20:05:00Z",
      revision: 3,
    },
  };
  const provider = new HomeAssistantRoutineProvider({ transport, entityId: "calendar.routine" });
  const result = await provider.complete("ok@x", 2);
  assert.equal(result.ok, true);
  assert.equal(result.item?.status, "completed");
  assert.equal(result.item?.revision, 3);
  assert.equal(transport.sent[0]?.expected_revision, 2);
  assert.equal(transport.sent[0]?.command, "complete");
});

test("a conflict is surfaced so the UI can roll back", async () => {
  const transport = new FakeTransport();
  transport.response = { success: false, error: { code: "autiplanner_conflict", message: "stale" } };
  const provider = new HomeAssistantRoutineProvider({ transport, entityId: "calendar.routine" });
  const result = await provider.markMissed("ok@x", 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflict");
});

test("subscription listens for a change from another client", async () => {
  const transport = new FakeTransport();
  transport.response = { success: true, items: [] };
  const provider = new HomeAssistantRoutineProvider({ transport, entityId: "sensor.agenda" });
  let calls = 0;
  const stop = provider.subscribe(() => {
    calls += 1;
  });
  transport.emit("autiplanner/agenda/subscribed", { items: [] });
  assert.equal(calls, 1);
  stop();
  transport.emit("autiplanner/agenda/subscribed", { items: [] });
  assert.equal(calls, 1);
  assert.equal(transport.sent[0]?.type, "autiplanner/agenda/subscribe");
});
