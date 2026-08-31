# Adding to the simulator

The thing you will most often want is a new scenario. That is a YAML file — no
code.

## A new scenario

Drop a file under `stubs/<group>/` and click **reload** in the UI (or
`POST /api/stubs/reload`). It appears immediately.

```yaml
description: Denied — experimental treatment
priority: 950            # 900 is the fallback for a transaction; 950 keeps this
                         # reachable only when a test patient is bound to it
match:
  transaction: "837"     # which request this answers
scenario:
  title: Denied — experimental or investigational
  group: Remittance (835)
  outcome: >-
    The payer refuses it as unproven treatment. Appealable with literature, but
    nothing arrives in the meantime.
  technical: CLP02=4 · CAS*CO*55 (procedure deemed experimental) · LQ*HE*N115
respond:
  - { transaction: "999", delay: 30s, template: 999-generic.hbs, values: {ak9: A, ik5: A} }
  - { transaction: "277", delay: 2m,  template: 277ca-generic.hbs, values: {stc: "A2:20"} }
  - { transaction: "835", delay: 10m, template: 835-generic.hbs,
      values:
        clpStatus: "4"
        paidAmount: "0.00"
        cas: ["CAS*CO*55*{{chargeAmount}}"]
        lq:  ["LQ*HE*N115"] }
```

Three things make a scenario good:

- **`outcome`** is what a biller or a practice owner would say happened. No codes.
- **`technical`** is what an engineer needs: the segments and codes that come back.
- **`values`** may reference the request — `{{chargeAmount}}`, `{{memberId}}` —
  so the response reflects what was actually sent rather than a fixed number.

Add `seenInProduction:` when you know a code's real frequency; the UI shows it,
and it is the difference between a plausible scenario and a documented one.

Templates live in `templates/` and are authored with conventional `*` and `:`
delimiters. The profile converts them to the clearinghouse's real wire format on
the way out, so never hard-code `|` or `^`.

## Running the tests

```bash
npm test              # scenarios, delivery routing, wire format, engine behaviour
npm run test:sftp     # end to end through a real SFTP server (needs Docker)
```

`test/scenarios.mjs` generates a patient for every scenario in the library and
checks that the details the UI hands a tester actually produce the advertised
outcome. A new scenario is covered by it automatically — if yours cannot be
reached from its own test patient, that test fails, which is the point.

## A profile for another clearinghouse

`src/engine/profile.js` holds the wire format: delimiters, interchange identity,
and the filename shape per transaction. A second clearinghouse is a new object
there, not a fork. If you add one, say in the pull request how you established
the format — a real file beats a specification.
