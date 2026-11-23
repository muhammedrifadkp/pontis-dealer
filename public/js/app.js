// Pontis Energy dealer app
// One login screen. The Pontis office (admin) manages dealers and staff; staff only upload dealer PDFs and
// extract client details and photos; dealers fill client forms that become a PDF they send on WhatsApp.
// Client details stay on the device and never reach the server.

import { SECTIONS, activeFields, needsCoApplicant, check, note, tidy, display, isPhoto, normMobile, printable } from './fields.js';
import * as store from './store.js';
import * as scan from './scan.js';
import { preparePhoto, getPosition, readExifGps, fmtCoord } from './media.js';
import { buildClientPdf } from './pdf.js';
import { readPdfFiles, groupClients, clientKey, extractPhotos, savePhotos, fileName, download } from './office.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const SESSION_KEY = 'pontis-session';
const prettyPhone = p => String(p || '').replace(/^(\d{5})(\d{5})$/, '$1 $2');
const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(t);
};
const ICON = {
  camera: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  image: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="m4 16 4.5-4.5 4 4 2.5-2.5L20 18"/><circle cx="15.5" cy="9.5" r="1.5"/></svg>',
  pin: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  back: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  wa: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2 2.5 4.3 5 5l1.2-1.3 2 1-.5 1.7c-3.8.4-8.2-3.8-8.2-7.6L10.2 7.8l1 2z"/></svg>',
  plus: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  file: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>',
  trash: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  copy: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>',
  phone: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
  next: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  save: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  scan: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8.5 8.5v7M12 8.5v7M15.5 8.5v7"/></svg>',
  bolt: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5 14h6l-1 7 8-11h-6z"/></svg>'
};
const uniq = a => [...new Set(a)];

// ---------- session ----------
let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
function setSession(s) {
  session = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}
let loginNote = '';
function logout(message) {
  setSession(null);
  loginNote = message || '';
  location.hash = '#/login';
  render();
}

async function api(path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch(`/api/${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(session && session.token ? { authorization: `Bearer ${session.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw Object.assign(new Error('No internet connection. Check the connection and try again.'), { offline: true });
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { logout(data.message || 'Please log in again.'); throw Object.assign(new Error(data.message || 'Please log in again.'), { status: 401 }); }
  if (!r.ok) throw Object.assign(new Error(data.message || 'Something went wrong. Please try again.'), { status: r.status, data });
  return data;
}

// ---------- small UI helpers ----------
function toast(msg, kind = '') {
  const el = $('#toast');
  el.className = `toast show ${kind}`;
  el.textContent = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = 'toast'; }, 3800);
}
function busy(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  btn.setAttribute('aria-busy', on ? 'true' : 'false');
}
let lastFocus = null;
function openModal(html, { onClose, cls = '' } = {}) {
  closeModal();
  lastFocus = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal${cls ? ` ${cls}` : ''}" role="dialog" aria-modal="true" aria-labelledby="mTitle">${html}</div>`;
  document.body.appendChild(back);
  document.body.classList.add('modal-open');
  back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
  back._onClose = onClose;
  const first = back.querySelector('[autofocus], input, select, textarea, button');
  if (first) first.focus();
  return back.firstElementChild;
}
function closeModal() {
  const back = $('.modal-back');
  if (!back) return;
  if (back._onClose) back._onClose();
  back.remove();
  document.body.classList.remove('modal-open');
  if (lastFocus && lastFocus.isConnected) lastFocus.focus();
}
document.addEventListener('keydown', e => {
  const back = $('.modal-back');
  if (!back) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.key === 'Tab') { // keep the focus inside the dialog
    const items = $$('a[href], button:not([disabled]), input, select, textarea', back).filter(x => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
function confirmBox(title, text, okLabel, danger) {
  return new Promise(resolve => {
    let answered = false;
    const m = openModal(`<h2 id="mTitle">${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <div class="modal-actions"><button class="btn" type="button" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-yes>${esc(okLabel)}</button></div>`,
    { onClose: () => { if (!answered) resolve(false); } });
    $('[data-yes]', m).focus();
    $('[data-yes]', m).onclick = () => { answered = true; closeModal(); resolve(true); };
    $('[data-no]', m).onclick = () => closeModal();
  });
}
// ---------- QR code / barcode scanner ----------
// The camera looks for codes until one gives the field's value; "Choose a photo" reads a photo or a
// screenshot instead. o: { kind (scan.READERS), title, multi (stays open for the next code), aim() (the
// line under the picture), accept(value, result) → { ok, msg, done }, partial(result) → message, after() }
const READER_FAIL = 'The code reader could not start in this browser. Update Chrome or Safari, or type the number.';
function scanner(o) {
  const rd = scan.READERS[o.kind];
  const aim = () => (o.aim ? o.aim() : rd.aim);
  let cam = null, timer = 0, loop = 0, closed = false, paused = false, starting = false;
  const seen = new Map(); // code text → when the camera last saw it (Infinity: answered in the list, ignore it)
  const stopCam = () => { loop++; clearTimeout(timer); if (cam) { cam.stop(); cam = null; } };
  clearTimeout(toast.t); $('#toast').className = 'toast'; // an earlier message would cover the buttons
  const onVis = () => { if (document.visibilityState === 'visible' && !closed && !paused) startCam(); };
  const m = openModal(`<div class="scan-head"><h2 id="mTitle">${esc(o.title)}</h2>
      <button class="btn ghost icon" type="button" data-x aria-label="Close">×</button></div>
    <div class="scan-view"><video muted playsinline aria-hidden="true"></video><span class="scan-frame" aria-hidden="true"></span>
      <p class="scan-cam" data-cam>Starting the camera…</p></div>
    <p class="scan-status" data-status aria-live="polite"></p>
    <div class="scan-pick" data-pick hidden></div>
    <div class="scan-acts" data-acts>
      <label class="btn">${ICON.image} Choose a photo<input class="vh" type="file" accept="image/*" data-file${o.multi ? ' multiple' : ''}></label>
      <button class="btn" type="button" data-torch aria-pressed="false" hidden>${ICON.bolt} Light</button>
      <button class="btn${o.multi ? ' primary' : ''}" type="button" data-x>${o.multi ? 'Done' : 'Cancel'}</button>
    </div>`, { cls: 'scanner', onClose: () => {
    closed = true; stopCam();
    document.removeEventListener('visibilitychange', onVis);
    if (o.after) setTimeout(o.after, 0); // after the dialog has handed the focus back
  } });
  const video = $('video', m), camMsg = $('[data-cam]', m), status = $('[data-status]', m), pick = $('[data-pick]', m), torch = $('[data-torch]', m);
  const say = (msg, tone = '') => { status.textContent = msg; status.className = `scan-status${tone ? ` ${tone}` : ''}`; };
  const buzz = () => { try { if (navigator.vibrate) navigator.vibrate(70); } catch (e) { /* no vibration */ } };
  $$('[data-x]', m).forEach(b => { b.onclick = closeModal; });
  say(aim());

  const tick = async gen => {
    if (gen !== loop || closed || !cam) return;
    if (!paused && video.readyState >= 2 && video.videoWidth) {
      try {
        const texts = await scan.detectFrame(video, rd.set);
        if (texts.length && gen === loop && !closed && !paused) await handle(texts, false);
      } catch (err) { /* this picture could not be read; the next one is tried */ }
    }
    if (gen === loop && !closed && cam) timer = setTimeout(() => tick(gen), 120);
  };
  const startCam = async () => {
    if (closed || starting) return;
    if (cam && cam.track.readyState === 'live') { if (video.paused) video.play().catch(() => {}); return; }
    starting = true;
    stopCam();
    camMsg.textContent = 'Starting the camera…';
    // the camera and the code reader start together (the reader may need to load the first time)
    const [c, ready] = await Promise.all([scan.startCamera(video).catch(err => err), scan.prepare(rd.set).catch(err => err)]);
    starting = false;
    const failed = ready instanceof Error ? ready : c instanceof Error ? c : null;
    if (failed || closed) {
      if (!(c instanceof Error)) c.stop();
      if (failed) camMsg.textContent = failed.message === 'reader' ? READER_FAIL : failed.message;
      return;
    }
    cam = c;
    camMsg.textContent = '';
    torch.hidden = !cam.torch;
    tick(++loop);
  };

  const take = (value, r) => {
    const out = o.accept(value, r || {});
    if (out.ok) buzz();
    if (out.done || (out.ok && !o.multi)) { closeModal(); toast(out.msg, out.ok ? 'good' : ''); return; }
    say(out.msg, out.ok ? 'ok' : 'warn');
  };
  // several possible values: the dealer picks the right one
  const choose = (values, texts) => {
    paused = true;
    pick.hidden = false;
    pick.innerHTML = `<p class="scan-q">${esc(rd.which)}</p>
      <div class="scan-list">${values.map((v, i) => `<button class="btn" type="button" data-v="${i}"><span class="mono">${esc(v)}</span></button>`).join('')}</div>
      <button class="btn ghost sm" type="button" data-again>None of these: scan again</button>
      <details class="scan-raw"><summary>What the code says</summary><pre>${esc(texts.join('\n\n').slice(0, 1200))}</pre></details>`;
    say('');
    $('[data-v]', pick).focus();
    pick.onclick = e => {
      const b = e.target.closest('[data-v]'), again = e.target.closest('[data-again]');
      if (!b && !again) return;
      texts.forEach(t => seen.set(t, Infinity)); // do not ask again about the same code
      pick.hidden = true; pick.innerHTML = ''; paused = false;
      if (b) take(values[Number(b.dataset.v)]); else say(aim());
    };
  };
  // an Aadhaar QR code without the full number: say so, and stop
  const partial = r => {
    paused = true; stopCam();
    buzz();
    $('.scan-view', m).hidden = true;
    $('[data-acts]', m).hidden = true;
    say('');
    pick.hidden = false;
    pick.innerHTML = `<p class="scan-note">${esc(o.partial(r))}</p><button class="btn primary block" type="button" data-ok>OK</button>`;
    const ok = $('[data-ok]', pick);
    ok.onclick = closeModal;
    ok.focus();
  };
  const handle = async (all, fromPhoto) => {
    // a code is handled when it comes into view, not again while it stays there
    const now = Date.now();
    const texts = fromPhoto ? all : all.filter(t => {
      const last = seen.get(t);
      if (last === Infinity) return false;
      seen.set(t, now);
      return !last || now - last > 2500;
    });
    if (!texts.length) return;
    const res = await Promise.all(texts.map(t => rd.read(t)));
    if (closed) return;
    if (o.multi) { // each code is the next box's value
      let said = false;
      for (let i = 0; i < res.length && !closed; i++) {
        const r = res[i];
        if (r.sure && r.values.length === 1) { take(r.values[0], r); said = true; }
        else if (r.values.length) { choose(r.values, [texts[i]]); return; }
      }
      if (!said && !closed) say((res.find(r => r.none) || rd).none, 'warn');
      return;
    }
    const sure = uniq(res.filter(r => r.sure).flatMap(r => r.values));
    if (sure.length === 1) { take(sure[0], res.find(r => r.sure && r.values.includes(sure[0]))); return; }
    const any = uniq(res.flatMap(r => r.values));
    if (any.length) { choose(any, texts); return; }
    const part = res.find(r => r.partial);
    if (part) { partial(part); return; }
    say((res.find(r => r.none) || rd).none, 'warn');
  };

  $('[data-file]', m).addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    paused = true;
    pick.hidden = true;
    say(files.length > 1 ? `Reading ${files.length} photos…` : 'Reading the photo…');
    const texts = [];
    let unreadable = 0;
    for (const f of files) {
      try { texts.push(...await scan.detectPhoto(f, rd.set)); }
      catch (err) {
        if (err.message === 'reader') { paused = false; say(READER_FAIL, 'warn'); return; }
        unreadable++;
      }
    }
    if (closed) return;
    paused = false;
    if (texts.length) { await handle(uniq(texts), true); return; }
    say(unreadable === files.length
      ? 'This photo could not be opened. Use a JPG or PNG photo or screenshot.'
      : `No code found in ${files.length > 1 ? 'these photos' : 'this photo'}. Take a closer, sharp photo of just the code, in good light.`, 'warn');
  });
  torch.onclick = async () => {
    const on = torch.getAttribute('aria-pressed') !== 'true';
    try { await cam.setTorch(on); torch.setAttribute('aria-pressed', String(on)); }
    catch (e) { toast('The light could not be turned on.', 'bad'); }
  };
  document.addEventListener('visibilitychange', onVis);
  startCam();
}

function topBar(extra = '') {
  return `<header class="bar${extra ? ' has-tabs' : ''}">
    <a class="brand" href="#/" aria-label="Pontis Energy home"><img src="assets/icon.png" alt="" width="30" height="27"><span translate="no">Pontis Energy</span></a>
    ${extra}
    <div class="who"><span class="who-name">${esc(session.user.name)}</span><button class="btn ghost sm" type="button" data-logout>Log out</button></div>
  </header>`;
}
// ---------- PWA install button (removed once the app is installed) ----------
const isIos = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches
  || matchMedia('(display-mode: window-controls-overlay)').matches
  || navigator.standalone === true
  || document.referrer.startsWith('android-app://');
let installEvent = null;
let appInstalled = isStandalone();

function canShowInstall() {
  if (appInstalled || isStandalone()) return false;
  return !!(installEvent || isIos);
}
function removeInstallUi() {
  $$('[data-install-wrap]').forEach(el => el.remove());
}
function syncInstallUi() {
  if (!canShowInstall()) { removeInstallUi(); return; }
  const slot = $('[data-install-slot]');
  if (!slot || $('[data-install-wrap]', slot)) return;
  const auth = slot.dataset.installSlot === 'auth';
  slot.innerHTML = auth
    ? `<div class="install-auth" data-install-wrap><button class="btn block" type="button" data-install-app>${ICON.save} Install app</button></div>`
    : `<div class="install-bar card" data-install-wrap><div class="install-copy"><b>Install Pontis app</b><span class="muted small">Add to your home screen for quick access.</span></div><button class="btn primary sm" type="button" data-install-app>${ICON.save} Install app</button></div>`;
}
async function triggerInstall(btn) {
  if (appInstalled || isStandalone()) { removeInstallUi(); return; }
  if (installEvent) {
    const ev = installEvent;
    installEvent = null;
    busy(btn, true);
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === 'accepted') {
        appInstalled = true;
        removeInstallUi();
        return;
      }
    } catch (e) { /* prompt failed or already used */ }
    busy(btn, false);
    syncInstallUi();
    return;
  }
  if (isIos) {
    const m = openModal(`<h2 id="mTitle">Install Pontis app</h2>
      <p class="muted">In Safari, tap <b>Share</b>, then tap <b>Add to Home Screen</b>.</p>
      <div class="modal-actions"><button class="btn primary" type="button" data-ok>Got it</button></div>`);
    $('[data-ok]', m).onclick = closeModal;
  }
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  appInstalled = false;
  installEvent = e;
  syncInstallUi();
});
window.addEventListener('appinstalled', () => {
  appInstalled = true;
  installEvent = null;
  removeInstallUi();
  toast('App installed.', 'good');
});
try {
  matchMedia('(display-mode: standalone)').addEventListener('change', e => {
    if (e.matches) { appInstalled = true; installEvent = null; removeInstallUi(); }
  });
} catch (e) { /* older Safari */ }

