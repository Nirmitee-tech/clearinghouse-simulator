// Shared scenario authoring — turns a single X12 code into a valid stub.
// Used by both the CLI (tools/add-code.mjs) and the UI endpoint (POST /api/scenarios),
// so the two can never drift.
import fs from 'fs';
import path from 'path';

const GROUP_DIR = { carc: 'remit', rarc: 'remit', stc: 'claimack', aaa: 'eligibility' };

function nextNum(dir) {
  const nums = fs.existsSync(dir)
    ? fs.readdirSync(dir).map(f => parseInt(f, 10)).filter(n => !isNaN(n))
    : [];
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0');
}

function existingEmit(dir, needle) {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some(f => fs.readFileSync(path.join(dir, f), 'utf8').includes(needle));
}

const slugify = s => s.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '');

// Returns { yaml, group, dir, slug } or throws { code, message } on a bad/duplicate input.
export function buildScenario({ type, code, description }, stubsRoot) {
  type = String(type || '').toLowerCase();
  code = String(code || '').toUpperCase().trim();
  const desc = String(description || '').trim();
  if (!GROUP_DIR[type]) throw { code: 'bad_type', message: `type must be carc | stc | aaa | rarc` };
  if (!code) throw { code: 'bad_code', message: 'code is required' };

  const dir = path.join(stubsRoot, GROUP_DIR[type]);

  if (type === 'carc') {
    const [grp, reason] = code.split('-');
    if (!grp || !reason) throw { code: 'bad_code', message: 'CARC must be GROUP-REASON, e.g. CO-45' };
    if (existingEmit(dir, `CAS*${grp}*${reason}*`)) throw { code: 'exists', message: `CAS*${grp}*${reason} already has a scenario` };
    const isPR = grp === 'PR', isCO = grp === 'CO';
    const d = desc || `Adjustment reason ${reason}`;
    const slug = `${nextNum(dir)}-custom-${grp.toLowerCase()}-${reason.toLowerCase()}`;
    const yaml = `description: >
  Custom-added via UI/CLI. ${grp}-${reason}: ${d}.
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
`;
    return { yaml, group: 'remit', dir, slug };
  }

  if (type === 'stc') {
    const [cat, st] = code.split('-');
    if (!cat || !st) throw { code: 'bad_code', message: 'STC must be CATEGORY-STATUS, e.g. A7-255' };
    if (existingEmit(dir, `stc: '${cat}:${st}'`)) throw { code: 'exists', message: `STC ${cat}:${st} already has a scenario` };
    const rejected = /^A[3678]$/.test(cat);
    const d = desc || `Status ${st}`;
    const slug = `${nextNum(dir)}-custom-${cat.toLowerCase()}-${st}`;
    const yaml = `description: >
  Custom-added via UI/CLI. STC ${cat}^${st}: ${d}.
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
`;
    return { yaml, group: 'claimack', dir, slug };
  }

  if (type === 'aaa') {
    if (existingEmit(dir, `aaaReason: '${code}'`)) throw { code: 'exists', message: `AAA ${code} already has a scenario` };
    const d = desc || `Eligibility reject reason ${code}`;
    const slug = `${nextNum(dir)}-custom-aaa-${slugify(code)}`;
    const yaml = `description: >
  Custom-added via UI/CLI. 271 AAA reject reason ${code}: ${d}.
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
`;
    return { yaml, group: 'eligibility', dir, slug };
  }

  // rarc
  if (existingEmit(dir, `rarc: ${code}\n`) || existingEmit(dir, `rarc: ${code} `)) {
    throw { code: 'exists', message: `RARC ${code} already referenced` };
  }
  const d = desc || `Remittance advice remark ${code}`;
  const slug = `${nextNum(dir)}-custom-rarc-${slugify(code)}`;
  const yaml = `description: >
  Custom-added via UI/CLI. RARC remark ${code}: ${d}. Travels with a denial CARC as its explanation.
priority: 935
match: { transaction: '837' }
scenario:
  title: 'Denied with remark — ${d} (${code})'
  group: Remittance (835)
  outcome: 'The denial carries remark ${code} explaining why — read alongside the CARC.'
  technical: 'CAS*CO*16 + LQ*HE*${code} (RARC) — ${d}'
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
`;
  return { yaml, group: 'remit', dir, slug };
}

// Writes the built scenario to disk. Returns the relative stub id.
export function writeScenario(built) {
  fs.mkdirSync(built.dir, { recursive: true });
  const file = path.join(built.dir, `${built.slug}.yaml`);
  if (fs.existsSync(file)) throw { code: 'exists', message: `${built.slug} already exists` };
  fs.writeFileSync(file, built.yaml);
  return `${built.group}/${built.slug}`;
}
