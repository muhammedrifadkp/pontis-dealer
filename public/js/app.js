// Pontis Energy dealer app
// One login screen. The Pontis office (admin) manages dealers; dealers fill client forms that become a PDF
// they send on WhatsApp. Client details stay on the dealer's phone until sent, and never reach the server.

import { SECTIONS, activeFields, needsCoApplicant, check, note, tidy, display, isPhoto, normMobile } from './fields.js';
import * as store from './store.js';
import { preparePhoto, getPosition, fmtCoord } from './media.js';
import { buildClientPdf } from './pdf.js';
import { readPdfFiles, downloadCsv } from './office.js';

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
  file: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>'
};

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
function openModal(html, { onClose } = {}) {
  closeModal();
  lastFocus = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">${html}</div>`;
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
function topBar(extra = '') {
  return `<header class="bar${extra ? ' has-tabs' : ''}">
    <a class="brand" href="#/" aria-label="Pontis Energy home"><img src="assets/icon.png" alt="" width="30" height="27"><span translate="no">Pontis Energy</span></a>
    ${extra}
    <div class="who"><span class="who-name">${esc(session.user.name)}</span><button class="btn ghost sm" type="button" data-logout>Log out</button></div>
  </header>`;
}
document.addEventListener('click', async e => {
  if (e.target.closest('[data-logout]')) {
    if (await confirmBox('Log out?', 'You will need your mobile number and password to log in again. Unfinished forms stay on this phone.', 'Log out')) logout();
  }
});

// ---------- routing: the address shows the screen, so Back works ----------
const route = () => location.hash.replace(/^#\/?/, '').split('/');
window.addEventListener('hashchange', () => render());
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

let current = null; // cleanup for the screen being left
function render() {
  if (current) { current(); current = null; }
  closeModal();
  const [view, arg] = route();
  if (!session) { document.title = 'Log in – Pontis Energy'; return loginView(); }
  if (session.user.role === 'admin') {
    if (view === 'excel') return excelView();
    return dealersView();
  }
  if (view === 'form' && arg) return formView(arg);
  if (view === 'done' && arg) return doneView(arg);
  return homeView();
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
    <section class="list-block" id="drafts" hidden><h2>Unfinished</h2><ul class="items"></ul></section>
    <section class="list-block" id="recent" hidden><h2>Clients sent</h2><ul class="items"></ul></section>
    <p class="install-tip" id="installTip" hidden></p>
  </main>`;

  const drafts = await store.listDrafts(owner).catch(() => []);
  if (drafts.length) {
    $('#drafts').hidden = false;
    $('#drafts ul').innerHTML = drafts.map(d => `<li class="item">
      <div class="item-main"><b>${esc(d.values.name || 'No name yet')}</b>
      <span class="muted small">${esc(SECTIONS[d.section].title)}${d.mode ? ` · ${d.mode === 'loan' ? 'Loan' : 'Cash'}` : ''} · saved ${esc(ago(d.updatedAt))}</span></div>
      <div class="item-acts"><a class="btn sm" href="#/form/${esc(d.id)}">Continue</a>
      <button class="btn sm ghost danger-text" type="button" data-del-draft="${esc(d.id)}" aria-label="Delete the unfinished form for ${esc(d.values.name || 'this client')}">Delete</button></div></li>`).join('');
  }
  const recent = store.listRecent(owner);
  if (recent.length) {
    $('#recent').hidden = false;
    $('#recent ul').innerHTML = recent.slice(0, 40).map(c => `<li class="item">
      <div class="item-main"><b>${esc(c.name)}</b><span class="muted small">Consumer ${esc(c.consumer)}${c.mode ? ` · ${c.mode === 'loan' ? 'Loan' : 'Cash'}` : ''} · Section 1 ${esc(ago(c.at))}${c.s2At ? ' · Section 2 sent' : ''}</span></div>
      <div class="item-acts">${c.s2At ? `<span class="pill ok">${ICON.check} Done</span>` : `<button class="btn sm" type="button" data-new="2" data-consumer="${esc(c.consumer)}">Section 2</button>`}</div></li>`).join('');
  }

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!standalone) {
    const tip = $('#installTip');
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    tip.hidden = false;
    tip.innerHTML = ios
      ? 'Tip: install this app. In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>.'
      : (installEvent ? 'Tip: <button class="link" type="button" id="installBtn">install this app</button> to open it from your home screen.' : 'Tip: install this app from the browser menu (⋮) → <b>Install app</b> or <b>Add to Home screen</b>.');
    const ib = $('#installBtn');
    if (ib) ib.onclick = async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; tip.hidden = true; };
  }

  app.onclick = async e => {
    const n = e.target.closest('[data-new]');
    if (n) {
      const section = Number(n.dataset.new);
      const values = {};
      if (section === 2 && n.dataset.consumer) {
        const c = store.listRecent(owner).find(x => x.consumer === n.dataset.consumer);
        if (c) Object.assign(values, { consumer: c.consumer, name: c.name });
      }
      const d = { id: store.newId(), owner, section, mode: n.dataset.mode || '', values, createdAt: Date.now() };
      await store.saveDraft(d);
      go(`#/form/${d.id}`);
      return;
    }
    const del = e.target.closest('[data-del-draft]');
    if (del && await confirmBox('Delete this unfinished form?', 'The details and photos typed so far are removed from this phone.', 'Delete', true)) {
      await store.deleteDraft(del.dataset.delDraft);
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

function fieldHtml(f, v) {
  const id = `f-${f.key}`;
  const req = f.required === false ? ' <span class="opt">(optional)</span>' : '';
  const hint = f.hint ? `<p class="hint" id="${id}-hint">${esc(f.hint)}</p>` : '';
  const describedBy = `${f.hint ? `${id}-hint ` : ''}${id}-err`;
  const val = v[f.key];
  const input = (type, extra = '') => `<input id="${id}" name="${f.key}" type="${type}" value="${esc(val ?? '')}" aria-describedby="${describedBy}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}${f.placeholder.endsWith('…') ? '' : '…'}"` : ''} ${extra}>`;
  let body = '';
  switch (f.type) {
    case 'text': body = input('text', 'autocomplete="off" autocapitalize="words"'); break;
    case 'consumer': body = input('text', 'inputmode="numeric" autocomplete="off" placeholder="1155…"'); break;
    case 'mobile': body = input('tel', 'inputmode="numeric" autocomplete="off" placeholder="98470 12345…"'); break;
    case 'aadhaar': body = input('text', `inputmode="numeric" autocomplete="off" placeholder="1234 5678 9012…" value="${esc(display(f, v))}"`); break;
    case 'pan': body = input('text', 'autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE1234F…" class="upper"'); break;
    case 'email': body = input('email', 'inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="name@gmail.com…"'); break;
    case 'age': case 'number': body = input('text', 'inputmode="numeric" autocomplete="off"'); break;
    case 'serial': body = input('text', 'autocomplete="off" autocapitalize="characters" spellcheck="false" class="upper mono"'); break;
    case 'select':
      body = `<select id="${id}" name="${f.key}" aria-describedby="${describedBy}"><option value="">Choose…</option>${f.options.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      break;
    case 'location': body = locationHtml(f, val); break;
    case 'serials': body = `<div class="serials" id="${id}" role="group" aria-describedby="${describedBy}"></div>`; break;
    case 'photo': case 'photos': case 'gpsphoto': body = photoHtml(f); break;
  }
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
    <label class="btn add-photo"><input class="vh" type="file" accept="image/*" data-photo="${f.key}"${gps ? ' capture="environment"' : ''}${multi ? ' multiple' : ''} aria-labelledby="f-${f.key}-lbl">
      ${gps ? ICON.camera : ICON.image}<span data-addlabel>${gps ? 'Take photo' : 'Add photo'}</span></label>
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
    $('.note-soft', w).textContent = touched.has(f.key) && !msg ? note(f, d.values) : '';
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
    box.innerHTML = n ? Array.from({ length: n }, (_, i) => `<label class="serial"><span>${i + 1}</span><input type="text" data-serial="${i}" value="${esc(list[i] || '')}" autocomplete="off" autocapitalize="characters" spellcheck="false" class="upper mono" aria-label="Panel ${i + 1} serial number"></label>`).join('')
      : '<p class="serials-empty">Enter the <b>number of panels</b> above. A box then appears here for each panel’s serial number.</p>';
  }
  function renderThumbs(f) {
    const ul = $(`[data-thumbs="${f.key}"]`, form); if (!ul) return;
    const list = d.values[f.key] || [];
    Promise.all(list.map(p => store.getPhoto(p.pid).then(b => ({ p, b })))).then(items => {
      ul.innerHTML = items.map(({ p, b }, i) => `<li><img src="${b ? photoUrl(p.pid, b) : ''}" alt="${esc(f.label)} ${i + 1}" width="${p.w}" height="${p.h}">
        ${p.gps ? '<span class="gps-badge">GPS</span>' : ''}
        <button type="button" class="x" data-remove="${f.key}" data-i="${i}" aria-label="Remove ${esc(f.label)} ${i + 1}">×</button></li>`).join('');
    });
    const lbl = $(`[data-photo="${f.key}"]`, form).parentElement.querySelector('[data-addlabel]');
    lbl.textContent = f.type === 'photos' ? (list.length ? 'Add more photos' : 'Add photos') : list.length ? (f.type === 'gpsphoto' ? 'Take again' : 'Replace photo') : (f.type === 'gpsphoto' ? 'Take photo' : 'Add photo');
  }

  allFields.forEach(f => {
    if (f.type === 'serials') renderSerials(f);
    if (['photo', 'photos', 'gpsphoto'].includes(f.type)) renderThumbs(f);
  });
  refresh();

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

  // GPS photos: start finding the location as the camera opens
  let gpsWait = null;
  form.addEventListener('click', async e => {
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
      let gps = null;
      if (f.type === 'gpsphoto') {
        const fileAge = Date.now() - (files[0].lastModified || Date.now());
        if (fileAge > 3 * 60 * 1000) throw new Error('This photo was not taken just now. Use the camera to take a new photo at the site.');
        status.textContent = 'Getting the GPS location…';
        let pos = gpsWait ? await gpsWait : null;
        if (!pos || pos instanceof Error) pos = await getPosition();
        gps = pos;
        gpsWait = null;
      }
      const room = max - (f.type === 'photos' ? (d.values[f.key] || []).length : 0);
      const take = files.slice(0, room);
      if (files.length > take.length) toast(`Only ${max} photos fit here.`);
      const added = [];
      for (let i = 0; i < take.length; i++) {
        status.textContent = take.length > 1 ? `Preparing photo ${i + 1} of ${take.length}…` : 'Preparing the photo…';
        const stamp = gps ? { ...gps, at: Date.now(), label: f.label.replace(/^GPS photo of /i, '').replace(/^./, c => c.toUpperCase()) } : null;
        const ph = await preparePhoto(take[i], stamp);
        const pid = await store.savePhoto(ph.blob);
        added.push({ pid, w: ph.w, h: ph.h, at: Date.now(), ...(gps ? { gps: { lat: gps.lat, lng: gps.lng, acc: gps.acc, at: stamp.at } } : {}) });
      }
      if (f.type === 'photos') d.values[f.key] = [...(d.values[f.key] || []), ...added];
      else {
        const old = d.values[f.key] || [];
        if (old.length) store.deletePhotos(old.map(p => p.pid));
        d.values[f.key] = added.slice(0, 1);
      }
      status.textContent = gps && gps.acc > 100 ? `Added. The GPS was only accurate to ${Math.round(gps.acc)} m.` : '';
      touched.add(f.key);
      await store.saveDraft(d);
      renderThumbs(f); refresh(); showError(f);
    } catch (err) {
      status.textContent = '';
      toast(err && err.message === 'jpeg' ? 'This phone could not prepare the photo. Please update the phone’s software or use another phone.' : (err.message || 'Could not add the photo.'), 'bad');
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
      const focusable = $('input:not(.vh), select, button', w) || $('input', w);
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
    if (d.section === 1) store.addRecent(owner, { name: d.values.name, consumer: d.values.consumer, mobile: d.values.mobile, mode: d.mode });
    else store.markRecent(owner, d.values.consumer, { s2At: Date.now() });
    await store.deleteDraft(id);
    lastPdf = null;
    toast('Done. The client’s photos are removed from this phone.', 'good');
    go('#/');
  };
}

// ---------- admin: dealers ----------
let dealerCache = [];
function adminTabs(active) {
  return `<nav class="tabs" aria-label="Admin"><a href="#/" ${active === 'dealers' ? 'aria-current="page"' : ''}>Dealers</a><a href="#/excel" ${active === 'excel' ? 'aria-current="page"' : ''}>Excel</a></nav>`;
}
async function dealersView() {
  document.title = 'Dealers – Pontis Energy';
  app.innerHTML = `${topBar(adminTabs('dealers'))}<main class="wrap wide" id="main">
    <div class="head-row"><h1>Dealers</h1><button class="btn primary" type="button" id="addDealer">${ICON.plus} Add dealer</button></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Search name, number or area…" aria-label="Search dealers" autocomplete="off">
    <span class="muted small" id="count" aria-live="polite"></span></div>
    <ul class="dealers" id="dealerList"><li class="muted">Loading…</li></ul>
  </main>`;
  const listEl = $('#dealerList'), q = $('#q');
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
function showLogin(dealer, password, isReset) {
  const link = location.origin + '/';
  const msg = `Hello ${dealer.name},\n\n${isReset ? 'Your new login for the Pontis Energy dealer app:' : 'Welcome to the Pontis Energy dealer app. Your login:'}\n\nApp: ${link}\nMobile number: ${prettyPhone(dealer.phone)}\nPassword: ${password}\n\nOpen the link and log in. Then add the app to your home screen (Share > Add to Home Screen on iPhone, or the menu > Install app on Android).`;
  const wa = `https://wa.me/91${dealer.phone}?text=${encodeURIComponent(msg)}`;
  const m = openModal(`<h2 id="mTitle">${isReset ? 'New password' : 'Dealer added'}: ${esc(dealer.name)}</h2>
    <p class="muted">Send these login details to the dealer now. The password is shown only this once; if it is lost, use <b>Reset password</b>.</p>
    <dl class="creds"><dt>Mobile number</dt><dd>${esc(prettyPhone(dealer.phone))}</dd><dt>Password</dt><dd class="mono big" translate="no">${esc(password)}</dd></dl>
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

// ---------- admin: Excel from PDFs ----------
let excelRows = [];
function excelView() {
  document.title = 'Excel from PDFs – Pontis Energy';
  app.innerHTML = `${topBar(adminTabs('excel'))}<main class="wrap wide" id="main">
    <h1>Excel from PDFs</h1>
    <p class="muted">Save the PDFs dealers send on WhatsApp, then choose them here (or drop them on this box). The details are read straight from the PDFs, so nothing is retyped.</p>
    <label class="drop" id="drop"><input class="vh" type="file" accept="application/pdf,.pdf" multiple id="pdfFiles">${ICON.file}<b>Choose PDFs</b><span class="muted small">or drop them here</span></label>
    <div id="excelOut" aria-live="polite"></div>
  </main>`;
  const out = $('#excelOut');
  const drawOut = (msg = '') => {
    const s1 = excelRows.filter(r => r.section === 1), s2 = excelRows.filter(r => r.section === 2);
    out.innerHTML = `${msg ? `<p class="note">${esc(msg)}</p>` : ''}${excelRows.length ? `
      <div class="excel-acts">
        <button class="btn primary" type="button" data-csv="1" ${s1.length ? '' : 'disabled'}>Download Section 1 (${s1.length})</button>
        <button class="btn primary" type="button" data-csv="2" ${s2.length ? '' : 'disabled'}>Download Section 2 (${s2.length})</button>
        <button class="btn ghost" type="button" id="clearRows">Clear list</button>
      </div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Section</th><th>Customer</th><th>Consumer no.</th><th>Dealer</th></tr></thead><tbody>
      ${excelRows.slice().sort((a, b) => b.createdAt - a.createdAt).map(r => `<tr><td>${esc(new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(r.createdAt))}</td><td>${r.section}${r.mode ? ` · ${r.mode === 'loan' ? 'Loan' : 'Cash'}` : ''}</td><td>${esc(r.fields.name)}</td><td class="mono">${esc(r.fields.consumer)}</td><td>${esc(r.dealer.name)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}`;
  };
  drawOut();
  const take = async files => {
    const { rows, skipped } = await readPdfFiles(files);
    const known = new Set(excelRows.map(r => r.ref + r.createdAt));
    const fresh = rows.filter(r => !known.has(r.ref + r.createdAt));
    excelRows.push(...fresh);
    const dupes = rows.length - fresh.length;
    drawOut(`${fresh.length} PDF${fresh.length === 1 ? '' : 's'} added.${dupes ? ` ${dupes} already in the list.` : ''}${skipped.length ? ` ${skipped.length} file${skipped.length > 1 ? 's were' : ' was'} not from this app: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}.` : ''}`);
  };
  $('#pdfFiles').addEventListener('change', e => { take([...e.target.files]); e.target.value = ''; });
  const drop = $('#drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); take([...e.dataTransfer.files]); });
  out.onclick = e => {
    const c = e.target.closest('[data-csv]');
    if (c) downloadCsv(Number(c.dataset.csv), excelRows.filter(r => r.section === Number(c.dataset.csv)));
    if (e.target.closest('#clearRows')) { excelRows = []; drawOut(); }
  };
}

// ---------- start ----------
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });
if (!location.hash) history.replaceState(null, '', '#/');
render();
if (session) {
  api('me').then(r => { setSession({ token: r.token, user: r.user }); }).catch(() => { /* offline: keep working */ });
  store.cleanUp();
}
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