document.addEventListener('click', async e => {
  const inst = e.target.closest('[data-install-app]');
  if (inst) { triggerInstall(inst); return; }
  if (e.target.closest('[data-logout]')) {
    const note = session && session.user.role === 'dealer'
      ? 'You will need your mobile number and password to log in again. Unfinished forms stay on this phone.'
      : 'You will need your mobile number and password to log in again. Added PDFs stay on this device.';
    if (await confirmBox('Log out?', note, 'Log out')) logout();
  }
});

// ---------- routing: the address shows the screen, so Back works ----------
const route = () => location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
const routeQuery = () => new URLSearchParams(location.hash.split('?')[1] || '');
window.addEventListener('hashchange', () => render());
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

let current = null; // cleanup for the screen being left
function render() {
  if (current) { current(); current = null; }
  closeModal();
  const [view, arg] = route();
  if (!session) { document.title = 'Log in – Pontis Energy'; loginView(); }
  else if (session.user.role === 'admin') {
    if (view === 'client' && arg) clientView(decodeURIComponent(arg));
    else if (view === 'clients' || view === 'excel') clientsView(); // "excel": the old address of this tab
    else if (view === 'staff') staffView();
    else dealersView();
  } else if (session.user.role === 'staff') {
    if (view === 'client' && arg) clientView(decodeURIComponent(arg));
    else clientsView();
  } else {
    if (view === 'form' && arg) formView(arg);
    else if (view === 'done' && arg) doneView(arg);
    else homeView();
  }
  syncInstallUi();
}

// ---------- login ----------
function loginView() {
  app.innerHTML = `<main class="auth" id="main">
    <img class="auth-logo" src="assets/logo.png" alt="Pontis Energy" width="700" height="196">
    <h1>Log in</h1>
    <p class="muted">Use the mobile number and password you got from Pontis Energy.</p>
    ${loginNote ? `<p class="note" role="status">${esc(loginNote)}</p>` : ''}
    <form id="loginForm" novalidate>
      <label class="fld"><span>Mobile number</span>
        <input name="phone" type="tel" inputmode="numeric" autocomplete="username" placeholder="98470 12345…" required></label>
      <label class="fld"><span>Password</span>
        <span class="pw"><input name="password" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required>
        <button class="pw-eye" type="button" aria-label="Show password" aria-pressed="false">Show</button></span></label>
      <p class="form-err" id="loginErr" role="alert"></p>
      <button class="btn primary block" type="submit">Log in</button>
    </form>
    <div data-install-slot="auth"></div>
    <p class="muted small center">Forgot the password? Ask Pontis Energy to reset it.</p>
  </main>`;
  loginNote = '';
  const form = $('#loginForm'), err = $('#loginErr');
  if (matchMedia('(pointer: fine)').matches) form.phone.focus();
  $('.pw-eye').onclick = e => {
    const show = form.password.type === 'password';
    form.password.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-pressed', String(show));
    e.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  };
  let timer = null;
  current = () => clearInterval(timer);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const phone = normMobile(form.phone.value), password = form.password.value.trim();
    err.textContent = '';
    form.phone.classList.toggle('invalid', !/^[6-9]\d{9}$/.test(phone));
    form.password.classList.toggle('invalid', !password);
    if (!/^[6-9]\d{9}$/.test(phone)) { err.textContent = 'Enter your 10-digit mobile number.'; form.phone.focus(); return; }
    if (!password) { err.textContent = 'Enter your password.'; form.password.focus(); return; }
    const btn = form.querySelector('[type=submit]');
    busy(btn, true);
    try {
      const r = await api('login', { method: 'POST', body: { phone, password } });
      setSession({ token: r.token, user: r.user });
      store.cleanUp();
      store.keepStorage();
      go('#/');
    } catch (ex) {
      busy(btn, false);
      const d = ex.data || {};
      if (d.error === 'locked') {
        let left = d.retryIn || 300;
        const tick = () => {
          err.textContent = `Too many wrong passwords. Try again in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`;
          btn.disabled = left > 0;
          if (left-- <= 0) { clearInterval(timer); err.textContent = 'You can try again now.'; }
        };
        clearInterval(timer); tick(); timer = setInterval(tick, 1000);
      } else {
        err.textContent = ex.message + (d.triesLeft && d.triesLeft <= 3 ? ` ${d.triesLeft} tr${d.triesLeft === 1 ? 'y' : 'ies'} left before a 5-minute lock.` : '');
        if (d.error === 'wrong') { form.password.classList.add('invalid'); form.password.select(); }
      }
    }
  });
}

// ---------- dealer: home ----------
async function homeView() {
  document.title = 'Pontis Energy – Dealer';
  const owner = session.user.phone;
  app.innerHTML = `${topBar()}<main class="wrap" id="main">
    <div data-install-slot></div>
    <h1 class="hello">Hello, ${esc(session.user.name.split(' ')[0])}</h1>
    <div class="cards">
      <section class="card">
        <h2><span class="tag">Section 1</span> Work start</h2>
        <p class="muted">A new client: details and documents before the work starts.</p>
        <div class="row2">
          <button class="btn primary" type="button" data-new="1" data-mode="cash">${ICON.plus} Cash</button>
          <button class="btn primary" type="button" data-new="1" data-mode="loan">${ICON.plus} Loan</button>
        </div>
      </section>
      <section class="card">
        <h2><span class="tag sage">Section 2</span> After installation</h2>
        <p class="muted">Panel, inverter and meter details for KSEB.</p>
        <button class="btn primary block" type="button" data-new="2">${ICON.plus} Start Section 2</button>
      </section>
    </div>
    <section class="list-block" id="s1List" hidden><h2>Section 1</h2><ul class="items"></ul></section>
    <section class="list-block" id="s2List" hidden><h2>Section 2</h2><ul class="items"></ul></section>
  </main>`;

  // Each client's forms on this phone: unfinished ones (drafts) and sent ones. A Section 2 belongs to a
  // Section 1 when it was opened from it (fromId) or has the same consumer number.
  const drafts = await store.listDrafts(owner).catch(() => []);
  const sent = store.listRecent(owner);
  const sentFor = consumer => (consumer && sent.find(x => x.consumer === consumer)) || null;
  const s2DraftFor = (id, consumer) => drafts.find(x => x.section === 2 && ((id && x.fromId === id) || (consumer && x.values.consumer === consumer))) || null;
  const SHOW_SENT = 40;
  const s1Items = [
    ...drafts.filter(d => d.section === 1).map(d => {
      const v = d.values, done = sentFor(v.consumer);
      return { key: `d:${d.id}`, d, name: v.name, consumer: v.consumer || '', aadhaar: v.aadhaar, id: d.id, mode: d.mode, s2: s2DraftFor(d.id, v.consumer), s2Sent: !!(done && done.s2At) };
    }),
    ...sent.filter(c => c.at).sort((a, b) => b.at - a.at).slice(0, SHOW_SENT)
      .map(c => ({ key: `c:${c.consumer}`, c, name: c.name, consumer: c.consumer, aadhaar: c.aadhaar, mode: c.mode, s2: s2DraftFor('', c.consumer), s2Sent: !!c.s2At }))
  ];
  const s2Items = [
    ...drafts.filter(d => d.section === 2).map(d => ({ d, name: d.values.name, consumer: d.values.consumer || '' })),
    ...sent.filter(c => c.s2At).sort((a, b) => b.s2At - a.s2At).slice(0, SHOW_SENT).map(c => ({ c, name: c.name, consumer: c.consumer }))
  ];
  // a form is removed DRAFT_DAYS after it was last changed; warn in its last week
  const daysLeft = d => Math.max(1, Math.ceil((d.updatedAt + store.DRAFT_DAYS * 864e5 - Date.now()) / 864e5));
  const expiry = d => (daysLeft(d) <= 7 ? `<span class="warn-text small">Removed from this phone in ${daysLeft(d)} day${daysLeft(d) === 1 ? '' : 's'} unless you open it</span>` : '');
  const meta = (...parts) => `<span class="muted small">${parts.filter(Boolean).map(esc).join(' · ')}</span>`;
  const modeName = m => (m === 'loan' ? 'Loan' : m === 'cash' ? 'Cash' : '');
  const state = isSent => (isSent ? `<span class="pill ok">${ICON.check} Sent</span>` : '<span class="pill wait">Not sent yet</span>');
  const s2State = it => (it.s2Sent ? `<span class="pill ok">${ICON.check} Section 2 sent</span>` : it.s2 ? '<span class="pill info">Section 2 started</span>' : '');
  const delBtn = d => `<button class="btn sm ghost danger-text" type="button" data-del-draft="${esc(d.id)}" aria-label="Delete the unfinished form for ${esc(d.values.name || 'this client')}">Delete</button>`;
  const delSentBtn = (section, c) => `<button class="btn sm ghost danger-text" type="button" data-del-sent="${section}" data-consumer="${esc(c.consumer)}" aria-label="Delete ${esc(c.name || 'this client')} from the Section ${section} list">Delete</button>`;
  if (s1Items.length) {
    $('#s1List').hidden = false;
    $('#s1List ul').innerHTML = s1Items.map(it => `<li class="item">
      <div class="item-main"><b>${esc(it.name || 'No name yet')}</b>
        ${meta(modeName(it.mode), it.consumer && `Consumer ${it.consumer}`, it.d ? `saved ${ago(it.d.updatedAt)}` : `sent ${ago(it.c.at)}`)}
        <span class="item-tags">${state(!it.d)}${s2State(it)}</span>${it.d ? expiry(it.d) : ''}</div>
      <div class="item-acts">${it.d ? `<button class="btn sm" type="button" data-s1="${esc(it.key)}">Continue…</button>${delBtn(it.d)}`
        : `${it.s2Sent ? '' : `<button class="btn sm" type="button" data-s2from="${esc(it.key)}">Section 2</button>`}${delSentBtn(1, it.c)}`}</div></li>`).join('');
  }
  if (s2Items.length) {
    $('#s2List').hidden = false;
    $('#s2List ul').innerHTML = s2Items.map(it => `<li class="item">
      <div class="item-main"><b>${esc(it.name || 'No name yet')}</b>
        ${meta(it.consumer && `Consumer ${it.consumer}`, it.d ? `saved ${ago(it.d.updatedAt)}` : `sent ${ago(it.c.s2At)}`)}
        <span class="item-tags">${state(!it.d)}</span>${it.d ? expiry(it.d) : ''}</div>
      <div class="item-acts">${it.d ? `<a class="btn sm" href="#/form/${esc(it.d.id)}">Continue</a>${delBtn(it.d)}` : delSentBtn(2, it.c)}</div></li>`).join('');
  }

  // Section 2 from a Section 1 (unfinished or sent): its consumer number, name and Aadhaar number are filled in.
  // The Section 1 stays in its list. If Section 2 was already started, that form opens (with any of those
  // boxes still empty there filled in) instead of a second one.
  const openS2 = async it => {
    const from = it ? { consumer: it.consumer, name: it.name, aadhaar: it.aadhaar } : {};
    const open = it && (it.s2 || s2DraftFor(it.id, it.consumer));
    if (open) {
      let changed = false;
      Object.entries(from).forEach(([k, v]) => { if (v && !open.values[k]) { open.values[k] = v; changed = true; } });
      if (changed) await store.saveDraft(open);
      go(`#/form/${open.id}`);
      return;
    }
    const values = Object.fromEntries(Object.entries(from).filter(([, v]) => v));
    const d = { id: store.newId(), owner, section: 2, mode: '', values, fromId: (it && it.id) || '', createdAt: Date.now() };
    await store.saveDraft(d);
    go(`#/form/${d.id}`);
  };
  const itemByKey = key => s1Items.find(x => x.key === key);

  // "Continue…" on an unfinished Section 1: carry on with it, or go on to its Section 2
  const chooseSection = it => {
    const s2Note = it.s2 ? `After installation · started ${ago(it.s2.updatedAt)}`
      : it.s2Sent ? 'Section 2 was already sent for this client. This starts it again.'
        : 'After installation. The consumer number, name and Aadhaar number come from Section 1.';
    const m = openModal(`<h2 id="mTitle">${esc(it.name || 'No name yet')}</h2>
      <p class="muted">Which section do you want to continue?</p>
      <ul class="pick-list">
        <li><button class="pick-client" type="button" data-go="1"><span class="tag">Section 1</span><b>Continue in Section 1</b>
          <span class="muted small">Work start${modeName(it.mode) ? ` · ${modeName(it.mode)}` : ''} · saved ${esc(ago(it.d.updatedAt))}</span></button></li>
        <li><button class="pick-client" type="button" data-go="2"><span class="tag sage">Section 2</span><b>Continue in Section 2</b>
          <span class="muted small">${esc(s2Note)}</span></button></li>
      </ul>
      <button class="btn ghost block" type="button" data-close>Cancel</button>`);
    $('[data-go="1"]', m).focus();
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-go]');
      if (b) { closeModal(); if (b.dataset.go === '1') go(`#/form/${it.d.id}`); else openS2(it); return; }
      if (e.target.closest('[data-close]')) closeModal();
    });
  };

  // "Start Section 2": choose the client from Section 1, or start an empty form
  const waitingS2 = s1Items.filter(it => !it.s2Sent && (it.name || it.consumer)); // not forms with nothing typed yet
  const pickS2 = () => {
    const list = waitingS2;
    const m = openModal(`<h2 id="mTitle">Start Section 2</h2>
      <p class="muted">Choose the client. Their consumer number, name and Aadhaar number come from Section 1.</p>
      ${list.length > 6 ? '<input type="search" data-q placeholder="Search name or consumer number…" aria-label="Search clients" autocomplete="off" spellcheck="false">' : ''}
      <ul class="pick-list" data-list></ul>
      <div class="stack"><button class="btn block" type="button" data-blank>${ICON.plus} A client not in this list</button>
      <button class="btn ghost block" type="button" data-close>Cancel</button></div>`);
    const ul = $('[data-list]', m), q = $('[data-q]', m);
    const draw = () => {
      const term = q ? q.value.trim().toLowerCase() : '', num = term.replace(/\D/g, '');
      const shown = list.filter(it => !term || String(it.name || '').toLowerCase().includes(term) || (num.length >= 3 && it.consumer.includes(num)));
      ul.innerHTML = shown.length ? shown.map(it => `<li><button class="pick-client" type="button" data-client="${esc(it.key)}">
          <b>${esc(it.name || 'No name yet')}</b><span class="muted small">${it.consumer ? `Consumer <span class="mono">${esc(it.consumer)}</span> · ` : ''}Section 1 ${it.d ? `not sent yet, saved ${esc(ago(it.d.updatedAt))}` : `sent ${esc(ago(it.c.at))}`}${it.s2 ? ' · Section 2 started' : ''}</span></button></li>`).join('')
        : `<li class="muted small">No client matches “${esc(q.value)}”.</li>`;
    };
    draw();
    if (q) q.addEventListener('input', draw);
    const first = $('[data-client]', ul); if (first) first.focus();
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-client]');
      if (b) { closeModal(); openS2(itemByKey(b.dataset.client)); return; }
      if (e.target.closest('[data-blank]')) { closeModal(); openS2(null); return; }
      if (e.target.closest('[data-close]')) closeModal();
    });
  };
  if (waitingS2.length) $('[data-new="2"]').innerHTML = `${ICON.plus} Start Section 2…`;

  app.onclick = async e => {
    const s1 = e.target.closest('[data-s1]');
    if (s1) { chooseSection(itemByKey(s1.dataset.s1)); return; }
    const s2from = e.target.closest('[data-s2from]');
    if (s2from) { openS2(itemByKey(s2from.dataset.s2from)); return; }
    const n = e.target.closest('[data-new]');
    if (n && n.dataset.new === '2') {
      if (waitingS2.length) pickS2(); else openS2(null);
      return;
    }
    if (n) {
      const d = { id: store.newId(), owner, section: 1, mode: n.dataset.mode || '', values: {}, createdAt: Date.now() };
      await store.saveDraft(d);
      go(`#/form/${d.id}`);
      return;
    }
    const del = e.target.closest('[data-del-draft]');
    if (del && await confirmBox('Delete this unfinished form?', 'The details and photos typed so far are removed from this phone.', 'Delete', true)) {
      await store.deleteDraft(del.dataset.delDraft);
      toast('Deleted.');
      render();
      return;
    }
    // a sent form: its PDF has gone to Pontis Energy, so only this phone's list entry is removed
    const delSent = e.target.closest('[data-del-sent]');
    if (delSent) {
      const section = Number(delSent.dataset.delSent), c = sent.find(x => x.consumer === delSent.dataset.consumer);
      if (!c) return;
      const other = section === 1 ? 2 : 1, inOther = section === 1 ? !!c.s2At : !!c.at;
      const note = [
        'The PDF was already sent to Pontis Energy, so it is not affected.',
        inOther ? `${c.name} stays in the Section ${other} list.` : '',
        section === 1 && !c.s2At && !s2DraftFor('', c.consumer) ? 'Section 2 for this client will then need the consumer number, name and Aadhaar number typed.' : ''
      ].filter(Boolean).join(' ');
      if (!await confirmBox(`Delete ${c.name} from the Section ${section} list?`, note, 'Delete', true)) return;
      store.forgetSent(owner, section, c.consumer);
      toast('Deleted.');
      render();
    }
  };
  current = () => { app.onclick = null; };
}

