# What the corpus taught us

The scenario library and the wire format were checked against a production
corpus of clearinghouse traffic — **10,432 response files**: 4,432 claim
acknowledgements, 3,586 eligibility responses, 2,116 functional acknowledgements,
298 remittances and 32 proprietary XML reports.

That corpus is not public and is not part of this repository: it is real
healthcare traffic belonging to the practice that received it. What follows is
structural only — segment order, code frequencies, filename shapes. No patient,
provider or payer data was copied out of it, and none is reproduced here.

## Format corrections

The mock originally emitted textbook X12. Live traffic does not look like that.

| | The mock emitted | Live traffic | Now |
|---|---|---|---|
| Element separator | `*` | `\|` | fixed |
| Component separator | `:` | `^` | fixed |
| Repetition separator | `^` | `}` | fixed |
| Interchange sender | `CLEARMOCK` | `ZIRMED` | fixed |
| 271 filename | `ELG_271_<ts>.txt` | `{clientId}.{stamp}.{seq}.ELG.271.edi` | fixed |
| 277 filename | `STA_277_<ts>.txt` | `{clientId}.{stamp}.CLP.277` | fixed |
| 999 filename | `ACK_999_<ts>.txt` | `{clientId}.{stamp}.999` | fixed |
| 835 filename | `ERA_835_<ts>.835` | `{payerId}.{stamp}.{seq}.ERA.835.edi` | fixed |

The 835 filename detail matters: live remittances are named by **payer ID**, not
by the practice, so anything sorting inbound files by name groups them by payer.

Scenarios are still authored in the conventional `*` / `:` form; the profile
converts on the way out, so a second clearinghouse only needs a new profile.

## Structural corrections

**277CA was materially wrong.** Our version had one acknowledgement level. Real
ones carry four: clearinghouse (`NM1*AY`, with its own tax ID), receiver, billing
provider, then patient — with a status at the receiver level *and* at the claim
level, plus `TRN*1` batch numbers, `DTP*050` received date, `DTP*009` process
date, `QTY`, `AMT*YY`, `REF*D9` (the clearinghouse's own claim id) and `REF*0B`.
The template now reproduces the real segment sequence exactly.

**835 was missing reconciliation anchors.** Live remittances carry `REF*6R`
line-item control numbers on 2,479 service lines; the mock emitted none, which makes
line-level posting guesswork. Also added: `DTM*050` received, `DTM*233` statement
end, `AMT*AU` coverage amount, `NM1*82` rendering provider, and `TS3` provider
summary.

## Codes we were missing

Ranked by how often they actually appear.

**Eligibility rejections** — `AAA*Y**43` (invalid provider identification) is the
single most common answer in the corpus at **589 of 3,586 responses**, and there was no scenario for it. Also added: `63` future date of service, `T4` payer not
identified, `74` sex mismatch, `79` invalid participant, `78` not in group, `15`
incomplete request.

**Eligibility benefits** — `EB*G` (out-of-pocket maximum) appears **15,272 times**
and was absent from every scenario, so no test ever exercised stop-loss handling.
Added along with `EB*V` cannot process, `EB*U` contact payer, `EB*N` restricted
provider, `EB*H` unlimited, `EB*5` pending investigation.

**Claim statuses** — `STC*A1:19:AY` (received by clearinghouse) is the most common
status in the corpus at **4,766 occurrences**; it is the first thing almost every
claim gets back, and the mock never sent it. Added with `A7:26:QC`, `A7:88:IL`,
`A3:125:82`, `A3:585:PR`, `A7:153`, `P3:46:1P`, `F0:0`.

**Remittance adjustments** — the library assumed duplicates arrive as `CO-18`; the corpus
uses `OA-18` three times more often, and the group code decides who absorbs the
cost. Added `CO-119` benefit maximum, `PR-200`, `PR-29` (timely filing billed to
the patient, alongside the `CO-29` form we had), `PI-22`, `OA-133`.

**Remark codes** — `N381` dominates live ERAs at **539 occurrences** and was
absent entirely.

**Provider-level adjustments** — `PLB*AH` (origination fee) is the most common in
the corpus; the library only had `WO`, `FB` and `L6`.

**Telehealth** — more than half of live `90837` lines carry a `95` or `GT`
modifier. No scenario exercised a modifier at all.

## Worth knowing

**999s are never rejections here.** All 2,116 functional acknowledgements in the
corpus are `AK9*A` / `IK5*A`. Format failures surface as 277CA rejections instead,
so a system that only handles 999 rejections will look fine in testing and miss
every real failure. The 999-rejection scenarios are kept — other clearinghouses
do send them — but they are not the realistic path here.

**A non-X12 channel exists.** Waystar also drops `Prof_{clientId}_{MMDDYYYY}.xml`
— claim-edit audit reports, referencing a stylesheet at zirmed.com, listing what
each user changed on a claim in the portal. 32 of them in the corpus. The mock
does not simulate this yet; it is the clearest remaining gap.

**Service types are repeating composites.** `EB03` frequently carries dozens of
service type codes in one element separated by `}` — a parser expecting a single
value silently reads only the first.
