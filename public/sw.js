// Offline support: the app's own files are kept on the phone, so the app opens at once even on a weak
// signal, and forms and PDFs work without internet. Logins (/api) always go to the server.
// Raise VERSION with every release: phones then fetch the new files in the background and switch to
// them together (the open app reloads itself when no form is open, otherwise on the next start).
const VERSION = '2026.11.27-4';
const CACHE = `pontis-dealer-${VERSION}`;
// The QR code reader (about 1 MB) is kept apart, so phones fetch it again only when it changes, not with every release
const VENDOR = 'pontis-vendor-zxing-3.1.7';
const VENDOR_FILES = ['vendor/zxing/reader/index.js', 'vendor/zxing/share.js', 'vendor/zxing/zxing_reader.wasm'];
const PAGE = './'; // the app page (Cloudflare only redirects index.html to it, and a redirect cannot open the app)
const FILES = [
  PAGE, 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/fields.js', 'js/store.js', 'js/media.js', 'js/pdf.js', 'js/office.js', 'js/geo.js', 'js/scan.js',
  'assets/logo.png', 'assets/icon.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-64.png',
  ...['400', '500', '600', '700'].map(w => `fonts/noto-sans-latin-${w}-normal.woff2`),
  ...['500', '600'].map(w => `fonts/barlow-latin-${w}-normal.woff2`)
];

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))),
    // not needed to open the app: if it cannot be fetched now, it is fetched when the scanner first opens
    caches.open(VENDOR).then(async c => {
      const have = await c.keys();
      if (have.length < VENDOR_FILES.length) await c.addAll(VENDOR_FILES);
    }).catch(() => {})
  ]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== VENDOR).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/vendor/')) {
    e.respondWith(caches.open(VENDOR).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone()).catch(() => {});
      return res;
    }));
    return;
  }
  // the saved copy first, so every file comes from the same version; anything not saved comes from the network
  e.respondWith(
    caches.open(CACHE)
      .then(c => c.match(req.mode === 'navigate' ? PAGE : req, { ignoreSearch: true }))
      .then(hit => hit || fetch(req))
  );
});
