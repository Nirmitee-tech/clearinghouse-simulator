// Stub loader + matcher. Stubs are YAML files: a `match` block (field conditions
// against the parsed request) and a `respond` block (one response or a flow of
// several, each a Handlebars template rendered with the request's own values).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export function loadStubs(stubsDir) {
  const stubs = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.ya?ml$/.test(f.name)) {
        try {
          const doc = yaml.load(fs.readFileSync(p, 'utf8'));
          if (doc && doc.match && doc.respond) {
            doc.id = path.relative(stubsDir, p).replace(/\.ya?ml$/, '');
            doc.enabled = doc.enabled !== false;
            doc.priority = doc.priority ?? 100;
            stubs.push(doc);
          }
        } catch (e) {
          console.error(`[stubs] failed to load ${p}: ${e.message}`);
        }
      }
    }
  };
  walk(stubsDir);
  // Lower priority number wins; specific stubs should set priority < 100.
  stubs.sort((a, b) => a.priority - b.priority);
  console.log(`[stubs] loaded ${stubs.length} stub(s)`);
  return stubs;
}

// Condition forms: literal equality, {endsWith}, {startsWith}, {contains},
// {regex}, {oneOf: []}, {gt}/{lt} (numeric). Fields not present in `match`
// are unconstrained. All present conditions must pass.
function condPass(cond, value) {
  const v = value == null ? '' : String(value);
  if (cond == null) return true;
  if (typeof cond !== 'object') return v === String(cond) || Number(v) === Number(cond);
  if ('endsWith' in cond) return v.endsWith(String(cond.endsWith));
  if ('startsWith' in cond) return v.startsWith(String(cond.startsWith));
  if ('contains' in cond) return v.includes(String(cond.contains));
  if ('regex' in cond) return new RegExp(cond.regex).test(v);
  if ('oneOf' in cond) return cond.oneOf.map(String).includes(v);
  if ('gt' in cond) return Number(v) > Number(cond.gt);
  if ('lt' in cond) return Number(v) < Number(cond.lt);
  return false;
}

export function matchStub(stubs, doc) {
  for (const stub of stubs) {
    if (!stub.enabled) continue;
    const m = stub.match;
    let ok = true;
    const why = [];
    for (const [field, cond] of Object.entries(m)) {
      const pass = condPass(cond, doc[field]);
      why.push({ field, cond, value: doc[field] ?? null, pass });
      if (!pass) { ok = false; break; }
    }
    if (ok) return { stub, why };
  }
  return { stub: null, why: [] };
}
