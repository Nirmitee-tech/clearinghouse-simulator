// Data-driven scenario generator: emits one stub per real code observed in production.
// Descriptions from X12 CARC (Claim Adjustment Reason) and CSCC/STC (Claim Status) code sets.
// Reads the gap lists in /tmp (real_cas.txt, real_stc.txt) produced from the corpus scan.
import fs from 'fs';

const CARC = {
  '5':'Procedure code/type of bill inconsistent with the place of service',
  '27':'Expenses incurred after coverage terminated','31':'Patient cannot be identified as our insured',
  '96':'Non-covered charge(s)','97':'Payment adjusted — benefit included in another service already adjudicated',
  '129':'Prior processing information incorrect','167':'This (these) diagnosis(es) is (are) not covered',
  '177':'Patient has not met the required eligibility requirements','204':'Not covered under the patient’s current benefit plan',
  '226':'Information requested from the billing/rendering provider was not provided','227':'Information requested from the patient was not provided',
  '242':'Services not provided by network/primary care providers','252':'An attachment/other documentation is required to adjudicate',
  '256':'Service not payable per managed care contract','A1':'Claim/service denied — see remark code',
  'B13':'Previously paid — payment for this claim/service may have been provided',
  '45':'Charge exceeds fee schedule/maximum allowable','95':'Plan procedures not followed','200':'Expenses incurred during a lapse in coverage',
  '1':'Deductible amount','2':'Coinsurance amount','3':'Co-payment amount','18':'Exact duplicate claim/service','29':'Time limit for filing has expired',
  '133':'Claim forwarded to another payer','23':'Impact of prior payer(s) adjudication','4':'Procedure code inconsistent with the modifier or a required modifier is missing',
  '16':'Claim/service lacks information needed for adjudication','119':'Benefit maximum for this time period has been reached',
};

const STC = {
  '0':'Acknowledgement','1':'Entity acknowledges receipt of claim','19':'Entity acknowledges receipt of claim/encounter',
  '20':'Accepted for processing','3':'Claim has been adjudicated and is awaiting payment','16':'Claim/encounter has been forwarded to entity',
  '21':'Missing or invalid information','26':'Entity not found — patient','33':'Subscriber and subscriber id not found',
  '54':'Duplicate of a previously processed claim','88':'Entity not eligible for benefits for submitted dates of service',
  '97':'Patient eligibility not found','125':'Entity’s id number','142':'Rendering provider name matching required',
  '153':'Entity’s relationship to insured is invalid','155':'Diagnosis code invalid for the date of service',
  '187':'Rendering provider name matching required','255':'Entity not found — patient','464':'Payer assigned claim control number',
  '477':'Diagnosis code','500':'Entity’s Postal/Zip code','543':'Claim received by the clearinghouse and passed to the payer',
  '562':'Entity’s National Provider Identifier (NPI)','578':'Refund issued to an erroneous priority payer','672':'Payer’s payment could not be applied',
  '743':'Diagnosis code(s) for the services rendered','796':'There is data missing in the claim','46':'Awaiting supporting documentation',
};
const CATEGORY = { A0:'Acknowledgement', A1:'Received', A2:'Accepted', A3:'Returned as unprocessable / rejected',
  A6:'Rejected — missing information', A7:'Rejected — invalid information', A8:'Rejected — relational field error', P3:'Pending', P5:'Pending — patient' };

const loadReal = p => fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean);
function covered(re, dir){ const out=new Set();
  for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.yaml'))){
    const t=fs.readFileSync(dir+'/'+f,'utf8'); let m; const rx=new RegExp(re,'g');
    while((m=rx.exec(t))) out.add(m[1]); } return out; }

// ---- CAS gap ----
const realCas = loadReal('/tmp/real_cas.txt');
const covCas = covered("CAS\\*(?:CO|PR|OA|PI|CR)\\*([0-9A-Z]+)", 'stubs/remit');
let casMade=0, casSkip=0;
for(const code of realCas){
  const [grp,reason]=code.split('-');
  if(covCas.has(reason)){ casSkip++; continue; }
  const desc = CARC[reason] || `Adjustment reason ${reason}`;
  const isPR = grp==='PR', isCO = grp==='CO';
  const slug = `${String(44+casMade).padStart(2,'0')}-auto-${grp.toLowerCase()}-${reason.toLowerCase()}`;
  fs.writeFileSync(`stubs/remit/${slug}.yaml`, `description: >
  Auto-generated from production. ${grp}-${reason}: ${desc}.
priority: 940
match: { transaction: '837' }
scenario:
  title: '${isPR?'Patient owes':isCO?'Contractual write-off':'Adjustment'} — ${desc} (${grp}-${reason})'
  group: Remittance (835)
  outcome: '${isPR?'Assigned to the patient as responsibility.':isCO?'Written off contractually — not billable to the patient.':'Other / payer-initiated adjustment.'}'
  technical: 'CAS*${grp}*${reason} — ${desc}'
  seenInProduction: corpus
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
      clpStatus: '${isPR?'4':'1'}'
      paidAmount: '${isCO?'{{allowedAmount}}':'0.00'}'
      patientResp: '${isPR?'{{chargeAmount}}':'0.00'}'
      checkAmount: '${isCO?'{{allowedAmount}}':'0.00'}'
      cas: [ 'CAS*${grp}*${reason}*{{chargeAmount}}' ]
`); casMade++;
}

// ---- STC gap ----
const realStc = loadReal('/tmp/real_stc.txt');
const covStc = covered("stc: *'?([A-Z][0-9]+:[0-9]+)", 'stubs/claimack');
const covStcNorm = new Set([...covStc].map(s=>s.replace(':','^')));
let stcMade=0, stcSkip=0;
for(const code of realStc){
  if(covStcNorm.has(code)){ stcSkip++; continue; }
  const [cat,st]=code.split('^');
  const catText = CATEGORY[cat]||cat, stText = STC[st]||`Status ${st}`;
  const rejected = /^A[3678]$/.test(cat);
  const slug = `${String(27+stcMade).padStart(2,'0')}-auto-${cat.toLowerCase()}-${st}`;
  fs.writeFileSync(`stubs/claimack/${slug}.yaml`, `description: >
  Auto-generated from production. STC ${cat}^${st}: ${catText} — ${stText}.
priority: 930
match: { transaction: '837' }
scenario:
  title: '${catText} — ${stText} (${cat}^${st})'
  group: Claim acknowledgement (277CA)
  outcome: '${rejected?'Rejected before adjudication — correct the flagged data and resubmit.':cat==='A1'||cat==='A2'?'Accepted / received — progressing normally.':'Pending — awaiting payer.'}'
  technical: 'STC*${cat}:${st} — ${stText}'
  seenInProduction: corpus
respond:
  - { transaction: '999', delay: 20s, template: 999-generic.hbs, values: { ak9: A, ik5: A } }
  - transaction: '277'
    delay: 2m
    template: 277ca-generic.hbs
    values: { stc: '${cat}:${st}', action: '${rejected?'U':'WQ'}', stcText: '${stText.replace(/'/g,"")}' }
`); stcMade++;
}
console.log(`CAS: generated ${casMade}, already-covered ${casSkip}`);
console.log(`STC: generated ${stcMade}, already-covered ${stcSkip}`);