// ---------- dealer: client form ----------
const urls = new Map(); // object URLs for the photo thumbnails on screen
function photoUrl(pid, blob) {
  if (!urls.has(pid)) urls.set(pid, URL.createObjectURL(blob));
  return urls.get(pid);
}
function freeUrls() { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); }

// a scan button inside the box: these fields can be read from a QR code or barcode
const SCAN_TYPES = ['aadhaar', 'pan', 'consumer', 'serial'];
const scanBtn = (attr, label) => `<button class="scan-btn" type="button" ${attr} aria-label="${esc(label)}" title="Scan QR code"><span class="scan-box">${ICON.scan}</span></button>`;

function fieldHtml(f, v) {
  const id = `f-${f.key}`;
  const req = f.required === false ? ' <span class="opt">(optional)</span>' : '';
  const hint = f.hint ? `<p class="hint" id="${id}-hint">${esc(f.hint)}</p>` : '';
  const describedBy = `${f.hint ? `${id}-hint ` : ''}${id}-err`;
  const val = v[f.key];
  const input = (type, extra = '', shown = val ?? '') => `<input id="${id}" name="${f.key}" type="${type}" value="${esc(shown)}" aria-describedby="${describedBy}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}${f.placeholder.endsWith('…') ? '' : '…'}"` : ''} ${extra}>`;
  let body = '';
  switch (f.type) {
    case 'text': body = input('text', 'autocomplete="off" autocapitalize="words"'); break;
    case 'consumer': body = input('text', 'inputmode="numeric" autocomplete="off" placeholder="1155…"'); break;
    case 'mobile': body = input('tel', 'inputmode="numeric" autocomplete="off" placeholder="98470 12345…"'); break;
    case 'aadhaar': body = input('text', 'inputmode="numeric" autocomplete="off" placeholder="1234 5678 9012…"', display(f, v)); break;
    case 'pan': body = input('text', 'autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE1234F…" class="upper"'); break;
    case 'email': body = input('email', 'inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="name@gmail.com…"'); break;
    case 'age': case 'number': body = input('text', 'inputmode="numeric" autocomplete="off"'); break;
    case 'decimal': body = input('text', 'inputmode="decimal" autocomplete="off"'); break;
    case 'serial': body = input('text', 'autocomplete="off" autocapitalize="characters" spellcheck="false" class="upper mono"'); break;
    case 'select':
      body = `<select id="${id}" name="${f.key}" aria-describedby="${describedBy}"><option value="">Choose…</option>${f.options.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      break;
    case 'location': body = locationHtml(f, val); break;
    case 'serials': body = `<div class="serials" id="${id}" role="group" aria-describedby="${describedBy}"></div>`; break;
    case 'photo': case 'photos': case 'gpsphoto': body = photoHtml(f); break;
  }
  if (SCAN_TYPES.includes(f.type) && f.scan !== false) body = `<div class="scan-in">${body}${scanBtn(`data-scan="${f.key}"`, `Scan the code: ${f.label}`)}</div>`;
  const labelTag = ['photo', 'photos', 'gpsphoto', 'location', 'serials'].includes(f.type) ? `<span class="lbl" id="${id}-lbl">` : `<label class="lbl" for="${id}">`;
  const labelEnd = labelTag.startsWith('<span') ? '</span>' : '</label>';
  return `<div class="fld-wrap" data-f="${f.key}">${labelTag}${esc(f.label)}${req}${labelEnd}${body}${hint}
    <p class="note-soft" id="${id}-note" aria-live="polite"></p><p class="err" id="${id}-err" aria-live="polite"></p></div>`;
}
function locationHtml(f, val) {
  return `<div class="loc">
    <button class="btn" type="button" data-locate>${ICON.pin} Use my location</button>
    <p class="loc-val" data-locval>${locText(val)}</p>
    <details class="loc-paste"${val && val.link && !val.lat ? ' open' : ''}><summary>Not at the house? Paste a Google Maps link</summary>
      <input type="url" inputmode="url" data-loclink autocomplete="off" spellcheck="false" placeholder="https://maps.app.goo.gl/…" value="${esc(val && !val.lat ? val.link || '' : '')}" aria-label="Google Maps link"></details>
  </div>`;
}
function locText(v) {
  if (!v) return '';
  if (v.lat) return `${ICON.check} ${fmtCoord(v.lat, 'N', 'S')}, ${fmtCoord(v.lng, 'E', 'W')} (±${Math.round(v.acc)} m) · <a href="https://maps.google.com/?q=${v.lat},${v.lng}" target="_blank" rel="noopener">Open in Maps</a>`;
  if (v.link) return `${ICON.check} Link added`;
  return '';
}
function photoHtml(f) {
  const multi = f.type === 'photos', gps = f.type === 'gpsphoto';
  return `<div class="photos${gps ? ' gps' : ''}">
    <ul class="thumbs" data-thumbs="${f.key}"></ul>
    <label class="btn add-photo"><input class="vh" type="file" accept="image/*" data-photo="${f.key}"${multi ? ' multiple' : ''} aria-labelledby="f-${f.key}-lbl">
      ${gps ? ICON.camera : ICON.image}<span data-addlabel>Add photo</span></label>
    <p class="photo-status" data-status="${f.key}" aria-live="polite"></p>
  </div>`;
}

