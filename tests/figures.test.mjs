import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { normalizeLibrary } from '../js/core.mjs';
import { createFigureLoader, observeFigures } from '../js/figures.mjs';
import { renderPaperRow, startApp } from '../js/app.mjs';
import { Drive } from '../js/drive.mjs';
import { makeDOM, eventually } from './support/dom.mjs';

const figure = id => ({ name: `${id}.png`, drive_id: id });
const fixture = JSON.parse(readFileSync(new URL('../demo/papers.json', import.meta.url)));
const urls = () => ({ created: [], revoked: [], createObjectURL(blob) { const url = `blob:figure-${this.created.length}`; this.created.push({ blob, url }); return url; }, revokeObjectURL(url) { this.revoked.push(url); } });

class Observer {
  static instances = [];
  constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); Observer.instances.push(this); }
  observe(target) { this.targets.add(target); }
  disconnect() { this.targets.clear(); }
  emit(targets = [...this.targets], isIntersecting = true) { this.callback(targets.map(target => ({ target, isIntersecting }))); }
}
class Viewer {
  constructor(scroller, pages, callbacks) { this.callbacks = callbacks; this.calls = []; this.zoom = 1; }
  close() {}
  schedule() {}
  async open(source, page) { this.calls.push({ source, page }); this.callbacks.onReady(); }
}

test('figure normalization accepts optional IDs and rejects malformed values without changing other library fields', () => {
  const values = [figure('id'), null, undefined, 4, 'file.png', true, [], { name: 'x.png', drive_id: null }, { name: 'x.png', drive_id: '  ' }, { name: 42, drive_id: 'id' }, { name: 'x.png', drive_id: 42 }, { drive_id: 'id' }, { name: ' ' }];
  const result = normalizeLibrary({ papers: values.map((value, id) => ({ id: String(id), figure: value })) });
  assert.deepEqual(result.papers.map(p => p.figure), [figure('id'), null, null, null, null, null, null, { name: 'x.png', drive_id: null }, { name: 'x.png', drive_id: null }, null, { name: 'x.png', drive_id: null }, null, null]);
  assert.equal(normalizeLibrary({ papers: [{}] }).papers[0].figure, null);
});

test('figure loader caps active reads at four, shares in-flight IDs and cached URLs, and remembers failures until IDs change', async () => {
  let active = 0, peak = 0;
  const calls = [], pending = [];
  const objectURLs = urls();
  const loader = createFigureLoader((value, signal) => new Promise((resolve, reject) => {
    active++; peak = Math.max(peak, active); calls.push(value.drive_id);
    assert.equal(signal.aborted, false);
    pending.push({ resolve(blob) { active--; resolve(blob); }, reject(error) { active--; reject(error); } });
  }), objectURLs);
  for (const value of [null, undefined, {}, { name: 'no-id.png', drive_id: '' }]) assert.equal(await loader.load(value), null);
  const jobs = Array.from({ length: 9 }, (_, i) => loader.load(figure(String(i))));
  const same = loader.load(figure('0'));
  assert.equal(same, jobs[0]);
  await eventually(() => calls.length === 4);
  pending[0].resolve(new Blob(['one']));
  pending[1].reject({ status: 404 });
  pending[2].reject({ status: 403 });
  pending[3].reject(new TypeError('offline'));
  await eventually(() => calls.length === 8);
  for (let i = 4; i < 8; i++) pending[i].resolve(new Blob(['image']));
  await eventually(() => calls.length === 9);
  pending[8].resolve(new Blob(['last']));
  const loaded = await Promise.all(jobs);
  assert.equal(peak, 4);
  assert.equal(loaded[0], await same);
  assert.deepEqual(loaded.slice(1, 4), [null, null, null]);
  for (let i = 0; i < 9; i++) assert.equal(await loader.load(figure(String(i))), loaded[i]);
  assert.equal(calls.length, 9);
  const changed = loader.load(figure('replacement'));
  await eventually(() => calls.length === 10);
  pending[9].resolve(new Blob(['new']));
  assert.ok(await changed);
  loader.clear();
  assert.deepEqual(objectURLs.revoked, objectURLs.created.map(item => item.url));
});

test('figure loader discards queued work on redraw and releases late blobs after clearing', async () => {
  const pending = [], objectURLs = urls();
  const loader = createFigureLoader((value, signal) => new Promise(resolve => pending.push({ value, signal, resolve })), objectURLs);
  const jobs = Array.from({ length: 132 }, (_, i) => loader.load(figure(String(i))));
  await eventually(() => pending.length === 4);
  loader.cancelQueued();
  assert.deepEqual(await Promise.all(jobs.slice(4)), Array(128).fill(null));
  loader.clear();
  assert.ok(pending.every(item => item.signal.aborted));
  pending.forEach(item => item.resolve(new Blob(['late'])));
  assert.deepEqual(await Promise.all(jobs.slice(0, 4)), Array(4).fill(null));
  assert.equal(objectURLs.created.length, 0);
  const again = loader.load(figure('131'));
  await eventually(() => pending.length === 5);
  pending[4].resolve(new Blob(['visible']));
  assert.ok(await again);
  loader.clear();
});

