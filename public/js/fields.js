// The two client forms and their checks. To add or change a field, edit SECTION_1 / SECTION_2 below.
//
// Field types: text, consumer, mobile, aadhaar, pan, email, age, number, select, serial,
//              photo (one), photos (several), gpsphoto (camera only, stamped with GPS), location, serials
// Options:     required (default true), only: 'loan' | 'cash', group: 'co' (co-applicant, loan and age 60+)

export const CO_APPLICANT_AGE = 60;
export const INVERTER_BRANDS = ['Waaree', 'Havells', 'Deye', 'Other'];

export const SECTION_1 = [
  { key: 'name', label: 'Customer name', type: 'text', placeholder: 'As on the Aadhaar card' },
  { key: 'consumer', label: 'Consumer number', type: 'consumer', hint: 'From the KSEB bill, usually 13 digits' },
  { key: 'ksebBill', label: 'KSEB bill photo', type: 'photo' },
  { key: 'mobile', label: 'Registered mobile number', type: 'mobile', hint: 'The number registered with KSEB' },
  { key: 'aadhaar', label: 'Aadhaar number', type: 'aadhaar' },
  { key: 'aadhaarFront', label: 'Aadhaar card photo (front)', type: 'photo' },
  { key: 'aadhaarBack', label: 'Aadhaar card photo (back)', type: 'photo' },
  { key: 'age', label: 'Age', type: 'age', only: 'loan', hint: `${CO_APPLICANT_AGE} or above needs a co-applicant` },

  { key: 'pan', label: 'PAN number', type: 'pan', only: 'loan' },
  { key: 'panPhoto', label: 'PAN card photo', type: 'photo', only: 'loan' },
  { key: 'coName', label: 'Co-applicant name', type: 'text', only: 'loan', group: 'co' },
  { key: 'coRelation', label: 'Relation to the customer', type: 'text', only: 'loan', group: 'co', placeholder: 'Son, daughter, spouse…' },
  { key: 'coMobile', label: 'Co-applicant mobile number', type: 'mobile', only: 'loan', group: 'co' },
  { key: 'coAadhaar', label: 'Co-applicant Aadhaar number', type: 'aadhaar', only: 'loan', group: 'co' },
  { key: 'coAadhaarFront', label: 'Co-applicant Aadhaar photo (front)', type: 'photo', only: 'loan', group: 'co' },
  { key: 'coAadhaarBack', label: 'Co-applicant Aadhaar photo (back)', type: 'photo', only: 'loan', group: 'co' },
  { key: 'coPan', label: 'Co-applicant PAN number', type: 'pan', only: 'loan', group: 'co' },
  { key: 'coPanPhoto', label: 'Co-applicant PAN card photo', type: 'photo', only: 'loan', group: 'co' },
  { key: 'location', label: 'Google location', type: 'location', hint: 'Tap at the customer’s house, or paste a Google Maps link' },
  { key: 'taxBuilding', label: 'Tax receipt: building', type: 'photo', only: 'loan' },
  { key: 'taxLand', label: 'Tax receipt: land', type: 'photo', only: 'loan' },
  { key: 'bankDocType', label: 'Bank document', type: 'select', options: ['Passbook', 'Cheque leaf', 'Bank statement'] },
  { key: 'bankDoc', label: 'Bank document photo', type: 'photo' },
  { key: 'landmark', label: 'Landmark', type: 'text', required: false, placeholder: 'Near …' },
  { key: 'email', label: 'Email ID', type: 'email' },
  { key: 'roofPhoto', label: 'GPS photo of the rooftop', type: 'gpsphoto', hint: 'Taken with the camera at the site; the location and time are printed on it' }
];

