// Expectations: "when a request arrives carrying THIS identifier, answer with
// THAT scenario." Registered ahead of the test run (from the UI or the API),
// keyed by a business identifier the tester already knows — a member id, a
// patient control number, a payer id — and looked up on every inbound request.
//
// Persisted so they survive a restart and can be shared by a whole team or a CI
// job. The store is deliberately a tiny interface (all(), put(), remove()) so a
// file on a Docker volume can be swapped for MongoDB without touching callers.
import fs from 'node:fs';
import path from 'node:path';

export function createFileStore(filePath) {
  let records = [];
  let seq = 0;

  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      records = Array.isArray(parsed.records) ? parsed.records : [];
      seq = Number(parsed.seq) || records.length;
    } catch (e) {
      console.error(`[expectations] could not read ${filePath}: ${e.message}`);
    }
  }

  function flush() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ seq, records }, null, 2));
    } catch (err) {
      // Records stay in memory; only their survival across a restart is lost.
      console.error(`[expectations] could not persist to ${filePath}: ${err.message}`);
    }
  }

  return {
    all: () => records,
    put(rec) {
      if (rec.id) {
        const i = records.findIndex(r => r.id === rec.id);
        if (i >= 0) { records[i] = { ...records[i], ...rec }; flush(); return records[i]; }
      }
      const created = {
        id: `exp_${++seq}`,
        createdAt: new Date().toISOString(),
        enabled: true,
        hits: 0,
        cursor: 0,
        times: null,
        ...rec,
      };
      records.unshift(created);
      flush();
      return created;
    },
    remove(id) {
      const before = records.length;
      records = records.filter(r => r.id !== id);
      if (records.length !== before) flush();
      return before - records.length;
    },
    clear() { const n = records.length; records = []; flush(); return n; },
    touch() { flush(); },
  };
}

/**
 * Find the expectation that claims this request, and advance its cursor.
 * Returns { record, stubId } or null.
 *
 * `respondWith` holds one stub id or several: several are cycled per hit, so a
 * single expectation can say "pending on the first call, finalized on the next"
 * without touching the stub library.
 */
export function claimRequest(store, doc) {
  for (const r of store.all()) {
    if (!r.enabled) continue;
    if (r.times != null && r.hits >= r.times) continue;
    if (!r.key?.field) continue;
    if (String(doc[r.key.field] ?? '') !== String(r.key.value)) continue;
    if (r.transaction && String(r.transaction) !== String(doc.transaction)) continue;

    const list = Array.isArray(r.respondWith) ? r.respondWith : [r.respondWith];
    if (!list.length) continue;
    const stubId = list[Math.min(r.cursor ?? 0, list.length - 1)];

    r.hits = (r.hits ?? 0) + 1;
    r.cursor = Math.min((r.cursor ?? 0) + 1, list.length - 1 + 1);
    r.lastHitAt = new Date().toISOString();
    store.touch();
    return { record: r, stubId };
  }
  return null;
}
