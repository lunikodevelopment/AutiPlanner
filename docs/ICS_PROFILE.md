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
- `X-AUTIPLANNER-DATE` on write; optional on read, where it may be derived from a scheduling field

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
- `X-AUTIPLANNER-ICON` — application icon key, not an arbitrary remote URL.

`X-AUTIPLANNER-ROUTINE-ID` is now used: it holds the series uid on an occurrence
override. `X-AUTIPLANNER-DATE` is described under *Local date*.

Do not add fields merely for visual styling when the same presentation can remain client-side.

## VEVENT

Use `VEVENT` for non-actionable appointments/events that should appear in the planner but do not have completion semantics. If the product later supports acknowledging an event, model that acknowledgment separately rather than mutating standard event semantics without documentation.

## Recurrence

Prefer standard recurrence (`RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`). Do not create a custom recurrence grammar.

Recurring task identity needs two levels:

- a stable series/template identity, the `UID` of a VTODO carrying `RRULE`;
- a unique occurrence identity, `<series-uid>:<date>`.

An occurrence override is a separate VTODO whose `UID` is the occurrence
identity, carrying `RECURRENCE-ID` and `X-AUTIPLANNER-ROUTINE-ID`:

```ics
BEGIN:VTODO
UID:meds-am-series@autiplanner.local:2026-08-12
DTSTAMP:20260811T060000Z
DTSTART:20260812T080000Z
RECURRENCE-ID;VALUE=DATE:20260812
SUMMARY:Take medication
STATUS:NEEDS-ACTION
X-AUTIPLANNER-DATE:2026-08-12
X-AUTIPLANNER-DAYPART:MORNING
X-AUTIPLANNER-OUTCOME:MISSED
X-AUTIPLANNER-ROUTINE-ID:meds-am-series@autiplanner.local
END:VTODO
```

A series master is always written as `STATUS:NEEDS-ACTION` with
`X-AUTIPLANNER-OUTCOME:PENDING`. It is never completed.

Do not implement recurring completion by marking the series master completed. Completion belongs to an occurrence.

### Supported RRULE subset

```ics
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
RRULE:FREQ=DAILY;INTERVAL=2
RRULE:FREQ=MONTHLY;COUNT=6
```

| Part | Support |
|---|---|
| `FREQ` | `DAILY`, `WEEKLY`, `MONTHLY` |
| `INTERVAL` | positive integer |
| `COUNT` | positive integer, mutually exclusive with `UNTIL` |
| `UNTIL` | `YYYYMMDD` or `YYYYMMDDTHHMMSSZ`; read as a calendar day, not converted |
| `BYDAY` | `MO`…`SU`, weekly only |

`BYDAY` on `MONTHLY`, positional `BYDAY` such as `2MO`, `BYSETPOS`, `BYYEARDAY`,
and `BYMONTH` are outside the subset. A component using them is reported as
`unsupported-recurrence` and its raw form is preserved rather than guessed at.

`EXDATE` and `RDATE` belong on the series master. They are `VALUE=DATE` lists.
An `EXDATE` does not delete a stored occurrence override; an override for an
excluded date still wins, because the household explicitly wrote it down.

### Expansion window

Occurrences expand per requested window. The window is capped at 366 days and a
wider request returns an error rather than a truncated list. An open-ended daily
series therefore never materializes an unbounded calendar.

## Text escaping and folding

Any serializer must implement iCalendar text escaping and line folding correctly before it is considered production-ready. The initial TypeScript package is a contract scaffold, not permission to ignore RFC-compatible escaping.

## Local date

```ics
X-AUTIPLANNER-DATE:2026-08-11
```

The local calendar day is explicit. Writers always emit `X-AUTIPLANNER-DATE` as `YYYY-MM-DD`. Readers prefer it.

If the property is absent, readers may derive a date from `DTSTART`, then `DUE`, then `DTEND`. That fallback is for external files. It is not permission to infer day part from the clock, and it must not replace an explicit date when the UTC instant falls on a different calendar day.

`YYYYMMDD` is accepted on read. Writers use `YYYY-MM-DD`.

## Import behavior

`parseCalendar` does not throw on malformed input. It returns routine items, issues, and raw components that were not imported.

- Day part is never inferred from the clock. A missing or unknown day part rejects the VTODO.
- `X-AUTIPLANNER-OUTCOME` wins over `STATUS`. A missed or skipped item is never rewritten as completed because `STATUS` or `COMPLETED` disagrees.
- A missing outcome may be inferred only as `pending` (`NEEDS-ACTION` or absent status) or `completed` (`STATUS:COMPLETED` plus a UTC `COMPLETED` timestamp). Other status values, including `CANCELLED`, are not mapped onto skipped or missed.
- `COMPLETED` is accepted only as a UTC date-time. A timezone name is not guessed in order to convert it.
- Floating local time, UTC, a single `TZID`, and all-day `VALUE=DATE` are distinct. Mixed floating and zoned values are rejected.
- `RRULE`, `RDATE`, `EXDATE`, and `RECURRENCE-ID` are not imported as completable items. The raw component is preserved.
- Nested components such as `VALARM` are reported and omitted from a modeled rewrite.
- Unknown `X-AUTIPLANNER-*` properties are kept on the item. `VEVENT` and other unmodeled components are preserved for a later rewrite.
- Rejected VTODO components are retained in `preserved` so a rewrite through `serializeCalendar` does not silently delete them.

## Serialization

Writers emit CRLF, fold at 75 octets, and escape TEXT. Numeric offsets are converted to UTC because iCalendar date-times are UTC or `TZID`, not numeric offsets. That conversion uses the offset already present; it does not choose a timezone name. A timezone name is only valid together with a floating local timestamp; it is not inferred for a UTC value.

Missed and skipped items are written as `STATUS:NEEDS-ACTION` plus `X-AUTIPLANNER-OUTCOME`. They do not receive `STATUS:COMPLETED` or `COMPLETED`.

## Unknown properties

Importers should preserve unknown `X-AUTIPLANNER-*` properties where practical so newer producers do not lose metadata when an older client performs a round trip.

## Example

See `examples/autiplanner.ics`.