export const SECTION_2 = [
  { key: 'consumer', label: 'Consumer number', type: 'consumer' },
  { key: 'name', label: 'Customer name', type: 'text' },
  { key: 'aadhaar', label: 'Aadhaar number', type: 'aadhaar' },
  { key: 'panelWatt', label: 'Panel watts (Wp)', type: 'number', min: 100, max: 1000, placeholder: 'e.g. 570' },
  { key: 'panelCount', label: 'Number of panels', type: 'number', min: 1, max: 200, placeholder: 'e.g. 6' },
  { key: 'panelSerials', label: 'Panel serial numbers', type: 'serials', countKey: 'panelCount' },
  { key: 'panelSerialPhotos', label: 'Panel serial number photos', type: 'photos', min: 1, max: 60, hint: 'Add as many photos as needed to show every serial number' },
  { key: 'panelsGps', label: 'GPS photo of the panels with the customer', type: 'gpsphoto' },
  { key: 'inverterBrand', label: 'Inverter brand', type: 'select', options: INVERTER_BRANDS, otherKey: 'inverterBrandOther' },
  { key: 'inverterBrandOther', label: 'Inverter brand name', type: 'text', showIf: v => v.inverterBrand === 'Other' },
  { key: 'inverterSerial', label: 'Inverter serial number', type: 'serial' },
  { key: 'inverterSerialPhoto', label: 'Inverter serial number photo', type: 'photo' },
  { key: 'meterSerial', label: 'Energy meter serial number', type: 'serial' },
  { key: 'meterSerialPhoto', label: 'Energy meter serial number photo', type: 'photo' },
  { key: 'meterCodePhoto', label: 'Energy meter upper code photo', type: 'photo' }
];

export const SECTIONS = {
  1: { title: 'Section 1', subtitle: 'Work start', fields: SECTION_1 },
  2: { title: 'Section 2', subtitle: 'After installation', fields: SECTION_2 }
};

export const PHOTO_TYPES = ['photo', 'photos', 'gpsphoto'];
export const isPhoto = f => PHOTO_TYPES.includes(f.type);

// Which fields are in use for this form, with these answers
export function activeFields(section, mode, values) {
  return SECTIONS[section].fields.filter(f => {
    if (f.only && f.only !== mode) return false;
    if (f.group === 'co' && !needsCoApplicant(mode, values)) return false;
    if (f.showIf && !f.showIf(values)) return false;
    return true;
  });
}
export const needsCoApplicant = (mode, v) => mode === 'loan' && Number(v.age) >= CO_APPLICANT_AGE;

// ---------- checks ----------
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
// Aadhaar numbers end with a Verhoeff check digit, so one wrong or swapped digit is caught
export function verhoeffOk(num) {
  let c = 0;
  const digits = String(num).split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = VD[c][VP[i % 8][digits[i]]];
  return c === 0;
}

// The PDF's fonts show English letters only: Malayalam (or any other script) and emoji would print as "?"
const PDF_TEXT = /^[\x20-\x7E -ÿ–—‘’“”•…₹]*$/;
export const printable = s => PDF_TEXT.test(String(s ?? ''));

export const digitsOnly = s => String(s ?? '').replace(/\D/g, '');
export const normMobile = s => { const d = digitsOnly(s); return d.length > 10 ? d.slice(-10) : d; };

// Tidies a typed value (what is stored and printed)
export function tidy(f, raw) {
  const s = String(raw ?? '');
  switch (f.type) {
    case 'consumer': return digitsOnly(s);
    case 'mobile': return normMobile(s);
    case 'aadhaar': return digitsOnly(s).slice(0, 12);
    case 'pan': return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    case 'age': case 'number': return digitsOnly(s).slice(0, 4);
    case 'email': return s.trim().toLowerCase();
    case 'serial': return s.toUpperCase().replace(/\s+/g, '').slice(0, 40);
    default: return s.replace(/\s+/g, ' ').trim();
  }
}

