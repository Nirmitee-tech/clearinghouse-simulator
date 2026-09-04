# Clearinghouse Simulator

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
production traffic is real PHI and real money. this gives you the whole
conversation locally, instantly, and deterministically — including the failure
modes you can't ask a payer to reproduce on demand.

## Using it as a drop-in for a real clearinghouse

The transport is the same one production uses: your application uploads 837 and
270 files by SFTP and polls a directory for responses. Point its clearinghouse
settings at this container and nothing else in your code changes — no client
library, no interface to swap, no build flag.

```yaml
# whatever your application calls its clearinghouse SFTP settings
host: localhost
port: 2222
username: simulator
password: simulator
outbound_dir: /edi/Upload      # where it puts 837 and 270 files
inbound_dir:  /edi/Download    # where it collects responses
processed_dir: /edi/Processed  # where it moves what it has consumed
error_dir:     /edi/Error
```

### Where responses are delivered

Few applications poll a single flat directory — most partition the drop folder,
usually by organization. The delivery path is a template, and every directory in
it is created on demand:

```bash
CM_DELIVER_TO="{orgId}"              # /Download/1/...
CM_DELIVER_TO="{payerId}/{transaction}"
CM_ORG_ID=1
```

Tokens: `{orgId}`, `{payerId}`, `{transaction}`, `{clientId}`. Both are also
settable at runtime through `POST /api/settings`.

### Two things that will bite you

Learned from wiring this to a real application:

- **Give the SFTP server one mount, not several.** Applications typically move
  processed files with an SFTP rename, and renaming across separate mounts fails.
  Keep `Upload`, `Download`, `Processed` and `Error` inside a single mounted
  directory (the compose file does this).
- **Pre-create the directories the application expects.** An SFTP chroot root is
  not writable, so an application that tries to `mkdir` its own drop folders will
  fail with permission denied.

### What has been proven

The wire format is validated against a production corpus of 10,432 real response
files: byte-identical interchange headers, the same delimiters, the same segment
order, the same filename shapes (see
[docs/CORPUS-FINDINGS.md](docs/CORPUS-FINDINGS.md)).

It has also been run end to end against a real revenue-cycle application: the
application uploaded an 837 over SFTP, the simulator answered with 999, 277CA and
835 files, and the application's own scheduled sweep collected them, parsed them
and posted the remittance to its database — through its production code path,
with no test hooks. It could not tell the difference.

That was one application. If you run a second one, an issue reporting what broke
is the most useful contribution this project can get.

## For a team

Every developer runs their own copy; there is nothing shared to break and no
credentials to hand out.

```bash
git clone https://github.com/Nirmitee-tech/clearinghouse-simulator
cd clearinghouse-simulator && docker compose up
```

That is the whole setup: the UI on `localhost:8090`, SFTP on `localhost:2222`,
and 120 scenarios ready to use. A prebuilt image is also published to
`ghcr.io/nirmitee-tech/clearinghouse-simulator` on every push to `main` — note
that GitHub creates new container packages **private** even for a public
repository, so pulling it anonymously fails until the package's visibility is
switched to public once in the repository's package settings.

**In automated tests**, run it as a service and drive it over HTTP: create a test
patient bound to the outcome you want, use those details in your own fixtures,
then assert on what your application did.

```bash
# arrange: this patient's claims will be denied for lack of prior authorization
curl -s -X POST localhost:8090/api/patients -H 'Content-Type: application/json' \
  -d '{"scenarios":["remit/06-denied-no-auth"]}'
# → {"memberId":"748120553","firstName":"ROWAN","lastName":"TRIALWOOD", ...}
```

Set `speed` to `10000` in `POST /api/settings` and responses arrive immediately
instead of on realistic delays — useful in CI, misleading anywhere a human is
watching, because real remittances take days.

## Quick start

```bash
docker compose up          # UI on http://localhost:8090, SFTP on :2222
```

That brings up three things: a one-shot `init` that creates the directories an
SFTP chroot cannot create for itself, the engine, and an SFTP server sharing one
volume with it — `/edi/Upload`, `/edi/Download`, `/edi/Processed`, `/edi/Error`.

Point your application's clearinghouse SFTP settings at `localhost:2222`
(user `simulator`, password `simulator`) and run it normally.

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

210 scenarios across the full transaction set, each stating both what the
practice sees and what comes back on the wire:

