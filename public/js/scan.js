// Reading QR codes and barcodes into the form, from the camera or from a photo the dealer chooses.
// Android Chrome has a code reader built in (BarcodeDetector). Other browsers (iPhone, computers) use
// ZXing (public/vendor/zxing: zxing-wasm 3.1.7, MIT licence), loaded only when the scanner first opens.
// Each field's reader (READERS below) then takes its value out of the code's text.

import { verhoeffOk } from './fields.js';

// ---------- which codes are looked for ----------
const SETS = {
  qr: { native: ['qr_code'], zxing: ['QRCode'] },
  // labels on panels, inverters and meters, and the KSEB bill, can have a barcode instead of a QR code
  any: {
    native: ['qr_code', 'data_matrix', 'code_128', 'code_39', 'code_93', 'itf', 'ean_13'],
    zxing: ['QRCode', 'MicroQRCode', 'DataMatrix', 'Code128', 'Code39', 'Code93', 'ITF', 'EAN13']
  }
};

const natives = {};
function nativeDetector(set) {
  if (!natives[set]) {
    natives[set] = (async () => {
      if (!('BarcodeDetector' in window)) return null;
      try {
        const have = await window.BarcodeDetector.getSupportedFormats();
        const want = SETS[set].native.filter(f => have.includes(f));
        return want.includes('qr_code') ? new window.BarcodeDetector({ formats: want }) : null;
      } catch (e) { return null; }
    })();
  }
  return natives[set];
}

let zxingP = null;
function zxing() {
  if (!zxingP) {
    zxingP = import('../vendor/zxing/reader/index.js').then(async z => {
      const wasm = new URL('../vendor/zxing/zxing_reader.wasm', import.meta.url).href;
      await z.prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasm : prefix + path) }, fireImmediately: true });
      return z;
    }).catch(err => { zxingP = null; throw Object.assign(new Error('reader'), { cause: err }); });
  }
  return zxingP;
}

// Gets the reader ready (throws Error('reader') if it cannot run on this browser)
export async function prepare(set) {
  if (await nativeDetector(set)) return 'native';
  await zxing();
  return 'zxing';
}

const nativeTexts = list => list.map(b => b.rawValue).filter(Boolean);
const zxingTexts = list => list.filter(r => r.isValid && r.text).map(r => r.text);

function pixels(canvas, src, w, h, maxSide) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch);
}