async function formView(id) {
  const d = await store.getDraft(id);
  if (!d || d.owner !== session.user.phone) { toast('That form is no longer on this phone.'); go('#/'); return; }
  const sec = SECTIONS[d.section];
  const modeName = d.mode === 'loan' ? 'Loan' : d.mode === 'cash' ? 'Cash' : '';
  document.title = `${sec.title}${modeName ? ` ${modeName}` : ''} – Pontis Energy`;
  const allFields = sec.fields.filter(f => !f.only || f.only === d.mode);
  let html = '', group = '';
  for (const f of allFields) {
    if ((f.group || '') !== group) {
      if (group) html += '</fieldset>';
      if (f.group === 'co') html += '<fieldset class="co" data-co><legend>Co-applicant <span class="muted small">(needed because the customer is 60 or older)</span></legend>';
      group = f.group || '';
    }
    html += fieldHtml(f, d.values);
  }
  if (group) html += '</fieldset>';

  app.innerHTML = `<header class="bar form-bar">
      <a class="btn ghost icon" href="#/" aria-label="Back to home (the form is saved)">${ICON.back}</a>
      <div class="form-title"><b>${esc(sec.title)}${modeName ? ` · ${modeName}` : ''}</b><span>${esc(sec.subtitle)}</span></div>
      <span class="progress" id="progress" aria-live="polite"></span>
    </header>
    <main class="wrap" id="main">
      <p class="saved-note muted small">${ICON.check} Saved on this phone as you type.</p>
      <form id="clientForm" novalidate>${html}</form>
    </main>
    <div class="sticky"><div class="sticky-in">
      <p class="form-sum" id="formSum" role="alert"></p>
      <button class="btn primary block" type="button" id="makePdf">${ICON.file} Make PDF</button></div></div>`;

  const form = $('#clientForm');
  let submitted = false;
  const touched = new Set();
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => store.saveDraft(d).catch(() => toast('Could not save on this phone.', 'bad')), 300); };
  const fieldByKey = Object.fromEntries(allFields.map(f => [f.key, f]));
  const wrapOf = key => $(`.fld-wrap[data-f="${key}"]`, form);

  function showError(f) {
    const w = wrapOf(f.key); if (!w) return '';
    // the serial list is filled box by box, so it is only checked after "Make PDF"
    const show = submitted || (touched.has(f.key) && f.type !== 'serials');
    const msg = show ? check(f, d.values) : '';
    $('.err', w).textContent = msg;
    w.classList.toggle('has-err', !!msg);
    const inp = $(`#f-${f.key}`, w);
    if (inp && inp.tagName !== 'DIV') inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
    let soft = touched.has(f.key) && !msg ? note(f, d.values) : '';
    // a new-type Aadhaar QR code gives only the last 4 digits: the typed number should end with them
    const last4 = f.type === 'aadhaar' && d.qr && d.qr[f.key], typed = String(d.values[f.key] || '');
    if (!msg && !soft && last4 && typed.length === 12 && !typed.endsWith(last4)) soft = `The Aadhaar QR code scanned ends in ${last4}, but this number ends in ${typed.slice(-4)}. Check the number.`;
    $('.note-soft', w).textContent = soft;
    return msg;
  }
  function refresh() {
    const active = new Set(activeFields(d.section, d.mode, d.values).map(f => f.key));
    allFields.forEach(f => { const w = wrapOf(f.key); if (w) w.hidden = !active.has(f.key); });
    const co = $('[data-co]', form); if (co) co.hidden = !needsCoApplicant(d.mode, d.values);
    const list = activeFields(d.section, d.mode, d.values);
    const done = list.filter(f => !check(f, d.values)).length;
    $('#progress').textContent = `${done} of ${list.length} done`;
    if (submitted) {
      const bad = list.filter(f => showError(f));
      $('#formSum').textContent = bad.length ? `${bad.length} thing${bad.length > 1 ? 's' : ''} to fix before making the PDF.` : '';
    } else {
      list.filter(f => touched.has(f.key)).forEach(showError); // keep shown messages up to date
    }
  }

  // serial number boxes follow the number of panels
  function renderSerials(f) {
    const box = $(`#f-${f.key}`, form); if (!box) return;
    const n = Math.min(200, Number(d.values[f.countKey]) || 0);
    const list = Array.isArray(d.values[f.key]) ? d.values[f.key] : [];
    if (box.dataset.n === String(n)) return; // already showing this many boxes
    box.dataset.n = String(n);
    box.innerHTML = n ? (n > 1 ? `<div class="serials-scan"><button class="btn" type="button" data-scanall>${ICON.scan} Scan all panels</button>
        <p class="hint">The camera stays open: scan one panel after another, and the boxes fill in order.</p></div>` : '')
      + Array.from({ length: n }, (_, i) => `<div class="serial"><span aria-hidden="true">${i + 1}</span><div class="scan-in"><input type="text" data-serial="${i}" value="${esc(list[i] || '')}" autocomplete="off" autocapitalize="characters" spellcheck="false" class="upper mono" aria-label="Panel ${i + 1} serial number">${scanBtn(`data-scan-serial="${i}"`, `Scan the code of panel ${i + 1}`)}</div></div>`).join('')
      : '<p class="serials-empty">Enter the <b>number of panels</b> above. A box then appears here for each panel’s serial number.</p>';
  }
  function renderThumbs(f) {
    const ul = $(`[data-thumbs="${f.key}"]`, form); if (!ul) return;
    const list = d.values[f.key] || [];
    Promise.all(list.map(p => store.getPhoto(p.pid).then(b => ({ p, b })))).then(items => {
      ul.innerHTML = items.map(({ p, b }, i) => `<li><img src="${b ? photoUrl(p.pid, b) : ''}" alt="${esc(f.label)} ${i + 1}" width="${p.w}" height="${p.h}">
        ${p.gps ? '<span class="gps-badge">GPS</span>' : p.noGps ? '<span class="gps-badge none">No GPS</span>' : ''}
        <button type="button" class="x" data-remove="${f.key}" data-i="${i}" aria-label="Remove ${esc(f.label)} ${i + 1}">×</button></li>`).join('');
    });
    const lbl = $(`[data-photo="${f.key}"]`, form).parentElement.querySelector('[data-addlabel]');
    lbl.textContent = f.type === 'photos' ? (list.length ? 'Add more photos' : 'Add photos') : list.length ? 'Replace photo' : 'Add photo';
  }

  allFields.forEach(f => {
    if (f.type === 'serials') renderSerials(f);
    if (['photo', 'photos', 'gpsphoto'].includes(f.type)) renderThumbs(f);
  });
  refresh();

  // ---------- values read from a QR code or barcode ----------
  function setValue(f, raw) {
    d.values[f.key] = tidy(f, raw);
    const inp = $(`#f-${f.key}`, form);
    if (inp) inp.value = f.type === 'aadhaar' ? display(f, d.values) : d.values[f.key];
    touched.add(f.key);
  }
  // the name and age from an Aadhaar QR code go into their boxes, only when those are still empty
  function fillFromAadhaar(f, r) {
    const to = f.fill || {}, filled = [];
    const nf = fieldByKey[to.name], af = fieldByKey[to.age];
    const name = String(r.name || '').replace(/\s+/g, ' ').trim();
    if (nf && name.length >= 2 && !d.values[nf.key] && printable(name)) { setValue(nf, name); filled.push('name'); }
    const age = scan.ageFrom(r.dob);
    if (af && age && !d.values[af.key]) { setValue(af, String(age)); filled.push('age'); }
    return filled;
  }
  const alsoFilled = list => (list.length ? ` The ${list.join(' and ')} ${list.length > 1 ? 'were' : 'was'} filled from it too.` : '');
  function afterScan(keys) { save(); refresh(); keys.forEach(k => { if (fieldByKey[k]) showError(fieldByKey[k]); }); }

  const shown = f => (f.type === 'aadhaar' ? display(f, d.values) : d.values[f.key]);
  // a value read from a code goes into its box; returns what to tell the dealer
  function putValue(f, value, r, from = '') {
    setValue(f, value);
    const filled = f.type === 'aadhaar' ? fillFromAadhaar(f, r || {}) : [];
    if (d.qr) delete d.qr[f.key];
    afterScan([f.key, ...Object.values(f.fill || {})]);
    return `${f.label}${from}: ${shown(f)}.${alsoFilled(filled)}`;
  }
  // a new-type Aadhaar QR code: no full number, only its last 4 digits → { text, tone, typeNext }
  function putPartial(f, r) {
    d.qr = { ...(d.qr || {}), [f.key]: r.last4 };
    const filled = fillFromAadhaar(f, r);
    if (d.values[f.key]) touched.add(f.key);
    afterScan([f.key, ...Object.values(f.fill || {})]);
    const now = String(d.values[f.key] || '');
    if (now.length === 12) {
      return now.endsWith(r.last4)
        ? { text: `The Aadhaar number typed matches this card: it ends in ${r.last4}.${alsoFilled(filled)}`, tone: 'ok' }
        : { text: `This card’s Aadhaar number ends in ${r.last4}, but the number typed ends in ${now.slice(-4)}. Check the number.${alsoFilled(filled)}`, tone: 'warn' };
    }
    return { text: `This card has the new Aadhaar QR code. It does not hold the full Aadhaar number, only its last 4 digits: ${r.last4}. Type the 12-digit number from the card; the app checks that it ends in ${r.last4}.${alsoFilled(filled)}`, tone: '', typeNext: true };
  }

  function scanField(f) {
    let typeNext = false;
    scanner({
      kind: f.type, title: `Scan: ${f.label}`,
      accept: (value, r) => ({ ok: true, msg: putValue(f, value, r) }),
      partial(r) { const p = putPartial(f, r); typeNext = !!p.typeNext; return p.text; },
      after: () => { if (typeNext && form.isConnected) $(`#f-${f.key}`, form).focus(); }
    });
  }

  // panel serial numbers: one box, or all the empty boxes one after another
  const sf = allFields.find(x => x.type === 'serials');
  const serialList = () => (Array.isArray(d.values[sf.key]) ? d.values[sf.key] : (d.values[sf.key] = []));
  const panelCount = () => Math.min(200, Number(d.values[sf.countKey]) || 0);
  const emptyBoxes = () => Array.from({ length: panelCount() }, (_, i) => i).filter(i => !String(serialList()[i] || '').trim());
  const sameAs = (v, skip) => serialList().slice(0, panelCount()).findIndex((x, j) => j !== skip && x === v);
  function putSerial(i, v) {
    serialList()[i] = v;
    const inp = $(`[data-serial="${i}"]`, form);
    if (inp) inp.value = v;
    touched.add(sf.key);
    save(); refresh();
  }
  const serialOf = value => tidy({ type: 'serial' }, value);
  function scanSerial(i) {
    scanner({
      kind: 'serial', title: `Scan: panel ${i + 1} serial number`,
      accept(value) {
        const v = serialOf(value), dup = sameAs(v, i);
        if (v.length < 4) return { ok: false, msg: 'This code is too short to be a serial number.' };
        if (dup >= 0) return { ok: false, msg: `Panel ${dup + 1} already has this serial number (${v}). Scan panel ${i + 1}’s code.` };
        putSerial(i, v);
        return { ok: true, msg: `Panel ${i + 1}: ${v}` };
      }
    });
  }
  function scanAllSerials() {
    const n = panelCount();
    if (!emptyBoxes().length) { toast(`All ${n} boxes have a serial number. To scan one again, use the scan button in its box.`); return; }
    scanner({
      kind: 'serial', multi: true, title: 'Scan the panel serial numbers',
      aim: () => `Panel ${emptyBoxes()[0] + 1} of ${n}: point the camera at the panel’s code. The camera stays open for the next panel.`,
      accept(value) {
        const v = serialOf(value), dup = sameAs(v, -1);
        if (v.length < 4) return { ok: false, msg: 'This code is too short to be a serial number.' };
        if (dup >= 0) return { ok: false, msg: `Already added as panel ${dup + 1}. Point the camera at the next panel.` };
        const i = emptyBoxes()[0];
        putSerial(i, v);
        const left = emptyBoxes();
        if (!left.length) return { ok: true, done: true, msg: `All ${n} panel serial numbers are filled.` };
        return { ok: true, msg: `Panel ${i + 1}: ${v} ✓ Now panel ${left[0] + 1} of ${n}.` };
      }
    });
  }

  // ---------- numbers read from the photos the dealer adds ----------
  // A photo of the Aadhaar or PAN card, the KSEB bill or a serial label (fields with readInto) is searched
  // for its QR code or barcode. An empty box gets the value; a box already filled is checked against it.
  async function readCodes(pf, files) {
    const target = fieldByKey[pf.readInto];
    const status = $(`[data-status="${pf.key}"]`, form);
    if (!target || !status || !files.length) return;
    const rd = scan.READERS[target.type === 'serials' ? 'serial' : target.type];
    const say = (text, tone = '') => {
      status.textContent = text;
      status.classList.toggle('warn', tone === 'warn');
      status.classList.toggle('ok', tone === 'ok');
    };
    say(files.length > 1 ? 'Looking for codes in the photos…' : 'Looking for a code in the photo…');
    try {
      const texts = [];
      for (let i = 0; i < files.length; i++) {
        if (files.length > 2) say(`Looking for codes: photo ${i + 1} of ${files.length}…`);
        try { texts.push(...await scan.detectPhoto(files[i], rd.set)); }
        catch (err) { if (err.message === 'reader') break; } // no code reader in this browser: the dealer types it
      }
      if (!form.isConnected) return;
      const res = await Promise.all(uniq(texts).map(t => rd.read(t)));
      const out = target.type === 'serials' ? serialsFromPhotos(res, files.length) : valueFromPhoto(target, res, rd);
      say(out.text || '', out.tone);
    } catch (err) { say(''); }
  }
  function valueFromPhoto(f, res, rd) {
    const sure = uniq(res.filter(r => r.sure).flatMap(r => r.values));
    const now = String(d.values[f.key] || '');
    if (sure.length === 1) {
      const r = res.find(x => x.sure && x.values.includes(sure[0])), v = tidy(f, sure[0]);
      if (!now) return { text: putValue(f, sure[0], r, ' read from the code in the photo'), tone: 'ok' };
      if (now === v) {
        const filled = f.type === 'aadhaar' ? fillFromAadhaar(f, r) : [];
        if (filled.length) afterScan(Object.values(f.fill || {}));
        return { text: `${f.label}: matches the code in the photo.${alsoFilled(filled)}`, tone: 'ok' };
      }
      const fmt = x => (f.type === 'aadhaar' ? display(f, { [f.key]: x }) : x);
      return { text: `${f.label}: the code in the photo reads ${fmt(v)}, but ${fmt(now)} is typed. Check it.`, tone: 'warn' };
    }
    const part = !sure.length && res.find(r => r.partial);
    if (part) return putPartial(f, part);
    if (!now && res.some(r => r.values.length)) return { text: `${f.label}: the code in the photo has more than one possible number. To choose one, tap the scan button in that box, then Choose a photo.`, tone: 'warn' };
    if (f.type === 'pan' && res.length) return { text: rd.none, tone: 'warn' };
    return { text: '' };
  }
  function serialsFromPhotos(res, nPhotos) {
    const found = uniq(res.filter(r => r.sure && r.values.length === 1).map(r => serialOf(r.values[0])).filter(v => v.length >= 4));
    const where = nPhotos > 1 ? 'the photos' : 'the photo';
    if (!found.length) return { text: '' };
    const n = panelCount();
    if (!n) return { text: `${plural(found.length, 'serial number', 'serial numbers')} found in ${where}. Enter the number of panels first, then add ${where} again.`, tone: 'warn' };
    const added = [];
    let had = 0;
    for (const v of found) {
      if (sameAs(v, -1) >= 0) { had++; continue; }
      const i = emptyBoxes()[0];
      if (i === undefined) break;
      putSerial(i, v);
      added.push(i + 1);
    }
    const full = found.length - had - added.length;
    const text = [
      added.length ? `${plural(added.length, 'serial number', 'serial numbers')} read from ${where} and added (panel${added.length > 1 ? 's' : ''} ${added.slice(0, 8).join(', ')}${added.length > 8 ? '…' : ''}).` : '',
      had ? `${had} ${had === 1 ? 'was' : 'were'} already in the boxes.` : '',
      full ? `${full} did not fit: all ${n} boxes are full.` : ''
    ].filter(Boolean).join(' ');
    return { text, tone: full ? 'warn' : 'ok' };
  }

  form.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.serial !== undefined) {
      const f = allFields.find(x => x.type === 'serials');
      const arr = Array.isArray(d.values[f.key]) ? d.values[f.key] : (d.values[f.key] = []);
      arr[Number(t.dataset.serial)] = tidy({ type: 'serial' }, t.value);
      save(); refresh(); return;
    }
    if (t.dataset.loclink !== undefined) {
      const f = allFields.find(x => x.type === 'location');
      d.values[f.key] = t.value.trim() ? { link: t.value.trim() } : null;
      $('[data-locval]', form).innerHTML = locText(d.values[f.key]);
      save(); refresh(); return;
    }
    const f = fieldByKey[t.name]; if (!f) return;
    d.values[f.key] = tidy(f, t.value);
    if (f.type === 'number') allFields.filter(x => x.countKey === f.key).forEach(renderSerials);
    save(); refresh();
  });
  form.addEventListener('change', e => {
    const f = fieldByKey[e.target.name];
    if (f) {
      touched.add(f.key);
      if (f.type === 'aadhaar' || f.type === 'pan' || f.type === 'mobile' || f.type === 'email') e.target.value = f.type === 'aadhaar' ? display(f, d.values) : d.values[f.key];
      if (f.type === 'select') { refresh(); }
      showError(f);
    }
    if (e.target.dataset.serial !== undefined) { const sf = allFields.find(x => x.type === 'serials'); touched.add(sf.key); showError(sf); }
  });
  form.addEventListener('focusout', e => { const f = fieldByKey[e.target.name]; if (f && e.target.value) { touched.add(f.key); showError(f); } });

  // GPS photos: start finding the location as the photo picker opens
  let gpsWait = null;
  form.addEventListener('click', async e => {
    const sc = e.target.closest('[data-scan]');
    if (sc) { scanField(fieldByKey[sc.dataset.scan]); return; }
    const ss = e.target.closest('[data-scan-serial]');
    if (ss) { scanSerial(Number(ss.dataset.scanSerial)); return; }
    if (e.target.closest('[data-scanall]')) { scanAllSerials(); return; }

    const lab = e.target.closest('.photos.gps .add-photo');
    if (lab) gpsWait = getPosition().catch(err => err);

    const loc = e.target.closest('[data-locate]');
    if (loc) {
      const f = allFields.find(x => x.type === 'location');
      busy(loc, true);
      $('[data-locval]', form).textContent = 'Finding the location…';
      try {
        const p = await getPosition();
        d.values[f.key] = { lat: p.lat, lng: p.lng, acc: p.acc, at: p.at };
        const li = $('[data-loclink]', form); if (li) li.value = '';
        $('[data-locval]', form).innerHTML = locText(d.values[f.key]);
        if (p.acc > 100) toast(`The location is only accurate to ${Math.round(p.acc)} m. Try again outside for a better fix.`);
        touched.add(f.key); save(); refresh(); showError(f);
      } catch (err) {
        $('[data-locval]', form).innerHTML = locText(d.values[f.key]);
        toast(err.message, 'bad');
      }
      busy(loc, false);
      return;
    }

    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const f = fieldByKey[rm.dataset.remove], i = Number(rm.dataset.i);
      const [gone] = d.values[f.key].splice(i, 1);
      if (gone) { store.deletePhotos([gone.pid]); const u = urls.get(gone.pid); if (u) { URL.revokeObjectURL(u); urls.delete(gone.pid); } }
      const st = $(`[data-status="${f.key}"]`, form); if (st) { st.textContent = ''; st.classList.remove('warn', 'ok'); }
      save(); renderThumbs(f); refresh(); showError(f);
      $(`[data-photo="${f.key}"]`, form).focus();
    }
  });

  form.addEventListener('change', async e => {
    const inp = e.target.closest('[data-photo]'); if (!inp || !inp.files.length) return;
    const f = fieldByKey[inp.dataset.photo];
    const files = [...inp.files];
    inp.value = '';
    const status = $(`[data-status="${f.key}"]`, form);
    const max = f.type === 'photos' ? (f.max || 60) : 1;
    try {
      // GPS photos: the location saved in the photo itself (where it was taken) comes first. Without it,
      // this device's location is used. A computer often has neither: the photo is then still added,
      // marked "No GPS" here and in the PDF, so the office can see it.
      let gps = null, noGps = '';
      if (f.type === 'gpsphoto') {
        status.textContent = 'Reading the photo’s location…';
        const exif = await readExifGps(files[0]);
        if (exif) {
          gps = { lat: exif.lat, lng: exif.lng, acc: null, at: exif.at || files[0].lastModified || Date.now(), source: 'photo' };
        } else {
          status.textContent = 'Getting the GPS location…';
          let pos = gpsWait ? await gpsWait : null;
          if (!pos || pos instanceof Error) pos = await getPosition().catch(err => err);
          if (pos instanceof Error) noGps = pos.message;
          else gps = { ...pos, at: Date.now(), source: 'device', late: Date.now() - (files[0].lastModified || Date.now()) > 10 * 60 * 1000 };
        }
        gpsWait = null;
      }
      const room = max - (f.type === 'photos' ? (d.values[f.key] || []).length : 0);
      const take = files.slice(0, room);
      if (files.length > take.length) toast(`Only ${max} photos fit here.`);
      const added = [];
      for (let i = 0; i < take.length; i++) {
        status.textContent = take.length > 1 ? `Preparing photo ${i + 1} of ${take.length}…` : 'Preparing the photo…';
        const stamp = gps ? { ...gps, label: f.label.replace(/^GPS photo of /i, '').replace(/^./, c => c.toUpperCase()) } : null;
        const ph = await preparePhoto(take[i], stamp);
        const pid = await store.savePhoto(ph.blob);
        added.push({ pid, w: ph.w, h: ph.h, at: Date.now(),
          ...(gps ? { gps: { lat: gps.lat, lng: gps.lng, acc: gps.acc, at: gps.at, source: gps.source, late: !!gps.late } } : {}),
          ...(f.type === 'gpsphoto' && !gps ? { noGps: true } : {}) });
      }
      if (f.type === 'photos') d.values[f.key] = [...(d.values[f.key] || []), ...added];
      else {
        const old = d.values[f.key] || [];
        if (old.length) store.deletePhotos(old.map(p => p.pid));
        d.values[f.key] = added.slice(0, 1);
      }
      status.classList.toggle('warn', !!noGps);
      status.textContent = noGps
        ? 'No location found: marked “No GPS”.'
        : gps && gps.source === 'photo' ? 'Added, with the location saved in the photo.'
        : gps && gps.acc > 100 ? `Added. The GPS was only accurate to ${Math.round(gps.acc)} m.` : '';
      touched.add(f.key);
      await store.saveDraft(d);
      renderThumbs(f); refresh(); showError(f);
      if (f.readInto && take.length) readCodes(f, take); // the original photos, sharper than the ones kept
    } catch (err) {
      status.textContent = '';
      toast(err && err.message === 'jpeg' ? 'This phone could not prepare the photo. Please update the phone’s software or use another phone.'
        : err && err.message === 'image' ? 'This photo could not be opened. Use a JPG or PNG photo (iPhone HEIC photos may not open on a computer).'
        : (err && err.message) || 'Could not add the photo.', 'bad');
    }
  });

  $('#makePdf').addEventListener('click', async () => {
    submitted = true;
    refresh();
    const list = activeFields(d.section, d.mode, d.values);
    const bad = list.filter(f => check(f, d.values));
    if (bad.length) {
      const w = wrapOf(bad[0].key);
      w.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      const focusable = (bad[0].type === 'serials' && ($$('[data-serial]', w).find(i => !i.value) || $('[data-serial]', w)))
        || $('input:not(.vh), select, button', w) || $('input', w);
      if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 300);
      return;
    }
    await store.saveDraft(d);
    go(`#/done/${d.id}`);
  });

  // save straight away when the app is closed or goes to the background (e.g. switching to WhatsApp)
  const flush = () => { clearTimeout(saveT); store.saveDraft(d).catch(() => {}); };
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  current = () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
    flush(); freeUrls();
  };
}

