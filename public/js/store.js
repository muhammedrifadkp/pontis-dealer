// Kept on the dealer's phone only: unfinished forms (drafts) with their photos, and a short list of
// clients already sent (name, consumer number and mobile only) to fill Section 2 quickly.
// Drafts are deleted after the PDF is sent ("Done") or after DRAFT_DAYS.

const DB_NAME = 'pontis-dealer';
const DRAFT_DAYS = 7;
let dbp = null;

function openDb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
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
export async function wipeAll() {
  try { await tx('drafts', 'readwrite', s => s.clear()); await tx('photos', 'readwrite', s => s.clear()); } catch (e) { /* ignore */ }
}

// ---------- clients already sent (for Section 2) ----------
const recentKey = owner => `pontis-recent-${owner}`;
export function listRecent(owner) {
  try { return JSON.parse(localStorage.getItem(recentKey(owner)) || '[]'); } catch (e) { return []; }
}
export function addRecent(owner, c) {
  const list = listRecent(owner).filter(x => x.consumer !== c.consumer);
  list.unshift({ ...c, at: Date.now() });
  try { localStorage.setItem(recentKey(owner), JSON.stringify(list.slice(0, 150))); } catch (e) { /* ignore */ }
}
export function markRecent(owner, consumer, patch) {
  const list = listRecent(owner).map(x => x.consumer === consumer ? { ...x, ...patch } : x);
  try { localStorage.setItem(recentKey(owner), JSON.stringify(list)); } catch (e) { /* ignore */ }
}
