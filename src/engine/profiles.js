// Profiles: named bundles of scenarios you apply in one go, so a whole test
// setup ("all denials", "full happy-path cycle", "eligibility edge cases") is
// one click instead of picking scenarios one by one.
//
// A profile is a YAML file in profiles/:
//   name: Denial testing
//   description: Every denial / rejection path
//   scenarios:
//     - claimack/22-patient-id-not-found     # exact stub id
//     - remit/06-*                           # glob against stub ids
//     - group: Remittance (835)              # or every stub in a group
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// Turn a glob like "remit/06-*" into a RegExp anchored to the whole id.
function globToRe(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

// Resolve a profile's scenario selectors against the loaded stubs → ordered, de-duped id list.
export function resolveProfile(profile, stubs) {
  const withScenario = stubs.filter(s => s.scenario);
  const ids = [];
  const add = id => { if (id && !ids.includes(id)) ids.push(id); };
  for (const sel of profile.scenarios || []) {
    if (typeof sel === 'string') {
      if (sel.includes('*') || sel.includes('?')) {
        const re = globToRe(sel);
        withScenario.filter(s => re.test(s.id)).forEach(s => add(s.id));
      } else {
        add(withScenario.find(s => s.id === sel)?.id);
      }
    } else if (sel && sel.group) {
      withScenario.filter(s => (s.scenario.group || '') === sel.group).forEach(s => add(s.id));
    }
  }
  return ids;
}

export function createProfileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });

  function load() {
    const out = [];
    for (const f of fs.readdirSync(dir).filter(x => /\.ya?ml$/.test(x))) {
      try {
        // lazy import to avoid a hard dep at module load
        const doc = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (doc && doc.name && Array.isArray(doc.scenarios)) {
          doc.id = f.replace(/\.ya?ml$/, '');
          out.push(doc);
        }
      } catch (e) { /* skip malformed profile */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const slugify = s => String(s).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '');

  return {
    all: load,
    get: id => load().find(p => p.id === id),
    // Save a custom profile from the UI. Path-confined; refuses a bad name.
    save({ name, description, scenarios }) {
      name = String(name || '').trim();
      if (!name) throw { code: 'bad_name', message: 'profile name is required' };
      if (!Array.isArray(scenarios) || !scenarios.length) throw { code: 'bad_scenarios', message: 'pick at least one scenario' };
      const slug = slugify(name);
      if (!slug) throw { code: 'bad_name', message: 'name has no usable characters' };
      const file = path.resolve(dir, `${slug}.yaml`);
      if (!file.startsWith(path.resolve(dir) + path.sep)) throw { code: 'bad_name', message: 'invalid name' };
      fs.writeFileSync(file, yaml.dump({
        name,
        description: String(description || '').replace(/[\r\n]+/g, ' ').trim(),
        scenarios: scenarios.map(String),
      }));
      return slug;
    },
  };
}
