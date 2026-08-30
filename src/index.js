// clearmock — X12 clearinghouse simulator.
// Watches a drop directory (SFTP-mounted in Docker), matches inbound X12 against
// stubs, renders Handlebars response templates carrying the request's own values,
// and writes them to the outbound directory the system under test polls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import express from 'express';
import { createEngine } from './engine/core.js';
import { createTrafficLog } from './engine/traffic.js';
import { createFileStore } from './engine/expectations.js';
import { generateIdentity, bindingsFor } from './engine/patients.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = {
  inbound:  process.env.CM_INBOUND  || path.join(ROOT, 'data/inbound'),
  outbound: process.env.CM_OUTBOUND || path.join(ROOT, 'data/outbound'),
  stubs:    process.env.CM_STUBS    || path.join(ROOT, 'stubs'),
  templates:process.env.CM_TEMPLATES|| path.join(ROOT, 'templates'),
  port:     Number(process.env.CM_PORT || 8090),
};
for (const d of [CFG.inbound, CFG.outbound]) fs.mkdirSync(d, { recursive: true });

const trafficLog = createTrafficLog(path.join(ROOT, 'data/traffic.jsonl'));
const expectations = createFileStore(path.join(ROOT, 'data/expectations.json'));
const patients = createFileStore(path.join(ROOT, 'data/patients.json'));
const engine = createEngine({
  stubsDir: CFG.stubs, templatesDir: CFG.templates,
  outboundDir: CFG.outbound, trafficLog, expectations,
});

// ---- file watcher: anything dropped into inbound is a request ----
chokidar.watch(CFG.inbound, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 400 } })
  .on('add', (fp) => {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const entry = engine.handle(raw, 'sftp', path.basename(fp));
      console.log(`[in] ${path.basename(fp)} → ${entry.transaction} · stub=${entry.matchedStub || 'NO MATCH'}`);
      fs.mkdirSync(path.join(CFG.inbound, 'processed'), { recursive: true });
      fs.renameSync(fp, path.join(CFG.inbound, 'processed', path.basename(fp)));
    } catch (e) { console.error(`[in] ${fp}: ${e.message}`); }
  });

// ---- control plane + UI ----
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['text/plain', 'application/edi-x12'], limit: '5mb' }));
app.use(express.static(path.join(ROOT, 'ui')));

app.post('/api/inject', (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : req.body.edi;
  if (!raw) return res.status(400).json({ error: 'send raw X12 as text/plain or {"edi": "..."}' });
  res.json(engine.handle(raw, 'http', req.body?.fileName || null));
});
app.get('/api/traffic', (_q, res) => res.json(trafficLog.list()));
app.get('/api/traffic/:id', (q, res) => res.json(trafficLog.get(q.params.id) || {}));
app.get('/api/stubs', (_q, res) => res.json(engine.listStubs()));
app.post('/api/stubs/reload', (_q, res) => res.json({ loaded: engine.reloadStubs() }));
app.post('/api/stubs/:id(*)/toggle', (q, res) =>
  res.json({ ok: engine.setStubEnabled(q.params.id, !!q.body?.enabled) }));
// Test patients: mint an identity and register it against the chosen scenarios.
app.get('/api/patients', (_q, res) => {
  const byMember = new Map(expectations.all().map(e => [`${e.key.value}::${e.transaction}`, e]));
  res.json(patients.all().map(p => ({
    ...p,
    bindings: p.bindings.map(b => ({
      ...b,
      hits: byMember.get(`${p.memberId}::${b.transaction}`)?.hits ?? 0,
      next: byMember.get(`${p.memberId}::${b.transaction}`)?.cursor ?? 0,
    })),
  })));
});

