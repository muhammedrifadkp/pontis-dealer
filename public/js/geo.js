// Geo-Tag overlay helpers for the Staff GEO PDF editor:
// - Parses coordinates, Google Maps links, dates and multi-line pasted Geo-Tag blocks
// - Fetches map tiles through our own /api/geo/tile endpoint (zero CORS / CSP issues)
// - Renders the Baiju-GEO-style bottom overlay card (mini-map + date/time + place + address + Lat/Long)

const MAX_EXPORT_SIDE = 1600;
const EXPORT_QUALITY = 0.88;
const GEO_SIZE_TIERS = [
  { maxSide: 1600, minQ: 0.72, maxQ: 0.86 },
  { maxSide: 1440, minQ: 0.70, maxQ: 0.84 },
  { maxSide: 1280, minQ: 0.68, maxQ: 0.82 },
  { maxSide: 1120, minQ: 0.64, maxQ: 0.80 },
  { maxSide: 960, minQ: 0.56, maxQ: 0.76 },
  { maxSide: 800, minQ: 0.44, maxQ: 0.72 },
  { maxSide: 640, minQ: 0.35, maxQ: 0.65 }
];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad2 = n => String(n).padStart(2, '0');

// Format timestamp (ms) in IST as "YYYY/MM/DD HH:mm" (matches Baiju GEO.pdf)
export function formatGeoDate(ts) {
  if (!Number.isFinite(ts)) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'Asia/Kolkata'
    }).formatToParts(ts);
    const get = t => (parts.find(p => p.type === t) || {}).value || '';
    const hh = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}/${get('month')}/${get('day')} ${hh}:${get('minute')}`;
  } catch {
    const d = new Date(ts);
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
}

export function validCoord(lat, lng) {
  const a = Number(lat), b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && String(lat).trim() !== '' && String(lng).trim() !== ''
    && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
}

// Parse coordinates from a Google Maps URL, plain "lat, lng", "11.35° N, 75.87° E", or "Lat ... Long ..."
export function parseCoords(str) {
  const s = String(str || '');
  const deg = s.match(/(-?\d{1,2}\.\d+)\s*°\s*([NS])\s*[,;\s]+\s*(-?\d{1,3}\.\d+)\s*°\s*([EW])/i);
  if (deg) {
    const lat = Number(deg[1]) * (deg[2].toUpperCase() === 'S' ? -1 : 1);
    const lng = Number(deg[3]) * (deg[4].toUpperCase() === 'W' ? -1 : 1);
    if (validCoord(lat, lng)) return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
  }
  const labelled = s.match(/\blat(?:itude)?\s*[:=]?\s*(-?\d{1,2}\.\d+)\D+\b(?:lon|lng|long|longitude)\s*[:=]?\s*(-?\d{1,3}\.\d+)/i);
  if (labelled && validCoord(labelled[1], labelled[2])) {
    return { lat: Number(labelled[1]).toFixed(6), lng: Number(labelled[2]).toFixed(6) };
  }
  const urlPatterns = [
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|ll|query|center)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/i,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/
  ];
  for (const re of urlPatterns) {
    const m = s.match(re);
    if (m && validCoord(m[1], m[2])) return { lat: Number(m[1]).toFixed(6), lng: Number(m[2]).toFixed(6) };
  }
  const pair = s.match(/(?:^|[^\d.\-])(-?\d{1,2}\.\d{3,})\s*[,;\s]+\s*(-?\d{1,3}\.\d{3,})(?!\d)/);
  if (pair && validCoord(pair[1], pair[2])) {
    return { lat: Number(pair[1]).toFixed(6), lng: Number(pair[2]).toFixed(6) };
  }
  return null;
}

// Parse date/time from the Section 2 PDF GPS line:
// e.g. "GPS: 11.359716° N, 75.874116° E (±12 m) · 17 Nov 2026, 9:57 am IST · GPS from the photo"
export function parsePdfGpsLine(line) {
  const s = String(line || '');
  if (!s) return null;
  const coords = parseCoords(s);
  let dateTime = '';
  const dt = s.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (dt) {
    const mo = MONTHS[dt[2].toLowerCase()];
    if (mo) {
      let hh = Number(dt[4]);
      const pm = dt[6].toLowerCase() === 'pm';
      if (pm && hh < 12) hh += 12;
      if (!pm && hh === 12) hh = 0;
      dateTime = `${dt[3]}/${pad2(mo)}/${pad2(Number(dt[1]))} ${pad2(hh)}:${dt[5]}`;
    }
  }
  if (!coords && !dateTime) return null;
  return { lat: coords ? coords.lat : '', lng: coords ? coords.lng : '', dateTime };
}

// Parse anything staff paste into the Quick Paste box:
// - Google Maps URL (full or short link -> returns url so caller can call /api/geo/lookup)
// - Plain coordinates ("11.359716, 75.874116")
// - Multi-line Geo-Tag Camera block (date/time, place, address, Lat ... Long ...)
// - Plain address text
export function parsePastedLocation(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  const out = { lat: '', lng: '', dateTime: '', place: '', address: '', url: '' };
  if (!text) return out;

  const urlMatch = text.match(/https?:\/\/\S+/i);
  if (urlMatch) out.url = urlMatch[0];

  const coords = parseCoords(text);
  if (coords) { out.lat = coords.lat; out.lng = coords.lng; }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const kept = [];
  for (const line of lines) {
    // Skip boilerplate watermarks if pasted from OCR / another camera app
    if (/^(?:google|geo[- ]?tagging camera|gps map camera)$/i.test(line)) continue;
    // Skip pure URL line
    if (/^https?:\/\/\S+(?:\s*\(accuracy[^)]*\))?$/i.test(line)) continue;
    // Pure coordinate line
    if (/^(?:lat(?:itude)?\s*[:=]?\s*-?\d+(?:\.\d+)?\D+(?:lon|lng|long|longitude)\s*[:=]?\s*-?\d+(?:\.\d+)?|-?\d{1,2}\.\d{3,}\s*°?\s*[NS]?\s*[,;\s]+\s*-?\d{1,3}\.\d{3,}\s*°?\s*[EW]?)$/i.test(line)) {
      continue;
    }
    // Date/time line: "2026/11/17 09:57", "17/11/2026 09:57 AM", "17 Nov 2026, 9:57 am"
    const dtLine = line.match(/^(?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})(?:[,\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?(?:\s*IST)?)?$/i);
    if (dtLine && !out.dateTime) { out.dateTime = line; continue; }
    kept.push(line);
  }

  if (kept.length === 1) {
    // Single line: short -> place, longer address -> address
    if (kept[0].length <= 42 && kept[0].split(',').length <= 3) out.place = kept[0];
    else out.address = kept[0];
  } else if (kept.length >= 2) {
    out.place = kept[0];
    out.address = kept.slice(1).join(', ');
  }
  return out;
}

// ---------- Mini-map rendering (fetches same-origin /api/geo/tile with auth token) ----------
const tileCache = new Map(); // "z/x/y" -> Promise<HTMLImageElement | null>

function loadImgFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('tile')); };
    img.src = u;
  });
}

function fetchTile(z, x, y, token) {
  const key = `${z}/${x}/${y}`;
  if (!tileCache.has(key)) {
    tileCache.set(key, (async () => {
      try {
        const res = await fetch(`/api/geo/tile?z=${z}&x=${x}&y=${y}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {}
        });
        if (!res.ok) return null;
        return await loadImgFromBlob(await res.blob());
      } catch {
        return null;
      }
    })());
  }
  return tileCache.get(key);
}

