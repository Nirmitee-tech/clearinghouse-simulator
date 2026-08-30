// Wire-format profile. Real Waystar traffic does not look like textbook X12:
// the element separator is "|", repetition "}", components "^", the sender is
// ZIRMED (the company Waystar was built from), and every response type has its
// own filename shape. Templates are authored in the conventional "*" / ":" form
// and converted here, so a scenario never has to care about the profile.
export const WAYSTAR = {
  name: 'waystar',
  element: '|',
  component: '^',
  repetition: '}',
  segment: '~',
  sender: 'ZIRMED',
  clientId: '314906',
  // {clientId}.{stamp}.{seq}.ELG.271.edi and friends, observed from live traffic.
  fileName({ transaction, clientId, payerId, stamp, seq }) {
    switch (transaction) {
      case '271': return `${clientId}.${stamp}.${seq}.ELG.271.edi`;
      case '277': return `${clientId}.${stamp}.CLP.277`;
      case '999': return `${clientId}.${stamp}.999`;
      case '835': return `${payerId || '00000'}.${stamp}.${seq}.ERA.835.edi`;
      case 'TA1': return `${clientId}.${stamp}.TA1`;
      case '278': return `${clientId}.${stamp}.${seq}.AUT.278.edi`;
      case 'XML': return `Prof_${clientId}_${stamp.slice(4, 8)}${stamp.slice(0, 4)}.xml`;
      default:    return `${clientId}.${stamp}.${transaction}`;
    }
  },
};

export const PLAIN = {
  name: 'plain', element: '*', component: ':', repetition: '^', segment: '~',
  sender: 'CLEARMOCK', clientId: 'SUBMITTER',
  fileName: ({ transaction, stamp, seq }) => `${transaction}_${stamp}_${seq}.txt`,
};

export const PROFILES = { waystar: WAYSTAR, plain: PLAIN };

/**
 * Re-delimit a rendered transaction. Authored with "*" between elements and ":"
 * inside composites; ISA is fixed-width so its repetition and component
 * positions are set explicitly rather than by substitution.
 */
export function applyDelimiters(edi, p) {
  if (p.element === '*' && p.component === ':' && p.repetition === '^') return edi;
  const segments = edi.split('~').filter(s => s.length);
  return segments.map(seg => {
    const els = seg.split('*').map(e => e.split(':').join(p.component));
    if (els[0] === 'ISA') {
      els[11] = p.repetition;                 // ISA11 repetition separator
      els[16] = p.component;                  // ISA16 component separator
    }
    return els.join(p.element);
  }).join(p.segment) + p.segment;
}
