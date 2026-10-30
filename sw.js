const CACHE = 'paper-reader-shell-v7';
const ROOT = new URL('./', self.location.href);
const SHELL = [
  'index.html', 'styles.css', 'config.js', 'manifest.webmanifest',
  'js/app.mjs', 'js/core.mjs', 'js/storage.mjs', 'js/login.mjs', 'js/drive.mjs', 'js/reading.mjs', 'js/comments.mjs', 'js/feed.mjs', 'js/feed-view.mjs', 'js/pdf-viewer.mjs',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
].map(path => new URL(path, ROOT).href);

function shellURL(request) {
  const url = new URL(request.url);
  // Allow only this app's shell. Google, Drive media and demo data never enter respondWith.
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return null;
  if (url.pathname === ROOT.pathname || url.pathname === new URL('index.html', ROOT).pathname) return new URL('index.html', ROOT).href;
  if (url.search) return null;
  if (SHELL.includes(url.href)) return url.href;
  for (const directory of ['vendor/pdfjs/cmaps/', 'vendor/pdfjs/standard_fonts/']) {
    if (url.pathname.startsWith(new URL(directory, ROOT).pathname)) return url.href;
  }
  return null;
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('paper-reader-shell-') && name !== CACHE).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = shellURL(event.request);
  if (!url) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(url, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(url);
      if (cached) return cached;
      throw error;
    }
  })());
});
