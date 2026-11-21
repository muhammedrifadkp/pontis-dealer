// Kept on the dealer's phone only: unfinished forms (drafts) with their photos, and a short list of
// clients already sent (name, consumer number and mobile; the Aadhaar number until Section 2 is sent)
// to fill Section 2 quickly.
// Drafts are deleted after the PDF is sent ("Done") or DRAFT_DAYS after they were last changed.
// On the office's device: the client list read from received PDFs ("office"), and the PDFs themselves
// ("officePdfs"), so their photos can be seen and saved later.

const DB_NAME = 'pontis-dealer';
export const DRAFT_DAYS = 30;
let dbp = null;

function openDb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('office')) db.createObjectStore('office', { keyPath: 'ref' });
        if (!db.objectStoreNames.contains('officePdfs')) db.createObjectStore('officePdfs', { keyPath: 'ref' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbp = null; }; // let a newer version of the app upgrade the storage
        resolve(db);
      };
      req.onerror = () => { dbp = null; reject(req.error); };
    });
  }
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(r => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const reqP = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function saveDraft(d) {
  d.updatedAt = Date.now();
  await tx('drafts', 'readwrite', s => s.put(d));
}
export const getDraft = id => tx('drafts', 'readonly', s => reqP(s.get(id)));
export async function listDrafts(owner) {
  const all = await tx('drafts', 'readonly', s => reqP(s.getAll()));
  return (all || []).filter(d => d.owner === owner).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function deleteDraft(id) {
  const d = await getDraft(id);
  if (d) await deletePhotos(photoIds(d));
  await tx('drafts', 'readwrite', s => s.delete(id));
}
export function photoIds(d) {
  return Object.values(d.values || {}).flatMap(v => Array.isArray(v) ? v.filter(x => x && x.pid).map(x => x.pid) : []);
}

export async function savePhoto(blob) {
  const id = newId();
  await tx('photos', 'readwrite', s => s.put({ id, blob }));
  return id;
}
export async function getPhoto(id) {
  const r = await tx('photos', 'readonly', s => reqP(s.get(id)));
  return r ? r.blob : null;
}
export async function deletePhotos(ids) {
  if (!ids.length) return;
  await tx('photos', 'readwrite', s => { ids.forEach(id => s.delete(id)); });
}

// Removes drafts older than DRAFT_DAYS, and photos no draft uses
export async function cleanUp() {
  try {
    const drafts = await tx('drafts', 'readonly', s => reqP(s.getAll()));
    const old = Date.now() - DRAFT_DAYS * 864e5;
    for (const d of drafts) if (d.updatedAt < old) await deleteDraft(d.id);
    const keep = new Set((await tx('drafts', 'readonly', s => reqP(s.getAll()))).flatMap(photoIds));
    const ids = await tx('photos', 'readonly', s => reqP(s.getAllKeys()));
    await deletePhotos(ids.filter(id => !keep.has(id)));
  } catch (e) { /* storage not available: nothing to clean */ }
}
// Asks the browser not to clear the saved forms and photos when the phone runs low on space
export async function keepStorage() {
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) { /* not supported */ }
}

// ---------- office: the client list, one row per PDF (Ref) ----------
export const listOffice = () => tx('office', 'readonly', s => reqP(s.getAll())).then(r => r || []);
export async function putOffice(rows) {
  if (!rows.length) return;
  await tx('office', 'readwrite', s => { rows.forEach(r => s.put(r)); });
}
export async function clearOffice() {
  await tx('office', 'readwrite', s => s.clear());
  await tx('officePdfs', 'readwrite', s => s.clear());
}
export async function deleteOffice(refs) {
  await tx('office', 'readwrite', s => { refs.forEach(r => s.delete(r)); });
  await tx('officePdfs', 'readwrite', s => { refs.forEach(r => s.delete(r)); });
}
export const putOfficePdf = (ref, blob) => tx('officePdfs', 'readwrite', s => s.put({ ref, blob }));
export const getOfficePdf = ref => tx('officePdfs', 'readonly', s => reqP(s.get(ref))).then(r => r ? r.blob : null);
export const officePdfRefs = () => tx('officePdfs', 'readonly', s => reqP(s.getAllKeys())).then(k => new Set(k || []));

// ---------- clients already sent ----------
// One entry per consumer number: { consumer, name, mobile, mode, aadhaar, at (Section 1 sent), s2At (Section 2 sent) }
const recentKey = owner => `pontis-recent-${owner}`;
export function listRecent(owner) {
  try { return JSON.parse(localStorage.getItem(recentKey(owner)) || '[]'); } catch (e) { return []; }
}
// Called on "Done": Section 1 keeps what fills Section 2; Section 2 then removes the Aadhaar number
export function markSent(owner, section, c) {
  const list = listRecent(owner);
  const old = list.find(x => x.consumer === c.consumer);
  const x = section === 1
    ? { ...old, name: c.name, consumer: c.consumer, mobile: c.mobile, mode: c.mode, aadhaar: c.aadhaar, at: Date.now() }
    : { ...old, name: (old && old.name) || c.name, consumer: c.consumer, aadhaar: undefined, s2At: Date.now() };
  const rest = list.filter(y => y.consumer !== c.consumer);
  try { localStorage.setItem(recentKey(owner), JSON.stringify([x, ...rest].slice(0, 150))); } catch (e) { /* ignore */ }
}
