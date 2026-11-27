// Builds the client PDF on the phone: a details table (real text, so it stays small and sharp)
// followed by one page per photo. The typed details are also stored inside the PDF (/PontisData),
// so the Clients tab can list received PDFs without retyping.

import { isPhoto, display, SECTIONS } from './fields.js';
import { getPhoto } from './store.js';
import { fmtCoord, fmtWhen, gpsSource } from './media.js';

const W = 595.28, H = 841.89, M = 40;
const NAVY = [0.157, 0.298, 0.384], BLUE = [0.184, 0.525, 0.722], SAGE = [0.494, 0.616, 0.341];
const RED = [0.706, 0.137, 0.094], GREY = [0.36, 0.40, 0.45], LINE = [0.84, 0.87, 0.90], TINT = [0.933, 0.957, 0.973], INK = [0.12, 0.14, 0.18];

// Helvetica and Helvetica-Bold character widths (1/1000 em) for codes 32–126
const HV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const EXTRA = { 0x96: 556, 0x97: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x85: 1000, 0xB0: 400, 0xB7: 278, 0xB1: 584, 0xD7: 584 };
const WIN = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '₹': null };

// Text in the PDF's WinAnsi encoding (the standard fonts cannot show other scripts)
function ansi(str) {
  let out = '';
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0);
    if (ch === '₹') out += 'Rs.';
    else if (WIN[ch] !== undefined && WIN[ch] !== null) out += String.fromCharCode(WIN[ch]);
    else if (c === 9 || c === 10) out += ' ';
    else if (c >= 32 && c <= 126) out += ch;
    else if (c >= 128 && c <= 255) out += ch; // 128–159: already WinAnsi (text wrapped earlier)
    else out += '?';
  }
  return out;
}
const charW = (code, bold) => code >= 32 && code <= 126 ? (bold ? HB : HV)[code - 32] : (EXTRA[code] ?? 556);
const textW = (s, size, bold) => { let w = 0; for (let i = 0; i < s.length; i++) w += charW(s.charCodeAt(i), bold); return w * size / 1000; };
const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// Splits text into lines that fit the width (long words are broken)
function wrap(text, size, maxW, bold) {
  const lines = [];
  for (const para of ansi(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const tryLine = line ? `${line} ${word}` : word;
      if (textW(tryLine, size, bold) <= maxW) { line = tryLine; continue; }
      if (line) lines.push(line);
      let w = word;
      while (textW(w, size, bold) > maxW) {
        let n = w.length;
        while (n > 1 && textW(w.slice(0, n), size, bold) > maxW) n--;
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

class Page {
  constructor() { this.ops = []; this.images = new Set(); }
  color(c, stroke) { return `${c.map(x => x.toFixed(3)).join(' ')} ${stroke ? 'RG' : 'rg'}`; }
  rect(x, y, w, h, fill) { this.ops.push(`${this.color(fill)} ${x.toFixed(2)} ${(H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  line(x1, y1, x2, y2, c, lw = 0.6) { this.ops.push(`${this.color(c, true)} ${lw} w ${x1.toFixed(2)} ${(H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(H - y2).toFixed(2)} l S`); }
  // y is the text's baseline, measured from the top of the page
  text(x, y, str, size, { bold = false, color = INK, align = 'left' } = {}) {
    const s = ansi(str);
    const w = textW(s, size, bold);
    const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${this.color(color)} ${tx.toFixed(2)} ${(H - y).toFixed(2)} Td (${esc(s)}) Tj ET`);
  }
  image(name, x, y, w, h) { this.images.add(name); this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(H - y - h).toFixed(2)} cm /${name} Do Q`); }
}

const latin1 = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const pdfText = s => '<FEFF' + Array.from(String(s), c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>';

function writePdf(pages, images, info) {
  const parts = [], offsets = [];
  let len = 0;
  const push = x => { const b = typeof x === 'string' ? latin1(x) : x; parts.push(b); len += b.length; };
  const obj = (n, write) => { offsets[n] = len; push(`${n} 0 obj\n`); write(); push('\nendobj\n'); };
  const imgBase = 6, pageBase = imgBase + images.length;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageBase + i * 2} 0 R`).join(' ')}] >>`));
  obj(3, () => push(`<< /Title ${pdfText(info.title)} /Producer ${pdfText('Pontis Energy Dealer App')} /PontisData <${info.data}> >>`));
  obj(4, () => push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  obj(5, () => push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
  images.forEach((im, i) => obj(imgBase + i, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
    push(im.bytes);
    push('\nendstream');
  }));
  pages.forEach((p, i) => {
    const n = pageBase + i * 2;
    const xo = [...p.images].map(name => `/${name} ${imgBase + Number(name.slice(2)) - 1} 0 R`).join(' ');
    obj(n, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${n + 1} 0 R >>`));
    const content = latin1(p.ops.join('\n'));
    obj(n + 1, () => { push(`<< /Length ${content.length} >>\nstream\n`); push(content); push('\nendstream'); });
  });
  const count = pageBase + pages.length * 2, xref = len;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

