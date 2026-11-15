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

function drawStamp(ctx, w, h, s) {
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.034));
  const lh = Math.round(fs * 1.35), pad = Math.round(fs * 0.8);
  const lines = [
    `${fmtCoord(s.lat, 'N', 'S')}   ${fmtCoord(s.lng, 'E', 'W')}   ±${Math.round(s.acc)} m`,
    fmtWhen(s.at),
    `Pontis Energy · ${s.label}`
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
