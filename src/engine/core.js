// The engine: file arrives (SFTP drop dir or HTTP inject) → parse → match stub
// → schedule the response flow → write response files to the outbound dir.
import fs from 'node:fs';
import path from 'node:path';
import { parseX12 } from './x12.js';
import { loadStubs, matchStub } from './stubs.js';
import { makeRenderer } from './render.js';

const DELAY_RE = /^(\d+)(ms|s|m|h)?$/;
function parseDelay(v, speed) {
  if (v == null) return 0;
  const m = DELAY_RE.exec(String(v));
  if (!m) return 0;
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] || 's'];
  return (Number(m[1]) * mult) / (speed || 1);
}

export function createEngine({ stubsDir, templatesDir, outboundDir, trafficLog }) {
  let stubs = loadStubs(stubsDir);
  const renderer = makeRenderer(templatesDir);
  const settings = { speed: 1, outage: false, hold: false };
  const held = [];   // responses waiting for manual release when settings.hold
  const timers = new Set();

  function respFileName(txn, doc) {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const tag = { '271': 'ELG', '999': 'ACK', '277': 'STA', '835': 'ERA' }[txn] || txn;
    return `${tag}_${txn}_${ts}_${doc.isa13 || 'X'}.${txn === '835' ? '835' : 'txt'}`;
  }

  function deliver(txn, content, fileName, entry) {
    if (settings.outage) {
      entry.deliveries.push({ txn, fileName, status: 'dropped (outage mode)', at: new Date().toISOString() });
      return;
    }
    if (settings.hold) {
      held.push({ txn, content, fileName, entry });
      entry.deliveries.push({ txn, fileName, status: 'held (manual release)', at: new Date().toISOString() });
      return;
    }
    fs.writeFileSync(path.join(outboundDir, fileName), content);
    entry.deliveries.push({ txn, fileName, status: 'delivered', at: new Date().toISOString() });
  }

  function handle(raw, source, name = null) {
    const doc = parseX12(raw);
    const entry = {
      id: trafficLog.nextId(),
      at: new Date().toISOString(),
      source,
      fileName: name,
      transaction: doc?.transaction || 'unparseable',
      summary: doc ? summarize(doc) : null,
      raw,
      matchedStub: null,
      matchTrace: [],
      deliveries: [],
    };

    if (doc) {
      const { stub, why } = matchStub(stubs, doc);
      entry.matchTrace = why;
      if (stub) {
        entry.matchedStub = stub.id;
        const steps = Array.isArray(stub.respond) ? stub.respond : [stub.respond];
        for (const step of steps) {
          const delayMs = parseDelay(step.delay, settings.speed);
          const t = setTimeout(() => {
            timers.delete(t);
            try {
              const content = renderer.render(step.template, doc, step.values || {});
              deliver(step.transaction, content, respFileName(step.transaction, doc), entry);
            } catch (e) {
              entry.deliveries.push({ txn: step.transaction, status: `render error: ${e.message}`, at: new Date().toISOString() });
            }
          }, delayMs);
          timers.add(t);
          entry.deliveries.push({ txn: step.transaction, status: `scheduled +${step.delay || '0s'}`, at: new Date().toISOString() });
        }
      }
    }
    trafficLog.add(entry);
    return entry;
  }

  return {
    handle,
    settings,
    reloadStubs() { stubs = loadStubs(stubsDir); renderer.clearCache(); return stubs.length; },
    listStubs() { return stubs.map(s => ({ id: s.id, enabled: s.enabled, priority: s.priority, description: s.description || '', match: s.match, respond: s.respond })); },
    setStubEnabled(id, enabled) { const s = stubs.find(x => x.id === id); if (s) s.enabled = enabled; return !!s; },
    releaseHeld() {
      const n = held.length;
      for (const h of held.splice(0)) {
        fs.writeFileSync(path.join(outboundDir, h.fileName), h.content);
        h.entry.deliveries.push({ txn: h.txn, fileName: h.fileName, status: 'delivered (released)', at: new Date().toISOString() });
      }
      return n;
    },
    heldCount: () => held.length,
  };
}

function summarize(doc) {
  switch (doc.transaction) {
    case '270': return `Eligibility inquiry — member ${doc.memberId || '?'} (${doc.subscriberFirst || ''} ${doc.subscriberLast || ''}) → ${doc.payerName || doc.payerId || 'payer ?'} · trace ${doc.traceNumber || '—'}`;
    case '837': return `Claim ${doc.patientControlNumber || '?'} — $${doc.chargeAmount || '?'} · member ${doc.memberId || '?'} · ${doc.serviceLines?.length || 0} line(s) → ${doc.payerName || 'payer ?'}`;
    case '276': return `Claim status inquiry — PCN ${doc.patientControlNumber || '?'} · trace ${doc.traceNumber || '—'}`;
    default: return `${doc.transaction} transaction`;
  }
}
