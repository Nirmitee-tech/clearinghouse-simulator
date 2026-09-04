#!/usr/bin/env node
// Extendible scenario authoring — add a stub for any X12 code the simulator is missing.
//
// Usage:
//   node tools/add-code.mjs carc CO-253 "Sequestration - reduction in federal payment"
//   node tools/add-code.mjs stc  A7-500 "Entity's Postal/Zip code"
//   node tools/add-code.mjs aaa  72     "Invalid/Missing Subscriber/Insured ID"
//   node tools/add-code.mjs rarc N381   "Alert: consult our contractual agreement"
//
// It writes a valid scenario into the right stubs/ group, refuses to clobber an
// existing code, then reminds you to reload the engine. No code editing required.

import fs from 'fs';
import path from 'path';

const [, , rawType, rawCode, ...descParts] = process.argv;
const desc = descParts.join(' ').trim();

if (!rawType || !rawCode) {
  console.error(`add-code — add a scenario for a missing X12 code.

  node tools/add-code.mjs <type> <code> "<description>"

  <type>  carc | stc | aaa | rarc
  <code>  CARC: GROUP-REASON (CO-45, PR-3, OA-23)
          STC : CATEGORY-STATUS (A7-255, A3-21)
          AAA : reason number (72)      RARC: remark code (N381)
`);
  process.exit(1);
}

const type = rawType.toLowerCase();
const code = rawCode.toUpperCase();
const safe = s => s.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '');
const nextNum = dir => {
  const nums = fs.readdirSync(dir).map(f => parseInt(f, 10)).filter(n => !isNaN(n));
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0');
};
const already = (dir, needle) =>
  fs.readdirSync(dir).some(f => fs.readFileSync(path.join(dir, f), 'utf8').includes(needle));

function write(dir, slug, yaml) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.yaml`);
  if (fs.existsSync(file)) { console.error(`refusing to overwrite ${file}`); process.exit(1); }
  fs.writeFileSync(file, yaml);
  console.log(`wrote ${file}`);
  console.log('reload the running engine:  curl -s -X POST localhost:8090/api/stubs/reload');
}

if (type === 'carc') {
  const [grp, reason] = code.split('-');
  if (!grp || !reason) { console.error('CARC code must be GROUP-REASON, e.g. CO-45'); process.exit(1); }
  const dir = 'stubs/remit';
  if (already(dir, `CAS*${grp}*${reason}*`)) { console.error(`CAS*${grp}*${reason} already has a scenario`); process.exit(1); }
  const isPR = grp === 'PR', isCO = grp === 'CO';
  const d = desc || `Adjustment reason ${reason}`;
  write(dir, `${nextNum(dir)}-custom-${grp.toLowerCase()}-${reason.toLowerCase()}`, `description: >
  Custom-added. ${grp}-${reason}: ${d}.
priority: 940
match: { transaction: '837' }
scenario:
  title: '${isPR ? 'Patient owes' : isCO ? 'Contractual write-off' : 'Adjustment'} — ${d} (${grp}-${reason})'
  group: Remittance (835)
  outcome: '${isPR ? 'Assigned to the patient as responsibility.' : isCO ? 'Written off contractually — not billable to the patient.' : 'Other / payer-initiated adjustment.'}'
  technical: 'CAS*${grp}*${reason} — ${d}'
  seenInProduction: custom
respond:
  - { transaction: '999', delay: 30s, template: 999-generic.hbs, values: { ak9: A, ik5: A } }
  - transaction: '277'
    delay: 2m
    template: 277ca-generic.hbs
    values: { stc: 'A2:20', action: WQ, payerClaimRef: PYR${reason} }
  - transaction: '835'
    delay: 10m
    template: 835-generic.hbs
    values:
      clpStatus: '${isPR ? '4' : '1'}'
      paidAmount: '${isCO ? '{{allowedAmount}}' : '0.00'}'
      patientResp: '${isPR ? '{{chargeAmount}}' : '0.00'}'
      checkAmount: '${isCO ? '{{allowedAmount}}' : '0.00'}'
      cas: [ 'CAS*${grp}*${reason}*{{chargeAmount}}' ]
