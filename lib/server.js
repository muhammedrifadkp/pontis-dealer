// Pontis dealer app: the server side (Cloudflare Pages Functions + a D1 database).
// Only logins and the dealer list live here. Client details never reach the server:
// dealers make the PDF on their phone and send it on WhatsApp.
//
// Settings (Cloudflare > Settings > Variables and Secrets; locally in .dev.vars):
//   ADMIN_PHONE, ADMIN_PASSWORD   the Pontis office login
//   SESSION_SECRET                signs logins; changing it logs everyone out
//   PASSWORD_SECRET               mixed into dealer passwords; never change it once dealers exist
// Database binding: DB (D1). The tables are created on first use.

const enc = new TextEncoder();
const dec = new TextDecoder();
const TOKEN_DAYS = 30;
const MIN = 60 * 1000;
// Wrong passwords lock a number only for the connection they came from, so a stranger who knows
// the office number cannot lock the office out. A second, higher limit counts every connection.
const PAIR_FAILS = 10, PAIR_LOCK = 5 * MIN;                            // one number, one connection
const NUMBER_FAILS = 50, NUMBER_WINDOW = 15 * MIN, NUMBER_LOCK = 15 * MIN; // one number, all connections

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const fail = (status, error, message, extra = {}) => json({ error, message, ...extra }, status);

