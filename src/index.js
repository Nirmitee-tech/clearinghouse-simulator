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
const engine = createEngine({
  stubsDir: CFG.stubs, templatesDir: CFG.templates,
  outboundDir: CFG.outbound, trafficLog,
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