// The texts of the codes in the camera's current picture
let frameCanvas = null;
export async function detectFrame(video, set) {
  const det = await nativeDetector(set);
  if (det) return nativeTexts(await det.detect(video));
  const z = await zxing();
  if (!frameCanvas) frameCanvas = document.createElement('canvas');
  // read on the phone's processor: a smaller picture is quicker and saves the battery, and still
  // holds a dense Aadhaar QR code that fills the box on the screen
  const img = pixels(frameCanvas, video, video.videoWidth, video.videoHeight, 1280);
  return zxingTexts(await z.readBarcodes(img, { formats: SETS[set].zxing, tryHarder: true, maxNumberOfSymbols: 4 }));
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

// The texts of the codes in a photo (several codes in one photo are all found)
export async function detectPhoto(file, set) {
  const img = await loadImage(file);
  const det = await nativeDetector(set);
  if (det) {
    const found = nativeTexts(await det.detect(img).catch(() => []));
    if (found.length) return found;
  }
  // the built-in reader found nothing (or there is none): ZXing looks harder
  const z = await zxing();
  const canvas = document.createElement('canvas');
  try {
    const data = pixels(canvas, img, img.naturalWidth, img.naturalHeight, 3200);
    return zxingTexts(await z.readBarcodes(data, { formats: SETS[set].zxing, tryHarder: true, maxNumberOfSymbols: 12 }));
  } finally { canvas.width = canvas.height = 0; } // frees the memory straight away on phones
}

// ---------- the camera ----------
export async function startCamera(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw cameraError({ name: window.isSecureContext ? 'NotFoundError' : 'SecurityError' });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (err) { throw cameraError(err); }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  let caps = {};
  try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { /* not supported */ }
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  return {
    track,
    torch: !!caps.torch,
    setTorch: on => track.applyConstraints({ advanced: [{ torch: on }] }),
    stop: () => { stream.getTracks().forEach(t => t.stop()); video.srcObject = null; }
  };
}
function cameraError(err) {
  const n = err && err.name;
  const msg = n === 'NotAllowedError' || n === 'SecurityError'
    ? 'The camera is blocked for this app. Allow the camera in the browser’s site settings, or choose a photo instead.'
    : n === 'NotReadableError' || n === 'AbortError'
      ? 'The camera is busy in another app. Close that app and try again, or choose a photo instead.'
      : 'No camera found on this device. Choose a photo of the code instead.';
  return Object.assign(new Error(msg), { name: n || 'Error' });
}

// ---------- taking each field's value out of a code's text ----------
// Each reader returns { values: [...], sure, partial?, none?, ...extras }:
//   one value and sure: it goes straight into the box; several (or not sure): the dealer picks one;
//   partial: an Aadhaar QR code without the full number (only its last 4 digits); none: what to say.
const uniq = a => [...new Set(a)];
const latin1 = b => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const tidyName = s => String(s || '').replace(/\s+/g, ' ').trim();
const validAadhaar = s => /^[2-9]\d{11}$/.test(s) && verhoeffOk(s);

// Old Aadhaar cards and letters: XML with the full number, e.g. <PrintLetterBarcodeData uid="…" name="…" dob="…"/>
function xmlAadhaar(text) {
  if (!/PrintLetterBarcodeData|\buid\s*=/i.test(text)) return null;
  const attr = k => { const m = text.match(new RegExp(`\\b${k}\\s*=\\s*["']([^"']*)["']`, 'i')); return m ? m[1].trim() : ''; };
  return { uid: attr('uid').replace(/[\s-]/g, ''), name: tidyName(attr('name')), dob: attr('dob') };
}

// New Aadhaar cards, e-Aadhaar and mAadhaar ("Secure QR"): a long number that is gzip data, fields split by
// byte 255. The reference ID starts with the last 4 digits of the Aadhaar number; the full number is not in it.
async function secureAadhaar(text) {
  if (!/^\d{200,}$/.test(text)) return null;
  if (typeof DecompressionStream !== 'function' || typeof BigInt !== 'function') return { tooOld: true };
  let hex = BigInt(text).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  let data;
  try {
    data = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  } catch (e) { return null; }
  const parts = [];
  for (let i = 0, start = 0; i < data.length && parts.length < 8; i++) {
    if (data[i] === 255) { parts.push(latin1(data.subarray(start, i))); start = i + 1; }
  }
  const o = /^V\d+$/.test(parts[0] || '') ? 1 : 0; // "V2" and later start with the version
  const ref = parts[o + 1] || '';
  if (!/^\d{4}/.test(ref)) return null;
  return { last4: ref.slice(0, 4), name: tidyName(parts[o + 2]), dob: parts[o + 3] || '' };
}

async function readAadhaar(text) {
  const t = String(text).trim();
  const bad = { values: [], none: 'The Aadhaar number in this QR code is not valid. Type the number from the card.' };
  const plain = t.replace(/[\s-]/g, '');
  if (/^\d{12}$/.test(plain)) return validAadhaar(plain) ? { values: [plain], sure: true } : bad;
  const x = xmlAadhaar(t);
  if (x) {
    if (/^\d{12}$/.test(x.uid)) return validAadhaar(x.uid) ? { values: [x.uid], sure: true, name: x.name, dob: x.dob } : bad;
    const last4 = (x.uid.match(/(\d{4})$/) || [])[1];
    if (last4) return { values: [], partial: true, last4, name: x.name, dob: x.dob };
  }
  const s = await secureAadhaar(t);
  if (s && s.tooOld) return { values: [], none: 'This phone’s browser is too old to read the new Aadhaar QR code. Update the phone’s software, or type the number.' };
  if (s) return { values: [], partial: true, last4: s.last4, name: s.name, dob: s.dob };
  return { values: [], none: 'This is not an Aadhaar QR code. Point the camera at the QR code printed on the Aadhaar card.' };
}

// PAN: ABCDE1234F, where the 4th letter is the holder type (P for a person)
function readPan(text) {
  const found = [...String(text).matchAll(/(?:^|[^A-Za-z0-9])([A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z])(?![A-Za-z0-9])/g)].map(m => m[1]);
  return { values: uniq(found), sure: true };
}

// KSEB consumer numbers have 13 digits. Without one, other numbers are offered for the dealer to pick.
function readConsumer(text) {
  const runs = String(text).match(/\d+/g) || [];
  const thirteen = uniq(runs.filter(r => r.length === 13));
  if (thirteen.length) return { values: thirteen, sure: true };
  return { values: uniq(runs.filter(r => r.length >= 6 && r.length <= 16)).slice(0, 6), sure: false };
}

// Serial numbers: the code is usually just the serial; otherwise a labelled "S/N: …" or "Serial No: …"
function readSerial(text) {
  const t = String(text).trim();
  if (/^[A-Za-z0-9][A-Za-z0-9\-/.]{3,39}$/.test(t)) return { values: [t], sure: true };
  const lab = t.match(/(?:^|[^A-Za-z])(?:s\/?n|serial(?:[\s_.-]*(?:no|number|num))?)\.?(?:\s*[:=#]\s*|\s+)([A-Za-z0-9][A-Za-z0-9-]{3,39})/i);
  if (lab) return { values: [lab[1]], sure: true };
  const tokens = t.split(/[^A-Za-z0-9-]+/).map(x => x.replace(/^-+|-+$/g, '')).filter(x => x.length >= 4 && x.length <= 40 && /\d/.test(x));
  return { values: uniq(tokens).slice(0, 8), sure: false };
}

export const READERS = {
  aadhaar: {
    set: 'qr', read: readAadhaar, which: 'Which one is the Aadhaar number?',
    aim: 'Point the camera at the QR code on the Aadhaar card. Hold it steady, close enough to fill the box.',
    none: 'This is not an Aadhaar QR code.'
  },
  pan: {
    set: 'qr', read: readPan, which: 'Which one is the PAN?',
    aim: 'Point the camera at the QR code on the PAN card.',
    none: 'This QR code does not show the PAN. On newer PAN cards it is locked: only the Income Tax Department’s app can read it. Type the PAN.'
  },
  consumer: {
    set: 'any', read: readConsumer, which: 'Which one is the consumer number?',
    aim: 'Point the camera at the QR code or barcode on the KSEB bill.',
    none: 'No consumer number in this code. Try the other code on the bill, or type the number.'
  },
  serial: {
    set: 'any', read: readSerial, which: 'Which one is the serial number?',
    aim: 'Point the camera at the QR code or barcode on the label.',
    none: 'No serial number found in this code.'
  }
};

// Age in years today, from a date of birth as written in Aadhaar QR codes (DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD)
export function ageFrom(dob, now = new Date()) {
  const s = String(dob || '').trim();
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/), y, mo, d;
  if (m) [d, mo, y] = [+m[1], +m[2], +m[3]];
  else if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else return 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
  return age >= 1 && age <= 120 ? age : 0;
}
