// Delivery routing and wire-format fidelity.
//
// Applications rarely poll one flat directory — they partition the drop folder,
// most often by organization. These check that the simulator lands files exactly
// where an application expects them, creating directories on the way, and that
// what it writes is in the clearinghouse's real wire format rather than
// textbook X12.
const BASE = process.env.CM_BASE || 'http://localhost:8093';
const post = (u, b) => fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const get = (u) => fetch(BASE + u).then(r => r.json());
const text = (u) => fetch(BASE + u).then(r => r.text());

let pass = 0, fail = 0;
const chk = (name, got, want) => (String(got) === String(want)
  ? (pass++, console.log(`  PASS  ${name}`))
  : (fail++, console.log(`  FAIL  ${name}\n        expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)));
const ok = (name, cond, detail = '') => (cond
  ? (pass++, console.log(`  PASS  ${name}`))
  : (fail++, console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`)));

const isa = (ctrl) => `ISA*00*          *00*          *ZZ*EXAMPLECLINIC  *ZZ*CLEARMOCK      *260830*1200*^*00501*${ctrl}*0*P*:`;
const claim = (ctrl = '000000901') => [isa(ctrl),
  'GS*HC*EXAMPLECLINIC*CLEARMOCK*20260830*1200*901*X*005010X222A1',
  'ST*837*0001*005010X222A1', 'BHT*0019*00*PCN-DELIV*20260830*1200*CH',
  'NM1*85*2*EXAMPLE BEHAVIORAL HEALTH*****XX*9990000001', 'REF*TJ*840000000',
  'NM1*IL*1*TESTFIELD*AVERY****MI*881234561',
  'NM1*PR*2*MERIDIAN HEALTH PLAN*****PI*00455',
  'CLM*PCN-DELIV*200.00***11:B:1*Y*A*Y*Y', 'DTP*472*D8*20260830',
  'NM1*82*1*EXAMPLE*PROVIDER****XX*1093817465', 'SV1*HC:90837*200.00*UN*1***1',
  'SE*13*0001', 'GE*1*901', 'IEA*1*000000901', ''].join('~');

async function deliverWith(routing, ctrl) {
  await post('/api/settings', { speed: 10000, outage: false, hold: false, ...routing });
  const res = await fetch(BASE + '/api/inject', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: claim(ctrl) });
  const entry = await res.json();
  await new Promise(r => setTimeout(r, 1200));
  const fresh = (await get('/api/traffic')).find(e => e.id === entry.id);
  return (fresh?.deliveries || []).filter(d => d.status.startsWith('deliver'));
}

console.log('1. delivery routing');
let d = await deliverWith({ deliverTo: '{orgId}', organizationId: '7' }, '000000911');
ok('routes into the organization folder', d.length > 0 && d.every(x => x.fileName.startsWith('7/')),
   `got ${JSON.stringify(d.map(x => x.fileName))}`);

d = await deliverWith({ deliverTo: '{payerId}/{transaction}', organizationId: '1' }, '000000912');
ok('supports multi-level templates', d.some(x => x.fileName.startsWith('00455/835/')),
   `got ${JSON.stringify(d.map(x => x.fileName))}`);

d = await deliverWith({ deliverTo: '', organizationId: '1' }, '000000913');
ok('flat delivery when no template is set', d.length > 0 && d.every(x => !x.fileName.includes('/')),
   `got ${JSON.stringify(d.map(x => x.fileName))}`);

d = await deliverWith({ deliverTo: '../../escape', organizationId: '1' }, '000000914');
ok('a traversal in the template cannot escape the outbound directory',
   d.length > 0 && d.every(x => !x.fileName.includes('..')),
   `got ${JSON.stringify(d.map(x => x.fileName))}`);

console.log('2. directories are created on demand');
await post('/api/settings', { deliverTo: '{orgId}', organizationId: '4242' });
await fetch(BASE + '/api/inject', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: claim('000000915') });
await new Promise(r => setTimeout(r, 1200));
const delivered = await get('/api/outbound');
ok('a folder that did not exist is created and written to',
   delivered.some(f => f.file.startsWith('4242/')),
   `nothing under 4242/ in ${JSON.stringify(delivered.slice(0, 4))}`);

console.log('3. wire format matches live clearinghouse traffic');
await post('/api/settings', { deliverTo: '', organizationId: '1' });
await fetch(BASE + '/api/inject', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: claim('000000916') });
await new Promise(r => setTimeout(r, 1200));
const files = await get('/api/outbound');
const era = files.filter(f => f.file.endsWith('.ERA.835.edi') && !f.file.includes('/')).pop();
ok('remittances are named by payer id, as live files are', !!era && /^\d+\..*\.ERA\.835\.edi$/.test(era.file),
   `got ${era?.file}`);
const body = await text('/api/outbound/' + era.file);
const header = body.split('~')[0];
chk('interchange header is 105 characters', header.length, 105);
ok('element separator is a pipe', header.startsWith('ISA|'), `got ${header.slice(0, 12)}`);
chk('repetition separator is }', header.split('|')[11], '}');
chk('component separator is ^', header.split('|')[16], '^');
ok('sender identifies as the clearinghouse', header.includes('ZIRMED'), `got ${header.slice(0, 60)}`);

const acks = files.filter(f => f.file.endsWith('.999')).pop();
ok('acknowledgements use the clientId.stamp.999 shape', !!acks && /\.\d{14}\.999$/.test(acks.file), `got ${acks?.file}`);
const status = files.filter(f => f.file.endsWith('.CLP.277')).pop();
ok('claim acknowledgements use the CLP.277 shape', !!status && /\.\d{14}\.CLP\.277$/.test(status.file), `got ${status?.file}`);

await post('/api/settings', { deliverTo: '', organizationId: '1', speed: 600 });
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
