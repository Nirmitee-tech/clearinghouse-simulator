// The engine: file arrives (SFTP drop dir or HTTP inject) → parse → match stub
// → schedule the response flow → write response files to the outbound dir.
import fs from 'node:fs';
import path from 'node:path';
import { parseX12 } from './x12.js';
import { claimRequest } from './expectations.js';
import { loadStubs, matchStub } from './stubs.js';
import { makeRenderer } from './render.js';
import { PROFILES, WAYSTAR, applyDelimiters } from './profile.js';

const DELAY_RE = /^(\d+)(ms|s|m|h)?$/;
function parseDelay(v, speed) {
  if (v == null) return 0;
  const m = DELAY_RE.exec(String(v));
  if (!m) return 0;
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] || 's'];
  return (Number(m[1]) * mult) / (speed || 1);
}

export function createEngine({ stubsDir, templatesDir, outboundDir, trafficLog, expectations }) {
  let stubs = loadStubs(stubsDir);
  let profile = WAYSTAR;
  const renderer = makeRenderer(templatesDir, profile);
  // Applications rarely poll one flat directory. Most partition the drop folder —
  // by organization, by payer, by transaction — so the delivery path is a template
  // and every directory in it is created on demand.
  const settings = {
    speed: 600, outage: false, hold: false, profile: profile.name,
    deliverTo: process.env.CM_DELIVER_TO ?? '',
    organizationId: process.env.CM_ORG_ID ?? '1',
  };
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

  let fileSeq = 0;
  function respFileName(txn, doc) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return profile.fileName({
      transaction: txn,
      clientId: safeToken(doc.isa06 || profile.clientId, 12),
      payerId: safeToken(doc.payerId || '00000', 8),
      stamp,
      seq: String(++fileSeq).padStart(6, '0'),
    });
  }

  // Resolve the delivery sub-path for one response. Tokens are substituted from
  // the request, so "{orgId}" or "{payerId}/{transaction}" both work.
  function deliveryDir(txn, doc) {
    const template = settings.deliverTo || '';
    if (!template) return outboundDir;
    const sub = template
      .replace(/\{orgId\}/g, safeToken(settings.organizationId, 20))
      .replace(/\{payerId\}/g, safeToken(doc.payerId || 'unknown', 20))
      .replace(/\{transaction\}/g, safeToken(txn, 6))
      .replace(/\{clientId\}/g, safeToken(doc.isa06 || profile.clientId, 20))
      .split('/').filter(Boolean).map(seg => safeToken(seg, 40)).join(path.sep);
    return path.join(outboundDir, sub);
  }

  // Defence in depth: even with sanitised tokens, never write outside outboundDir.
  function writeOutbound(fileName, content, dir = outboundDir) {
    const target = path.resolve(dir, fileName);
    if (!target.startsWith(path.resolve(outboundDir) + path.sep)) {
      throw new Error(`refusing to write outside outbound directory: ${fileName}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  function deliver(txn, content, fileName, entry, doc) {
    if (settings.outage) {
      entry.deliveries.push({ txn, fileName, status: 'dropped (outage mode)', at: new Date().toISOString() });
      return;
    }
    if (settings.hold) {
      held.push({ txn, content, fileName, entry, dir: deliveryDir(txn, doc || {}) });
      entry.deliveries.push({ txn, fileName, status: 'held (manual release)', at: new Date().toISOString() });
      return;
    }
    const dir = deliveryDir(txn, doc || {});
    writeOutbound(fileName, content, dir);
    const shown = path.relative(outboundDir, path.join(dir, fileName));
    entry.deliveries.push({ txn, fileName: shown, status: 'delivered', at: new Date().toISOString() });
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
      // Precedence: a registered expectation (keyed by business identifier) wins,
      // then a transient pin, then the stub library's own matching rules.
      let expected = null;
      if (expectations) {
        const claimed = claimRequest(expectations, doc);
        if (claimed) {
          const stub = stubs.find(x => x.id === claimed.stubId);
          if (stub) {
            expected = {
              stub,
              why: [{ field: claimed.record.key.field, cond: { expectation: claimed.record.id, label: claimed.record.label || '' },
                      value: doc[claimed.record.key.field], pass: true }],
            };
            entry.expectationId = claimed.record.id;
            entry.expectationLabel = claimed.record.label || null;
          } else {
            entry.deliveries.push({ txn: '-', status: `expectation ${claimed.record.id} names unknown stub "${claimed.stubId}"`, at: new Date().toISOString() });
          }
        }
      }
      const forced = expected || takeOverride(doc);
      const { stub, why } = forced || matchStub(stubs, doc);
      entry.matchTrace = why;
      entry.viaExpectation = !!expected;
      entry.viaOverride = !!forced && !expected;
      if (stub) {
        entry.matchedStub = stub.id;
        const { steps, position } = selectResponse(stub, doc);
        entry.sequencePosition = position;
        for (const step of steps) {
          const delayMs = parseDelay(step.delay, settings.speed);
          const t = setTimeout(() => {
            timers.delete(t);
            try {
              const rendered = renderer.render(step.template, doc, step.values || {});
              // Not every response a clearinghouse sends is X12: portal reports
              // arrive as XML and must not be run through the delimiter pass.
              const content = step.transaction === 'XML' ? rendered : applyDelimiters(rendered, profile);
              deliver(step.transaction, content, respFileName(step.transaction, doc), entry, doc);
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
    setProfile(name) {
      if (!PROFILES[name]) return false;
      profile = PROFILES[name];
      settings.profile = profile.name;
      renderer.setProfile(profile);
      return true;
    },
    profileName: () => profile.name,
    // Render every response a scenario would send, against a representative
    // request, purely for display.
    preview(id) {
      const stub = stubs.find(s => s.id === id);
      if (!stub) return null;
      const sample = {
        isa06: 'SUBMITTER', isa08: 'CLEARMOCK', isa13: '000000123', isa09: '260830',
        gs02: 'SUBMITTER', gs03: 'CLEARMOCK', gs06: '1', st02: '0001',
        transaction: stub.match?.transaction || '837',
        traceNumber: 'TM1001', patientControlNumber: 'PCN1001',
        memberId: '881234561', subscriberFirst: 'AVERY', subscriberLast: 'TESTFIELD',
        subscriberDob: '19880314', subscriberGender: 'F',
        payerName: 'MERIDIAN HEALTH PLAN', payerId: '00455',
        providerLast: 'EXAMPLE BEHAVIORAL HEALTH', providerNpi: '1093817465',
        billingName: 'EXAMPLE BEHAVIORAL HEALTH', billingNpi: '9990000001',
        billingTaxId: '840000000', chargeAmount: '200.00', cpt: '90837',
        serviceDate: '20260830',
      };
      const runs = Array.isArray(stub.sequence)
        ? stub.sequence.map((alt, i) => ({ call: i + 1, steps: Array.isArray(alt) ? alt : [alt] }))
        : [{ call: null, steps: Array.isArray(stub.respond) ? stub.respond : [stub.respond] }];
      return {
        id: stub.id,
        runs: runs.map(run => ({
          call: run.call,
          responses: run.steps.map(step => {
            try {
              return { transaction: step.transaction, delay: step.delay || '0s',
                       fileName: respFileName(step.transaction, sample),
                       edi: step.transaction === 'XML'
                         ? renderer.render(step.template, sample, step.values || {})
                         : applyDelimiters(renderer.render(step.template, sample, step.values || {}), profile) };
            } catch (e) {
              return { transaction: step.transaction, delay: step.delay || '0s', error: e.message };
            }
          }),
        })),
      };
    },
    listStubs() {
      return stubs.map(s => ({
        id: s.id, enabled: s.enabled, priority: s.priority,
        description: s.description || '', match: s.match,
        respond: s.respond || null, sequence: s.sequence || null,
        sequenceKey: s.sequenceKey || null, scenario: s.scenario || null,
        transaction: s.match?.transaction || null,
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
        writeOutbound(h.fileName, h.content, h.dir || outboundDir);
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