`);
} else if (type === 'stc') {
  const [cat, st] = code.split('-');
  if (!cat || !st) { console.error('STC code must be CATEGORY-STATUS, e.g. A7-255'); process.exit(1); }
  const dir = 'stubs/claimack';
  if (already(dir, `stc: '${cat}:${st}'`)) { console.error(`STC ${cat}:${st} already has a scenario`); process.exit(1); }
  const rejected = /^A[3678]$/.test(cat);
  const d = desc || `Status ${st}`;
  write(dir, `${nextNum(dir)}-custom-${cat.toLowerCase()}-${st}`, `description: >
  Custom-added. STC ${cat}^${st}: ${d}.
priority: 930
match: { transaction: '837' }
scenario:
  title: '${d} (${cat}^${st})'
  group: Claim acknowledgement (277CA)
  outcome: '${rejected ? 'Rejected before adjudication — correct the flagged data and resubmit.' : 'Progressing — see status text.'}'
  technical: 'STC*${cat}:${st} — ${d}'
  seenInProduction: custom
respond:
  - { transaction: '999', delay: 20s, template: 999-generic.hbs, values: { ak9: A, ik5: A } }
  - transaction: '277'
    delay: 2m
    template: 277ca-generic.hbs
    values: { stc: '${cat}:${st}', action: '${rejected ? 'U' : 'WQ'}', stcText: '${d.replace(/'/g, '')}' }
`);
} else if (type === 'aaa') {
  const dir = 'stubs/eligibility';
  if (already(dir, `aaaReason: '${code}'`)) { console.error(`AAA ${code} already has a scenario`); process.exit(1); }
  const d = desc || `Eligibility reject reason ${code}`;
  write(dir, `${nextNum(dir)}-custom-aaa-${safe(code)}`, `description: >
  Custom-added. 271 AAA reject reason ${code}: ${d}.
priority: 930
match: { transaction: '270' }
scenario:
  title: 'Eligibility rejected — ${d} (AAA ${code})'
  group: Eligibility (271)
  outcome: 'The payer refused the eligibility inquiry — correct the flagged field and re-verify.'
  technical: 'AAA03 = ${code} — ${d}'
  seenInProduction: custom
respond:
  - transaction: '271'
    delay: 1m
    template: 271-aaa.hbs
    values: { aaaReason: '${code}', aaaText: '${d.replace(/'/g, '')}' }
`);
} else if (type === 'rarc') {
  const dir = 'stubs/remit';
  if (already(dir, `rarc: ${code}`)) { console.error(`RARC ${code} already referenced`); process.exit(1); }
  const d = desc || `Remark code ${code}`;
  write(dir, `${nextNum(dir)}-custom-rarc-${safe(code)}`, `description: >
  Custom-added. RARC remark ${code}: ${d}. Travels with a denial CARC as explanation.
priority: 935
match: { transaction: '837' }
scenario:
  title: 'Denied with remark — ${d} (${code})'
  group: Remittance (835)
  outcome: 'The denial carries remark ${code} explaining why — read alongside the CARC.'
  technical: 'CAS*CO*16 + LQ*HE*${code} (RARC remark) — ${d}'
  seenInProduction: custom
respond:
  - { transaction: '999', delay: 30s, template: 999-generic.hbs, values: { ak9: A, ik5: A } }
  - transaction: '277'
    delay: 2m
    template: 277ca-generic.hbs
    values: { stc: 'A2:20', action: WQ, payerClaimRef: PYRRARC }
  - transaction: '835'
    delay: 10m
    template: 835-generic.hbs
    values:
      clpStatus: '4'
      paidAmount: '0.00'
      patientResp: '0.00'
      checkAmount: '0.00'
      cas: [ 'CAS*CO*16*{{chargeAmount}}' ]
      rarc: ${code}
`);
} else {
  console.error(`unknown type "${type}" — use carc | stc | aaa | rarc`);
  process.exit(1);
}
