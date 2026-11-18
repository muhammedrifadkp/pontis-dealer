// Photos: made smaller for the PDF, and GPS photos get the location and time printed on them.

const MAX_SIDE = 1600;
const QUALITY = 0.8;

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url; // browsers turn the photo the right way up from its EXIF orientation
  });
}

// Returns { blob, w, h } as a JPEG at most MAX_SIDE pixels on its longest side
export async function preparePhoto(file, stamp) {
  const img = await loadImage(file);
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  if (stamp) drawStamp(ctx, w, h, stamp);
  const blob = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', QUALITY));
  c.width = c.height = 0; // frees the memory straight away on phones
  if (!blob || blob.type !== 'image/jpeg') throw new Error('jpeg');
  return { blob, w, h };
}

export const fmtCoord = (v, pos, neg) => `${Math.abs(v).toFixed(6)}° ${v >= 0 ? pos : neg}`;
export const fmtWhen = t => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(t) + ' IST';

// Where a GPS photo's location came from, as printed on the photo and in the PDF
export function gpsSource(g) {
  if (g.source === 'photo') return 'GPS from the photo';
  if (g.late) return 'location when added, photo taken earlier';
  return '';
}

function drawStamp(ctx, w, h, s) {
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.034));
  const lh = Math.round(fs * 1.35), pad = Math.round(fs * 0.8);
  const src = gpsSource(s);
  const lines = [
    `${fmtCoord(s.lat, 'N', 'S')}   ${fmtCoord(s.lng, 'E', 'W')}${s.acc != null ? `   ±${Math.round(s.acc)} m` : ''}`,
    fmtWhen(s.at),
    `Pontis Energy · ${s.label}${src ? ` · ${src}` : ''}`
  ];
  const band = pad * 2 + lh * lines.length;
  ctx.fillStyle = 'rgba(16, 32, 44, 0.66)';
  ctx.fillRect(0, h - band, w, band);
  ctx.fillStyle = '#7E9D57';
  ctx.fillRect(0, h - band, Math.round(fs * 0.3), band);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((t, i) => {
    ctx.font = `${i === 0 ? 600 : 400} ${fs}px "Noto Sans", Arial, sans-serif`;
    ctx.fillText(t, pad + Math.round(fs * 0.4), h - band + pad + i * lh, w - pad * 2);
  });
}

// The GPS position and time stored in a JPEG photo's EXIF data by the camera (phone cameras with
// location on, and GPS camera apps). Returns { lat, lng, at } (at may be null) or null.
// This is how a photo chosen from a computer or the gallery keeps the place where it was taken.
export async function readExifGps(file) {
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null; // not a JPEG
    let p = 2;
    while (p + 10 <= v.byteLength) {
      const marker = v.getUint16(p);
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) return null; // image data starts: no EXIF
      if (marker === 0xFFE1 && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) return exifGps(v, p + 10);
      p += 2 + v.getUint16(p + 2);
    }
  } catch (e) { /* unreadable or cut short: treat as no GPS */ }
  return null;
}
function exifGps(v, t) {
  const le = v.getUint16(t) === 0x4949; // "II": little-endian
  const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const ifd = off => {
    const tags = {};
    for (let i = 0, n = u16(off); i < n; i++) {
      const e = off + 2 + i * 12, type = u16(e + 2), count = u32(e + 4);
      tags[u16(e)] = { count, at: (SIZE[type] || 1) * count > 4 ? u32(e + 8) : e + 8 };
    }
    return tags;
  };
  const ascii = x => { let s = ''; for (let i = 0; x && i < x.count; i++) { const c = v.getUint8(t + x.at + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); };
  const rats = x => Array.from({ length: x.count }, (_, i) => { const d = u32(x.at + i * 8 + 4); return d ? u32(x.at + i * 8) / d : 0; });
  const ifd0 = ifd(u32(4));
  if (!ifd0[0x8825]) return null;
  const g = ifd(u32(ifd0[0x8825].at));
  if (!g[2] || !g[4] || g[2].count < 3 || g[4].count < 3) return null;
  const deg = r => r[0] + r[1] / 60 + r[2] / 3600;
  const lat = deg(rats(g[2])) * (ascii(g[1]) === 'S' ? -1 : 1);
  const lng = deg(rats(g[4])) * (ascii(g[3]) === 'W' ? -1 : 1);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180) || (lat === 0 && lng === 0)) return null;

  // when it was taken: the GPS time (UTC), else the camera's time (India time unless it says otherwise)
  let at = null;
  const gd = ascii(g[0x1D]).match(/^(\d{4}):(\d\d):(\d\d)$/);
  if (gd && g[7] && g[7].count >= 3) {
    const [hh, mm, ss] = rats(g[7]);
    at = Date.UTC(+gd[1], +gd[2] - 1, +gd[3], hh, mm, ss);
  } else if (ifd0[0x8769]) {
    const ex = ifd(u32(ifd0[0x8769].at));
    const m = ascii(ex[0x9003]).match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
    const off = ascii(ex[0x9011]);
    if (m) at = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${/^[+-]\d\d:\d\d$/.test(off) ? off : '+05:30'}`);
  }
  return { lat, lng, at: Number.isFinite(at) ? at : null };
}

// Current position from the phone's GPS
export function getPosition(timeout = 25000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(Object.assign(new Error('This phone cannot share its location.'), { code: 'nogeo' })); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }),
      e => reject(Object.assign(new Error(geoMessage(e)), { code: e.code })),
      { enableHighAccuracy: true, timeout, maximumAge: 20000 }
    );
  });
}
function geoMessage(e) {
  if (e && e.code === 1) return 'Location is turned off for this app. Allow location in the browser or phone settings, then try again.';
  if (e && e.code === 3) return 'Could not find the location in time. Step outside or near a window and try again.';
  return 'Could not get the location. Turn on the phone’s location (GPS) and try again.';
}
