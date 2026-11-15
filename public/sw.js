// Offline support: the app's own files are kept on the phone, so forms and PDFs work without internet.
// Logins (/api) always go to the server. Raise VERSION with every release.
const VERSION = '2026.11.15-2';
const CACHE = `pontis-dealer-${VERSION}`;
const FILES = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/fields.js', 'js/store.js', 'js/media.js', 'js/pdf.js', 'js/office.js',
  'assets/logo.png', 'assets/icon.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-64.png',
  ...['400', '500', '600', '700'].map(w => `fonts/noto-sans-latin-${w}-normal.woff2`),
  ...['500', '600'].map(w => `fonts/barlow-latin-${w}-normal.woff2`)
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // newest version when online, the saved copy when offline
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? 'index.html' : req, copy)); }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true }))
  );
});
