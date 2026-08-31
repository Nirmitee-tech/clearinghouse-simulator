// In-memory traffic log with JSONL persistence (survives restarts for demos).
import fs from 'node:fs';
export function createTrafficLog(persistPath, max = 500) {
  let seq = 0;
  const entries = [];
  if (persistPath && fs.existsSync(persistPath)) {
    for (const line of fs.readFileSync(persistPath, 'utf8').split('\n').filter(Boolean)) {
      try { const e = JSON.parse(line); entries.push(e); seq = Math.max(seq, e.id); } catch {}
    }
  }
  return {
    nextId: () => ++seq,
    add(e) {
      entries.push(e);
      if (entries.length > max) entries.shift();
      // Persistence is a convenience for demos; losing it must never fail a request.
      if (persistPath) {
        try { fs.appendFileSync(persistPath, JSON.stringify(e) + '\n'); }
        catch (err) { console.error(`[traffic] could not persist to ${persistPath}: ${err.message}`); }
      }
    },
    list: () => entries.slice().reverse(),
    get: (id) => entries.find(e => e.id === Number(id)),
  };
}
