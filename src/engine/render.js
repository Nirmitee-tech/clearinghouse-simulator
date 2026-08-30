// Handlebars rendering with X12-aware helpers. The whole point of the mock:
// responses carry the REQUEST's own correlation values (trace numbers, control
// numbers, member ids, charges), so the system under test matches them exactly
// as it would real clearinghouse traffic.
import Handlebars from 'handlebars';
import fs from 'node:fs';
import path from 'node:path';

let responseControlNumber = Date.now() % 1_000_000_000;

export function makeRenderer(templatesDir) {
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

  return {
    render(templateName, doc, extra = {}) {
      const ctx = { ...doc, ...extra, respControl: String(++responseControlNumber).padStart(9, '0') };
      // Templates are authored with one segment per line for reviewability;
      // wire format collapses to segment terminator + no newlines.
      const out = template(templateName)(ctx);
      return out.split('\n').map(l => l.trim()).filter(Boolean).join('');
    },
    clearCache() { cache.clear(); },
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
