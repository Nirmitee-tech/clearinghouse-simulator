// X12 code catalogue — descriptions for CARC (adjustment reasons), RARC (remark
// codes), CSCC/STC (claim status), and 271 AAA (eligibility reject) codes.
//
// This is a LOOKUP, not a scenario set: it lets the add-code flow auto-fill a
// description for any known code, so every code is addable without pre-generating
// hundreds of scenarios that would bury the ones actually in use. The scenario
// list stays lean; the catalogue makes coverage extendable on demand.
//
// Not exhaustive of all ~400 X12 codes — it carries the common set plus every
// code seen in the corpus. Unknown codes still work; the description is just blank.

export const CARC = {
  '1': 'Deductible amount', '2': 'Coinsurance amount', '3': 'Co-payment amount',
  '4': 'Procedure code inconsistent with the modifier, or a required modifier is missing',
  '5': 'Procedure code/bill type inconsistent with the place of service',
  '6': 'Procedure/revenue code inconsistent with the patient’s age',
  '7': 'Procedure/revenue code inconsistent with the patient’s gender',
  '8': 'Procedure code inconsistent with the provider type/specialty',
  '9': 'Diagnosis inconsistent with the patient’s age', '10': 'Diagnosis inconsistent with the patient’s gender',
  '11': 'Diagnosis inconsistent with the procedure', '12': 'Diagnosis inconsistent with the provider type',
  '13': 'Date of death precedes the date of service', '14': 'Date of birth follows the date of service',
  '15': 'Authorization number missing/invalid', '16': 'Claim/service lacks information needed for adjudication',
  '18': 'Exact duplicate claim/service', '19': 'Work-related injury — liability of the WC carrier',
  '20': 'Injury covered by the liability carrier', '22': 'Care may be covered by another payer (COB)',
  '23': 'Impact of prior payer(s) adjudication', '24': 'Charges covered under a capitation agreement',
  '26': 'Expenses incurred prior to coverage', '27': 'Expenses incurred after coverage terminated',
  '29': 'Time limit for filing has expired', '31': 'Patient cannot be identified as our insured',
  '35': 'Lifetime benefit maximum has been reached', '39': 'Services denied at the time authorization was requested',
  '40': 'Charges do not meet qualifications for emergent/urgent care', '44': 'Prompt-pay discount',
  '45': 'Charge exceeds fee schedule/maximum allowable', '49': 'Non-covered — routine/preventive exam or screening',
  '50': 'Non-covered — not deemed a medical necessity by the payer', '54': 'Multiple physicians/assistants not covered',
  '55': 'Procedure/treatment is deemed experimental/investigational', '58': 'Treatment was deemed by the payer to have been rendered in the wrong setting',
  '59': 'Charges reduced based on multiple-surgery rules', '96': 'Non-covered charge(s)',
  '97': 'Benefit for this service is included in the payment for another service already adjudicated',
  '109': 'Claim/service not covered by this payer/contractor', '110': 'Billing date predates the service date',
  '119': 'Benefit maximum for this time period has been reached', '125': 'Submission/billing error(s)',
  '129': 'Prior processing information incorrect', '133': 'The claim was forwarded to another payer',
  '146': 'Diagnosis was invalid for the date(s) of service', '147': 'Provider contracted/negotiated rate expired',
  '151': 'Payer deems the information does not support this many/frequency of services',
  '167': 'This (these) diagnosis(es) is (are) not covered', '170': 'Payment denied when performed by this type of provider',
  '177': 'Patient has not met the required eligibility requirements', '181': 'Procedure code was invalid on the date of service',
  '182': 'Procedure modifier was invalid on the date of service', '183': 'Referring provider is not eligible to refer this service',
  '185': 'Rendering provider is not eligible to perform the service billed', '197': 'Precertification/authorization/notification absent',
  '198': 'Precertification/authorization exceeded', '199': 'Revenue code and procedure code do not match',
  '200': 'Expenses incurred during a lapse in coverage', '204': 'Not covered under the patient’s current benefit plan',
  '222': 'Exceeds the contracted maximum number of hours/days/units', '226': 'Information requested from the billing/rendering provider was not provided',
  '227': 'Information requested from the patient/insured was not provided', '242': 'Services not provided by network/primary care providers',
  '243': 'Services not authorized by network/primary care providers', '252': 'An attachment/other documentation is required to adjudicate',
  '253': 'Sequestration — reduction in federal payment', '256': 'Service not payable per managed-care contract',
  '288': 'Referral absent', 'A1': 'Claim/service denied — see remark code', 'B7': 'Provider not certified/eligible to be paid for this procedure on this date',
  'B13': 'Previously paid — payment for this claim/service may have been provided', 'B15': 'Service requires a qualifying service/procedure that was not received/adjudicated',
};

