# Architecture

This document is the source of truth for AutiPlanner's initial system boundaries.

## 1. Problem model

AutiPlanner presents a date-oriented routine as named day parts containing actionable items. Each item has a four-state outcome:

- `pending`: no outcome has been recorded yet;
- `completed`: the user reports the item was done;
- `missed`: the user reports the item was not done;
- `skipped`: the item was intentionally skipped and should not be treated as a failure to record state.

These states are domain data, not merely UI decoration.

## 2. Components

### `packages/core`

Owns provider-neutral types and validation helpers. It knows nothing about iCalendar, Home Assistant, Navet, Android, React, HTTP, or storage.

### `packages/ics`

Owns the mapping between `RoutineItem` and the AutiPlanner iCalendar profile. It is the only TypeScript package that should understand `X-AUTIPLANNER-*` fields.

### Home Assistant integration

The intended persistence owner and synchronization boundary. It will:

1. load an ICS source;
2. expose calendar/to-do-compatible state to Home Assistant;
3. expose AutiPlanner-specific metadata/commands where standard entities are insufficient;
4. serialize mutations;
5. persist updates atomically;
6. notify clients through normal Home Assistant state/event mechanisms.

### Android app

A native client. It should authenticate to Home Assistant and consume AutiPlanner state through that boundary. Offline-first behavior can be added later, but conflict semantics must be designed before direct offline mutations are enabled.

### Navet integration

A dashboard presentation/provider mapping. It should consume normalized AutiPlanner routine data and render date/day-part groups. Shared Navet UI should not become coupled to raw Home Assistant payloads.

## 3. Single-writer rule

Once the Home Assistant integration is implemented, the integration is the authority that writes the live ICS store.

```text
Android ─┐
         ├─> Home Assistant commands ─> AutiPlanner integration ─> atomic ICS write
Navet ───┘
```

Direct concurrent writes from Android + Navet + Home Assistant are explicitly out of scope because they create avoidable merge and corruption problems.

## 4. Identity

`uid` is stable calendar identity. A title is mutable and must never be used as identity.

The JSON/domain `id` may equal the calendar UID initially. If a provider-scoped identifier is added later, the mapping must remain deterministic and documented.

## 5. Time model

A routine item always has a local calendar `date`. It may additionally have start/end/due timestamps and a timezone.

Day part is explicit metadata; it is not inferred from the hour. This allows a household to define, for example, an 11:30 item as `afternoon` if that matches the person's routine.

## 6. State mapping

AutiPlanner has richer state than a generic completed/not-completed task API.

| AutiPlanner | Standard VTODO status | Extra property |
|---|---|---|
| pending | `NEEDS-ACTION` | `X-AUTIPLANNER-OUTCOME:PENDING` |
| completed | `COMPLETED` | `X-AUTIPLANNER-OUTCOME:COMPLETED` |
| missed | `NEEDS-ACTION` | `X-AUTIPLANNER-OUTCOME:MISSED` |
| skipped | `NEEDS-ACTION` | `X-AUTIPLANNER-OUTCOME:SKIPPED` |

The standard status preserves interoperability. The extension preserves AutiPlanner meaning.

## 7. Mutation model

Initial command vocabulary:

- `complete(uid, completedAt)`
- `markMissed(uid)`
- `skip(uid)`
- `reset(uid)`
- `create(item)`
- `update(uid, patch)`
- `delete(uid)`

Commands should be idempotent where practical. State-changing APIs should return the resulting item, not merely `true`.

## 8. Concurrency

The Home Assistant persistence layer should eventually use an in-process mutation lock plus atomic replacement of the ICS file. A future revision field can provide optimistic concurrency for offline Android edits.

Do not add multi-writer filesystem synchronization as a shortcut.

## 9. Security/privacy

Calendar and routine data can reveal health, medication, appointments, and daily behavior. Treat it as sensitive household data.

- Do not log full event descriptions by default.
- Never commit access tokens or real exported calendars.
- Prefer Home Assistant authentication rather than a second AutiPlanner password system.
- Keep local/self-hosted operation possible.

## 10. Decision log

### ADR-001 — Standard iCalendar plus extensions

Accepted. Use `.ics`, `VTODO`/`VEVENT`, and `X-AUTIPLANNER-*` properties rather than inventing a new calendar grammar.

### ADR-002 — Explicit day part

Accepted. Store day part, do not infer it from time.

### ADR-003 — Four-state outcome

Accepted. Pending/completed/missed/skipped are distinct domain values.

### ADR-004 — Home Assistant as synchronization boundary

Accepted for the initial architecture. Revisit only if a future offline-first requirement proves it insufficient.