// ---------- dealer: PDF ready ----------
let lastPdf = null; // { id, blob, name }
async function doneView(id) {
  const d = await store.getDraft(id);
  if (!d || d.owner !== session.user.phone) { go('#/'); return; }
  const sec = SECTIONS[d.section];
  const modeName = d.mode === 'loan' ? 'Loan' : d.mode === 'cash' ? 'Cash' : '';
  document.title = 'PDF ready – Pontis Energy';
  app.innerHTML = `${topBar()}<main class="wrap narrow" id="main"><div class="done card" id="doneCard" aria-live="polite">
    <div class="spinner" aria-hidden="true"></div><h1>Making the PDF…</h1><p class="muted">This takes a few seconds.</p></div></main>`;
  const fileName = [sec.title.replace(' ', ''), modeName, d.values.name, d.values.consumer].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '-') + '.pdf';
  try {
    if (!lastPdf || lastPdf.id !== id || lastPdf.at < d.updatedAt) {
      const blob = await buildClientPdf({
        section: d.section, mode: d.mode, values: d.values,
        fields: activeFields(d.section, d.mode, d.values),
        dealer: { name: session.user.name, phone: prettyPhone(session.user.phone) },
        createdAt: Date.now(), ref: `S${d.section}${d.mode ? d.mode[0].toUpperCase() : ''}-${d.id.slice(-6).toUpperCase()}`
      });
      lastPdf = { id, blob, name: fileName, at: Date.now() };
    }
  } catch (err) {
    $('#doneCard').innerHTML = `<h1>Could not make the PDF</h1><p class="muted">${esc(err.message || 'Please try again.')}</p>
      <div class="stack"><a class="btn primary block" href="#/form/${esc(id)}">Back to the form</a></div>`;
    return;
  }
  const { blob } = lastPdf;
  const file = typeof File === 'function' ? new File([blob], fileName, { type: 'application/pdf' }) : null;
  const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  $('#doneCard').innerHTML = `<div class="done-ico">${ICON.check}</div>
    <h1>PDF ready</h1>
    <p class="muted file-name">${esc(fileName)} · ${(blob.size / 1048576).toFixed(1)}&nbsp;MB</p>
    <div class="stack">
      ${canShare ? `<button class="btn wa block" type="button" id="share">${ICON.wa} Send on WhatsApp</button>` : ''}
      <button class="btn ${canShare ? '' : 'primary'} block" type="button" id="download">${ICON.file} ${canShare ? 'Save PDF' : 'Download PDF'}</button>
      <a class="btn ghost block" href="#/form/${esc(id)}">Change details</a>
    </div>
    <div class="finish">
      <p class="muted small">After sending, tap <b>Done</b>. The client’s photos are then removed from this phone.</p>
      <button class="btn ok block" type="button" id="finish">${ICON.check} Done, client sent</button>
    </div>`;
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };
  $('#download').onclick = download;
  const share = $('#share');
  if (share) share.onclick = async () => {
    try { await navigator.share({ files: [file], title: fileName }); }
    catch (err) { if (err && err.name !== 'AbortError') { toast('Sharing did not work, so the PDF was saved instead.'); download(); } }
  };
  $('#finish').onclick = async () => {
    const owner = session.user.phone;
    // the Aadhaar number is kept only to fill Section 2, and removed once Section 2 is sent
    store.markSent(owner, d.section, { name: d.values.name, consumer: d.values.consumer, mobile: d.values.mobile, mode: d.mode, aadhaar: d.values.aadhaar });
    await store.deleteDraft(id);
    lastPdf = null;
    toast('Done. The client’s photos are removed from this phone.', 'good');
    go('#/');
  };
}

// ---------- admin: dealers ----------
let dealerCache = [];
let staffCache = [];
function adminTabs(active) {
  return `<nav class="tabs" aria-label="Admin"><a href="#/" ${active === 'dealers' ? 'aria-current="page"' : ''}>Dealers</a><a href="#/staff" ${active === 'staff' ? 'aria-current="page"' : ''}>Staff</a><a href="#/clients" ${active === 'clients' ? 'aria-current="page"' : ''}>Clients</a></nav>`;
}
const officeBar = () => topBar(session.user.role === 'admin' ? adminTabs('clients') : '');
async function dealersView() {
  document.title = 'Dealers – Pontis Energy';
  app.innerHTML = `${topBar(adminTabs('dealers'))}<main class="wrap wide" id="main">
    <div data-install-slot></div>
    <div class="head-row"><h1>Dealers</h1><button class="btn primary" type="button" id="addDealer">${ICON.plus} Add dealer</button></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Search name, number or area…" aria-label="Search dealers" autocomplete="off">
    <span class="muted small" id="count" aria-live="polite"></span></div>
    <ul class="dealers" id="dealerList"><li class="muted">Loading…</li></ul>
  </main>`;
  const listEl = $('#dealerList'), q = $('#q');
  // how many clients each dealer has in the Clients tab (from the PDFs kept on this device)
  let sent = new Map();
  store.listOffice().then(rows => {
    sent = new Map();
    groupClients(rows).forEach(c => { const k = String(c.dealer.phone || '').replace(/\D/g, ''); sent.set(k, (sent.get(k) || 0) + 1); });
    if (dealerCache.length) draw();
  }).catch(() => {});
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const items = dealerCache.filter(x => !term || `${x.name} ${x.phone} ${x.area}`.toLowerCase().includes(term));
    const active = dealerCache.filter(x => x.active).length;
    $('#count').textContent = dealerCache.length ? `${dealerCache.length} dealer${dealerCache.length > 1 ? 's' : ''} · ${active} active` : '';
    if (!dealerCache.length) {
      listEl.innerHTML = `<li class="empty card"><h2>No dealers yet</h2><p class="muted">Add your first dealer. The app makes a password, and you send the login details to their WhatsApp in one tap.</p></li>`;
      return;
    }
    listEl.innerHTML = items.length ? items.map(x => `<li class="dealer card${x.active ? '' : ' off'}">
      <div class="dealer-main"><b>${esc(x.name)}</b>
        <span class="muted small">${esc(prettyPhone(x.phone))}${x.area ? ` · ${esc(x.area)}` : ''}</span>
        ${x.notes ? `<span class="muted small clamp">${esc(x.notes)}</span>` : ''}</div>
      <span class="pill ${x.active ? 'ok' : 'off'}">${x.active ? 'Active' : 'Blocked'}</span>
      <div class="dealer-acts">
        ${sent.get(x.phone) ? `<a class="btn sm" href="#/clients?dealer=${esc(x.phone)}">Clients (${sent.get(x.phone)})</a>` : ''}
        <button class="btn sm" type="button" data-act="edit" data-id="${x.id}">Edit…</button>
        <button class="btn sm" type="button" data-act="reset" data-id="${x.id}">Reset password…</button>
        <button class="btn sm" type="button" data-act="toggle" data-id="${x.id}">${x.active ? 'Block…' : 'Unblock'}</button>
        <button class="btn sm ghost danger-text" type="button" data-act="delete" data-id="${x.id}">Delete…</button>
      </div></li>`).join('') : `<li class="muted">No dealer matches “${esc(q.value)}”.</li>`;
  };
  const load = async () => {
    try { dealerCache = (await api('dealers')).dealers; draw(); }
    catch (err) { if (err.status !== 401) listEl.innerHTML = `<li class="card err-card">${esc(err.message)} <button class="btn sm" type="button" id="retry">Try again</button></li>`; const r = $('#retry'); if (r) r.onclick = load; }
  };
  q.addEventListener('input', draw);
  $('#addDealer').onclick = () => dealerForm(null, load);
  listEl.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const x = dealerCache.find(y => y.id === Number(b.dataset.id)); if (!x) return;
    if (b.dataset.act === 'edit') dealerForm(x, load);
    if (b.dataset.act === 'reset') {
      if (!await confirmBox(`Reset ${x.name}’s password?`, 'A new password is made and the old one stops working. They are logged out until they use the new one.', 'Reset password')) return;
      busy(b, true);
      try { const r = await api(`dealers/${x.id}/reset`, { method: 'POST', body: {} }); showLogin(r.dealer, r.password, true); load(); }
      catch (err) { toast(err.message, 'bad'); }
      busy(b, false);
    }
    if (b.dataset.act === 'toggle') {
      if (x.active && !await confirmBox(`Block ${x.name}?`, 'They are logged out and cannot log in until you unblock them. Nothing else changes.', 'Block', true)) return;
      busy(b, true);
      try { await api(`dealers/${x.id}`, { method: 'PUT', body: { active: !x.active } }); toast(x.active ? `${x.name} is blocked.` : `${x.name} can log in again.`, 'good'); await load(); }
      catch (err) { toast(err.message, 'bad'); busy(b, false); }
    }
    if (b.dataset.act === 'delete') {
      if (!await confirmBox(`Delete ${x.name}?`, 'They can no longer log in, and this cannot be undone. PDFs they already sent are not affected. To stop them for a while, use Block instead.', 'Delete', true)) return;
      busy(b, true);
      try { await api(`dealers/${x.id}`, { method: 'DELETE' }); toast(`${x.name} is deleted.`); await load(); }
      catch (err) { toast(err.message, 'bad'); busy(b, false); }
    }
  };
  load();
}

