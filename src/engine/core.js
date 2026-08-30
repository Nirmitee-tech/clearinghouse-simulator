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

  // Scenario overrides: "the next N requests carrying this value get THIS stub",
  // set at test-setup time instead of by editing the stub library. Lets parallel
  // tests each pin their own outcome without fighting over global stub state.
  const overrides = [];      // {id, field, value, stubId, remaining, used}
  let overrideSeq = 0;

  // Per-key cursors for stubs that answer differently on each successive call
  // (a claim that is PENDING on the first status inquiry and FINALIZED on the next).
  const cursors = new Map();

  function takeOverride(doc) {
    for (const o of overrides) {
      if (o.remaining <= 0) continue;
      if (String(doc[o.field] ?? '') !== String(o.value)) continue;
      const stub = stubs.find(s => s.id === o.stubId);
      if (!stub) continue;
      o.remaining--; o.used++;
      return { stub, why: [{ field: o.field, cond: { override: o.stubId }, value: doc[o.field], pass: true }] };
    }
    return null;
  }

  // A stub may declare `sequence:` — a list of respond-blocks cycled per key.
  function selectResponse(stub, doc) {
    if (!Array.isArray(stub.sequence) || !stub.sequence.length) {
      return { steps: Array.isArray(stub.respond) ? stub.respond : [stub.respond], position: null };
    }
    const keyField = stub.sequenceKey || 'patientControlNumber';
    const key = `${stub.id}::${doc[keyField] ?? 'default'}`;
    const i = cursors.get(key) ?? 0;
    cursors.set(key, i + 1);
    const pick = stub.sequence[Math.min(i, stub.sequence.length - 1)];
    const steps = Array.isArray(pick) ? pick : [pick];
    return { steps, position: `${Math.min(i, stub.sequence.length - 1) + 1}/${stub.sequence.length}` };
  }

  // Every component of a response filename is derived from an inbound file we do
  // not control, so each one is reduced to a safe charset before it reaches the
  // filesystem (an ISA13 of "../../x" must not escape the outbound directory).
  function safeToken(v, max = 20) {
    return String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max) || 'X';
  }

  function respFileName(txn, doc) {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const tag = { '271': 'ELG', '999': 'ACK', '277': 'STA', '835': 'ERA' }[txn] || safeToken(txn, 6);
    const ext = txn === '835' ? '835' : 'txt';
    return `${tag}_${safeToken(txn, 6)}_${ts}_${safeToken(doc.isa13)}.${ext}`;
  }

  // Defence in depth: even with sanitised tokens, never write outside outboundDir.
  function writeOutbound(fileName, content) {
    const target = path.resolve(outboundDir, fileName);
    if (!target.startsWith(path.resolve(outboundDir) + path.sep)) {
      throw new Error(`refusing to write outside outbound directory: ${fileName}`);
    }
    fs.writeFileSync(target, content);
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
    writeOutbound(fileName, content);
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
      const forced = takeOverride(doc);
      const { stub, why } = forced || matchStub(stubs, doc);
      entry.matchTrace = why;
      entry.viaOverride = !!forced;
      if (stub) {
        entry.matchedStub = stub.id;
        const { steps, position } = selectResponse(stub, doc);
        entry.sequencePosition = position;
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
    listStubs() {
      return stubs.map(s => ({
        id: s.id, enabled: s.enabled, priority: s.priority,
        description: s.description || '', match: s.match,
        respond: s.respond || null, sequence: s.sequence || null,
        sequenceKey: s.sequenceKey || null,
      }));
    },
    setStubEnabled(id, enabled) { const s = stubs.find(x => x.id === id); if (s) s.enabled = enabled; return !!s; },
    addOverride({ field, value, stubId, times }) {
      const o = { id: ++overrideSeq, field, value: String(value), stubId,
                  remaining: Number(times) > 0 ? Number(times) : 1, used: 0 };
      overrides.unshift(o);
      return o;
    },
    listOverrides: () => overrides.slice(),
    clearOverrides() { const n = overrides.length; overrides.length = 0; return n; },
    resetCursors() { const n = cursors.size; cursors.clear(); return n; },
    releaseHeld() {
      const n = held.length;
      for (const h of held.splice(0)) {
        writeOutbound(h.fileName, h.content);
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