// Renders a crisp square mini-map canvas centered on (lat, lng) with a red pin.
// Falls back to a clean stylized offline map graphic when tiles aren't reachable.
export async function buildMiniMap(lat, lng, token, size = 260, zoom = 15) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');

  // Offline / base background
  ctx.fillStyle = '#E8F0E5';
  ctx.fillRect(0, 0, size, size);

  const n = 1 << zoom;
  const latRad = (lat * Math.PI) / 180;
  const fx = ((lng + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const cx = Math.floor(fx), cy = Math.floor(fy);
  const pxInTile = (fx - cx) * 256, pyInTile = (fy - cy) * 256;

  // Fetch the 3x3 neighborhood around the target tile so the square is always completely filled
  const jobs = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const tx = ((cx + dx) % n + n) % n;
      const ty = cy + dy;
      if (ty < 0 || ty >= n) continue;
      jobs.push(fetchTile(zoom, tx, ty, token).then(img => ({ img, dx, dy })));
    }
  }
  const tiles = await Promise.all(jobs);
  const scale = size / 256; // show ~1 tile span across the square
  let drawn = 0;
  for (const { img, dx, dy } of tiles) {
    if (!img) continue;
    const drawX = size / 2 - (pxInTile - dx * 256) * scale;
    const drawY = size / 2 - (pyInTile - dy * 256) * scale;
    ctx.drawImage(img, drawX, drawY, 256 * scale, 256 * scale);
    drawn++;
  }

  if (!drawn) {
    // Clean stylized vector map fallback when offline
    ctx.fillStyle = '#E7EFE5';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#CBE0F2';
    ctx.lineWidth = size * 0.055;
    ctx.beginPath();
    ctx.moveTo(0, size * 0.25);
    ctx.bezierCurveTo(size * 0.35, size * 0.12, size * 0.65, size * 0.45, size, size * 0.32);
    ctx.stroke();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = size * 0.032;
    ctx.beginPath();
    ctx.moveTo(size * 0.15, 0); ctx.lineTo(size * 0.85, size);
    ctx.moveTo(0, size * 0.72); ctx.lineTo(size, size * 0.48);
    ctx.moveTo(size * 0.5, 0); ctx.lineTo(size * 0.46, size);
    ctx.stroke();
  }

  // Crisp red map pin at the exact center
  const pinX = size / 2, pinY = size / 2;
  const r = Math.max(8, size * 0.082);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = size * 0.04;
  ctx.shadowOffsetY = size * 0.015;
  ctx.fillStyle = '#EA4335';
  ctx.beginPath();
  ctx.arc(pinX, pinY - r * 1.1, r, Math.PI * 0.82, Math.PI * 0.18, false);
  ctx.lineTo(pinX, pinY + r * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#B31412';
  ctx.lineWidth = Math.max(1.5, size * 0.008);
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(pinX, pinY - r * 1.1, r * 0.36, 0, Math.PI * 2);
  ctx.fill();

  return c;
}