export const RARC = {
  N4: 'Missing/incomplete/invalid prior insurance carrier EOB', N19: 'Procedure code incidental to the primary procedure',
  N26: 'Missing itemized bill/statement', N30: 'Patient ineligible for this service',
  N115: 'Decision based on a Local Coverage Determination (LCD)', N130: 'Consult plan benefit documents/guidelines',
  N174: 'This is not a covered service/procedure/equipment/bed', N179: 'Additional information requested from the member',
  N185: 'Alert: do not resubmit this claim/service', N286: 'Missing/incomplete/invalid referring provider primary identifier',
  N381: 'Alert: consult our contractual agreement for restrictions/billing on this procedure',
  N448: 'This drug/service/supply is not included in the fee schedule/contracted amount',
  N522: 'Duplicate of a claim processed, or in process, as a crossover/COB claim',
  N535: 'We do not pay for this item under this program', N702: 'Decision based on review of previously adjudicated claims',
  N706: 'Missing documentation', N770: 'The adjustment request has been processed',
  N781: 'Alert: patient balance may be billed', N782: 'Missing/incomplete/invalid subscriber identifier',
  M15: 'Separately billed services/tests bundled — cannot be paid separately', M16: 'Alert: see the payer’s web/bulletin for details',
  M25: 'Payment adjusted — the information does not support this level of service',
  M51: 'Missing/incomplete/invalid procedure code', M64: 'Missing/incomplete/invalid other diagnosis',
  M76: 'Missing/incomplete/invalid diagnosis or condition', M77: 'Missing/incomplete/invalid place of service',
  M115: 'This item is denied when provided by a non-contract or non-demonstration supplier',
  MA04: 'Secondary payment cannot be considered without the primary payer EOB', MA130: 'Claim contains incomplete/invalid information',
};

// Claim status category (STC first component) and status codes (second component).
export const CSCC = {
  A0: 'Acknowledgement — no status', A1: 'Acknowledgement — received', A2: 'Acknowledgement — accepted',
  A3: 'Acknowledgement — returned as unprocessable / rejected', A4: 'Acknowledgement — not found',
  A5: 'Acknowledgement — split claim', A6: 'Acknowledgement — rejected for missing information',
  A7: 'Acknowledgement — rejected for invalid information', A8: 'Acknowledgement — rejected for relational field error',
  P0: 'Pending', P1: 'Pending — in process', P2: 'Pending — payer review', P3: 'Pending — provider requested information',
  P4: 'Pending — patient requested information', P5: 'Pending — payer administrative/system hold',
  F0: 'Finalized', F1: 'Finalized — payment', F2: 'Finalized — denial', F3: 'Finalized — revised/adjusted', F4: 'Finalized — forwarded',
};
export const STC_STATUS = {
  '0': 'Cannot provide further status electronically', '1': 'Entity acknowledges receipt of the claim',
  '3': 'Claim adjudicated and awaiting payment', '16': 'Claim/encounter forwarded to entity',
  '19': 'Entity acknowledges receipt of claim/encounter', '20': 'Accepted for processing',
  '21': 'Missing or invalid information', '24': 'Entity not approved as an electronic submitter',
  '26': 'Entity not found — patient', '33': 'Subscriber and subscriber id not found',
  '35': 'Claim/encounter not found', '46': 'Awaiting supporting documentation',
  '54': 'Duplicate of a previously processed claim', '65': 'Claim/line has been paid',
  '88': 'Entity not eligible for benefits for the submitted dates of service', '97': 'Patient eligibility not found',
  '125': 'Entity’s id number', '142': 'Rendering provider name matching required',
  '153': 'Entity’s relationship to the insured is invalid', '155': 'Diagnosis code invalid for the date of service',
  '187': 'Rendering provider name matching required', '255': 'Entity not found — patient',
  '464': 'Payer-assigned claim control number', '477': 'Diagnosis code', '500': 'Entity’s postal/zip code',
  '543': 'Claim received by the clearinghouse and passed to the payer', '562': 'Entity’s National Provider Identifier (NPI)',
  '672': 'Payer’s payment could not be applied', '743': 'Diagnosis code(s) for the services rendered',
  '796': 'There is data missing in the claim',
};

export const AAA = {
  '15': 'Required application data missing', '33': 'Input errors', '35': 'Out of network',
  '41': 'Authorization/access restrictions', '42': 'Unable to respond at current time',
  '43': 'Invalid/missing provider identification', '44': 'Invalid/missing provider name',
  '45': 'Invalid/missing provider specialty', '46': 'Invalid/missing provider phone number',
  '47': 'Invalid/missing provider state', '48': 'Invalid/missing referring provider identification',
  '49': 'Provider is not primary care physician', '50': 'Provider ineligible for inquiries', '51': 'Provider not on file',
  '52': 'Service dates not within provider plan enrollment', '56': 'Inappropriate date',
  '57': 'Invalid/missing date(s) of service', '58': 'Invalid/missing date of birth',
  '60': 'Date of birth follows date(s) of service', '61': 'Date of death precedes date(s) of service',
  '62': 'Date of service not within allowable inquiry period', '63': 'Date of service in the future',
  '64': 'Invalid/missing patient id', '65': 'Invalid/missing patient name', '66': 'Invalid/missing patient gender',
  '67': 'Patient not found', '68': 'Duplicate patient id', '71': 'Patient birth date does not match the database',
  '72': 'Invalid/missing subscriber/insured id', '73': 'Invalid/missing subscriber/insured name',
  '74': 'Invalid/missing subscriber/insured gender code', '75': 'Subscriber/insured not found',
  '76': 'Duplicate subscriber/insured id', '77': 'Subscriber found, patient not found',
  '78': 'Subscriber/insured not in group/plan identified', '79': 'Invalid participant identification',
  'T4': 'Payer name or identifier missing',
};

// Look up a description for a code of a given add-code type. Returns '' if unknown.
export function describe(type, code) {
  code = String(code || '').toUpperCase().trim();
  if (type === 'carc') return CARC[code.split('-').pop()] || '';
  if (type === 'rarc') return RARC[code] || '';
  if (type === 'aaa') return AAA[code] || '';
  if (type === 'stc') {
    const [cat, st] = code.split('-');
    const c = CSCC[cat] ? CSCC[cat].replace(/^Acknowledgement — /, '') : '';
    const s = STC_STATUS[st] || '';
    return [s, c].filter(Boolean).join(' — ') || '';
  }
  return '';
}
