# clearmock

An open-source **X12 clearinghouse simulator**. Point your revenue-cycle
application at it instead of a real clearinghouse and it answers like one:
send a 270, get a 271; send an 837, get the 999 → 277CA → 835 sequence — with
**your own request's values echoed back**, so every correlation key your code
matches on (trace numbers, control numbers, patient control numbers, member ids,
charges) lines up exactly as it would in production.

Ships with a profile matched against a real production corpus — the same
delimiters (`|` elements, `^` components, `}` repetition), the same interchange
identity, and the same filename shapes clearinghouse traffic actually uses.
Transport and file conventions are configuration, so a second clearinghouse is a
new profile, not a fork.

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

## The scenario library

88 scenarios across the full transaction set, each stating both what the practice
sees and what comes back on the wire:

| Group | Covers |
|---|---|
| Eligibility (270 → 271) | active, deductible states, out-of-network, terminated, not-yet-effective, visit limits, carve-outs, COBRA, Medicaid spend-down, Medicare primary, and the `AAA` rejections (member not found, bad ID, name/DOB mismatch, payer down, provider not on file) |
| Prior authorization (278) | approved, partial, pended, denied, not required, contact payer |
| File acknowledgement (TA1 / 999) | interchange accept and reject, 999 accept, accept-with-warnings, and rejects at segment, element and envelope level |
| Claim acknowledgement (277CA) | accepted and forwarded, plus rejections for subscriber, NPI, procedure, diagnosis, dates, duplicates, enrolment and payer routing |
| Remittance (835) | paid in full, deductible / coinsurance / copay, contractual write-off, partial line payment, bundling, sequestration, secondary COB, capitation, interest, corrected claims, reversals and offsets, predetermination, and the common denials (no auth, non-covered, timely filing, missing info, duplicate, medical necessity, provider not eligible, wrong payer) |
| Claim status (276 → 277) | pending, pending-for-records, finalised paid / part-paid / denied, returned, received-not-worked, not on file |

Every scenario names its own X12 detail — `CAS*CO*197` with `LQ*HE*N130`, `AAA*Y**75*C`,
`STC*A7:21:82`, `CLP02=22` with `PLB*WO` — and the UI can render the exact
response before you wire anything up.

## API

| Endpoint | Purpose |
|---|---|
| `GET/POST/DELETE /api/patients` | generate a test patient bound to chosen scenarios |
| `GET /api/stubs/:id/preview` | the exact X12 a scenario returns |
| `POST /api/inject` | submit raw X12 without SFTP |
| `GET /api/traffic` | every exchange, newest first |
| `GET /api/stubs` · `POST /api/stubs/reload` | stub library |
| `POST /api/stubs/:id/toggle` | enable/disable one stub |
| `GET/POST /api/settings` | speed, outage, hold |
| `POST /api/release` | release held responses |
| `GET/POST/DELETE /api/overrides` | pin a scenario for the next N matching requests |
| `POST /api/cursors/reset` | rewind every sequence cursor |

## Fidelity

The wire format and 119 scenarios were validated against a production corpus of
10,432 real response files. That work is written up in
[docs/CORPUS-FINDINGS.md](docs/CORPUS-FINDINGS.md) — including several places
where textbook X12 and real clearinghouse traffic disagree, and the codes that
dominate real files but appear in no tutorial. Scenarios carrying a
`seenInProduction` note are labelled in the UI with how often they occurred.

The corpus itself is private healthcare data and is not part of this repository.

## Status & scope

Working end to end across 270/271 eligibility, 278 prior authorization,
837 → TA1/999 → 277CA → 835 claim flows, 276/277 claim status, and the
non-X12 portal report channel. The X12 reader
is deliberately lenient — it reads envelopes and correlation fields rather than
validating compliance, so imperfect real-world files still exercise your code.

Not a certification tool, not a payer, and not affiliated with any
clearinghouse vendor. Test data only — never point it at production PHI.

MIT licensed.