const b64url = bytes => {
  let s = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = str => {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
};
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
// compares without stopping at the first different character
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const normPhone = p => {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d; // drops +91 or a leading 0
};
const validPhone = p => /^[6-9]\d{9}$/.test(p);
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- database ----------
let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS dealers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        area TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        token_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL)`),
      // key: "<phone>|<connection>" or "<phone>"; since: when the counted wrong passwords began
      db.prepare(`CREATE TABLE IF NOT EXISTS login_fails (
        key TEXT PRIMARY KEY,
        fails INTEGER NOT NULL DEFAULT 0,
        since INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0)`),
      db.prepare('DROP TABLE IF EXISTS login_attempts') // replaced by login_fails
    ]).catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}
const publicDealer = d => ({
  id: d.id, name: d.name, phone: d.phone, area: d.area, notes: d.notes,
  active: !!d.active, createdAt: d.created_at, updatedAt: d.updated_at
});

// ---------- passwords and logins ----------
const hashPassword = async (env, salt, pw) => b64url(await hmac(env.PASSWORD_SECRET, `${salt}:${pw}`));
const newSalt = () => b64url(crypto.getRandomValues(new Uint8Array(16)));
// 4 letters + 4 digits, without look-alikes (I, O, 0, 1): easy to type on a phone
function newPassword() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789';
  const r = crypto.getRandomValues(new Uint32Array(8));
  let s = '';
  for (let i = 0; i < 4; i++) s += L[r[i] % L.length];
  for (let i = 4; i < 8; i++) s += D[r[i] % D.length];
  return s;
}
function checkPassword(pw) {
  const p = String(pw ?? '');
  if (p.length < 6) return 'The password needs at least 6 characters.';
  if (p.length > 40) return 'The password can have at most 40 characters.';
  if (/\s/.test(p)) return 'The password cannot have spaces.';
  return '';
}

// a changed admin phone or password ends the admin's existing logins
const adminVersion = async env => b64url(await hmac(env.SESSION_SECRET, `admin:${normPhone(env.ADMIN_PHONE)}:${env.ADMIN_PASSWORD}`)).slice(0, 12);

async function makeToken(env, payload) {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_DAYS * 864e5 })));
  return `${body}.${b64url(await hmac(env.SESSION_SECRET, body))}`;
}
async function readToken(env, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  if (!same(sig, b64url(await hmac(env.SESSION_SECRET, body)))) return null;
  let p;
  try { p = JSON.parse(dec.decode(unb64url(body))); } catch { return null; }
  return p && p.exp > Date.now() ? p : null;
}

// The logged-in user, checked against the current admin settings and dealer list
async function currentUser(env, request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const p = await readToken(env, token);
  if (!p) return null;
  if (p.r === 'admin') {
    return p.v === await adminVersion(env) ? { role: 'admin', name: 'Pontis office', phone: normPhone(env.ADMIN_PHONE), tok: { r: 'admin', v: p.v } } : null;
  }
  if (p.r === 'dealer') {
    const d = await env.DB.prepare('SELECT * FROM dealers WHERE id = ?').bind(p.id).first();
    if (!d || !d.active || d.token_version !== p.v) return null; // blocked, deleted or password reset
    return { role: 'dealer', id: d.id, name: d.name, phone: d.phone, area: d.area, tok: { r: 'dealer', id: d.id, v: d.token_version } };
  }
  return null;
}
const userOut = u => ({ role: u.role, name: u.name, phone: u.phone, area: u.area || '' });

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

const readFails = (db, key) => db.prepare('SELECT * FROM login_fails WHERE key = ?').bind(key).first();
const writeFails = (db, key, fails, since, lockedUntil) => db.prepare(
  'INSERT INTO login_fails (key, fails, since, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, since = excluded.since, locked_until = excluded.locked_until'
).bind(key, fails, since, lockedUntil);
const lockedReply = ms => fail(429, 'locked', 'Too many wrong passwords. Try again in a few minutes.', { retryIn: Math.ceil(ms / 1000) });
// ends the lock and the count for a number, on every connection
const clearFails = (db, phone) => db.prepare('DELETE FROM login_fails WHERE key = ? OR key LIKE ?').bind(phone, `${phone}|%`);

async function login(env, request) {
  const { phone, password } = await readBody(request);
  const p = normPhone(phone);
  const pw = String(password ?? '');
  if (!validPhone(p) || !pw) return fail(400, 'missing', 'Enter your 10-digit mobile number and your password.');
  const now = Date.now();
  const pairKey = `${p}|${request.headers.get('cf-connecting-ip') || 'unknown'}`;
  const [pair, num] = await Promise.all([readFails(env.DB, pairKey), readFails(env.DB, p)]);
  const lockedUntil = Math.max(pair ? pair.locked_until : 0, num ? num.locked_until : 0);
  if (lockedUntil > now) return lockedReply(lockedUntil - now);

  let user = null, blocked = false;
  if (p === normPhone(env.ADMIN_PHONE)) {
    if (same(pw, String(env.ADMIN_PASSWORD))) user = { role: 'admin', name: 'Pontis office', phone: p, tok: { r: 'admin', v: await adminVersion(env) } };
  } else {
    const d = await env.DB.prepare('SELECT * FROM dealers WHERE phone = ?').bind(p).first();
    if (d && same(await hashPassword(env, d.salt, pw), d.hash)) {
      if (d.active) user = { role: 'dealer', name: d.name, phone: d.phone, area: d.area, tok: { r: 'dealer', id: d.id, v: d.token_version } };
      else blocked = true;
    }
  }
  if (blocked) return fail(403, 'blocked', 'This login is blocked. Please contact Pontis Energy.');

  if (!user) {
    const pairFails = (pair ? pair.fails : 0) + 1;
    const inWindow = num && now - num.since < NUMBER_WINDOW;
    const numFails = (inWindow ? num.fails : 0) + 1, numSince = inWindow ? num.since : now;
    const pairLock = pairFails >= PAIR_FAILS, numLock = numFails >= NUMBER_FAILS;
    await env.DB.batch([
      pairLock ? writeFails(env.DB, pairKey, 0, now, now + PAIR_LOCK) : writeFails(env.DB, pairKey, pairFails, pair ? pair.since : now, 0),
      numLock ? writeFails(env.DB, p, 0, now, now + NUMBER_LOCK) : writeFails(env.DB, p, numFails, numSince, 0)
    ]);
    if (pairLock || numLock) return lockedReply(numLock ? NUMBER_LOCK : PAIR_LOCK);
    return fail(401, 'wrong', 'The mobile number or password is wrong.', { triesLeft: PAIR_FAILS - pairFails });
  }

  if (pair || num) await clearFails(env.DB, p).run();
  return json({ token: await makeToken(env, user.tok), user: userOut(user) });
}

// ---------- dealers (admin only) ----------
async function readDealerInput(env, body, current) {
  const name = clean(body.name, 60);
  const phone = normPhone(body.phone);
  const area = clean(body.area, 60);
  const notes = clean(body.notes, 300);
  const errors = {};
  if (name.length < 2) errors.name = 'Enter the dealer’s name.';
  if (!validPhone(phone)) errors.phone = 'Enter a 10-digit mobile number.';
  else if (phone === normPhone(env.ADMIN_PHONE)) errors.phone = 'This is the admin’s number. Use a different number.';
  else {
    const other = await env.DB.prepare('SELECT id, name FROM dealers WHERE phone = ?').bind(phone).first();
    if (other && (!current || other.id !== current.id)) errors.phone = `This number is already used by ${other.name}.`;
  }
  return { name, phone, area, notes, errors };
}

async function dealers(env, request, user, parts) {
  if (user.role !== 'admin') return fail(403, 'forbidden', 'Only the Pontis office can do this.');
  const method = request.method;
  const id = parts[1] ? Number(parts[1]) : null;
  const now = Date.now();

  if (!id && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM dealers ORDER BY active DESC, name COLLATE NOCASE').all();
    return json({ dealers: results.map(publicDealer) });
  }

  if (!id && method === 'POST') {
    const body = await readBody(request);
    const input = await readDealerInput(env, body, null);
    const typed = String(body.password ?? '').trim();
    if (typed) { const e = checkPassword(typed); if (e) input.errors.password = e; }
    if (Object.keys(input.errors).length) return fail(400, 'invalid', 'Please check the marked fields.', { fields: input.errors });
    const password = typed || newPassword();
    const salt = newSalt();
    const r = await env.DB.prepare('INSERT INTO dealers (name, phone, area, notes, active, salt, hash, token_version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 1, ?, ?)')
      .bind(input.name, input.phone, input.area, input.notes, salt, await hashPassword(env, salt, password), now, now).run();
    const d = await env.DB.prepare('SELECT * FROM dealers WHERE id = ?').bind(r.meta.last_row_id).first();
    return json({ dealer: publicDealer(d), password }, 201);
  }

  if (!id) return fail(405, 'method', 'Not allowed.');
  const d = await env.DB.prepare('SELECT * FROM dealers WHERE id = ?').bind(id).first();
  if (!d) return fail(404, 'not_found', 'This dealer no longer exists.');

  if (parts[2] === 'reset' && method === 'POST') {
    const body = await readBody(request);
    const typed = String(body.password ?? '').trim();
    if (typed) { const e = checkPassword(typed); if (e) return fail(400, 'invalid', e, { fields: { password: e } }); }
    const password = typed || newPassword();
    const salt = newSalt();
    // a new token version logs the dealer out of every phone
    await env.DB.prepare('UPDATE dealers SET salt = ?, hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?')
      .bind(salt, await hashPassword(env, salt, password), now, id).run();
    await clearFails(env.DB, d.phone).run();
    const fresh = await env.DB.prepare('SELECT * FROM dealers WHERE id = ?').bind(id).first();
    return json({ dealer: publicDealer(fresh), password });
  }

  if (!parts[2] && method === 'PUT') {
    const body = await readBody(request);
    const input = await readDealerInput(env, { name: d.name, phone: d.phone, area: d.area, notes: d.notes, ...body }, d);
    if (Object.keys(input.errors).length) return fail(400, 'invalid', 'Please check the marked fields.', { fields: input.errors });
    const active = body.active === undefined ? !!d.active : !!body.active;
    // blocking, or moving the login to another number, ends the dealer's current logins
    const bump = (!active && d.active) || input.phone !== d.phone ? 1 : 0;
    await env.DB.prepare('UPDATE dealers SET name = ?, phone = ?, area = ?, notes = ?, active = ?, token_version = token_version + ?, updated_at = ? WHERE id = ?')
      .bind(input.name, input.phone, input.area, input.notes, active ? 1 : 0, bump, now, id).run();
    const fresh = await env.DB.prepare('SELECT * FROM dealers WHERE id = ?').bind(id).first();
    return json({ dealer: publicDealer(fresh) });
  }

  if (!parts[2] && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM dealers WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return fail(405, 'method', 'Not allowed.');
}

// ---------- router ----------
export async function handle({ request, env }) {
  try {
    const missing = ['ADMIN_PHONE', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'PASSWORD_SECRET'].filter(k => !env[k]);
    if (!env.DB) missing.push('DB (D1 database binding)');
    if (missing.length) return fail(500, 'setup', `The app is not set up yet. Missing: ${missing.join(', ')}.`);
    if (String(env.SESSION_SECRET).length < 24 || String(env.PASSWORD_SECRET).length < 24) {
      return fail(500, 'setup', 'SESSION_SECRET and PASSWORD_SECRET must be long random strings (24+ characters).');
    }
    await ensureSchema(env.DB);

    const parts = new URL(request.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 'login' && request.method === 'POST') return await login(env, request);

    const user = await currentUser(env, request);
    if (!user) return fail(401, 'login', 'Please log in again.');
    if (parts[0] === 'me' && request.method === 'GET') {
      return json({ user: userOut(user), token: await makeToken(env, user.tok) }); // renewed while the app is used
    }
    if (parts[0] === 'dealers') return await dealers(env, request, user, parts);
    return fail(404, 'not_found', 'Not found.');
  } catch (err) {
    // shows in Cloudflare > the Pages project > Functions > Logs (no passwords or client details are in it)
    console.error('api error', request.method, new URL(request.url).pathname, err && err.stack ? err.stack : err);
    return fail(500, 'server', 'Something went wrong on the server. Please try again.');
  }
}