// Returns '' when fine, or the message to show under the field
export function check(f, values) {
  const v = values[f.key];
  const required = f.required !== false;
  if (isPhoto(f)) {
    const n = Array.isArray(v) ? v.length : 0;
    if (!n) return required ? (f.type === 'gpsphoto' ? 'Take this photo with the camera.' : 'Add this photo.') : '';
    if (f.type === 'photos' && f.min && n < f.min) return `Add at least ${f.min} photo${f.min > 1 ? 's' : ''}.`;
    return '';
  }
  if (f.type === 'location') {
    if (!v || (!v.lat && !v.link)) return required ? 'Add the location: tap “Use my location” or paste a Google Maps link.' : '';
    if (!v.lat && v.link && !/^https?:\/\/\S+$/i.test(v.link)) return 'Paste the full Google Maps link (it starts with https://).';
    return '';
  }
  if (f.type === 'serials') {
    const want = Number(values[f.countKey]) || 0;
    const list = Array.isArray(v) ? v.slice(0, want) : [];
    if (!want) return 'Enter the number of panels first.';
    const missing = [];
    for (let i = 0; i < want; i++) if (!String(list[i] || '').trim()) missing.push(i + 1);
    if (missing.length) return `Enter the serial number of panel ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}.`;
    const short = list.findIndex(x => String(x).length < 4);
    if (short >= 0) return `Panel ${short + 1}: the serial number looks too short.`;
    const seen = new Map();
    for (let i = 0; i < list.length; i++) {
      if (seen.has(list[i])) return `Panels ${seen.get(list[i]) + 1} and ${i + 1} have the same serial number.`;
      seen.set(list[i], i);
    }
    return '';
  }
  const s = String(v ?? '').trim();
  if (!s) return required ? 'Required.' : '';
  switch (f.type) {
    case 'text':
      if (!printable(s)) return 'Type this in English letters. Malayalam letters and emoji do not show in the PDF.';
      return s.length < 2 ? 'Too short.' : '';
    case 'consumer': return /^\d{6,16}$/.test(s) ? '' : 'Enter the consumer number in digits.';
    case 'mobile': return /^[6-9]\d{9}$/.test(s) ? '' : 'Enter a 10-digit mobile number.';
    case 'aadhaar':
      if (!/^\d{12}$/.test(s)) return 'Aadhaar has 12 digits.';
      if (/^[01]/.test(s) || !verhoeffOk(s)) return 'This Aadhaar number is not valid. Check every digit.';
      return '';
    case 'pan': return /^[A-Z]{5}\d{4}[A-Z]$/.test(s) ? '' : 'PAN looks like ABCDE1234F.';
    case 'email': return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) ? '' : 'Enter a full email ID, like name@gmail.com.';
    case 'age': { const n = Number(s); return n >= 18 && n <= 110 ? '' : 'Enter the age in years (18 or more).'; }
    case 'number': { const n = Number(s); return n >= (f.min ?? 0) && n <= (f.max ?? 1e9) ? '' : `Enter a number from ${f.min} to ${f.max}.`; }
    case 'serial': return s.length >= 4 ? '' : 'The serial number looks too short.';
    case 'select': return f.options.includes(s) ? '' : 'Choose one.';
    default: return '';
  }
}
// A soft note that does not stop the PDF
export function note(f, values) {
  if (f.type === 'consumer') {
    const s = String(values[f.key] ?? '');
    if (s && /^\d{6,16}$/.test(s) && s.length !== 13) return `This has ${s.length} digits; KSEB numbers usually have 13. Please check.`;
  }
  return '';
}

// Values as printed in the PDF and the Excel list
export function display(f, values) {
  const v = values[f.key];
  switch (f.type) {
    case 'aadhaar': return String(v || '').replace(/(\d{4})(?=\d)/g, '$1 ');
    case 'mobile': return v ? String(v).replace(/^(\d{5})(\d{5})$/, '$1 $2') : '';
    case 'location':
      if (!v) return '';
      if (v.lat) return `https://maps.google.com/?q=${v.lat.toFixed(6)},${v.lng.toFixed(6)} (accuracy ±${Math.round(v.acc || 0)} m)`;
      return v.link || '';
    case 'serials': {
      const want = Number(values[f.countKey]) || 0;
      return (Array.isArray(v) ? v.slice(0, want) : []).join(', ');
    }
    case 'select': return f.otherKey && v === 'Other' ? `Other: ${values[f.otherKey] || ''}` : String(v ?? '');
    default: return String(v ?? '');
  }
}
