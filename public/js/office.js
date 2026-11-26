// Office side: reads the PDFs dealers send, groups them by client, and takes the photos out of them.

import { SECTIONS } from './fields.js';
import { readPdfData, buildGeoPdf } from './pdf.js';

// Reads the details stored in each PDF. Each row keeps its file, so the PDF can be kept too.
export async function readPdfFiles(files) {
  const rows = [], skipped = [];
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { skipped.push(f.name); continue; }
    const data = readPdfData(await f.arrayBuffer());
    if (data && SECTIONS[data.section] && data.ref && data.fields) rows.push({ ...data, file: f }); else skipped.push(f.name);
  }
  return { rows, skipped };
}

// ---------- clients: the forms of one consumer number together ----------
export const clientKey = r => String(r.fields.consumer || '').replace(/\D/g, '') || r.ref;

export function groupClients(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = clientKey(r);
    if (!map.has(k)) map.set(k, { key: k, rows: [] });
    map.get(k).rows.push(r);
  }
  return [...map.values()].map(c => {
    c.rows.sort((a, b) => a.section - b.section || b.createdAt - a.createdAt);
    const newest = c.rows.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const s1 = c.rows.find(r => r.section === 1), s2 = c.rows.find(r => r.section === 2);
    return {
      ...c, s1, s2, latest: newest.createdAt,
      name: (s1 || newest).fields.name || 'No name',
      consumer: (s1 || newest).fields.consumer || '',
      mobile: s1 ? s1.fields.mobile || '' : '',
      dealer: (s1 || newest).dealer || {}
    };
  }).sort((a, b) => b.latest - a.latest);
}

// ---------- photos inside a PDF made by this app ----------
// The app puts each photo in the PDF as a JPEG on a page of its own, titled with the field's name,
// so the photos come out exactly as they went in.
const WIN_BACK = { 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—' };
const pdfString = s => s.replace(/\\(.)/g, '$1').replace(/[\x85\x91-\x97]/g, c => WIN_BACK[c.charCodeAt(0)]);

export async function extractPhotos(pdfBlob) {
  const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 65536) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 65536));
  // where each object starts, from the cross-reference table at the end
  const sx = s.slice(-64).match(/startxref\s+(\d+)\s+%%EOF/);
  if (!sx) return [];
  const xm = s.slice(+sx[1], +sx[1] + 40).match(/^xref\s+0 (\d+)\s+/);
  if (!xm) return [];
  const table = +sx[1] + xm[0].length, at = [];
  for (let n = 1; n < +xm[1]; n++) at[n] = +s.substr(table + n * 20, 10);
  const objText = n => { const a = at[n]; const e = s.indexOf('endobj', a); return a >= 0 && e > a ? s.slice(a, e) : ''; };
  const stream = n => { // [start, length] of an object's stream bytes
    const t = objText(n), len = t.match(/\/Length (\d+)/), k = t.indexOf('stream\n');
    return len && k >= 0 ? [at[n] + k + 7, +len[1]] : null;
  };

  const kids = (objText(2).match(/\/Kids \[([^\]]*)\]/) || [])[1] || '';
  const photos = [];
  let pageNo = 0;
  for (const m of kids.matchAll(/(\d+) 0 R/g)) {
    pageNo++;
    const page = objText(+m[1]);
    const xo = new Map([...page.matchAll(/\/(Im\d+) (\d+) 0 R/g)].map(x => [x[1], +x[2]]));
    const c = stream(+((page.match(/\/Contents (\d+) 0 R/) || [])[1] || 0));
    if (!c) continue;
    const content = s.substr(c[0], c[1]);
    const used = [...content.matchAll(/\/(Im\d+) Do/g)].map(x => x[1]).filter(n => n !== 'Im1'); // Im1 is the logo
    if (!used.length || !xo.has(used[0])) continue;
    const imgObj = xo.get(used[0]), meta = objText(imgObj), data = stream(imgObj);
    if (!data || !/\/DCTDecode/.test(meta)) continue;
    const title = content.match(/\/F2 13 Tf [^\n]*?\(((?:\\.|[^\\)])*)\) Tj/);
    photos.push({
      label: title ? pdfString(title[1]) : `Photo ${photos.length + 1}`,
      page: pageNo,
      w: +((meta.match(/\/Width (\d+)/) || [])[1] || 0), h: +((meta.match(/\/Height (\d+)/) || [])[1] || 0),
      blob: new Blob([bytes.subarray(data[0], data[0] + data[1])], { type: 'image/jpeg' })
    });
  }
  return photos;
}

// A safe file name: no characters that Windows, Android or iPhone refuse
export const fileName = s => String(s).replace(/[\\/:*?"<>|\x00-\x1F]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);

// ---------- GEO PDF (3 full-bleed photos from a Section 2 PDF) ----------
// Order: 1) Panels GPS photo, 2) Inverter work completed photo, 3) Inverter serial number photo.
export const GEO_KEYS = ['panelsGps', 'inverterWorkPhoto', 'inverterSerialPhoto'];

export function pickGeoPhotos(photos) {
  const byKey = new Map(SECTIONS[2].fields.map(f => [f.key, f.label]));
  const norm = s => String(s || '').trim().toLowerCase();
  const found = [], missing = [];
  for (const key of GEO_KEYS) {
    const label = byKey.get(key);
    if (!label) continue;
    const target = norm(label);
    const hit = photos.find(p => norm(p.label) === target || norm(p.label).startsWith(`${target} (`));
    if (hit) found.push(hit);
    else missing.push(label);
  }
  return { found, missing };
}

export const geoPdfName = c => `${fileName(`${c.name && c.name !== 'No name' ? c.name : (c.consumer ? `Consumer ${c.consumer}` : 'Client')} GEO`)}.pdf`;

export async function buildGeoPdfFromPhotos(photos, name) {
  return buildGeoPdf(photos, name.replace(/\.pdf$/i, ''));
}

// ---------- ZIP (stored, no compression: JPEGs do not get smaller) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = b => { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };

export async function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let off = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034B50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(h, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014B50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    central.push(c, name);
    off += 30 + name.length + data.length;
  }
  const size = central.reduce((a, x) => a + x.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054B50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// Saves photos: on a phone through the share sheet ("Save images" puts them in the gallery);
// on a computer one photo downloads as it is, several come as one ZIP file.
export async function savePhotos(files, zipName) {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && typeof File === 'function' && navigator.canShare) {
    const list = files.map(f => new File([f.blob], f.name, { type: 'image/jpeg' }));
    if (navigator.canShare({ files: list })) {
      try { await navigator.share({ files: list }); return 'shared'; }
      catch (err) { if (err && err.name === 'AbortError') return 'cancelled'; }
    }
  }
  if (files.length === 1) download(files[0].blob, files[0].name);
  else download(await makeZip(files), zipName);
  return 'downloaded';
}