test('Drive figure reads are GET media with no-store and unbound fetch; no session or absent ID never requests login', async () => {
  const store = { state: { session: { accessToken: 'test', expiresAt: Date.now() + 60000 } } };
  const requests = [];
  let status = 200;
  const drive = new Drive(store, () => assert.fail('image failure must not prompt login'), async function(input, options) {
    assert.equal(this, undefined);
    requests.push({ input, options });
    return { ok: status === 200, status, blob: async () => new Blob(['png']) };
  });
  assert.ok(await drive.figureBlob(figure('id/with space')) instanceof Blob);
  assert.equal(requests[0].input, 'https://www.googleapis.com/drive/v3/files/id%2Fwith%20space?alt=media');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test');
  assert.equal(requests[0].options.method, undefined);
  for (status of [401, 403, 404]) await assert.rejects(drive.figureBlob(figure('id')), error => error.status === status);
  assert.equal(await drive.figureBlob(null), null);
  store.state.session.expiresAt = 0;
  assert.equal(await drive.figureBlob(figure('id')), null);
  store.state.session = null;
  assert.equal(await drive.figureBlob(figure('id')), null);
  assert.equal(requests.length, 4);
});

test('rows prioritize Japanese titles, omit empty text lines, keep status/PDF hints and exclude tags/year/venue', () => {
  const { document } = makeDOM();
  const paper = normalizeLibrary(fixture).papers[0];
  const { row, frame } = renderPaperRow(document, paper, true);
  assert.equal(frame.children[0].textContent, [...paper.title_jp][0]);
  const text = row.children[1];
  assert.equal(text.children[0].children[0].textContent, paper.title_jp);
  assert.equal(text.children[1].textContent, paper.title);
  assert.equal(text.children[2].textContent, paper.authors);
  assert.equal(text.children[3].textContent, `コメント${paper.comment}`);
  assert.match(text.children[0].textContent, /★★★★★既読PDF なし/);
  for (const value of [paper.venue, String(paper.year), ...paper.tags]) assert.equal(row.textContent.includes(value), false);
  const empty = renderPaperRow(document, { ...paper, title_jp: '', authors: '', comment: '' }, false);
  assert.equal(empty.row.children[1].children.length, 1);
  assert.equal(empty.row.children[1].children[0].children[0].textContent, paper.title);
  assert.equal(empty.frame.textContent, '図なし');
});

test('observer reads only nearby rows, cancels queued rows that leave, handles quick re-entry, and keeps placeholders on decode error', async () => {
  const { document, $ } = makeDOM();
  const pending = [], objectURLs = urls();
  const loader = createFigureLoader(value => new Promise(resolve => pending.push({ value, resolve })), objectURLs);
  const view = observeFigures({ Observer, root: $('library-scroll'), loader, document });
  const observer = Observer.instances.at(-1);
  const rows = Array.from({ length: 132 }, (_, i) => renderPaperRow(document, { ...fixture.papers[0], id: String(i) }, false));
  rows.forEach(({ row, frame }, i) => view.observe(row, frame, figure(String(i))));
  assert.equal(pending.length, 0);
  assert.equal(observer.options.root, $('library-scroll'));
  assert.equal(observer.options.rootMargin, '300px');
  observer.emit(rows.slice(0, 5).map(item => item.row));
  await eventually(() => pending.length === 4);
  observer.emit([rows[4].row], false);
  observer.emit([rows[4].row], true);
  for (const item of pending) item.resolve(new Blob(['image']));
  await eventually(() => pending.length === 5);
  assert.equal(pending[4].value.drive_id, '4');
  pending[4].resolve(new Blob(['image']));
  await eventually(() => rows[4].frame.children[0].tagName === 'IMG');
  assert.equal(rows[5].frame.children[0].tagName, 'SPAN');
  await rows[4].frame.children[0].emit('error');
  assert.equal(rows[4].frame.children[0].tagName, 'SPAN');
  view.disconnect(); loader.clear();
});

