// Guarantees the UI never lies: for every scenario offered, generate a patient
// bound to it, build a request from that patient's own details, and check the
// engine answers with that scenario. If a scenario cannot be reached from the
// details the UI hands the tester, it is broken.
const BASE = process.env.CM_BASE || 'http://localhost:8093';
const post = (u, b) => fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const inject = (edi) => fetch(BASE + '/api/inject', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: edi }).then(r => r.json());

// ISA is fixed width: exactly 105 characters before the segment terminator.
const isa = (ctrl) => `ISA*00*          *00*          *ZZ*RIVERBEND      *ZZ*CLEARMOCK      *260830*1200*^*00501*${ctrl}*0*P*:`;

const build = {
  '270': p => [isa('000000777'),
    'GS*HS*RIVERBEND*CLEARMOCK*20260830*1200*777*X*005010X279A1',
    'ST*270*0001*005010X279A1', 'BHT*0022*13*TM900*20260830*1200', 'HL*1**20*1',
    `NM1*PR*2*${p.payerName}*****PI*${p.payerId}`, 'HL*2*1*21*1',
    'NM1*1P*2*RIVERBEND BEHAVIORAL HEALTH*****XX*1093817465', 'HL*3*2*22*0', 'TRN*1*TM900*9990000001',
    `NM1*IL*1*${p.lastName}*${p.firstName}****MI*${p.memberId}`,
    `DMG*D8*${p.dob.replace(/-/g, '')}*${p.gender}`,
    'DTP*291*D8*20260830', 'EQ*30', 'SE*13*0001', 'GE*1*777', 'IEA*1*000000777', ''].join('~'),

  '837': (p, sv = {}) => [isa('000000888'),
    'GS*HC*RIVERBEND*CLEARMOCK*20260830*1200*888*X*005010X222A1',
    'ST*837*0001*005010X222A1', 'BHT*0019*00*PCN-TEST*20260830*1200*CH',
    'NM1*85*2*RIVERBEND BEHAVIORAL HEALTH*****XX*9990000001', 'REF*TJ*840000000',
    `NM1*IL*1*${p.lastName}*${p.firstName}****MI*${p.memberId}`,
    `NM1*PR*2*${p.payerName}*****PI*${p.payerId}`,
    `CLM*PCN-TEST*${sv.charge || '200.00'}***11:B:1*Y*A*Y*Y`, 'DTP*472*D8*20260830',
    'NM1*82*1*JADHAV*MAHESH****XX*1093817465',
    `SV1*HC:${sv.cpt || '90837'}*${sv.charge || '200.00'}*UN*1***1`,
    'SE*13*0001', 'GE*1*888', 'IEA*1*000000888', ''].join('~'),

  '278': p => [isa('000000666'),
    'GS*HI*RIVERBEND*CLEARMOCK*20260830*1200*666*X*005010X217',
    'ST*278*0001*005010X217', 'BHT*0007*13*TM902*20260830*1200', 'HL*1**20*1',
    `NM1*X3*2*${p.payerName}*****PI*${p.payerId}`, 'HL*2*1*21*1',
    'NM1*1P*2*RIVERBEND BEHAVIORAL HEALTH*****XX*1093817465', 'HL*3*2*22*1',
    `NM1*IL*1*${p.lastName}*${p.firstName}****MI*${p.memberId}`,
    'HL*4*3*EV*0', 'UM*HS*I*AG**11:B:1', 'DTP*472*D8*20260830',
    'SE*13*0001', 'GE*1*666', 'IEA*1*000000666', ''].join('~'),

  '276': p => [isa('000000999'),
    'GS*HR*RIVERBEND*CLEARMOCK*20260830*1200*999*X*005010X212',
    'ST*276*0001*005010X212', 'BHT*0010*13*TM901*20260830*1200', 'TRN*1*TM901',
    `NM1*IL*1*${p.lastName}*${p.firstName}****MI*${p.memberId}`,
    'REF*EJ*PCN-TEST', 'SE*7*0001', 'GE*1*999', 'IEA*1*000000999', ''].join('~'),
};

await post('/api/settings', { speed: 10000, outage: false, hold: false });
const scenarios = (await (await fetch(BASE + '/api/stubs')).json()).filter(s => s.scenario);

let pass = 0, fail = 0;
for (const s of scenarios) {
  const txn = s.match?.transaction || '837';
  const patient = await post('/api/patients', { scenarios: [s.id] });
  const edi = build[txn](patient, s.scenario.service);
  const res = await inject(edi);
  if (res.matchedStub === s.id) { pass++; console.log(`  PASS  ${s.scenario.title}`); }
  else { fail++; console.log(`  FAIL  ${s.scenario.title}\n        generated patient produced "${res.matchedStub}" (expected "${s.id}")`); }
  await fetch(`${BASE}/api/patients/${patient.id}`, { method: 'DELETE' });
}

// A patient carrying several outcomes for one request type plays them in order.
const seqPatient = await post('/api/patients', {
  scenarios: ['remit/06-denied-no-auth', 'remit/02-deductible'] });
const first = await inject(build['837'](seqPatient));
const second = await inject(build['837'](seqPatient));
const third = await inject(build['837'](seqPatient));
const ordered = first.matchedStub === 'remit/06-denied-no-auth'
  && second.matchedStub === 'remit/02-deductible'
  && third.matchedStub === 'remit/02-deductible';
ordered ? (pass++, console.log('  PASS  several outcomes on one patient play in order, then hold'))
        : (fail++, console.log(`  FAIL  ordering: ${first.matchedStub} / ${second.matchedStub} / ${third.matchedStub}`));
await fetch(`${BASE}/api/patients/${seqPatient.id}`, { method: 'DELETE' });

// Two patients generated from the same scenario must not share an identity.
const a = await post('/api/patients', { scenarios: ['eligibility/01-active-full'] });
const b = await post('/api/patients', { scenarios: ['eligibility/01-active-full'] });
a.memberId !== b.memberId ? (pass++, console.log('  PASS  each generated patient gets its own member id'))
                          : (fail++, console.log('  FAIL  member ids collided'));
await fetch(`${BASE}/api/patients/${a.id}`, { method: 'DELETE' });
await fetch(`${BASE}/api/patients/${b.id}`, { method: 'DELETE' });

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