function dealerForm(x, reload) {
  const isNew = !x;
  const m = openModal(`<h2 id="mTitle">${isNew ? 'Add dealer' : `Edit ${esc(x.name)}`}</h2>
    <form id="dealerForm" novalidate>
      <label class="fld"><span>Name</span><input name="name" value="${esc(x ? x.name : '')}" autocomplete="off" autocapitalize="words" required></label>
      <p class="err" data-err="name" aria-live="polite"></p>
      <label class="fld"><span>Mobile number (their login and WhatsApp)</span><input name="phone" type="tel" inputmode="numeric" value="${esc(x ? prettyPhone(x.phone) : '')}" autocomplete="off" placeholder="98470 12345…" required></label>
      <p class="err" data-err="phone" aria-live="polite"></p>
      <label class="fld"><span>Area <span class="opt">(optional)</span></span><input name="area" value="${esc(x ? x.area : '')}" autocomplete="off" placeholder="Vadakara…"></label>
      <label class="fld"><span>Notes <span class="opt">(optional)</span></span><textarea name="notes" rows="2">${esc(x ? x.notes : '')}</textarea></label>
      ${isNew ? `<label class="fld"><span>Password <span class="opt">(optional)</span></span><input name="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Leave empty to make one automatically…" class="mono"></label>
      <p class="err" data-err="password" aria-live="polite"></p>` : ''}
      <p class="form-err" id="dfErr" role="alert"></p>
      <div class="modal-actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">${isNew ? 'Add dealer' : 'Save'}</button></div>
    </form>`);
  const f = $('#dealerForm', m);
  $('[data-cancel]', m).onclick = closeModal;
  f.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.tagName === 'TEXTAREA') f.requestSubmit(); });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    $$('[data-err]', f).forEach(p => { p.textContent = ''; });
    $$('input', f).forEach(i => i.classList.remove('invalid'));
    $('#dfErr', f).textContent = '';
    const body = { name: f.name.value.trim(), phone: f.phone.value.trim(), area: f.area.value.trim(), notes: f.notes.value.trim() };
    if (isNew && f.password.value.trim()) body.password = f.password.value.trim();
    const errs = {};
    if (body.name.length < 2) errs.name = 'Enter the dealer’s name.';
    if (!/^[6-9]\d{9}$/.test(normMobile(body.phone))) errs.phone = 'Enter a 10-digit mobile number.';
    const showErrs = fields => {
      Object.entries(fields).forEach(([k, msg]) => { const p = $(`[data-err="${k}"]`, f); if (p) p.textContent = msg; if (f[k]) f[k].classList.add('invalid'); });
      const firstKey = Object.keys(fields)[0]; if (f[firstKey]) f[firstKey].focus();
    };
    if (Object.keys(errs).length) { showErrs(errs); return; }
    const btn = f.querySelector('[type=submit]');
    busy(btn, true);
    try {
      if (isNew) {
        const r = await api('dealers', { method: 'POST', body });
        reload();
        showLogin(r.dealer, r.password, false);
      } else {
        await api(`dealers/${x.id}`, { method: 'PUT', body });
        closeModal(); toast('Saved.', 'good'); reload();
      }
    } catch (err) {
      busy(btn, false);
      if (err.data && err.data.fields) showErrs(err.data.fields);
      else $('#dfErr', f).textContent = err.message;
    }
  });
}

// Shows the login details once, with a WhatsApp button that opens the chat with the message ready
function showLogin(person, password, isReset, kind = 'dealer') {
  const link = location.origin + '/';
  const isStaff = kind === 'staff';
  const msg = isStaff
    ? `Hello ${person.name},\n\n${isReset ? 'Your new staff login for the Pontis Energy app:' : 'Welcome to Pontis Energy. Your staff login to open dealer PDFs and extract client details and photos:'}\n\nApp: ${link}\nMobile number: ${prettyPhone(person.phone)}\nPassword: ${password}\n\nOpen the link and log in.`
    : `Hello ${person.name},\n\n${isReset ? 'Your new login for the Pontis Energy dealer app:' : 'Welcome to the Pontis Energy dealer app. Your login:'}\n\nApp: ${link}\nMobile number: ${prettyPhone(person.phone)}\nPassword: ${password}\n\nOpen the link and log in. Then add the app to your home screen (Share > Add to Home Screen on iPhone, or the menu > Install app on Android).`;
  const wa = `https://wa.me/91${person.phone}?text=${encodeURIComponent(msg)}`;
  const who = isStaff ? 'staff member' : 'dealer';
  const addedTitle = isStaff ? 'Staff added' : 'Dealer added';
  const m = openModal(`<h2 id="mTitle">${isReset ? 'New password' : addedTitle}: ${esc(person.name)}</h2>
    <p class="muted">Send these login details to the ${who} now. The password is shown only this once; if it is lost, use <b>Reset password</b>.</p>
    <dl class="creds"><dt>Mobile number</dt><dd>${esc(prettyPhone(person.phone))}</dd><dt>Password</dt><dd class="mono big" translate="no">${esc(password)}</dd></dl>
    <div class="stack">
      <a class="btn wa block" href="${esc(wa)}" target="_blank" rel="noopener" id="waSend">${ICON.wa} Send on WhatsApp</a>
      <button class="btn block" type="button" id="copyCreds">Copy the message</button>
      <button class="btn ghost block" type="button" data-close>Done</button>
    </div>`);
  $('#waSend', m).addEventListener('click', () => toast('WhatsApp opens with the message ready. Tap Send there.'));
  $('#copyCreds', m).onclick = async () => {
    try { await navigator.clipboard.writeText(msg); toast('Copied.', 'good'); } catch (e) { toast('Could not copy. Use the WhatsApp button instead.', 'bad'); }
  };
  $('[data-close]', m).onclick = closeModal;
}

// ---------- admin: staff (PDF upload & data extraction only) ----------
async function staffView() {
  document.title = 'Staff – Pontis Energy';
  app.innerHTML = `${topBar(adminTabs('staff'))}<main class="wrap wide" id="main">
    <div data-install-slot></div>
    <div class="head-row"><h1>Staff</h1><button class="btn primary" type="button" id="addStaff">${ICON.plus} Add staff</button></div>
    <p class="muted small intro">Staff can only upload dealer PDFs and extract client details and photos. They cannot manage dealers or staff.</p>
    <div class="toolbar"><input type="search" id="q" placeholder="Search name, number or notes…" aria-label="Search staff" autocomplete="off">
    <span class="muted small" id="count" aria-live="polite"></span></div>
    <ul class="dealers" id="staffList"><li class="muted">Loading…</li></ul>
  </main>`;
  const listEl = $('#staffList'), q = $('#q');
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const items = staffCache.filter(x => !term || `${x.name} ${x.phone} ${x.notes}`.toLowerCase().includes(term));
    const active = staffCache.filter(x => x.active).length;
    $('#count').textContent = staffCache.length ? `${plural(staffCache.length, 'staff member', 'staff members')} · ${active} active` : '';
    if (!staffCache.length) {
      listEl.innerHTML = `<li class="empty card"><h2>No staff yet</h2><p class="muted">Add a staff member to upload dealer PDFs and extract client details and photos. The app makes a password, and you send the login details on WhatsApp in one tap.</p></li>`;
      return;
    }
    listEl.innerHTML = items.length ? items.map(x => `<li class="dealer card${x.active ? '' : ' off'}">
      <div class="dealer-main"><b>${esc(x.name)}</b>
        <span class="muted small">${esc(prettyPhone(x.phone))}</span>
        ${x.notes ? `<span class="muted small clamp">${esc(x.notes)}</span>` : ''}</div>
      <span class="pill ${x.active ? 'ok' : 'off'}">${x.active ? 'Active' : 'Blocked'}</span>
      <div class="dealer-acts">
        <button class="btn sm" type="button" data-act="edit" data-id="${x.id}">Edit…</button>
        <button class="btn sm" type="button" data-act="reset" data-id="${x.id}">Reset password…</button>
        <button class="btn sm" type="button" data-act="toggle" data-id="${x.id}">${x.active ? 'Block…' : 'Unblock'}</button>
        <button class="btn sm ghost danger-text" type="button" data-act="delete" data-id="${x.id}">Delete…</button>
      </div></li>`).join('') : `<li class="muted">No staff member matches “${esc(q.value)}”.</li>`;
  };
  const load = async () => {
    try { staffCache = (await api('staff')).staff; draw(); }
    catch (err) { if (err.status !== 401) listEl.innerHTML = `<li class="card err-card">${esc(err.message)} <button class="btn sm" type="button" id="retry">Try again</button></li>`; const r = $('#retry'); if (r) r.onclick = load; }
  };
  q.addEventListener('input', draw);
  $('#addStaff').onclick = () => staffForm(null, load);
  listEl.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const x = staffCache.find(y => y.id === Number(b.dataset.id)); if (!x) return;
    if (b.dataset.act === 'edit') staffForm(x, load);
    if (b.dataset.act === 'reset') {
      if (!await confirmBox(`Reset ${x.name}’s password?`, 'A new password is made and the old one stops working. They are logged out until they use the new one.', 'Reset password')) return;
      busy(b, true);
      try { const r = await api(`staff/${x.id}/reset`, { method: 'POST', body: {} }); showLogin(r.staff, r.password, true, 'staff'); load(); }
      catch (err) { toast(err.message, 'bad'); }
      busy(b, false);
    }
    if (b.dataset.act === 'toggle') {
      if (x.active && !await confirmBox(`Block ${x.name}?`, 'They are logged out and cannot log in until you unblock them.', 'Block', true)) return;
      busy(b, true);
      try { await api(`staff/${x.id}`, { method: 'PUT', body: { active: !x.active } }); toast(x.active ? `${x.name} is blocked.` : `${x.name} can log in again.`, 'good'); await load(); }
      catch (err) { toast(err.message, 'bad'); busy(b, false); }
    }
    if (b.dataset.act === 'delete') {
      if (!await confirmBox(`Delete ${x.name}?`, 'They can no longer log in, and this cannot be undone. PDFs already saved on devices are not affected. To stop them for a while, use Block instead.', 'Delete', true)) return;
      busy(b, true);
      try { await api(`staff/${x.id}`, { method: 'DELETE' }); toast(`${x.name} is deleted.`); await load(); }
      catch (err) { toast(err.message, 'bad'); busy(b, false); }
    }
  };
  load();
}