// ---------- Geo-Tag Overlay Canvas Renderer (matches Baiju GEO.pdf style) ----------
function wrapCanvasText(ctx, text, maxW, maxLines = 3) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.trim().split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxW) { line = test; continue; }
      if (line) {
        out.push(line);
        if (out.length >= maxLines) return out;
      }
      line = word;
    }
    if (line) {
      out.push(line);
      if (out.length >= maxLines) return out;
    }
  }
  return out;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// Draws the photo + optional Baiju-GEO-style location overlay onto a target <canvas>.
// cfg: { enabled, showMap, dateTime, place, address, lat, lng }
export function drawGeoPhoto(canvas, img, cfg, miniMap = null, maxSide = 0) {
  const nw = img.naturalWidth || img.width || 1200;
  const nh = img.naturalHeight || img.height || 900;
  const k = maxSide > 0 ? Math.min(1, maxSide / Math.max(nw, nh)) : 1;
  const w = Math.max(1, Math.round(nw * k));
  const h = Math.max(1, Math.round(nh * k));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  if (!cfg || !cfg.enabled) return { w, h };

  const hasCoords = validCoord(cfg.lat, cfg.lng);
  const coordLine = hasCoords ? `Lat ${Number(cfg.lat).toFixed(6)} Long ${Number(cfg.lng).toFixed(6)}` : '';
  const dateTime = String(cfg.dateTime || '').trim();
  const place = String(cfg.place || '').trim();
  const address = String(cfg.address || '').trim();
  const hasAnyText = !!(dateTime || place || address || coordLine);
  const useMap = !!(cfg.showMap && hasCoords && miniMap);
  if (!hasAnyText && !useMap) return { w, h };

  const base = Math.min(w, h);
  const pad = Math.round(base * 0.024);
  const gap = Math.round(base * 0.024);
  const mapSize = useMap ? Math.round(base * 0.245) : 0;
  const textX = pad + (useMap ? mapSize + gap : 0);
  const textW = Math.max(120, w - textX - pad);

  const badgeFs = Math.max(11, Math.round(base * 0.020));
  const dtFs = Math.max(16, Math.round(base * 0.044));
  const placeFs = Math.max(13, Math.round(base * 0.031));
  const bodyFs = Math.max(12, Math.round(base * 0.027));
  const font = (weight, size) => `${weight} ${size}px "Noto Sans", "Segoe UI", Arial, sans-serif`;

  // Measure lines to calculate overlay height cleanly (and always cover any prior bottom GPS stamp)
  const blocks = [];
  blocks.push({ kind: 'badge', h: Math.round(badgeFs * 1.65), gap: Math.round(base * 0.010) });
  if (dateTime) blocks.push({ kind: 'dt', text: dateTime, fs: dtFs, lh: Math.round(dtFs * 1.18), gap: Math.round(base * 0.008) });
  if (place) {
    ctx.font = font(600, placeFs);
    const lines = wrapCanvasText(ctx, place, textW, 2);
    blocks.push({ kind: 'place', lines, fs: placeFs, lh: Math.round(placeFs * 1.24), gap: Math.round(base * 0.005) });
  }
  if (address) {
    ctx.font = font(400, bodyFs);
    const lines = wrapCanvasText(ctx, address, textW, 3);
    blocks.push({ kind: 'addr', lines, fs: bodyFs, lh: Math.round(bodyFs * 1.26), gap: Math.round(base * 0.006) });
  }
  if (coordLine) {
    blocks.push({ kind: 'coord', text: coordLine, fs: bodyFs, lh: Math.round(bodyFs * 1.26), gap: 0 });
  }

  let contentH = 0;
  blocks.forEach((b, idx) => {
    const bh = b.kind === 'badge' ? b.h : b.lines ? b.lines.length * b.lh : b.lh;
    contentH += bh + (idx < blocks.length - 1 ? b.gap : 0);
  });

  const minBand = Math.round(base * 0.22); // cleanly covers existing Pontis bottom GPS stamp (~19.2%)
  const bandH = Math.min(Math.round(h * 0.44), Math.max(minBand, mapSize + pad * 2, contentH + pad * 2));
  const bandY = h - bandH;

  // Dark semi-transparent backdrop across the bottom edge
  const grad = ctx.createLinearGradient(0, bandY - Math.round(base * 0.04), 0, h);
  grad.addColorStop(0, 'rgba(12, 22, 30, 0)');
  grad.addColorStop(0.16, 'rgba(12, 22, 30, 0.72)');
  grad.addColorStop(1, 'rgba(12, 22, 30, 0.86)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, bandY - Math.round(base * 0.04), w, bandH + Math.round(base * 0.04));

  // Left mini-map thumbnail card
  if (useMap) {
    const my = h - pad - mapSize;
    ctx.save();
    roundRectPath(ctx, pad, my, mapSize, mapSize, Math.round(base * 0.016));
    ctx.clip();
    ctx.drawImage(miniMap, pad, my, mapSize, mapSize);
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, pad, my, mapSize, mapSize, Math.round(base * 0.016));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = Math.max(1.5, base * 0.003);
    ctx.stroke();
    ctx.restore();
  }

  // Right text column vertically centered inside the band
  let y = bandY + Math.max(pad, Math.round((bandH - contentH) / 2));
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = Math.max(2, base * 0.005);
  ctx.shadowOffsetY = 1;

  for (const b of blocks) {
    if (b.kind === 'badge') {
      const label = 'GPS Location';
      ctx.font = font(600, badgeFs);
      const tw = ctx.measureText(label).width;
      const bw = tw + badgeFs * 1.4, bh = b.h;
      ctx.save();
      ctx.shadowColor = 'transparent';
      roundRectPath(ctx, textX, y, bw, bh, Math.round(bh * 0.25));
      ctx.fillStyle = 'rgba(47, 134, 184, 0.92)';
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, textX + badgeFs * 0.7, y + Math.round((bh - badgeFs) / 2) - 1);
      y += bh + b.gap;
    } else if (b.kind === 'dt') {
      ctx.font = font(600, b.fs);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(b.text, textX, y, textW);
      y += b.lh + b.gap;
    } else if (b.kind === 'place') {
      ctx.font = font(600, b.fs);
      ctx.fillStyle = '#FFFFFF';
      for (const ln of b.lines) { ctx.fillText(ln, textX, y, textW); y += b.lh; }
      y += b.gap;
    } else if (b.kind === 'addr') {
      ctx.font = font(400, b.fs);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      for (const ln of b.lines) { ctx.fillText(ln, textX, y, textW); y += b.lh; }
      y += b.gap;
    } else if (b.kind === 'coord') {
      ctx.font = font(600, b.fs);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(b.text, textX, y, textW);
      y += b.lh;
    }
  }
  ctx.shadowColor = 'transparent';
  return { w, h };
}

