// Minimal X12 envelope reader: enough to identify a transaction and extract
// the correlation fields stubs match on and templates echo back.
// Not a validator — real files from real systems stay parseable even when dirty.

export function parseX12(raw) {
  const text = raw.replace(/\r?\n/g, '');
  if (!text.startsWith('ISA') || text.length < 106) return null;

  // ISA is fixed-width; element separator is byte 3, segment terminator byte 105.
  const elem = text[3];
  const segTerm = text[105];
  const segments = text.split(segTerm).filter(Boolean).map(s => s.split(elem));

  const isa = segments.find(s => s[0] === 'ISA') || [];
  const gs  = segments.find(s => s[0] === 'GS') || [];
  const st  = segments.find(s => s[0] === 'ST') || [];

  const doc = {
    raw: text,
    elem,
    segTerm,
    segments,
    transaction: st[1] || null,          // 270, 837, 276, ...
    isa06: (isa[6] || '').trim(),        // sender id
    isa08: (isa[8] || '').trim(),        // receiver id
    isa09: isa[9] || '',                 // date
    isa13: isa[13] || '',                // interchange control number
    gs02: gs[2] || '',
    gs03: gs[3] || '',
    gs06: gs[6] || '',                   // group control number
    st02: st[2] || '',                   // transaction set control number
  };

  // Per-transaction correlation fields.
  if (doc.transaction === '270') Object.assign(doc, extract270(segments));
  if (doc.transaction === '837') Object.assign(doc, extract837(segments));
  if (doc.transaction === '276') Object.assign(doc, extract276(segments));
  if (doc.transaction === '278') Object.assign(doc, extract278(segments));
  return doc;
}

function seg(segments, id) { return segments.filter(s => s[0] === id); }

function extract270(segments) {
  const out = {};
  const trn = seg(segments, 'TRN')[0];
  if (trn) out.traceNumber = trn[2] || '';
  // Subscriber loop: NM1*IL*1*LAST*FIRST****MI*MEMBERID
  const il = seg(segments, 'NM1').find(s => s[1] === 'IL');
  if (il) {
    out.subscriberLast = il[3] || '';
    out.subscriberFirst = il[4] || '';
    out.memberId = il[9] || '';
  }
  const pr = seg(segments, 'NM1').find(s => s[1] === 'PR');
  if (pr) { out.payerName = pr[3] || ''; out.payerId = pr[9] || ''; }
  const p1 = seg(segments, 'NM1').find(s => s[1] === '1P');
  if (p1) { out.providerLast = p1[3] || ''; out.providerNpi = p1[9] || ''; }
  const dmg = seg(segments, 'DMG')[0];
  if (dmg) { out.subscriberDob = dmg[2] || ''; out.subscriberGender = dmg[3] || ''; }
  const dtp = seg(segments, 'DTP').find(s => s[1] === '291');
  if (dtp) out.serviceDate = dtp[3] || '';
  return out;
}

function extract837(segments) {
  const out = { serviceLines: [] };
  const clm = seg(segments, 'CLM')[0];
  if (clm) { out.patientControlNumber = clm[1] || ''; out.chargeAmount = clm[2] || ''; }
  const il = seg(segments, 'NM1').find(s => s[1] === 'IL');
  if (il) {
    out.subscriberLast = il[3] || '';
    out.subscriberFirst = il[4] || '';
    out.memberId = il[9] || '';
  }
  const pr = seg(segments, 'NM1').find(s => s[1] === 'PR');
  if (pr) { out.payerName = pr[3] || ''; out.payerId = pr[9] || ''; }
  const r82 = seg(segments, 'NM1').find(s => s[1] === '82');
  if (r82) { out.renderingLast = r82[3] || ''; out.renderingNpi = r82[9] || ''; }
  const b85 = seg(segments, 'NM1').find(s => s[1] === '85');
  if (b85) { out.billingName = b85[3] || ''; out.billingNpi = b85[9] || ''; }
  for (const sv1 of seg(segments, 'SV1')) {
    const proc = (sv1[1] || '').split(':');
    out.serviceLines.push({ cpt: proc[1] || proc[0] || '', charge: sv1[2] || '', units: sv1[4] || '1' });
  }
  const dtpSvc = seg(segments, 'DTP').find(s => s[1] === '472');
  if (dtpSvc) out.serviceDate = dtpSvc[3] || '';
  const refTj = seg(segments, 'REF').find(s => s[1] === 'TJ' || s[1] === 'EI');
  if (refTj) out.billingTaxId = refTj[2] || '';
  return out;
}

// The subscriber loop identifies the member on every transaction that carries
// one — without it a request cannot be matched to a registered test patient.
function subscriber(segments, out) {
  const il = seg(segments, 'NM1').find(s => s[1] === 'IL');
  if (il) {
    out.subscriberLast = il[3] || '';
    out.subscriberFirst = il[4] || '';
    out.memberId = il[9] || '';
  }
  const dmg = seg(segments, 'DMG')[0];
  if (dmg) { out.subscriberDob = dmg[2] || ''; out.subscriberGender = dmg[3] || ''; }
  return out;
}

function extract276(segments) {
  const out = {};
  const trn = seg(segments, 'TRN')[0];
  if (trn) out.traceNumber = trn[2] || '';
  const clm = seg(segments, 'REF').find(s => s[1] === 'EJ');   // patient control number
  if (clm) out.patientControlNumber = clm[2] || '';
  const pr = seg(segments, 'NM1').find(s => s[1] === 'PR');
  if (pr) { out.payerName = pr[3] || ''; out.payerId = pr[9] || ''; }
  const b41 = seg(segments, 'NM1').find(s => s[1] === '41');
  if (b41) { out.billingName = b41[3] || ''; out.billingNpi = b41[9] || ''; }
  return subscriber(segments, out);
}

function extract278(segments) {
  const out = {};
  const bht = seg(segments, 'BHT')[0];
  if (bht) out.traceNumber = bht[3] || '';
  const x3 = seg(segments, 'NM1').find(s => s[1] === 'X3');   // utilization management org
  if (x3) { out.payerName = x3[3] || ''; out.payerId = x3[9] || ''; }
  const p1 = seg(segments, 'NM1').find(s => s[1] === '1P');
  if (p1) { out.providerLast = p1[3] || ''; out.providerNpi = p1[9] || ''; }
  const um = seg(segments, 'UM')[0];
  if (um) { out.requestCategory = um[1] || ''; out.serviceType = um[3] || ''; }
  const dtp = seg(segments, 'DTP').find(s => s[1] === '472');
  if (dtp) out.serviceDate = dtp[3] || '';
  return subscriber(segments, out);
}