let logoP = null;
function logoJpeg() {
  if (!logoP) {
    logoP = (async () => {
      const img = new Image();
      img.src = 'assets/logo.png';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
    })().catch(err => { logoP = null; throw err; });
  }
  return logoP;
}

// d: { section, mode, values, fields (in use), dealer: {name, phone}, createdAt, ref }
export async function buildClientPdf(d) {
  const sec = SECTIONS[d.section];
  const modeName = d.mode === 'loan' ? 'Loan' : d.mode === 'cash' ? 'Cash' : '';
  const images = [];
  const addImage = im => { images.push(im); return `Im${images.length}`; };
  const logo = addImage(await logoJpeg());
  const when = fmtWhen(d.createdAt);

  // the rows of the details table
  const rows = [];
  let lastGroup = '';
  const photoFields = d.fields.filter(isPhoto);
  for (const f of d.fields) {
    if ((f.group || '') !== lastGroup) {
      if (f.group === 'co') rows.push({ head: 'Co-applicant (customer is 60 or older)' });
      lastGroup = f.group || '';
    }
    if (isPhoto(f)) rows.push({ label: f.label, photo: f });
    else rows.push({ label: f.label, value: display(f, d.values) || '—' });
  }

  // lay the table out over as many pages as needed
  const LABEL_W = 178, PAD = 6, SIZE = 9.5, LH = 12.5;
  const valueW = W - 2 * M - LABEL_W - 2 * PAD;
  const pages = [];
  const header = (pg, first) => {
    const lh = 30, lw = lh * images[0].w / images[0].h;
    pg.image(logo, M, M - 6, lw, lh);
    pg.text(W - M, M + 6, first ? `Client details · ${sec.title}` : `${sec.title} (continued)`, 14, { bold: true, color: NAVY, align: 'right' });
    pg.text(W - M, M + 20, `${sec.subtitle}${modeName ? ` · ${modeName}` : ''}`, 9.5, { color: BLUE, align: 'right' });
    pg.rect(M, M + 32, W - 2 * M, 1.6, BLUE);
    return M + 50;
  };
  let pg = new Page(); pages.push(pg);
  let y = header(pg, true);
  pg.text(M, y, `Dealer: ${d.dealer.name} (${d.dealer.phone})`, 9, { color: GREY });
  pg.text(W - M, y, `${when}  ·  Ref ${d.ref}`, 9, { color: GREY, align: 'right' });
  y += 12;
  const layout = [];
  for (const r of rows) {
    const lines = r.head ? [r.head] : r.photo ? ['x'] : wrap(r.value, SIZE, valueW, false);
    const labelLines = r.head ? [] : wrap(r.label, SIZE, LABEL_W - 2 * PAD, true);
    const h = r.head ? 20 : Math.max(lines.length, labelLines.length) * LH + 2 * PAD - 2;
    if (y + h > H - M - 24) { pg = new Page(); pages.push(pg); y = header(pg, false); }
    layout.push({ r, pg, y, h, lines, labelLines });
    y += h;
  }

  // photo pages come after the table; now their page numbers are known
  let next = pages.length + 1;
  const photoPages = [], pageNote = new Map();
  for (const f of photoFields) {
    const list = d.values[f.key] || [];
    const first = next;
    list.forEach((p, i) => { photoPages.push({ f, p, i, n: list.length }); next++; });
    pageNote.set(f.key, list.length ? (list.length === 1 ? `Photo on page ${first}` : `${list.length} photos, pages ${first}–${next - 1}`) : 'No photo');
  }

  for (const { r, pg: p, y: ry, h, lines, labelLines } of layout) {
    if (r.head) {
      p.rect(M, ry + 4, W - 2 * M, h - 4, NAVY);
      p.text(M + PAD, ry + 16, r.head, 9.5, { bold: true, color: [1, 1, 1] });
      continue;
    }
    p.rect(M, ry, LABEL_W, h, TINT);
    p.line(M + LABEL_W, ry, M + LABEL_W, ry + h, LINE);
    labelLines.forEach((t, i) => p.text(M + PAD, ry + PAD + 9 + i * LH, t, SIZE, { bold: true, color: NAVY }));
    const vlines = r.photo ? [pageNote.get(r.photo.key)] : lines;
    vlines.forEach((t, i) => p.text(M + LABEL_W + PAD, ry + PAD + 9 + i * LH, t, SIZE, { color: r.photo ? BLUE : INK }));
    p.line(M, ry + h, W - M, ry + h, LINE);
  }
  // table outline on each page
  for (const p of pages) {
    const mine = layout.filter(l => l.pg === p && !l.r.head);
    if (!mine.length) continue;
    const top = mine[0].y;
    p.line(M, top, W - M, top, LINE);
  }

  // one page per photo
  for (const { f, p: ph, i, n } of photoPages) {
    const page = new Page(); pages.push(page);
    const blob = await getPhoto(ph.pid);
    if (!blob) throw new Error(`The photo “${f.label}” is missing. Please add it again.`);
    const name = addImage({ bytes: new Uint8Array(await blob.arrayBuffer()), w: ph.w, h: ph.h });
    const lw = 22 * images[0].w / images[0].h;
    page.image(logo, W - M - lw, M - 6, lw, 22);
    page.text(M, M + 8, n > 1 ? `${f.label} (${i + 1} of ${n})` : f.label, 13, { bold: true, color: NAVY });
    const meta = [d.values.name, d.values.consumer ? `Consumer ${d.values.consumer}` : ''].filter(Boolean).join('  ·  ');
    page.text(M, M + 22, meta, 9, { color: GREY });
    let top = M + 34;
    if (ph.gps) {
      const src = gpsSource(ph.gps);
      page.text(M, top + 4, `GPS: ${fmtCoord(ph.gps.lat, 'N', 'S')}, ${fmtCoord(ph.gps.lng, 'E', 'W')}${ph.gps.acc != null ? ` (±${Math.round(ph.gps.acc)} m)` : ''} · ${fmtWhen(ph.gps.at)}${src ? ` · ${src}` : ''}`, 8.5, { color: SAGE, bold: true });
      top += 12;
    } else if (ph.noGps) {
      page.text(M, top + 4, 'No GPS: the photo had no location saved in it, and the device location was not available.', 8.5, { color: RED, bold: true });
      top += 12;
    }
    page.rect(M, top, W - 2 * M, 1, LINE);
    const boxY = top + 10, boxW = W - 2 * M, boxH = H - boxY - M - 20;
    const k = Math.min(boxW / ph.w, boxH / ph.h);
    const iw = ph.w * k, ih = ph.h * k;
    page.image(name, M + (boxW - iw) / 2, boxY + (boxH - ih) / 2, iw, ih);
  }

  // footer with page numbers
  pages.forEach((p, i) => {
    p.line(M, H - M + 2, W - M, H - M + 2, LINE, 0.5);
    p.text(M, H - M + 14, `Pontis Energy · ${sec.title} ${sec.subtitle}${modeName ? ` · ${modeName}` : ''} · ${d.values.name || ''}`, 7.5, { color: GREY });
    p.text(W - M, H - M + 14, `Page ${i + 1} of ${pages.length}`, 7.5, { color: GREY, align: 'right' });
  });

  // the typed details, for the office page
  const data = {
    app: 'pontis-dealer', v: 1, section: d.section, mode: d.mode || '', ref: d.ref, createdAt: d.createdAt,
    dealer: d.dealer,
    fields: Object.fromEntries(d.fields.filter(f => !isPhoto(f)).map(f => [f.key, display(f, d.values)]))
  };
  return writePdf(pages, images, { title: `${sec.title} ${sec.subtitle} – ${d.values.name || ''}`, data: hex(new TextEncoder().encode(JSON.stringify(data))) });
}

