#!/usr/bin/env node
// Extendible scenario authoring (CLI). Thin wrapper over the shared builder the UI
// also uses, so the two can never drift.
//
// Usage:
//   node tools/add-code.mjs carc CO-253 "Sequestration - reduction in federal payment"
//   node tools/add-code.mjs stc  A7-500 "Entity's Postal/Zip code"
//   node tools/add-code.mjs aaa  72     "Invalid/Missing Subscriber/Insured ID"
//   node tools/add-code.mjs rarc N381   "Alert: consult our contractual agreement"

import path from 'path';
import { fileURLToPath } from 'url';
import { buildScenario, writeScenario } from '../src/engine/scenario-builder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , type, code, ...descParts] = process.argv;

if (!type || !code) {
  console.error(`add-code — add a scenario for a missing X12 code.

  node tools/add-code.mjs <type> <code> "<description>"

  <type>  carc | stc | aaa | rarc
  <code>  CARC: GROUP-REASON (CO-45, PR-3)   STC: CATEGORY-STATUS (A7-255)
          AAA : reason number (72)           RARC: remark code (N381)
`);
  process.exit(1);
}

try {
  const built = buildScenario({ type, code, description: descParts.join(' ') }, path.join(ROOT, 'stubs'));
  const id = writeScenario(built);
  console.log(`wrote stubs/${id}.yaml`);
  console.log('reload the running engine:  curl -s -X POST localhost:8090/api/stubs/reload');
} catch (e) {
  console.error(e.message || String(e));
  process.exit(1);
}