| Group | Covers |
|---|---|
| Eligibility (270 → 271) | active, deductible states, out-of-network, terminated, not-yet-effective, visit limits, carve-outs, COBRA, Medicaid spend-down, Medicare primary, and the `AAA` rejections (member not found, bad ID, name/DOB mismatch, payer down, provider not on file) |
| Prior authorization (278) | approved, partial, pended, denied, not required, contact payer |
| File acknowledgement (TA1 / 999) | interchange accept and reject, 999 accept, accept-with-warnings, and rejects at segment, element and envelope level |
| Claim acknowledgement (277CA) | accepted and forwarded, plus rejections for subscriber, NPI, procedure, diagnosis, dates, duplicates, enrolment and payer routing |
| Remittance (835) | paid in full, deductible / coinsurance / copay, contractual write-off, partial line payment, bundling, sequestration, secondary COB, capitation, interest, corrected claims, reversals and offsets, predetermination, and the common denials (no auth, non-covered, timely filing, missing info, duplicate, medical necessity, provider not eligible, wrong payer) |
| Claim status (276 → 277) | pending, pending-for-records, finalised paid / part-paid / denied, returned, received-not-worked, not on file |
| Portal reports (XML) | the non-X12 claim-edit report a clearinghouse drops when someone changes a claim in its web portal |

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

The wire format and every scenario were validated against a production corpus of
10,432 real response files. That work is written up in
[docs/CORPUS-FINDINGS.md](docs/CORPUS-FINDINGS.md) — including several places
where textbook X12 and real clearinghouse traffic disagree, and the codes that
dominate real files but appear in no tutorial. Scenarios carrying a
`seenInProduction` note are labelled in the UI with how often they occurred.

The corpus itself is private healthcare data and is not part of this repository.

## Tests

```bash
npm test              # scenarios, delivery routing and wire format, engine behaviour
npm run test:sftp     # end to end through a real SFTP server (needs Docker)
```

`test/scenarios.mjs` generates a patient for every scenario, sends a request built
from that patient's own details, and checks the advertised outcome is what comes
back — so the catalogue cannot advertise details that do not work.

## Status & scope

Working end to end across 270/271 eligibility, 278 prior authorization,
837 → TA1/999 → 277CA → 835 claim flows, 276/277 claim status, and the
non-X12 portal report channel. The X12 reader
is deliberately lenient — it reads envelopes and correlation fields rather than
validating compliance, so imperfect real-world files still exercise your code.

Not a certification tool, not a payer, and not affiliated with any
clearinghouse vendor. Test data only — never point it at production PHI.

## Who maintains this

Built and maintained by **[Nirmitee.io](https://nirmitee.io)**, who work on
healthcare interoperability and revenue-cycle integration — EHR/FHIR platforms,
clearinghouse connectivity and claims automation. This tool came out of that
work: testing a claims pipeline without touching a live clearinghouse.

Issues and pull requests are welcome, particularly new scenarios and profiles for
other clearinghouses.

MIT licensed.

## Adding a missing code (extendible)

The simulator ships a scenario for **every** X12 code observed in real clearinghouse
traffic — 210+ across eligibility (271), claim acknowledgement (277CA) and remittance
(835). When a payer returns a code that isn't yet covered, add it three ways, all backed
by the **same builder** (`src/engine/scenario-builder.js`) so they never drift:

### 1. From the UI (no terminal)

Open the simulator (`http://localhost:8090`) and use the **"Add a scenario for a missing
code"** panel: pick the code type, enter the code and an optional description, click **Add**.
The scenario is written, the engine reloads live, and the list filters to your new code.

### 2. From the API

```bash
curl -s -X POST localhost:8090/api/scenarios \
  -H 'Content-Type: application/json' \
  -d '{"type":"carc","code":"CO-253","description":"Sequestration reduction"}'
# -> {"id":"remit/NN-custom-co-253","group":"remit","loaded":211}
```

Returns `409` if the code already has a scenario, `400` on a malformed code.

### 3. From the CLI

```bash
node tools/add-code.mjs carc CO-253 "Sequestration - reduction in federal payment"
node tools/add-code.mjs stc  A7-500 "Entity's Postal/Zip code"
node tools/add-code.mjs aaa  72     "Invalid/Missing Subscriber/Insured ID"
node tools/add-code.mjs rarc N381   "Alert: consult our contractual agreement"
```

### Code types

| Type   | Transaction        | Code format            | Example   |
|--------|--------------------|------------------------|-----------|
| `carc` | Remittance (835)   | `GROUP-REASON`         | `CO-253`  |
| `stc`  | Claim ack (277CA)  | `CATEGORY-STATUS`      | `A7-500`  |
| `aaa`  | Eligibility (271)  | reason number          | `72`      |
| `rarc` | Remittance (835)   | remark code            | `N381`    |

All three paths refuse to clobber an existing code and produce a valid, reloadable stub.

### Rebuilding coverage from a fresh corpus

After pulling new clearinghouse files, regenerate the full scenario set:

```bash
node tools/gen-scenarios-from-corpus.mjs   # CARC + claim-status codes
node tools/gen-aaa-rarc.mjs                # AAA eligibility + RARC remark codes
```

Both read the code lists in `/tmp/real_*.txt` produced by scanning the corpus, so
coverage always tracks what the practice actually receives — no theoretical codes,
and any genuinely new one is one command away.