function staffForm(x, reload) {
  const isNew = !x;
  const m = openModal(`<h2 id="mTitle">${isNew ? 'Add staff' : `Edit ${esc(x.name)}`}</h2>
    <form id="staffForm" novalidate>
      <label class="fld"><span>Name</span><input name="name" value="${esc(x ? x.name : '')}" autocomplete="off" autocapitalize="words" required></label>
      <p class="err" data-err="name" aria-live="polite"></p>
      <label class="fld"><span>Mobile number (their login and WhatsApp)</span><input name="phone" type="tel" inputmode="numeric" value="${esc(x ? prettyPhone(x.phone) : '')}" autocomplete="off" placeholder="98470 12345…" required></label>
      <p class="err" data-err="phone" aria-live="polite"></p>
      <label class="fld"><span>Notes <span class="opt">(optional)</span></span><textarea name="notes" rows="2" placeholder="Office desk, branch…">${esc(x ? x.notes : '')}</textarea></label>
      ${isNew ? `<label class="fld"><span>Password <span class="opt">(optional)</span></span><input name="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Leave empty to make one automatically…" class="mono"></label>
      <p class="err" data-err="password" aria-live="polite"></p>` : ''}
      <p class="form-err" id="sfErr" role="alert"></p>
      <div class="modal-actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">${isNew ? 'Add staff' : 'Save'}</button></div>
    </form>`);
  const f = $('#staffForm', m);
  $('[data-cancel]', m).onclick = closeModal;
  f.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.tagName === 'TEXTAREA') f.requestSubmit(); });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    $$('[data-err]', f).forEach(p => { p.textContent = ''; });
    $$('input', f).forEach(i => i.classList.remove('invalid'));
    $('#sfErr', f).textContent = '';
    const body = { name: f.name.value.trim(), phone: f.phone.value.trim(), notes: f.notes.value.trim() };
    if (isNew && f.password.value.trim()) body.password = f.password.value.trim();
    const errs = {};
    if (body.name.length < 2) errs.name = 'Enter the staff member’s name.';
    if (!/^[6-9]\d{9}$/.test(normMobile(body.phone))) errs.phone = 'Enter a 10-digit mobile number.';
    const showErrs = fields => {
      Object.entries(fields).forEach(([k, msg]) => { const p = $(`[data-err="${k}"]`, f); if (p) p.textContent = msg; if (f[k]) f[k].classList.add('invalid'); });
      const firstKey = Object.keys(fields)[0]; if (f[firstKey]) f[firstKey].focus();
    };
    if (Object.keys(errs).length) { showErrs(errs); return; }
    const btn = f.querySelector('[type=submit]');
    busy(btn, true);
    try {
      if (isNew) {
        const r = await api('staff', { method: 'POST', body });
        reload();
        showLogin(r.staff, r.password, false, 'staff');
      } else {
        await api(`staff/${x.id}`, { method: 'PUT', body });
        closeModal(); toast('Saved.', 'good'); reload();
      }
    } catch (err) {
      busy(btn, false);
      if (err.data && err.data.fields) showErrs(err.data.fields);
      else $('#sfErr', f).textContent = err.message;
    }
  });
}

// ---------- admin: clients (from the PDFs dealers send) ----------
// The office saves the PDFs from WhatsApp and adds them here. Each PDF's details are read from it,
// and the PDF is kept on this device, so it can be opened and its photos saved later.
// One row per form (its Ref): a PDF made again after "Change details" replaces the older copy.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const modeLabel = m => (m === 'loan' ? 'Loan' : m === 'cash' ? 'Cash' : '');
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const digits = s => String(s || '').replace(/\D/g, '');
const dealerKey = d => digits(d && d.phone) || (d && d.name) || '';

async function addPdfs(files) {
  const rows = await store.listOffice();
  const { rows: got, skipped } = await readPdfFiles(files);
  const byRef = new Map(rows.map(r => [r.ref, r]));
  const changed = [], pdfs = [];
  let added = 0, replaced = 0, same = 0;
  for (const { file, ...row } of got) {
    const old = byRef.get(row.ref);
    if (old && old.createdAt > row.createdAt) { same++; continue; } // an older copy of a form in the list
    if (old && old.createdAt === row.createdAt) { same++; pdfs.push([row.ref, file]); continue; } // the same PDF: keep the file
    if (old) replaced++; else added++;
    byRef.set(row.ref, row);
    changed.push(row);
    pdfs.push([row.ref, file]);
  }
  await store.putOffice(changed);
  for (const [ref, f] of pdfs) await store.putOfficePdf(ref, f);
  const msg = [
    added || !(replaced || same) ? `${plural(added, 'PDF', 'PDFs')} added.` : '',
    replaced ? (replaced === 1 ? '1 PDF was a newer copy of a form already here, so it replaced the older one.' : `${replaced} PDFs were newer copies of forms already here, so they replaced the older ones.`) : '',
    same ? `${plural(same, 'PDF was', 'PDFs were')} already here.` : '',
    skipped.length ? `${plural(skipped.length, 'file was', 'files were')} not from this app: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}.` : ''
  ].filter(Boolean).join(' ');
  return { msg, got };
}
const addError = err => (err && err.name === 'QuotaExceededError'
  ? 'This device is out of space for more PDFs. Delete old clients, then try again.'
  : 'This browser could not keep the PDFs. Open the app in Chrome, Edge or Safari, not in a private window.');

// Dropping PDFs anywhere on the page adds them
function pdfDrop(el, onFiles) {
  el.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('over'); } });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
  el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('over'); onFiles([...e.dataTransfer.files]); });
}
const addPdfButton = (label = 'Add PDFs', cls = 'primary') =>
  `<label class="btn ${cls}">${ICON.plus}${esc(label)}<input class="vh" type="file" accept="application/pdf,.pdf" multiple data-addpdf></label>`;

// Opens a kept PDF in a new tab (the tab is opened at the tap, so the browser does not block it)
async function openPdf(ref, name) {
  const w = window.open('', '_blank');
  const blob = await store.getOfficePdf(ref).catch(() => null);
  if (!blob) { if (w) w.close(); toast('This PDF is not on this device. Add it again from WhatsApp.', 'bad'); return; }
  const u = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  if (w) w.location.href = u; else download(blob, name);
  setTimeout(() => URL.revokeObjectURL(u), 120000);
}
const pdfName = (c, r) => `${fileName(`${c.name}${c.consumer ? ` - ${c.consumer}` : ''} - Section ${r.section}`)}.pdf`;

async function deleteClients(clients) {
  const n = clients.length, forms = clients.reduce((a, c) => a + c.rows.length, 0);
  const who = n === 1 ? clients[0].name : plural(n, 'client', 'clients');
  if (!await confirmBox(`Delete ${who}?`, `${plural(forms, 'form', 'forms')} and ${forms === 1 ? 'its PDF and photos are' : 'their PDFs and photos are'} removed from this device. This cannot be undone here, but the PDFs stay in WhatsApp and can be added again.`, 'Delete', true)) return false;
  await store.deleteOffice(clients.flatMap(c => c.rows.map(r => r.ref))).catch(() => {});
  toast(`${n === 1 ? clients[0].name : plural(n, 'client', 'clients')} deleted.`);
  return true;
}

function clientsView() {
  document.title = 'Clients – Pontis Energy';
  const qp = routeQuery();
  clientsView.query = qp.toString() ? `?${qp}` : '';
  const st = { q: qp.get('q') || '', dealer: qp.get('dealer') || '', status: qp.get('status') || '', type: qp.get('type') || '', sort: qp.get('sort') || 'new' };
  const selected = new Set();
  app.innerHTML = `${officeBar()}<main class="wrap wide drop-page" id="main">
    <div data-install-slot></div>
    <div class="head-row"><h1>Clients</h1>${addPdfButton()}</div>
    <p class="muted small intro">Save the PDFs dealers send on WhatsApp, then add them here or drop them on this page.</p>
    <div id="addMsg" aria-live="polite"></div>
    <div id="clientsOut"><p class="muted">Loading…</p></div>
  </main>`;
  const out = $('#clientsOut'), main = $('#main');
  let rows = [], pdfRefs = new Set(), clients = [], shown = [];

  // the filters are kept in the address, so Back and a saved link return to the same list
  const saveState = () => {
    const p = new URLSearchParams();
    if (st.q) p.set('q', st.q);
    if (st.dealer) p.set('dealer', st.dealer);
    if (st.status) p.set('status', st.status);
    if (st.type) p.set('type', st.type);
    if (st.sort !== 'new') p.set('sort', st.sort);
    clientsView.query = p.toString() ? `?${p}` : '';
    history.replaceState(null, '', `#/clients${clientsView.query}`);
  };

  const draw = () => {
    clients = groupClients(rows);
    if (!clients.length) {
      out.innerHTML = `<div class="empty card"><h2>No clients yet</h2>
        <p class="muted">Add the PDFs dealers send on WhatsApp. You can choose many at once.</p>
        <div class="empty-acts">${addPdfButton('Choose PDFs')}</div></div>`;
      return;
    }
    const dealers = new Map();
    clients.forEach(c => { const k = dealerKey(c.dealer); const d = dealers.get(k) || { name: c.dealer.name || 'Unknown', n: 0 }; d.n++; dealers.set(k, d); });
    if (st.dealer && !dealers.has(st.dealer)) st.dealer = '';
    const waiting = clients.filter(c => !c.s2).length;
    out.innerHTML = `
      <div class="stats" role="group" aria-label="Show">
        <button type="button" class="stat" data-status="" aria-pressed="${!st.status}"><b>${clients.length}</b><span>All clients</span></button>
        <button type="button" class="stat wait" data-status="s2" aria-pressed="${st.status === 's2'}"><b>${waiting}</b><span>Waiting for Section 2</span></button>
        <button type="button" class="stat ok" data-status="done" aria-pressed="${st.status === 'done'}"><b>${clients.length - waiting}</b><span>Installed</span></button>
      </div>
      <div class="filters">
        <input type="search" id="q" value="${esc(st.q)}" placeholder="Search name, consumer, mobile or Ref…" aria-label="Search clients" autocomplete="off" spellcheck="false">
        <select id="fDealer" aria-label="Dealer"><option value="">All dealers</option>${[...dealers].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, d]) => `<option value="${esc(k)}"${k === st.dealer ? ' selected' : ''}>${esc(d.name)} (${d.n})</option>`).join('')}</select>
        <select id="fType" aria-label="Cash or loan"><option value="">Cash &amp; loan</option><option value="cash"${st.type === 'cash' ? ' selected' : ''}>Cash</option><option value="loan"${st.type === 'loan' ? ' selected' : ''}>Loan</option></select>
        <select id="fSort" aria-label="Sort"><option value="new">Newest first</option><option value="old"${st.sort === 'old' ? ' selected' : ''}>Oldest first</option><option value="name"${st.sort === 'name' ? ' selected' : ''}>Name A–Z</option><option value="dealer"${st.sort === 'dealer' ? ' selected' : ''}>By dealer</option></select>
      </div>
      <div class="result-row"><span class="muted small" id="count" aria-live="polite"></span><button class="link small" type="button" id="clearF" hidden>Clear filters</button></div>
      <div class="select-bar" id="selBar" hidden><span id="selCount"></span>
        <button class="btn sm danger" type="button" id="delSel">${ICON.trash} Delete…</button>
        <button class="btn sm ghost" type="button" id="selNone">Cancel</button></div>
      <ul class="clients" id="clientList"></ul>
      <p class="muted small storage" id="storage"></p>`;
    $('#q').addEventListener('input', e => { st.q = e.target.value; saveState(); drawList(); });
    [['#fDealer', 'dealer'], ['#fType', 'type'], ['#fSort', 'sort']].forEach(([sel, k]) => $(sel).addEventListener('change', e => { st[k] = e.target.value; saveState(); drawList(); }));
    drawList();
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => {
      const el = $('#storage'); if (el && e.usage) el.textContent = `${plural(pdfRefs.size, 'PDF', 'PDFs')} kept on this device · ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(e.usage / 1048576)} MB used`;
    }).catch(() => {});
  };

  const drawList = () => {
    const term = st.q.trim().toLowerCase(), num = digits(term);
    shown = clients.filter(c => (st.status === 's2' ? !c.s2 : st.status === 'done' ? !!c.s2 : true)
      && (!st.dealer || dealerKey(c.dealer) === st.dealer)
      && (!st.type || (c.s1 && c.s1.mode === st.type))
      && (!term || `${c.name} ${c.dealer.name || ''} ${c.rows.map(r => r.ref).join(' ')}`.toLowerCase().includes(term)
        || (num.length >= 3 && `${c.consumer} ${digits(c.mobile)}`.includes(num))));
    const by = { new: (a, b) => b.latest - a.latest, old: (a, b) => a.latest - b.latest, name: (a, b) => a.name.localeCompare(b.name), dealer: (a, b) => (a.dealer.name || '').localeCompare(b.dealer.name || '') || b.latest - a.latest };
    shown.sort(by[st.sort] || by.new);
    $$('.stat').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === st.status)));
    const filtered = !!(st.q || st.dealer || st.status || st.type);
    $('#count').textContent = filtered ? `Showing ${shown.length} of ${plural(clients.length, 'client', 'clients')}` : plural(clients.length, 'client', 'clients');
    $('#clearF').hidden = !filtered;
    $('#clientList').innerHTML = shown.length ? shown.map(c => {
      const forms = [c.s1, c.s2].filter(Boolean);
      const missing = c.rows.some(r => !pdfRefs.has(r.ref));
      return `<li class="client card${selected.has(c.key) ? ' picked' : ''}">
        <label class="pick"><input type="checkbox" data-pick="${esc(c.key)}"${selected.has(c.key) ? ' checked' : ''}><span class="vh">Select ${esc(c.name)}</span></label>
        <a class="client-link" href="#/client/${encodeURIComponent(c.key)}">
          <b>${esc(c.name)}</b>
          <span class="muted small">${c.consumer ? `Consumer <span class="mono">${esc(c.consumer)}</span>` : 'No consumer number'}${c.mobile ? ` · ${esc(c.mobile)}` : ''}</span>
          <span class="muted small">Dealer: ${esc(c.dealer.name || '—')}</span>
          <span class="client-status">
            ${c.s1 ? `<span class="pill info">S1 · ${esc(modeLabel(c.s1.mode) || 'Work start')} · ${esc(dayFmt.format(c.s1.createdAt))}</span>` : '<span class="pill off">No Section 1</span>'}
            ${c.s2 ? `<span class="pill ok">${ICON.check} S2 · ${esc(dayFmt.format(c.s2.createdAt))}</span>` : '<span class="pill wait">Section 2 pending</span>'}
            ${missing ? '<span class="pill off">PDF not on this device</span>' : ''}
          </span></a>
        <div class="client-acts">
          ${forms.map(r => `<button class="btn sm" type="button" data-open="${esc(r.ref)}" data-key="${esc(c.key)}"${pdfRefs.has(r.ref) ? '' : ' disabled'}>${ICON.file} S${r.section} PDF</button>`).join('')}
          <button class="btn sm ghost danger-text icon-sm" type="button" data-del="${esc(c.key)}" aria-label="Delete ${esc(c.name)}" title="Delete">${ICON.trash}</button>
        </div></li>`;
    }).join('') : `<li class="empty card"><p class="muted">No client matches these filters.</p><button class="btn sm" type="button" data-clearf>Clear filters</button></li>`;
    drawSel();
  };
  const drawSel = () => {
    const bar = $('#selBar'); if (!bar) return;
    bar.hidden = !selected.size;
    $('#selCount').textContent = `${selected.size} selected`;
  };
  const clearFilters = () => { Object.assign(st, { q: '', dealer: '', status: '', type: '' }); saveState(); draw(); };

  const load = async (msg = '') => {
    try { [rows, pdfRefs] = await Promise.all([store.listOffice(), store.officePdfRefs()]); }
    catch (e) { $('#addMsg').innerHTML = `<p class="note bad">${esc(addError(e))}</p>`; rows = []; }
    if (msg) $('#addMsg').innerHTML = `<p class="note">${esc(msg)}</p>`;
    selected.forEach(k => { if (!rows.some(r => clientKey(r) === k)) selected.delete(k); });
    draw();
  };
  const take = async files => {
    if (!files.length) return;
    $('#addMsg').innerHTML = '<p class="note">Reading the PDFs…</p>';
    try { const r = await addPdfs(files); await load(r.msg); }
    catch (e) { $('#addMsg').innerHTML = `<p class="note bad">${esc(addError(e))}</p>`; }
  };
  main.addEventListener('change', e => {
    if (e.target.matches('[data-addpdf]')) { take([...e.target.files]); e.target.value = ''; }
    if (e.target.matches('[data-pick]')) {
      const k = e.target.dataset.pick;
      if (e.target.checked) selected.add(k); else selected.delete(k);
      e.target.closest('.client').classList.toggle('picked', e.target.checked);
      drawSel();
    }
  });
  pdfDrop(main, take);
  main.addEventListener('click', async e => {
    const stat = e.target.closest('[data-status]');
    if (stat) { st.status = stat.dataset.status; saveState(); drawList(); return; }
    if (e.target.closest('#clearF, [data-clearf]')) { clearFilters(); return; }
    const op = e.target.closest('[data-open]');
    if (op) { const c = clients.find(x => x.key === op.dataset.key), r = c.rows.find(x => x.ref === op.dataset.open); openPdf(r.ref, pdfName(c, r)); return; }
    const del = e.target.closest('[data-del]');
    if (del) { if (await deleteClients([clients.find(x => x.key === del.dataset.del)])) load(); return; }
    if (e.target.closest('#selNone')) { selected.clear(); $$('[data-pick]').forEach(i => { i.checked = false; i.closest('.client').classList.remove('picked'); }); drawSel(); return; }
    if (e.target.closest('#delSel')) { if (await deleteClients(clients.filter(c => selected.has(c.key)))) { selected.clear(); load(); } }
  });
  load().then(() => { if (clientsView.scroll) window.scrollTo(0, clientsView.scroll); });
  current = () => { clientsView.scroll = window.scrollY; };
}

