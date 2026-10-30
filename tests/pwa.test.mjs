import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

test('service worker ignores Google and data before respondWith; caches only shell and used fonts', async () => {
  const listeners = {};
  const cached = [];
  const writes = [];
  const context = vm.createContext({ URL, Promise, self: { location: { href: 'https://example.test/app-paper-reader/sw.js' }, addEventListener: (type, callback) => { listeners[type] = callback; }, clients: { claim() {} } },
    caches: { open: async () => ({ addAll: async files => cached.push(...files), put: async (url) => writes.push(url), match: async () => null }), keys: async () => [] },
    fetch: async () => ({ ok: true, clone() { return this; } }),
  });
  vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
  let installed;
  listeners.install({ waitUntil: promise => { installed = promise; } });
  await installed;
  assert.equal(cached.some(url => /cmaps|standard_fonts|demo|papers\.json/.test(url)), false);
  for (const url of cached) assert.ok(existsSync(new URL(`..${new URL(url).pathname.replace('/app-paper-reader', '')}`, import.meta.url)), url);
  for (const url of ['https://www.googleapis.com/drive/v3/files/id?alt=media', 'https://accounts.google.com/gsi/client', 'https://accounts.google.com/o/oauth2/v2/auth', 'https://drive.google.com/file/id', 'https://example.test/app-paper-reader/demo/papers.json', 'https://example.test/app-paper-reader/demo/reader-demo.pdf', 'https://example.test/app-paper-reader/demo/figures/figure-1.png', 'https://example.test/elsewhere/index.html']) {
    let intercepted = false;
    listeners.fetch({ request: { url, method: 'GET' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, url);
  }
  for (const path of ['?demo=1', 'js/app.mjs', 'vendor/pdfjs/cmaps/78-H.bcmap', 'vendor/pdfjs/standard_fonts/FoxitSerif.pfb']) {
    let response;
    listeners.fetch({ request: { url: `https://example.test/app-paper-reader/${path}`, method: 'GET' }, respondWith: promise => { response = promise; } });
    assert.ok(response);
    await response;
  }
  assert.equal(writes.length, 4);
  assert.equal(writes[0], 'https://example.test/app-paper-reader/index.html');
});

test('manifest has relative URLs, standalone Japanese name, no orientation lock, and valid PNG dimensions', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url)));
  assert.equal(manifest.name, '論文リーダー');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, undefined);
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) {
    const bytes = readFileSync(new URL(`../${icon.src}`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /100dvh/);
  assert.match(css, /orientation: portrait/);
  for (const side of ['top', 'bottom', 'left', 'right']) assert.match(css, new RegExp(`env\\(safe-area-inset-${side}\\)`));
});