export async function renderGeoPhotoBlob(photo, cfg, miniMap = null, { maxSide = MAX_EXPORT_SIDE, quality = EXPORT_QUALITY, forceEncode = false } = {}) {
  const hasOverlay = !!(cfg && cfg.enabled);
  if (!hasOverlay && !forceEncode) return { blob: photo.blob, w: photo.w, h: photo.h };
  const img = photo.img || await loadImgFromBlob(photo.blob);
  const c = document.createElement('canvas');
  try {
    const { w, h } = drawGeoPhoto(c, img, hasOverlay ? cfg : null, hasOverlay ? miniMap : null, maxSide);
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.type !== 'image/jpeg') throw new Error('jpeg');
    // For non-overlay pages (e.g. inverter serial), keep the original untouched if it is already smaller
    if (!hasOverlay && photo.blob && photo.blob.type === 'image/jpeg' && photo.blob.size <= blob.size) {
      return { blob: photo.blob, w: photo.w, h: photo.h };
    }
    return { blob, w, h };
  } finally {
    c.width = c.height = 0;
  }
}

// Renders all GEO PDF pages from original source images so overlays stay vector-crisp,
// finding the highest possible resolution & JPEG quality that stays strictly <= maxBytes.
// items: [{ photo, cfg, miniMap }], buildPdf: (pages) => Promise<Blob>
export async function buildOptimizedGeoPdf(items, buildPdf, maxBytes) {
  const renderAll = async (maxSide, quality, forceEncode) => {
    const pages = [];
    for (const it of items) {
      pages.push(await renderGeoPhotoBlob(it.photo, it.cfg, it.miniMap, { maxSide, quality, forceEncode }));
    }
    return buildPdf(pages);
  };

  // Pass 1: top quality (full 1600px, Q=0.88 on overlays, untouched original on non-overlay pages)
  const top = await renderAll(MAX_EXPORT_SIDE, EXPORT_QUALITY, false);
  if (!maxBytes || top.size <= maxBytes) return top;

  // Pass 2: binary-search highest quality per resolution tier directly from original source images
  let smallest = top;
  for (const tier of GEO_SIZE_TIERS) {
    const low = await renderAll(tier.maxSide, tier.minQ, true);
    if (low.size < smallest.size) smallest = low;
    if (low.size > maxBytes) continue;
    let best = low;
    const high = await renderAll(tier.maxSide, tier.maxQ, true);
    if (high.size <= maxBytes) return high;
    let lo = tier.minQ, hi = tier.maxQ;
    for (let step = 0; step < 4; step++) {
      const mid = +((lo + hi) / 2).toFixed(3);
      const cur = await renderAll(tier.maxSide, mid, true);
      if (cur.size <= maxBytes) { best = cur; lo = mid; } else hi = mid;
    }
    return best;
  }
  return smallest;
}

export { loadImgFromBlob };
