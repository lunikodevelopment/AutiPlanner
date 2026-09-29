# Home Assistant integration

Home Assistant is the single writer for the AutiPlanner calendar. Clients send
commands; they never edit the `.ics` file directly.

There is no separate backend. This integration is the backend.

Setup instructions: [`../SETUP.md`](../SETUP.md).

## Layout

The integration lives at the repository root so HACS can install it. HACS
requires `custom_components/<domain>` there.

```text
custom_components/autiplanner/
  __init__.py        setup, services, Home Assistant wiring
  manifest.json
  const.py
  paths.py           calendar file location and path rules
  model.py           provider-free domain types
  commands.py        the one command entry point (no Home Assistant imports)
  api.py             request/response shaping for the HTTP API
  pairing.py         one-time pairing codes (no Home Assistant imports)
  http.py            aiohttp views for app clients
  pair_http.py       pairing endpoint and token minting
  ics.py             iCalendar profile parse/serialize
  recurrence.py      bounded series expansion
  store.py           single-writer store, lock, atomic write
  calendar.py        read-only calendar entity
  sensor.py          agenda + issue sensors
  websocket_api.py   agenda subscribe and command API
  config_flow.py
  services.yaml
tests/               at the repository root
```

`commands.py`, `api.py`, `paths.py`, `pairing.py`, `model.py`, `ics.py`,
`recurrence.py`, and `store.py` import no Home Assistant code, so they are tested
without Home Assistant installed. That boundary is deliberate: it keeps the
domain rules verifiable on their own.

## Client surfaces

Clients use one of these against the same store:

| Surface | Use |
|---|---|
| `autiplanner.complete` etc. (actions) | Home Assistant automations and scripts |
| `POST /api/autiplanner/agenda` | read a window |
| `POST /api/autiplanner/command` | apply one command |
| `POST /api/autiplanner/pair` | exchange a pairing code for a token |
| `autiplanner/agenda/subscribe` (websocket) | live updates |

The agenda and command routes authenticate with the Home Assistant bearer token
and call the same `apply_command`, so a client cannot bypass the mutation lock.
The pairing route is unauthenticated by necessity, because the app has no token
yet; the one-time code is the credential.

A command result contains the confirming item. A conflict is `409` with
`error.code = "autiplanner_conflict"` and the store is left unchanged.

## Pairing

The app cannot create its own Home Assistant token, and copying a long-lived
token by hand is friction AutiPlanner exists to avoid.

1. An authenticated user runs `autiplanner.pair`. The service returns a code.
2. The app posts the code to `/api/autiplanner/pair`.
3. The integration mints a long-lived token for the same user and returns it,
   along with the agenda sensor id and the base URL.

Properties that make this safe enough to expose unauthenticated:

- the code is 128 bits from `secrets.token_urlsafe`;
- it lives only in memory, so a restart invalidates it;
- it expires after ten minutes and is consumed on first use;
- at most five are outstanding per config entry;
- codes and tokens are never logged;
- the issued token appears in the user's profile and can be revoked there.

Token minting uses Home Assistant's auth manager and is wrapped so that an API
difference on some release reports "pairing unavailable" instead of breaking
integration setup. Manual token entry stays available as the fallback.

## Responsibilities

- read, write, and own the configured `.ics` file;
- expose standard `calendar` entities plus normalized agenda sensors;
- preserve AutiPlanner day part and the four-state outcome;
- expose `complete`, `mark_missed`, `skip`, and `reset`, plus CRUD,
  `add_series`, and `pair`;
- serialize mutations behind one lock;
- persist with an atomic replace;
- avoid logging routine descriptions.

## Why sensors instead of a to-do entity

`TodoListEntity` only models `NEEDS_ACTION` or `COMPLETED`. A missed or skipped
routine item would have to be stored as completed or as an error, which the
product invariant forbids. The agenda sensors therefore carry `dayPart` and the
four-state `status` verbatim, and a calendar entity is offered for standard
consumers.

## Two clients, one state

```
Android ─┐
         ├─> autiplanner.complete / HTTP command ─> RoutineStore ─> atomic .ics write
Navet ───┘
```

A client confirms state from the returned item rather than assuming success.

## Tests

Domain tests run without Home Assistant:

```bash
python3 -m unittest discover -s tests -t .
```

Config-flow, entity, and service tests need the Home Assistant harness:

```bash
pip install -r requirements-test.txt
pytest
```
