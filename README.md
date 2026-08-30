# clearmock

An open-source **X12 clearinghouse simulator**. Point your revenue-cycle
application at it instead of a real clearinghouse and it answers like one:
send a 270, get a 271; send an 837, get the 999 → 277CA → 835 sequence — with
**your own request's values echoed back**, so every correlation key your code
matches on (trace numbers, control numbers, patient control numbers, member ids,
charges) lines up exactly as it would in production.

Ships with a Waystar-shaped profile (SFTP file exchange, `.ELG`/`.835` naming),
but the transport and file conventions are configuration, not code.

## Why

Clearinghouse integrations are the hardest part of a claims product to test:
credentials are precious, enrolment takes weeks, responses take days, and
production traffic is real PHI and real money. clearmock gives you the whole
conversation locally, instantly, and deterministically — including the failure
modes you can't ask a payer to reproduce on demand.

## Quick start

```bash
docker compose up          # UI on http://localhost:8090, SFTP on :2222
```

Point your application's clearinghouse SFTP settings at `localhost:2222`
(user `clearmock`, password `clearmock`) and run it normally.

No SFTP needed? Inject directly:

```bash
curl -X POST http://localhost:8090/api/inject \
     -H 'Content-Type: text/plain' --data-binary @claim.837
```

## How it works

```
request file  →  parse X12  →  match a stub  →  render templates  →  response files
   (270/837)      envelope +     first match      Handlebars with        (271/999/
                  key fields     by priority      the request's own       277CA/835)
                                                  values
```

A **stub** is "given this request, respond with that" — plain YAML:

```yaml
description: "Member ID ending 99 → coverage terminated."
priority: 10
match:
  transaction: "270"
  memberId: { endsWith: "99" }
respond:
  transaction: "271"
  delay: 20s
  template: 271-inactive.hbs
```

A claim stub can return a **flow** — the real sequence, with realistic gaps:

```yaml
match: { transaction: "837", memberId: { endsWith: "00" } }
respond:
  - { transaction: "999", delay: 30s, template: 999-accept.hbs }
  - { transaction: "277", delay: 3m,  template: 277ca-rejected.hbs,
      values: { rejectText: "SUBSCRIBER ID NOT FOUND IN PAYER RECORDS" } }
```

Matchers: exact value, `endsWith`, `startsWith`, `contains`, `regex`, `oneOf`,
`gt`, `lt`. Lowest `priority` number wins; the shipped defaults sit at 900 so
your own stubs take precedence.

Templates are Handlebars over the parsed request, with X12 helpers
(`controlNumber`, `now`, `money`, `minus`, `pad`, `default`). Every field the
request carried is available by name — that's what makes responses correlate.

## Pinning a scenario for one call

Editing the stub library to steer a single test is clumsy, so a scenario can be
**pinned** instead: the next N requests carrying a value get a chosen stub, then
the pin is consumed and normal matching resumes. Parallel tests can each pin
their own outcome without fighting over shared state.

```bash
curl -X POST http://localhost:8090/api/overrides -H 'Content-Type: application/json' \
     -d '{"field":"memberId","value":"2232","stubId":"claims/02-cpt-90837-denied","times":1}'
```

## Answering differently on each call

Some behaviour only shows up across repeated calls — a claim that reads PENDING
on the first status inquiry and FINALIZED on the next. A stub can declare a
`sequence` instead of a single `respond`, advanced per correlation key:

```yaml
match: { transaction: "276" }
sequenceKey: patientControlNumber      # cursor is per claim, not global
sequence:
  - { transaction: "277", delay: 10s, template: 277ca-accepted.hbs,
      values: { statusText: "PENDING ADJUDICATION" } }
  - { transaction: "277", delay: 10s, template: 277ca-accepted.hbs,
      values: { statusText: "FINALIZED - PAID" } }
```

The last entry repeats once the sequence is exhausted.

## The UI

`http://localhost:8090` — live traffic timeline (click any exchange for the raw
X12, the decoded summary, and **why** a stub matched, condition by condition),
the stub library with per-stub enable/disable, and global controls:

- **speed** — run delays in real time, 60×, 600×, or instantly
- **outage mode** — responses are dropped, so you can exercise retry/backoff paths
- **hold responses** — queue answers and release them by hand, mid-test

Pinned scenarios are listed and can be created from the same screen.

## Scenario conventions

The bundled stubs use magic values so a tester can steer outcomes from the
application's own UI, with no clearinghouse-side setup:

| Send | Get |
|---|---|
| member id ending `99` | coverage inactive (`EB*6`) |
| member id ending `00` (270) | subscriber not found (`AAA*Y**75`) |
| member id ending `00` (837) | 999 accepted, then 277CA rejection |
| charge `999.00` | 999 syntax rejection — never reaches the payer |
| a `96156` service line | denial `CO-197` (no prior authorization) |
| charge under `$100` | paid in full |
| anything else | paid, minus `PR-1 $30` deductible and `CO-45 $20` write-off |

Add your own by dropping a YAML file into `stubs/` and clicking **reload stubs**.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/inject` | submit raw X12 without SFTP |
| `GET /api/traffic` | every exchange, newest first |
| `GET /api/stubs` · `POST /api/stubs/reload` | stub library |
| `POST /api/stubs/:id/toggle` | enable/disable one stub |
| `GET/POST /api/settings` | speed, outage, hold |
| `POST /api/release` | release held responses |
| `GET/POST/DELETE /api/overrides` | pin a scenario for the next N matching requests |
| `POST /api/cursors/reset` | rewind every sequence cursor |

## Status & scope

Early but working: 270/271, 837/999/277CA/835 flows end to end. The X12 reader
is deliberately lenient — it reads envelopes and correlation fields rather than
validating compliance, so imperfect real-world files still exercise your code.

Not a certification tool, not a payer, and not affiliated with any
clearinghouse vendor. Test data only — never point it at production PHI.

MIT licensed.