app.post('/api/patients', (q, res) => {
  const ids = Array.isArray(q.body?.scenarios) ? q.body.scenarios : [];
  if (!ids.length) return res.status(400).json({ error: 'pick at least one scenario' });

  const all = engine.listStubs();
  const chosen = ids.map(id => all.find(s => s.id === id)).filter(Boolean);
  if (!chosen.length) return res.status(400).json({ error: 'none of those scenarios exist' });

  const identity = generateIdentity(patients.all());
  const bindings = bindingsFor(chosen);
  const patient = patients.put({ ...identity, label: q.body.label || null, bindings });

  // One expectation per transaction: several scenarios for the same transaction
  // become an ordered run across successive calls.
  for (const b of bindings) {
    expectations.put({
      label: `${identity.firstName} ${identity.lastName}`,
      key: { field: 'memberId', value: identity.memberId },
      transaction: b.transaction === 'any' ? null : b.transaction,
      respondWith: b.scenarios.map(s => s.id),
      patientId: patient.id,
    });
  }
  res.json(patient);
});

app.delete('/api/patients/:id', (q, res) => {
  const p = patients.all().find(x => x.id === q.params.id);
  if (p) for (const e of expectations.all().filter(e => e.patientId === p.id)) expectations.remove(e.id);
  res.json({ removed: patients.remove(q.params.id) });
});

app.post('/api/patients/:id/reset', (q, res) => {
  const p = patients.all().find(x => x.id === q.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  for (const e of expectations.all().filter(e => e.patientId === p.id)) { e.hits = 0; e.cursor = 0; }
  expectations.touch();
  res.json({ ok: true });
});

// Expectations — the durable "given this identifier, answer with that scenario"
// registry the UI drives. Survives restarts; keyed by a business identifier.
app.get('/api/expectations', (_q, res) => res.json(expectations.all()));
app.post('/api/expectations', (q, res) => {
  const { id, label, keyField, keyValue, transaction, respondWith, times, enabled } = q.body || {};
  if (!id && (!keyField || keyValue === undefined || !respondWith)) {
    return res.status(400).json({ error: 'keyField, keyValue and respondWith are required' });
  }
  const rec = id ? { id } : {};
  if (label !== undefined) rec.label = label;
  if (keyField) rec.key = { field: keyField, value: String(keyValue) };
  if (transaction !== undefined) rec.transaction = transaction || null;
  if (respondWith) rec.respondWith = Array.isArray(respondWith) ? respondWith : [respondWith];
  if (times !== undefined) rec.times = times === '' || times === null ? null : Number(times);
  if (enabled !== undefined) rec.enabled = !!enabled;
  res.json(expectations.put(rec));
});
app.post('/api/expectations/:id/reset', (q, res) => {
  const r = expectations.all().find(x => x.id === q.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  r.hits = 0; r.cursor = 0; delete r.lastHitAt; expectations.touch();
  res.json(r);
});
app.delete('/api/expectations/:id', (q, res) => res.json({ removed: expectations.remove(q.params.id) }));
app.delete('/api/expectations', (_q, res) => res.json({ cleared: expectations.clear() }));

// Scenario overrides — pin the next N requests carrying a value to a chosen stub,
// the way a test sets up its expectation before exercising the system.
app.get('/api/overrides', (_q, res) => res.json(engine.listOverrides()));
app.post('/api/overrides', (q, res) => {
  const { field, value, stubId, times } = q.body || {};
  if (!field || value === undefined || !stubId) {
    return res.status(400).json({ error: 'field, value and stubId are required' });
  }
  res.json(engine.addOverride({ field, value, stubId, times }));
});
app.delete('/api/overrides', (_q, res) => res.json({ cleared: engine.clearOverrides() }));
app.post('/api/cursors/reset', (_q, res) => res.json({ reset: engine.resetCursors() }));

app.get('/api/settings', (_q, res) => res.json({ ...engine.settings, held: engine.heldCount() }));
app.post('/api/settings', (q, res) => { Object.assign(engine.settings, q.body || {}); res.json(engine.settings); });
app.post('/api/release', (_q, res) => res.json({ released: engine.releaseHeld() }));
app.get('/api/outbound', (_q, res) => res.json(
  fs.readdirSync(CFG.outbound).map(f => ({ file: f, size: fs.statSync(path.join(CFG.outbound, f)).size }))
));

app.listen(CFG.port, () => {
  console.log(`clearmock listening on http://localhost:${CFG.port}`);
  console.log(`  inbound  : ${CFG.inbound}`);
  console.log(`  outbound : ${CFG.outbound}`);
});
