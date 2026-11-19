// Office page: reads the details stored inside the dealers' PDFs and makes an Excel (CSV) list.

import { SECTIONS, isPhoto } from './fields.js';
import { readPdfData } from './pdf.js';

export async function readPdfFiles(files) {
  const rows = [], skipped = [];
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { skipped.push(f.name); continue; }
    const data = readPdfData(await f.arrayBuffer());
    if (data && SECTIONS[data.section] && data.ref && data.fields) rows.push(data); else skipped.push(f.name);
  }
  return { rows, skipped };
}

// Long numbers (Aadhaar, consumer, serials) are written so Excel keeps every digit
const cell = (v, preserveDigits = true) => {
  const s = String(v ?? '');
  const t = preserveDigits && /^\d{6,}$/.test(s) ? `="${s}"` : s;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function downloadCsv(section, rows) {
  const fields = SECTIONS[section].fields.filter(f => !isPhoto(f));
  const head = ['Date', 'Ref', 'Dealer', 'Dealer mobile', ...(section === 1 ? ['Cash / Loan'] : []), ...fields.map(f => f.label)];
  const fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const lines = rows.slice().sort((a, b) => a.createdAt - b.createdAt).map(r => {
    const details = [
      fmt.format(r.createdAt), r.ref, r.dealer && r.dealer.name, r.dealer && r.dealer.phone,
      ...(section === 1 ? [r.mode === 'loan' ? 'Loan' : r.mode === 'cash' ? 'Cash' : ''] : [])
    ];
    return [...details.map(v => cell(v)), ...fields.map(f => cell(r.fields[f.key], f.type !== 'decimal'))].join(',');
  });
  const csv = '﻿' + [head.map(v => cell(v)).join(','), ...lines].join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `Pontis clients - Section ${section} - ${stamp}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
