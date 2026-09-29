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
- `addSeries(template)`

Commands are idempotent where practical. State-changing APIs return the
resulting item, not merely `true`, so a client can confirm the outcome that was
actually stored instead of assuming success.

### `update` patches and clearing

A patch field replaces the value. `null` clears an optional field. Omitted
fields are unchanged. `uid` cannot be patched.

### Optimistic concurrency

Every mutation accepts an optional `expectedRevision` (`expected_revision` in
Home Assistant). When it does not match the stored `revision`, the command fails
with a conflict and writes nothing. The stored item is authoritative; the client
asks the user whether to retry. There are no automatic merge rules.

## 7.1 Recurrence

Recurring routines use standard `RRULE` on a series master, not cloned future
records. The supported subset is `FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL`,
`COUNT`, `UNTIL`, and `BYDAY` for weekly.

An occurrence is identified as `<series-uid>:<date>` and carries `RECURRENCE-ID`
and `X-AUTIPLANNER-ROUTINE-ID`. Completing one occurrence materializes only that
occurrence. The series master is never completed.

Expansion happens per requested window and is capped at 366 days. A wider
request is an error, not a silent truncation.

## 8. Concurrency

The Home Assistant store serializes mutations behind a single in-process lock and
replaces the ICS file atomically, so a crash cannot leave a truncated calendar.
`X-AUTIPLANNER-REVISION` provides optimistic concurrency: a command that
supplies a stale revision is rejected without writing.

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

### ADR-005 — Persist the local calendar date

Accepted. The local day is `X-AUTIPLANNER-DATE`. Writers always emit it. Readers prefer it and derive a date from `DTSTART`, `DUE`, or `DTEND` only when it is absent. Derivation is a fallback for external files, not permission to infer day part from the clock.

### ADR-006 — Agenda sensors, not a to-do entity

Accepted. Home Assistant's `TodoItem` only models `NEEDS_ACTION` or `COMPLETED`,
which cannot represent a missed or skipped routine item. AutiPlanner therefore
exposes the four-state agenda through sensors and a read-only calendar entity,
and keeps mutations in its own services. Forcing a to-do entity would require
storing missed or skipped as completed or as an error.

### ADR-007 — Bounded recurrence expansion

Accepted. Series expand per requested window, capped at 366 days. A wider request
returns an error. Cloning an unbounded future calendar is not an option.

### ADR-008 — No automatic conflict merge

Accepted. A revision conflict is surfaced to the user with the stored item. There
are no deterministic merge rules, because an automatic merge of four-state
outcomes would have to guess which outcome the household intended.