// Full-bleed photo-only PDF (one photo per page, each page sized to the photo's aspect ratio within 612 × 792 pt).
// Used on the office/staff side to create "<Customer Name> GEO.pdf" from Section 2 photos.
// photos: [{ blob, w, h }]
export async function buildGeoPdf(photos, title = 'GEO') {
  if (!photos || !photos.length) throw new Error('No photos to include in the GEO PDF.');
  const MAX_W = 612, MAX_H = 792;
  const items = [];
  for (const p of photos) {
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    const w = p.w > 0 ? p.w : MAX_W, h = p.h > 0 ? p.h : MAX_H;
    const k = Math.min(MAX_W / w, MAX_H / h);
    items.push({ bytes, w, h, pw: +(w * k).toFixed(2), ph: +(h * k).toFixed(2) });
  }
  const parts = [], offsets = [];
  let len = 0;
  const push = x => { const b = typeof x === 'string' ? latin1(x) : x; parts.push(b); len += b.length; };
  const obj = (n, write) => { offsets[n] = len; push(`${n} 0 obj\n`); write(); push('\nendobj\n'); };
  const imgBase = 4, pageBase = imgBase + items.length;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${items.length} /Kids [${items.map((_, i) => `${pageBase + i * 2} 0 R`).join(' ')}] >>`));
  obj(3, () => push(`<< /Title ${pdfText(title)} /Producer ${pdfText('Pontis Energy Dealer App')} >>`));
  items.forEach((im, i) => obj(imgBase + i, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
    push(im.bytes);
    push('\nendstream');
  }));
  items.forEach((im, i) => {
    const n = pageBase + i * 2;
    const name = `Im${i + 1}`;
    obj(n, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${im.pw} ${im.ph}] /Resources << /XObject << /${name} ${imgBase + i} 0 R >> >> /Contents ${n + 1} 0 R >>`));
    const content = latin1(`q ${im.pw.toFixed(2)} 0 0 ${im.ph.toFixed(2)} 0 0 cm /${name} Do Q\n`);
    obj(n + 1, () => { push(`<< /Length ${content.length} >>\nstream\n`); push(content); push('\nendstream'); });
  });
  const count = pageBase + items.length * 2, xref = len;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

