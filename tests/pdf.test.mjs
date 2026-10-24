import test from 'node:test';
import assert from 'node:assert/strict';
import { PdfViewer, downloadPdf } from '../js/pdf-viewer.mjs';
import { makeDOM, eventually } from './support/dom.mjs';

globalThis.ResizeObserver = class { observe() {} };
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.devicePixelRatio = 3;

function harness({ failRange = false, failFull = false } = {}) {
  const { $ } = makeDOM();
  const rendered = [];
  const options = [];
  const errors = [];
  const positions = [];
  const progress = [];
  const document = { numPages: 12, getPage: async number => ({
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
    render: ({ viewport, canvasContext }) => {
      assert.ok(canvasContext);
      rendered.push({ number, width: viewport.width });
      return { promise: Promise.resolve(), cancel() {} };
    }, cleanup() {},
  }) };
  const pdfjs = { getDocument: option => {
    options.push(option);
    const failure = option.url ? failRange : failFull;
    return { promise: failure ? Promise.reject(failure === true ? new Error('range failed') : failure) : Promise.resolve(document), destroy: async () => {} };
  } };
  const viewer = new PdfViewer($('pdf-scroll'), $('pdf-pages'), {
    onPage: (page, total) => positions.push([page, total]), onProgress: value => progress.push(value), onError: error => errors.push(error), onReady() {},
    getLibrary: async () => pdfjs, fetcher: async () => new Response(new Uint8Array([37, 80, 68, 70])),
  });
  return { viewer, $, rendered, errors, positions, progress, options };
}

test('real viewer controller renders only nearby pages, frees distant canvases, restores 7, and redraws on pinch', async () => {
  const h = harness();
  const { viewer, $, rendered } = h;
  await viewer.open({ url: 'https://example.test/demo.pdf' }, 7);
  await eventually(() => rendered.length > 0);
  assert.deepEqual(h.positions.at(-1), [7, 12]);
  assert.ok(rendered.length <= 3, 'all 12 pages must not render');
  assert.ok(rendered.every(r => r.number >= 6 && r.number <= 8));
  assert.match(h.options[0].cMapUrl, /vendor\/pdfjs\/cmaps\/$/);
  assert.equal(h.options[0].cMapPacked, true);
  assert.match(h.options[0].standardFontDataUrl, /vendor\/pdfjs\/standard_fonts\/$/);
  $('pdf-scroll').scrollTop = viewer.tops[2];
  await $('pdf-scroll').emit('scroll');
  await eventually(() => h.positions.at(-1)[0] === 3);
  await eventually(() => !viewer.pumping);
  assert.equal(viewer.rows[6].canvas, null);
  const before = rendered.length;
  await $('pdf-scroll').emit('touchstart', { touches: [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }] });
  await $('pdf-scroll').emit('touchmove', { touches: [{ clientX: 50, clientY: 100 }, { clientX: 250, clientY: 100 }] });
  assert.equal($('pdf-pages').style.transform, 'scale(2)');
  await $('pdf-scroll').emit('touchend');
  assert.equal(viewer.zoom, 2);
  assert.equal($('pdf-pages').style.transform, '');
  await eventually(() => rendered.length > before);
  assert.ok(rendered.at(-1).width > rendered[0].width);
  viewer.relayout(9); assert.equal(viewer.zoom, 4);
  viewer.relayout(0.1); assert.equal(viewer.zoom, 0.5);
  viewer.close();
  assert.equal($('pdf-pages').children.length, 0);
});

test('range failure retries full download once; initial 401 does not retry', async () => {
  const h = harness({ failRange: true });
  await h.viewer.open({ url: 'https://example.test/demo.pdf', headers: { Authorization: 'Bearer sample' } }, 7);
  await eventually(() => h.positions.length);
  assert.equal(h.options.length, 2);
  assert.ok(h.options[1].data instanceof Uint8Array);
  assert.equal(h.progress.some(p => p.retry), true);
  assert.deepEqual(h.positions.at(-1), [7, 12]);
  assert.equal(h.errors.length, 0);
  h.viewer.close();
  const blocked = harness({ failRange: Object.assign(new Error(), { status: 401 }) });
  await blocked.viewer.open({ url: 'https://example.test/private.pdf' });
  assert.equal(blocked.options.length, 1);
  assert.equal(blocked.errors[0].status, 401);
  blocked.viewer.close();
});

test('401 during a later page render preserves already displayed canvases', async () => {
  const h = harness();
  await h.viewer.open({ url: 'https://example.test/demo.pdf' });
  await eventually(() => h.viewer.rows[0].canvas);
  const canvas = h.viewer.rows[0].canvas;
  const getPage = h.viewer.doc.getPage;
  h.viewer.doc.getPage = async number => {
    const page = await getPage(number);
    page.render = () => ({ promise: Promise.reject(Object.assign(new Error('expired'), { status: 401 })), cancel() {} });
    return page;
  };
  h.viewer.relayout(1.25);
  await eventually(() => h.errors.length);
  assert.equal(h.errors[0].status, 401);
  assert.equal(h.viewer.rows[0].canvas, canvas);
  assert.equal(h.options.length, 1);
  h.viewer.close();
});

test('closing a pending PDF load prevents old pages from appearing on the next screen', async () => {
  const h = harness();
  let release;
  h.viewer.getLibrary = () => new Promise(resolve => { release = resolve; });
  const opening = h.viewer.open({ url: 'https://example.test/slow.pdf' });
  h.viewer.close();
  release({ getDocument() { throw new Error('closed viewer must not load'); } });
  await opening;
  assert.equal(h.$('pdf-pages').children.length, 0);
  assert.equal(h.errors.length, 0);
});

test('full download sends Authorization without caching, reports bytes, classifies missing files', async () => {
  const progress = [];
  const result = await downloadPdf({ url: 'https://example.test/pdf', headers: { Authorization: 'Bearer sample' } }, p => progress.push(p), undefined, async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer sample');
    assert.equal(options.cache, 'no-store');
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': '3' } });
  });
  assert.deepEqual([...result], [1, 2, 3]);
  assert.deepEqual(progress.at(-1), { loaded: 3, total: 3 });
  await assert.rejects(downloadPdf({ url: 'missing' }, () => {}, undefined, async () => ({ ok: false, status: 404 })), error => error.status === 404);
});
