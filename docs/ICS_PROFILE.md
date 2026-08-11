# AutiPlanner iCalendar profile

AutiPlanner stores interoperable RFC 5545-style iCalendar data and adds application metadata through `X-AUTIPLANNER-*` extension properties.

This profile is intentionally small. Extend it only when a domain requirement cannot be represented by existing iCalendar properties.

## Calendar envelope

Recommended envelope:

```ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//AutiPlanner//Routine Calendar//EN
CALSCALE:GREGORIAN
...
END:VCALENDAR
```

## Actionable routine item

Use `VTODO`.

Required by the AutiPlanner profile:

- `UID`
- `DTSTAMP`
- `SUMMARY`
- `X-AUTIPLANNER-DAYPART`
- `X-AUTIPLANNER-OUTCOME`

At least one scheduling field should normally be present (`DTSTART`, `DUE`, or a date represented by the application model), but importers should tolerate incomplete external tasks.

## Day part

```ics
X-AUTIPLANNER-DAYPART:MORNING
```

Allowed values:

- `MORNING`
- `AFTERNOON`
- `EVENING`
- `NIGHT`

Day part is semantic metadata and must not be recomputed from the item's clock time during round trips.

## Outcome

```ics
X-AUTIPLANNER-OUTCOME:PENDING
```

Allowed values:

- `PENDING`
- `COMPLETED`
- `MISSED`
- `SKIPPED`

Mapping to standard VTODO fields:

### Pending

```ics
STATUS:NEEDS-ACTION
X-AUTIPLANNER-OUTCOME:PENDING
```

### Completed

```ics
STATUS:COMPLETED
COMPLETED:20260811T084500Z
X-AUTIPLANNER-OUTCOME:COMPLETED
```

### Missed

```ics
STATUS:NEEDS-ACTION
X-AUTIPLANNER-OUTCOME:MISSED
```

### Skipped

```ics
STATUS:NEEDS-ACTION
X-AUTIPLANNER-OUTCOME:SKIPPED
```

`MISSED` and `SKIPPED` are intentionally not encoded as `COMPLETED`.

## Optional extension fields

Reserved names for future use:

- `X-AUTIPLANNER-ORDER` — integer display order within a day part;
- `X-AUTIPLANNER-ROUTINE-ID` — stable series/template identifier distinct from an occurrence UID;
- `X-AUTIPLANNER-REVISION` — monotonic integer for optimistic concurrency;
- `X-AUTIPLANNER-ICON` — application icon-font token, not an arbitrary remote URL;
- `X-AUTIPLANNER-PRIORITY` — `MUST_DO`, `PREFERABLY`, or `OPTIONAL`, rendered green/yellow/red by clients.

Do not add fields merely for visual styling when the same presentation can remain client-side.

## VEVENT

Use `VEVENT` for non-actionable appointments/events that should appear in the planner but do not have completion semantics. If the product later supports acknowledging an event, model that acknowledgment separately rather than mutating standard event semantics without documentation.

## Recurrence

Prefer standard recurrence (`RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`). Do not create a custom recurrence grammar.

Recurring task identity needs two levels:

- a stable series/template identity;
- a unique occurrence identity or deterministic occurrence key.

Do not implement recurring completion by marking the series master completed. Completion belongs to an occurrence.

Phase 5 support is bounded and explicit: `@autiplanner/core` exposes `routineTemplateToMaster`, `occurrenceUid`, and `expandRoutineItem`. Expansion requires a `from`/`to` date window and has a default 1,000-occurrence safety cap. The current generator supports standard `DAILY`, `WEEKLY`, and `MONTHLY` rules plus `COUNT`, `UNTIL`, `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `RDATE`, and `EXDATE`; unsupported frequencies fail loudly instead of silently approximating them. Occurrence overrides carry their own outcome and completion timestamp.

## Text escaping and folding

Any serializer must implement iCalendar text escaping and line folding correctly before it is considered production-ready. The initial TypeScript package is a contract scaffold, not permission to ignore RFC-compatible escaping.

The `@autiplanner/ics` package provides these Phase 1 entry points:

- `parseCalendar(input)` returns valid routine items plus structured warnings;
- `parseCalendar(input, { strict: true })` throws `IcsParseError` on the first malformed record;
- `defaultDayPart` is an explicit fallback for importing records that do not carry AutiPlanner day-part metadata;
- `serializeCalendar(items, { dtstamp })` writes a complete `VCALENDAR` with folded UTF-8 lines and a deterministic timestamp when requested.

By default, malformed or incomplete VTODO records are skipped with warnings rather than being silently guessed into a day part or outcome. A record must have a UID, summary, usable scheduling date, and day part (unless an explicit parser fallback is supplied). A completed record must also have a valid `COMPLETED` timestamp. When standard `STATUS` conflicts with `X-AUTIPLANNER-OUTCOME`, the explicit AutiPlanner outcome wins and a warning is emitted.

## Unknown properties

Importers should preserve unknown `X-AUTIPLANNER-*` properties where practical so newer producers do not lose metadata when an older client performs a round trip.

## Example

See `examples/autiplanner.ics`.
