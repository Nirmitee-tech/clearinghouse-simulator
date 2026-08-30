// Test patients. A tester picks the outcomes they want, and this mints a fresh
// identity to carry them: new name, date of birth and member id every time, so
// runs never collide and nothing has to be reset between them.
//
// The identity is the whole mechanism — the member id is registered against the
// chosen scenarios, so any request carrying it gets those answers back. Pick
// several scenarios for one transaction and they play out in order across
// successive calls (first claim denied, rebill paid).

const FIRST = ['AVERY','JORDAN','CASEY','ROWAN','QUINN','HARPER','EMERSON','SAWYER','REESE','MARLOWE','ELLIS','PAYTON'];
const LAST  = ['TESTFIELD','SAMPLEMAN','TRIALWOOD','MOCKRIDGE','PROVING','FIXTURE','CHECKLEY','DRYRUN','STAGEWELL','PILOTON'];
const SEX   = ['F','M'];

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

function randomDob() {
  const year = 1955 + Math.floor(Math.random() * 55);
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Member ids avoid the endings the built-in magic-value stubs react to, so a
// generated patient only ever behaves the way its bound scenarios say.
function randomMemberId(taken) {
  for (let i = 0; i < 500; i++) {
    const id = String(100000000 + Math.floor(Math.random() * 899999999));
    const tail = id.slice(-2);
    if (tail === '99' || tail === '00') continue;
    if (!taken.has(id)) return id;
  }
  return String(Date.now()).slice(-9);
}

export function generateIdentity(existing = []) {
  const taken = new Set(existing.map(p => p.memberId));
  return {
    firstName: pick(FIRST),
    lastName: pick(LAST),
    dob: randomDob(),
    gender: pick(SEX),
    memberId: randomMemberId(taken),
    payerName: 'MERIDIAN HEALTH PLAN',
    payerId: '00455',
  };
}

/**
 * Group the chosen scenarios by the transaction they answer, so one patient can
 * carry an eligibility outcome and a claim outcome at the same time without the
 * two competing.
 */
export function bindingsFor(chosenStubs) {
  const byTxn = new Map();
  for (const stub of chosenStubs) {
    const txn = stub.match?.transaction || 'any';
    if (!byTxn.has(txn)) byTxn.set(txn, []);
    byTxn.get(txn).push(stub);
  }
  return [...byTxn.entries()].map(([transaction, list]) => ({
    transaction,
    scenarios: list.map(s => ({ id: s.id, title: s.scenario?.title || s.id })),
  }));
}
