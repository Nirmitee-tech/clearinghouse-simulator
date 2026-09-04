// Generate eligibility AAA-reject and remittance RARC-remark scenarios from the corpus gap lists.
import fs from 'fs';

const AAA = {
  '15':'Required application data missing','41':'Authorization/access restrictions','42':'Unable to respond at current time',
  '43':'Invalid/missing provider identification','45':'Invalid/missing provider specialty','47':'Invalid/missing provider state',
  '48':'Invalid/missing referring provider ID','50':'Provider ineligible for inquiries','51':'Provider not on file',
  '56':'Inappropriate date','57':'Invalid/missing date(s) of service','58':'Invalid/missing date of birth',
  '60':'Date of birth follows date(s) of service','61':'Date of death precedes date(s) of service',
  '62':'Date of service not within allowable inquiry period','63':'Date of service in the future','64':'Invalid/missing patient ID',
  '65':'Invalid/missing patient name','66':'Invalid/missing patient gender code','67':'Patient not found','68':'Duplicate patient ID',
  '71':'Patient birth date does not match the database','72':'Invalid/missing subscriber/insured ID','73':'Invalid/missing subscriber/insured name',
  '74':'Invalid/missing subscriber/insured gender code','75':'Subscriber/insured not found','76':'Duplicate subscriber/insured ID',
  '77':'Subscriber found, patient not found','78':'Subscriber/insured not in group/plan identified','79':'Invalid participant identification',
  'T4':'Payer name or identifier missing',
};
const RARC = {
  N381:'Alert: consult our contractual agreement for restrictions/billing on this procedure',
  N130:'Consult plan benefit documents/guidelines for information about restrictions','N19':'Procedure code incidental to primary procedure',
  N30:'Patient ineligible for this service','N522':'Duplicate of a claim processed, or in process, as a crossover claim',
  N706:'Missing documentation','N702':'Decision based on review of previously adjudicated claims','N782':'Missing/incomplete/invalid subscriber ID',
  N185:'Alert: do not resubmit this claim/service','N448':'This drug/service/supply is not included in the fee schedule',
  N4:'Missing/incomplete/invalid prior insurance carrier EOB','N535':'We do not pay for this item under this program',
  N781:'Alert: patient balance may be billed','N770':'The adjustment request received has been processed',
  N26:'Missing itemized bill/statement','N179':'Additional information has been requested from the member',
  N174:'This is not a covered service/procedure/equipment/bed','M115:':'This item is denied when provided to this patient by a non-contract or non-demonstration supplier',
  M115:'This item is denied when provided by a non-contract supplier',M77:'Missing/incomplete/invalid place of service',
  M64:'Missing/incomplete/invalid other diagnosis',
};

const load = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : []);
const has = (dir, needle) => fs.readdirSync(dir).some(f => fs.readFileSync(`${dir}/${f}`, 'utf8').includes(needle));
const nextNum = dir => String(Math.max(0, ...fs.readdirSync(dir).map(f => parseInt(f, 10)).filter(n => !isNaN(n))) + 1).padStart(2, '0');

let aaaMade = 0;
for (const code of load('/tmp/real_aaa.txt')) {
  const dir = 'stubs/eligibility';
  if (has(dir, `aaaReason: '${code}'`)) continue;
  const d = AAA[code] || `Eligibility reject reason ${code}`;
  fs.writeFileSync(`${dir}/${nextNum(dir)}-auto-aaa-${code.toLowerCase()}.yaml`, `description: >
  Auto-generated from production. 271 AAA reject reason ${code}: ${d}.
priority: 930
match: { transaction: '270' }
scenario:
  title: 'Eligibility rejected — ${d} (AAA ${code})'
  group: Eligibility (271)
  outcome: 'The payer refused the eligibility inquiry — correct the flagged field and re-verify.'
  technical: 'AAA03 = ${code} — ${d}'
  seenInProduction: corpus
respond:
  - transaction: '271'
    delay: 1m
    template: 271-aaa.hbs
    values: { aaaReason: '${code}', aaaText: '${d.replace(/'/g, '')}' }
`); aaaMade++;
}

let rarcMade = 0;
for (const code of load('/tmp/real_rarc.txt')) {
  const dir = 'stubs/remit';
  if (has(dir, `rarc: ${code}\n`) || has(dir, `rarc: ${code} `)) continue;
  const d = RARC[code] || `Remittance advice remark ${code}`;
  fs.writeFileSync(`${dir}/${nextNum(dir)}-auto-rarc-${code.toLowerCase()}.yaml`, `description: >
  Auto-generated from production. RARC remark ${code}: ${d}. Travels with a denial CARC as its explanation.
priority: 935
match: { transaction: '837' }
scenario:
  title: 'Denied with remark — ${d} (${code})'
  group: Remittance (835)
  outcome: 'The denial carries remark ${code} explaining why — read alongside the CARC.'
  technical: 'CAS*CO*16 + LQ*HE*${code} (RARC) — ${d}'
  seenInProduction: corpus
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
`); rarcMade++;
}
console.log(`AAA: generated ${aaaMade}`);
console.log(`RARC: generated ${rarcMade}`);