// ---------- reading PDFs back ----------
// A PDF made here can come back re-saved by another app (a phone's PDF viewer, "Save as PDF", PDFium…).
// Those keep the pages but rewrite the file: streams get compressed, the layout of the file changes and
// the hidden /PontisData is dropped. So the reader finds objects by scanning, not by fixed offsets.
const inflate = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());

export function openPdf(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 65536) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 65536));
  const objs = new Map(); // n -> { dict, start, len, lenRef }
  const head = /(\d+)\s+\d+\s+obj\b/g;
  let m;
  while ((m = head.exec(s))) {
    const p = head.lastIndex, end = s.indexOf('endobj', p), st = s.indexOf('stream', p);
    if (end < 0) break;
    if (st >= 0 && st < end) {
      const dict = s.slice(p, st);
      const start = st + 6 + (s[st + 6] === '\r' ? 2 : 1);
      const direct = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/), ref = dict.match(/\/Length\s+(\d+)\s+\d+\s+R/);
      let len = direct ? +direct[1] : -1;
      if (len < 0 || s.slice(start + len, start + len + 12).indexOf('endstream') < 0) {
        const es = s.indexOf('endstream', start);
        len = es < 0 ? 0 : es - start;
        if (s[start + len - 1] === '\n') len--;
        if (s[start + len - 1] === '\r') len--;
      }
      objs.set(+m[1], { dict, start, len, lenRef: ref ? +ref[1] : 0 });
      head.lastIndex = Math.max(start + len, s.indexOf('endobj', start + len) + 6);
    } else {
      objs.set(+m[1], { dict: s.slice(p, end) });
      head.lastIndex = end + 6;
    }
  }
  const dict = n => (objs.get(n) || {}).dict || '';
  const refOf = (d, key) => { const r = d.match(new RegExp(`/${key}\\s*(\\d+)\\s+\\d+\\s+R`)); return r ? +r[1] : 0; };
  // a sub-dictionary written inline, or the object it points to
  const sub = (d, key) => {
    const r = refOf(d, key);
    if (r) return dict(r);
    const i = d.indexOf(`/${key}`);
    if (i < 0) return '';
    let k = d.indexOf('<<', i), depth = 0;
    if (k < 0) return '';
    for (let j = k; j < d.length - 1; j++) {
      if (d[j] === '<' && d[j + 1] === '<') { depth++; j++; } else if (d[j] === '>' && d[j + 1] === '>') { depth--; j++; if (!depth) return d.slice(k, j + 1); }
    }
    return '';
  };
  const raw = n => { const o = objs.get(n); return o && o.start != null ? bytes.subarray(o.start, o.start + o.len) : null; };
  const decoded = async n => {
    const b = raw(n);
    if (!b) return '';
    const out = /\/FlateDecode/.test(dict(n)) ? await inflate(b) : b;
    let t = '';
    for (let i = 0; i < out.length; i += 65536) t += String.fromCharCode.apply(null, out.subarray(i, i + 65536));
    return t;
  };
  // the pages in order, each with its resources (inherited from the page tree when not on the page)
  const pages = () => {
    const list = [], seen = new Set();
    const walk = (n, res) => {
      if (!n || seen.has(n)) return;
      seen.add(n);
      const d = dict(n), r = /\/Resources/.test(d) ? sub(d, 'Resources') : res;
      const kids = d.match(/\/Kids\s*\[([^\]]*)\]/);
      if (kids) { for (const k of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) walk(+k[1], r); return; }
      const xo = new Map([...sub(r, 'XObject').matchAll(/\/([^\s/<>\[\]]+)\s*(\d+)\s+\d+\s+R/g)].map(x => [x[1], +x[2]]));
      const arr = d.match(/\/Contents\s*\[([^\]]*)\]/);
      const contents = arr ? [...arr[1].matchAll(/(\d+)\s+\d+\s+R/g)].map(x => +x[1]) : [refOf(d, 'Contents')].filter(Boolean);
      list.push({ n, xo, content: async () => (await Promise.all(contents.map(decoded))).join('\n') });
    };
    const trailerRoot = [...s.matchAll(/\/Root\s*(\d+)\s+\d+\s+R/g)].pop();
    let root = trailerRoot ? refOf(dict(+trailerRoot[1]), 'Pages') : 0;
    if (!root) for (const [n, o] of objs) if (/\/Type\s*\/Pages\b/.test(o.dict) && !/\/Parent\b/.test(o.dict)) { root = n; break; }
    walk(root, '');
    return list;
  };
  return { s, dict, raw, decoded, pages };
}