async function clientView(key) {
  const rows = (await store.listOffice().catch(() => [])).filter(r => clientKey(r) === key);
  if (!rows.length) { go('#/clients'); return; }
  const c = groupClients(rows)[0];
  document.title = `${c.name} – Pontis Energy`;
  const urls = [];
  const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  current = () => urls.forEach(u => URL.revokeObjectURL(u));
  const base = fileName(`${c.name}${c.consumer ? ` - ${c.consumer}` : ''}`);
  const back = `#/clients${clientsView.query || ''}`;
  const mobile = digits(c.mobile), dealerPhone = digits(c.dealer.phone);

  const valueHtml = v => /^https?:\/\/\S+/.test(v)
    ? `<a href="${esc(v.split(' ')[0])}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v || '—');
  app.innerHTML = `${officeBar()}<main class="wrap" id="main">
    <a class="back-link" href="${esc(back)}">${ICON.back} All clients</a>
    <div class="client-head">
      <div class="client-title"><h1 class="client-name">${esc(c.name)}</h1>
        <p class="muted">${c.consumer ? `Consumer <span class="mono">${esc(c.consumer)}</span>` : 'No consumer number'}${c.mobile ? ` · ${esc(c.mobile)}` : ''}</p>
        <p class="muted small">Dealer: ${esc(c.dealer.name || '—')}${c.dealer.phone ? ` (${esc(c.dealer.phone)})` : ''}</p></div>
      <div class="client-quick">
        ${mobile.length === 10 ? `<a class="btn sm" href="tel:+91${mobile}">${ICON.phone} Call customer</a>` : ''}
        ${dealerPhone.length === 10 ? `<a class="btn sm wa" href="https://wa.me/91${dealerPhone}" target="_blank" rel="noopener">${ICON.wa} WhatsApp dealer</a>` : ''}
        <button class="btn sm ghost danger-text" type="button" data-delclient>${ICON.trash} Delete client…</button>
      </div>
    </div>
    ${c.s2 ? '' : '<p class="note">Section 2 (after installation) has not come in yet.</p>'}
    ${c.rows.map(r => {
      const sec = SECTIONS[r.section];
      const fields = sec.fields.filter(f => !isPhoto(f) && f.key in r.fields);
      return `<section class="card form-card" data-ref="${esc(r.ref)}" aria-labelledby="h-${esc(r.ref)}">
        <div class="form-card-head">
          <h2 id="h-${esc(r.ref)}"><span class="tag${r.section === 2 ? ' sage' : ''}">${esc(sec.title)}</span> ${esc(sec.subtitle)}${r.mode ? ` · ${esc(modeLabel(r.mode))}` : ''}</h2>
          <span class="muted small">Received ${esc(timeFmt.format(r.createdAt))} · Ref <span class="mono">${esc(r.ref)}</span></span>
          <div class="form-card-acts"><button class="btn sm" type="button" data-openpdf>${ICON.file} Open PDF</button>
            <button class="btn sm" type="button" data-savepdf>${ICON.save} Save PDF</button></div>
        </div>
        <details class="fields-box" open><summary>Details (${fields.length})</summary>
          <dl class="details">${fields.map(f => `<div><dt>${esc(f.label)}</dt><dd><span>${valueHtml(r.fields[f.key])}</span>${r.fields[f.key] ? `<button class="copy" type="button" data-copy="${esc(r.fields[f.key])}" aria-label="Copy ${esc(f.label)}" title="Copy">${ICON.copy}</button>` : ''}</dd></div>`).join('')}</dl></details>
        <h3 class="photos-h">Photos</h3>
        <div class="photos-out" data-photos><p class="muted small">Loading photos…</p></div>
        <div class="card-acts"><button class="btn sm ghost danger-text" type="button" data-remove>${ICON.trash} Delete this form…</button></div>
      </section>`;
    }).join('')}
  </main>`;

  const photos = new Map(); // ref -> photos taken out of that PDF
  const fillPhotos = async r => {
    const box = $(`[data-ref="${CSS.escape(r.ref)}"]`);
    const out = $('[data-photos]', box);
    const pdf = await store.getOfficePdf(r.ref).catch(() => null);
    $$('[data-openpdf], [data-savepdf]', box).forEach(b => { b.disabled = !pdf; });
    if (!pdf) {
      out.innerHTML = `<p class="note">The PDF for this form is not on this device. Add the same PDF from WhatsApp to see its photos.</p>${addPdfButton('Add this PDF', '')}`;
      return;
    }
    const list = await extractPhotos(pdf).catch(() => []);
    list.forEach(p => { p.url = url(p.blob); });
    photos.set(r.ref, list);
    out.innerHTML = list.length ? `<div class="photo-acts"><button class="btn primary sm" type="button" data-saveall>${ICON.save} Save all ${list.length} photos</button></div>
      <ul class="pgrid">${list.map((p, i) => `<li>
        <button class="pthumb" type="button" data-view="${i}" aria-label="View ${esc(p.label)}"><img src="${p.url}" alt="" width="${p.w}" height="${p.h}" loading="lazy"></button>
        <span class="plabel">${esc(p.label)}</span>
        <button class="btn sm" type="button" data-save="${i}" aria-label="Save ${esc(p.label)}">${ICON.save} Save</button></li>`).join('')}</ul>`
      : '<p class="muted small">This PDF has no photos.</p>';
  };
  c.rows.forEach(fillPhotos);

  const savePhoto = async p => {
    await savePhotos([{ name: `${base} - ${fileName(p.label)}.jpg`, blob: p.blob }], '').catch(() => toast('Could not save the photo.', 'bad'));
  };
  // a large view of one photo, with Previous / Next (also the arrow keys) and Save
  const viewer = (list, i) => {
    const m = openModal(`<div class="lb-head"><h2 id="mTitle"></h2><span class="muted small" data-pos></span>
        <button class="btn ghost icon" type="button" data-close aria-label="Close">×</button></div>
      <div class="lb-img"><img alt=""></div>
      <div class="lb-acts"><button class="btn" type="button" data-prev>${ICON.back} Previous</button>
        <button class="btn primary" type="button" data-lbsave>${ICON.save} Save</button>
        <button class="btn" type="button" data-next>Next ${ICON.next}</button></div>`, { cls: 'lightbox', onClose: () => document.removeEventListener('keydown', keys) });
    const show = n => {
      i = (n + list.length) % list.length;
      $('#mTitle', m).textContent = list[i].label;
      $('[data-pos]', m).textContent = `${i + 1} of ${list.length}`;
      $('img', m).src = list[i].url; $('img', m).alt = list[i].label;
      $('[data-prev]', m).disabled = $('[data-next]', m).disabled = list.length < 2;
    };
    const keys = e => { if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); };
    document.addEventListener('keydown', keys);
    $('[data-close]', m).onclick = closeModal;
    $('[data-prev]', m).onclick = () => show(i - 1);
    $('[data-next]', m).onclick = () => show(i + 1);
    $('[data-lbsave]', m).onclick = () => savePhoto(list[i]);
    show(i);
    $('[data-lbsave]', m).focus();
  };

  const main = $('#main');
  const reAdd = async files => {
    try { const r = await addPdfs(files); toast(r.msg); render(); }
    catch (e) { toast(addError(e), 'bad'); }
  };
  main.addEventListener('change', e => { if (e.target.matches('[data-addpdf]')) { reAdd([...e.target.files]); e.target.value = ''; } });
  pdfDrop(main, reAdd);
  main.addEventListener('click', async e => {
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      try { await navigator.clipboard.writeText(cp.dataset.copy); toast('Copied.', 'good'); } catch (err) { toast('Could not copy.', 'bad'); }
      return;
    }
    if (e.target.closest('[data-delclient]')) { if (await deleteClients([c])) go(back); return; }
    const box = e.target.closest('[data-ref]'); if (!box) return;
    const r = c.rows.find(x => x.ref === box.dataset.ref), list = photos.get(r.ref) || [];
    if (e.target.closest('[data-openpdf]')) { openPdf(r.ref, pdfName(c, r)); return; }
    if (e.target.closest('[data-savepdf]')) {
      const blob = await store.getOfficePdf(r.ref).catch(() => null);
      if (blob) await savePdfFile(blob, pdfName(c, r)); else toast('This PDF is not on this device.', 'bad');
      return;
    }
    const view = e.target.closest('[data-view]');
    if (view) { viewer(list, Number(view.dataset.view)); return; }
    const save = e.target.closest('[data-save]');
    if (save) { busy(save, true); await savePhoto(list[Number(save.dataset.save)]); busy(save, false); return; }
    const all = e.target.closest('[data-saveall]');
    if (all) {
      busy(all, true);
      const pad = n => String(n).padStart(2, '0');
      const files = list.map((p, i) => ({ name: `${pad(i + 1)} ${fileName(p.label)}.jpg`, blob: p.blob }));
      const how = await savePhotos(files, `${base} - Section ${r.section} photos.zip`).catch(() => 'failed');
      busy(all, false);
      if (how === 'downloaded') toast(`${list.length} photos saved as one ZIP file.`, 'good');
      if (how === 'failed') toast('Could not save the photos.', 'bad');
      return;
    }
    if (e.target.closest('[data-remove]')) {
      if (!await confirmBox(`Delete this Section ${r.section} form?`, `${c.name}’s Section ${r.section} form, its PDF and photos are removed from this device. The PDF stays in WhatsApp and can be added again.`, 'Delete', true)) return;
      await store.deleteOffice([r.ref]).catch(() => {});
      toast('Deleted.');
      if (c.rows.length > 1) render(); else go(back);
    }
  });
}
// Saves a PDF: on a phone through the share sheet (to Files or another app), on a computer as a download
async function savePdfFile(blob, name) {
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/pdf' }) : null;
  if (file && matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  download(blob, name);
}

// ---------- start ----------
if (!location.hash) history.replaceState(null, '', '#/');
render();
let lastCheck = 0;
function checkSession() {
  if (!session) return;
  lastCheck = Date.now();
  const prevRole = session.user.role, prevName = session.user.name;
  api('me').then(r => {
    if (!session) return;
    setSession({ token: r.token, user: r.user });
    if (r.user.role !== prevRole) render();
    else if (r.user.name !== prevName) { const el = $('.who-name'); if (el) el.textContent = r.user.name; }
  }).catch(() => { /* offline: keep working; 401 logs out in api() */ });
}
if (session) {
  checkSession();
  store.cleanUp();
  store.keepStorage();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session && Date.now() - lastCheck > 5 * 60 * 1000) checkSession();
});
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  // A new release is fetched in the background. Switch to it when nothing is being typed or made,
  // so a form is never lost; otherwise it is used the next time the app opens.
  const hadWorker = !!navigator.serviceWorker.controller;
  let updateReady = false;
  const idle = () => !$('.modal-back') && !['form', 'done'].includes(route()[0])
    && !$$('input, textarea').some(i => i.type !== 'file' && i.value);
  const reloadIfIdle = () => { if (updateReady && document.visibilityState === 'visible' && idle()) location.reload(); };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadWorker) { updateReady = true; reloadIfIdle(); } });
  document.addEventListener('visibilitychange', reloadIfIdle);
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