test('demo application loads nearby local images once across sorting, reload and return; changed IDs reload and nothing persists', async t => {
  const dom = makeDOM();
  dom.window.IntersectionObserver = Observer;
  const data = structuredClone(fixture), calls = [];
  const app = await startApp({ ...dom, Viewer, fetcher: async function(input, options) {
    assert.equal(this, undefined);
    assert.equal(options.cache, 'no-store');
    const url = new URL(input);
    assert.equal(url.protocol, 'file:', 'only local demo URLs in Node');
    if (url.pathname.endsWith('papers.json')) return { ok: true, json: async () => structuredClone(data) };
    if (url.pathname.includes('/figures/')) {
      calls.push(url.pathname);
      return { ok: true, blob: async () => new Blob([readFileSync(url)], { type: 'image/png' }) };
    }
    assert.equal(options.method, 'HEAD');
    return { ok: !url.pathname.includes('missing-demo'), status: url.pathname.includes('missing-demo') ? 404 : 200 };
  } });
  t.after(() => app.dispose());
  const { $ } = dom;
  const observer = Observer.instances.at(-1);
  assert.equal(calls.length, 0, 'initial rendering and PDF checks must not read all images');
  const first = () => $('paper-list').children.find(row => row.getAttribute('data-paper-id') === 'demo-read');
  observer.emit([first()]);
  await eventually(() => first().descendants('img').length === 1);
  assert.equal(calls.length, 1);
  $('library-scroll').scrollTop = 950;
  await first().click();
  assert.equal($('reader-view').hidden, false);
  assert.equal(observer.targets.size, 0);
  await $('read-toggle').click();
  $('comment-editor').value = '図の見分け方を覚える';
  await $('comment-editor').emit('input'); await $('comment-save').click();
  // Simulate a browser losing the hidden scroller's position.
  $('library-scroll').scrollTop = 0;
  await $('back-list').click();
  assert.equal($('library-scroll').scrollTop, 950);
  assert.match(first().textContent, /図の見分け方を覚える/);
  for (const sort of ['stars-desc', 'stars-asc', 'added-desc', 'added-asc']) {
    $('sort').value = sort; await $('sort').emit('change');
    observer.emit([first()]);
    await eventually(() => first().descendants('img').length === 1);
  }
  await $('reload').click();
  observer.emit([first()]);
  await eventually(() => first().descendants('img').length === 1);
  assert.equal(calls.length, 1);
  data.papers[0].figure.drive_id = 'demo:changed-id';
  await $('reload').click(); observer.emit([first()]);
  await eventually(() => calls.length === 2 && first().descendants('img').length === 1);
  const saved = dom.storage.get('paper-reader-v1');
  assert.doesNotMatch(saved, /blob:|figure-\d|changed-id/);
  assert.deepEqual([...dom.storage.keys()], ['paper-reader-v1']);
});

test('a late image from an old list cannot replace a refreshed row with a changed Drive ID', async () => {
  const { document, $ } = makeDOM();
  const pending = [], objectURLs = urls();
  const loader = createFigureLoader(value => new Promise(resolve => pending.push({ value, resolve })), objectURLs);
  const view = observeFigures({ Observer, root: $('library-scroll'), loader, document });
  const observer = Observer.instances.at(-1);
  const oldRow = renderPaperRow(document, fixture.papers[0], false);
  view.observe(oldRow.row, oldRow.frame, figure('old'));
  observer.emit();
  await eventually(() => pending.length === 1);
  view.disconnect();
  const newRow = renderPaperRow(document, fixture.papers[0], false);
  view.observe(newRow.row, newRow.frame, figure('new'));
  observer.emit();
  await eventually(() => pending.length === 2);
  const oldBlob = new Blob(['old']), newBlob = new Blob(['new']);
  pending[1].resolve(newBlob);
  await eventually(() => newRow.frame.children[0].tagName === 'IMG');
  pending[0].resolve(oldBlob);
  await eventually(() => objectURLs.created.length === 2);
  assert.equal(newRow.frame.children[0].src, objectURLs.created.find(entry => entry.blob === newBlob).url);
  assert.equal(oldRow.frame.children[0].tagName, 'SPAN');
  view.disconnect(); loader.clear();
});

test('demo PNGs include portrait/landscape images under 40KB; compact CSS reserves equal frames and 96px rows', () => {
  const dimensions = [];
  for (const paper of fixture.papers.filter(p => p.figure)) {
    const bytes = readFileSync(new URL(`../demo/figures/${paper.figure.name}`, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(bytes.length <= 40 * 1024);
    assert.equal(paper.figure.drive_id, `demo:${paper.figure.name}`);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    dimensions.push([width, height]);
    const chunks = [];
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    assert.equal(inflateSync(Buffer.concat(chunks)).length, height * (1 + width * 3));
    const scale = Math.min(88 / width, 66 / height);
    assert.ok(width * scale <= 88 && height * scale <= 66);
  }
  assert.equal(dimensions.length, fixture.papers.length * 2 / 3);
  assert.ok(dimensions.some(([w, h]) => h > w));
  assert.ok(dimensions.some(([w, h]) => w > 2 * h));
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.paper-row \{[^}]*height: 96px/);
  assert.match(css, /\.paper-figure img \{[^}]*width: 88px; height: 66px; object-fit: contain/);
  assert.match(css, /\.paper-title, \.paper-title-en, \.paper-authors, \.paper-comment \{[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap/);
  assert.match(css, /@container \(min-width: 700px\)\s*\{\s*\.paper-list \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /paper-card|line-clamp: 3/);
  assert.ok(6 * 96 + 12 + 24 + 61 <= 844, 'six rows fit after scrolling the list into view');
  for (const width of [390, 844]) {
    const columns = width >= 700 ? 2 : 1;
    const rowWidth = (width - 32 - (columns - 1) * 12) / columns;
    assert.ok(rowWidth - 16 - 88 - 10 > 0, 'text column has room at both widths');
  }
});