const WIN_BACK = { 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—' };
export const pdfString = str => str.replace(/\\([0-7]{1,3}|.)/g, (_, c) => /^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ({ n: '\n', r: '\r', t: '\t' }[c] ?? c));
export const fromAnsi = str => str.replace(/[\x85\x91-\x97]/g, c => WIN_BACK[c.charCodeAt(0)]);

// The text drawn on a page: [{ font, size, x, y, white, text (WinAnsi) }] in drawing order
export function pageTexts(content) {
  const out = [];
  for (const m of content.matchAll(/\/(F\d+)\s+([\d.]+)\s+Tf\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg\s+([\d.-]+)\s+([\d.-]+)\s+Td\s*\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj/g)) {
    out.push({ font: m[1], size: +m[2], white: +m[3] > 0.99 && +m[4] > 0.99 && +m[5] > 0.99, x: +m[6], y: +m[7], text: pdfString(m[8]) });
  }
  return out;
}

// Rebuilds the details from the printed table, for a PDF that lost /PontisData when it was re-saved
async function readPdfText(pdf) {
  const pages = pdf.pages();
  if (!pages.length) return null;
  const first = pageTexts(await pages[0].content());
  const title = first.find(t => t.font === 'F2' && t.size === 14 && /^Client details \xB7 Section (\d)$/.test(t.text));
  if (!title) return null;
  const section = +title.text.match(/Section (\d)$/)[1], sec = SECTIONS[section];
  if (!sec) return null;
  const sub = first.find(t => t.size === 9.5 && t.font === 'F1' && t.text.startsWith(sec.subtitle));
  const modeName = sub ? (sub.text.match(/\xB7 (Loan|Cash)$/) || [])[1] : '';
  const dealerT = first.find(t => t.size === 9 && t.text.startsWith('Dealer: '));
  const refT = first.find(t => t.size === 9 && /\xB7\s+Ref \S+$/.test(t.text));
  if (!refT) return null;
  const dm = dealerT ? fromAnsi(dealerT.text).match(/^Dealer: (.*) \(([^()]*)\)$/) : null;
  const when = refT.text.match(/^(\d{1,2}) ([A-Za-z]+),? (\d{4})(?:,| at)? (\d{1,2}):(\d{2})\s*(am|pm)/i); // "27 Nov 2026, 3:07 am" or "15 Nov 2026 at 3:35 PM"
  let createdAt = 0;
  if (when) {
    const mon = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(when[2].slice(0, 3).toLowerCase());
    const hr = (+when[4] % 12) + (/pm/i.test(when[6]) ? 12 : 0);
    createdAt = Date.UTC(+when[3], mon, +when[1], hr, +when[5]) - 330 * 60000; // IST is UTC+5:30
  }

  // table rows: bold label lines at the left, value lines to the right, on the first page and its "continued" pages
  const LABEL_X = M + 6, VALUE_X = M + 178 + 6, valueW = W - 2 * M - 178 - 12;
  const rows = [];
  for (let i = 0; i < pages.length; i++) {
    const texts = i ? pageTexts(await pages[i].content()) : first;
    if (i && !texts.some(t => t.font === 'F2' && t.size === 14 && t.text === `${sec.title} (continued)`)) break;
    let row = null;
    for (const t of texts) {
      if (t.size !== 9.5 || t.white) continue;
      if (t.font === 'F2' && Math.abs(t.x - LABEL_X) < 1) {
        if (!row || row.values.length) { row = { label: [], values: [] }; rows.push(row); }
        row.label.push(t.text);
      } else if (t.font === 'F1' && Math.abs(t.x - VALUE_X) < 1 && row) row.values.push(t.text);
    }
  }
  // lines broken inside a long word (a link) join without a space
  const joinLines = (lines, maxW, bold) => lines.reduce((acc, l, i) => {
    if (!i) return l;
    const prev = lines[i - 1];
    return acc + (!prev.includes(' ') && textW(prev, 9.5, bold) > maxW - 12 ? '' : ' ') + l;
  }, '');
  const byLabel = new Map(rows.map(r => [joinLines(r.label, 178 - 12, true), joinLines(r.values, valueW, false)]));
  const fields = {};
  for (const f of sec.fields) {
    if (isPhoto(f) || !byLabel.has(ansi(f.label))) continue;
    const v = fromAnsi(byLabel.get(ansi(f.label)));
    fields[f.key] = v === '—' ? '' : v;
  }
  if (!Object.keys(fields).length) return null;
  return {
    app: 'pontis-dealer', v: 1, section, mode: modeName ? modeName.toLowerCase() : '', ref: refT.text.match(/Ref (\S+)$/)[1], createdAt,
    dealer: dm ? { name: dm[1], phone: dm[2] } : {}, fields, fromText: true
  };
}

// Reads the details stored in a PDF made by this app (null for other PDFs)
export async function readPdfData(buffer) {
  const pdf = openPdf(buffer);
  const m = pdf.s.match(/\/PontisData\s*<([0-9A-Fa-f]+)>/);
  if (m) {
    const raw = new Uint8Array(m[1].length / 2);
    for (let i = 0; i < raw.length; i++) raw[i] = parseInt(m[1].substr(i * 2, 2), 16);
    try {
      const data = JSON.parse(new TextDecoder().decode(raw));
      if (data && data.app === 'pontis-dealer') return data;
    } catch (e) { /* fall back to the printed details */ }
  }
  try { return await readPdfText(pdf); } catch (e) { return null; }
}
