// Handlebars rendering with X12-aware helpers. The whole point of the mock:
// responses carry the REQUEST's own correlation values (trace numbers, control
// numbers, member ids, charges), so the system under test matches them exactly
// as it would real clearinghouse traffic.
import Handlebars from 'handlebars';
import fs from 'node:fs';
import path from 'node:path';

let responseControlNumber = Date.now() % 1_000_000_000;

export function makeRenderer(templatesDir, profileIn) {
  let profile = profileIn;
  const hb = Handlebars.create();

  hb.registerHelper('pad', (v, len) => String(v ?? '').padStart(Number(len), '0'));
  hb.registerHelper('padRight', (v, len) => String(v ?? '').padEnd(Number(len), ' '));
  hb.registerHelper('now', (fmt) => stamp(new Date(), typeof fmt === 'string' ? fmt : 'YYYYMMDD'));
  hb.registerHelper('controlNumber', () => String(++responseControlNumber).padStart(9, '0'));
  hb.registerHelper('minus', (a, b) => money(Number(a) - Number(b)));
  hb.registerHelper('times', (a, b) => money(Number(a) * Number(b)));
  hb.registerHelper('money', (a) => money(Number(a)));
  hb.registerHelper('upper', (v) => String(v ?? '').toUpperCase());
  hb.registerHelper('default', (v, d) => (v == null || v === '' ? d : v));

  const cache = new Map();
  function template(name) {
    if (!cache.has(name)) {
      const p = path.join(templatesDir, name);
      cache.set(name, hb.compile(fs.readFileSync(p, 'utf8'), { noEscape: true }));
    }
    return cache.get(name);
  }

  // A scenario's own values may themselves reference the request ("pay the
  // charge that was billed"), so they are rendered against the request before
  // the response template sees them.
  function resolveValues(extra, doc) {
    const out = {};
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'string' && v.includes('{{')) out[k] = hb.compile(v, { noEscape: true })(doc);
      else if (Array.isArray(v)) out[k] = v.map(x =>
        typeof x === 'string' && x.includes('{{') ? hb.compile(x, { noEscape: true })(doc) : x);
      else out[k] = v;
    }
    return out;
  }

  return {
    render(templateName, doc, extra = {}) {
      const ctx = {
        // Responses come FROM the clearinghouse TO whoever sent the request.
        mockSender: profile?.sender ?? 'CLEARMOCK',
        mockReceiver: doc.isa06 || profile?.clientId || 'SUBMITTER',
        ...doc,
        ...resolveValues(extra, doc),
        respControl: String(++responseControlNumber).padStart(9, '0'),
      };
      // Templates are authored with one segment per line for reviewability;
      // wire format collapses to segment terminator + no newlines.
      const out = template(templateName)(ctx);
      if (templateName.endsWith('report.hbs')) return out;   // XML keeps its shape
      return out.split('\n').map(l => l.trim()).filter(Boolean).join('');
    },
    clearCache() { cache.clear(); },
    setProfile(p) { profile = p; },
  };
}

function money(n) { return (Math.round(n * 100) / 100).toFixed(2); }

function stamp(d, fmt) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  // HHMM first: 'MM' would otherwise consume the 'MM' inside 'HHMM'.
  return fmt
    .replace('HHMM', p(d.getHours()) + p(d.getMinutes()))
    .replace('YYYY', d.getFullYear())
    .replace('YY', String(d.getFullYear()).slice(2))
    .replace('MM', p(d.getMonth() + 1))
    .replace('DD', p(d.getDate()));
}
