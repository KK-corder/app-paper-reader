import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp } from '../js/app.mjs';
import { makeDOM } from './support/dom.mjs';

class Viewer {
  constructor(scroller, pages, callbacks) { this.callbacks = callbacks; this.zoom = 1; this.calls = []; }
  close() { this.zoom = 1; }
  schedule() {}
  relayout(zoom) { this.zoom = zoom; }
  async open(source, page) { this.calls.push({ source, page }); this.callbacks.onReady(12); this.callbacks.onPage(page, 12); }
}

const fixture = JSON.parse(await readFile(new URL('../demo/papers.json', import.meta.url)));
function fakeFetch(request, options) {
  const url = String(request);
  assert.equal(options.cache, 'no-store');
  assert.ok(!url.startsWith('https://'), 'demo must never access Google or another external service');
  if (url.endsWith('papers.json')) return Promise.resolve({ ok: true, json: async () => structuredClone(fixture) });
  assert.equal(options.method, 'HEAD');
  return Promise.resolve({ ok: !url.includes('missing-demo'), status: url.includes('missing-demo') ? 404 : 200 });
}

test('demo flow: list, filters, open, tabs, DOI, copy, split limits, sheet, persistence, absent PDF/summary', async () => {
  const dom = makeDOM();
  let app = await startApp({ ...dom, Viewer, fetcher: fakeFetch });
  const { $, settings, document, window } = dom;
  assert.equal($('list-view').hidden, false);
  assert.equal($('paper-list').children.length, 6);
  assert.match($('paper-list').children[0].textContent, /Imaginary Light Blocks/);
  assert.match($('paper-list').children[2].textContent, /PDF なし/);
  assert.match($('paper-list').children[4].textContent, /PDF なし/);
  $('filter').value = '光の模'; await $('filter').emit('input');
  assert.equal($('paper-list').children.length, 1);
  $('filter').value = '積み木'; await $('filter').emit('input');
  assert.equal($('paper-list').children.length, 1);
  await $('paper-list').children[0].emit('click');
  assert.equal($('reader-view').hidden, false);
  assert.equal($('page-counter').textContent, '1 / 12');
  assert.equal($('summary-content').children[0].children[0].textContent, '新規性と貢献（一言）');
  assert.ok($('summary-content').textContent.includes('\n'));
  await $('details-tab').emit('click');
  assert.equal($('details-content').hidden, false);
  assert.equal($('summary-content').hidden, true);
  assert.deepEqual($('details-content').descendants('dt').map(n => n.textContent), ['題', '和題', '著者', '年', '会場', 'Type', 'DOI', 'タグ', 'Importance', 'Read Status', 'BibTeX']);
  const doi = $('details-content').descendants('a')[0];
  assert.equal(doi.href, 'https://doi.org/10.0000/fictional-reader-demo');
  assert.equal(doi.target, '_blank');
  await $('details-content').descendants('button')[0].emit('click');
  assert.equal(window.navigator.clipboard.text, fixture.papers[2].bibtex);
  assert.match($('details-content').textContent, /コピーしました/);
  $('reader-layout').clientWidth = 844;
  await $('splitter').emit('pointerdown', { pointerId: 1 });
  await $('splitter').emit('pointermove', { clientX: 900 });
  assert.equal(app.store.state.panelWidth, 75);
  await $('splitter').emit('pointermove', { clientX: 0 });
  assert.equal(app.store.state.panelWidth, 25);
  await $('splitter').emit('pointermove', { clientX: 506.4 });
  await $('splitter').emit('pointerup');
  assert.equal(app.store.state.panelWidth, 60);
  await $('sheet-toggle').emit('click');
  assert.equal($('reader-layout').classList.contains('sheet-open'), true);
  await $('sheet-close').emit('click');
  assert.equal($('reader-layout').classList.contains('sheet-open'), false);
  app.viewer.callbacks.onPage(7, 12);
  await $('back-list').emit('click');
  await $('paper-list').children[0].emit('click');
  assert.equal(app.viewer.calls.at(-1).page, 7);
  assert.equal($('reader-layout').style['--pdf-width'], '60%');
  app.dispose();
  const reloaded = makeDOM('?demo=1', dom.storage);
  app = await startApp({ ...reloaded, Viewer, fetcher: fakeFetch });
  await reloaded.$('paper-list').children[0].emit('click');
  assert.equal(app.viewer.calls.at(-1).page, 7);
  assert.equal(app.store.state.panelWidth, 60);
  await app.openPaper({ ...fixture.papers[3], pdf: null });
  assert.equal(reloaded.$('pdf-status').textContent, 'PDF なし');
  assert.match(reloaded.$('summary-content').textContent, /架空/);
  await app.openPaper(fixture.papers[4]);
  assert.equal(reloaded.$('summary-content').textContent, '要約なし');
  assert.ok(reloaded.$('details-content').descendants('dd').filter(n => n.textContent === '—').length >= 5);
  assert.equal(reloaded.$('details-content').descendants('pre')[0].textContent, '—');
  await app.openPaper(fixture.papers[5]);
  assert.equal(reloaded.$('pdf-status').textContent, 'PDF なし');
  app.dispose();
  assert.equal(document.head.children.length, 0);
  assert.equal(settings.length, 2);
});

test('empty client ID starts without network or failure; settings save and clear work', async () => {
  const dom = makeDOM('');
  const app = await startApp({ ...dom, Viewer, clientId: '', fetcher: () => { throw new Error('unexpected network'); } });
  const { $ } = dom;
  assert.equal($('login-view').hidden, false);
  assert.equal($('login-message').textContent, 'config.js にクライアント ID を入れる');
  assert.equal($('login-button').disabled, true);
  await dom.settings[0].emit('click');
  $('survey-path').value = ' University / test / survey ';
  $('login-method').value = 'popup';
  await $('settings-form').emit('submit');
  assert.deepEqual(app.store.state.settings, { path: 'University/test/survey', method: 'popup' });
  assert.equal(dom.document.head.children.length, 0);
  app.store.setPage('paper', 7);
  app.store.state.panelWidth = 70;
  await $('clear-reading').emit('click');
  assert.equal(app.store.page('paper'), 1);
  assert.equal(app.store.state.panelWidth, 50);
  assert.equal(app.store.state.settings.method, 'popup');
  assert.deepEqual([...dom.storage.keys()], ['paper-reader-v1']);
  app.dispose();
});

test('paper strings stay text, not HTML, and clipboard rejection is reported', async () => {
  const dom = makeDOM();
  dom.window.navigator.clipboard.writeText = async () => { throw new Error(); };
  const app = await startApp({ ...dom, Viewer, fetcher: fakeFetch });
  await app.openPaper({ ...fixture.papers[2], title: '<img src=x onerror=alert(1)>', summary: [{ heading: '<b>heading</b>', text: '<script>bad()</script>\nline 2' }], pdf: null });
  assert.equal(dom.$('reader-title').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(dom.$('summary-content').descendants('script').length, 0);
  assert.match(dom.$('summary-content').textContent, /<script>/);
  await dom.$('details-content').descendants('button')[0].emit('click');
  assert.match(dom.$('details-content').textContent, /コピーできませんでした/);
  app.dispose();
});

test('saved valid session loads Drive without another login; expiry leaves an open paper visible', async () => {
  const dom = makeDOM('');
  dom.storage.set('paper-reader-v1', JSON.stringify({
    session: { accessToken: 'sample', expiresAt: Date.now() + 60000 },
    folders: { 'University/01_reaserch/survey': { survey: 'survey-id', reader: 'reader-id' } },
  }));
  let reads = 0;
  const app = await startApp({ ...dom, Viewer, fetcher: async (input, options) => {
    reads++;
    assert.equal(options.headers.Authorization, 'Bearer sample');
    const url = new URL(input);
    assert.equal(url.origin, 'https://www.googleapis.com');
    return { ok: true, json: async () => url.searchParams.has('alt') ? { papers: [{ ...fixture.papers[2], pdf: { name: 'demo.pdf', drive_id: 'pdf-id' } }] } : { files: [{ id: 'json-id' }] } };
  } });
  assert.equal(reads, 2);
  assert.equal(dom.$('list-view').hidden, false);
  await dom.$('paper-list').children[0].emit('click');
  assert.equal(app.viewer.calls[0].source.headers.Authorization, 'Bearer sample');
  const summary = dom.$('summary-content').textContent;
  app.store.state.session.expiresAt = 1;
  await dom.document.emit('visibilitychange');
  assert.equal(dom.$('session-banner').hidden, false);
  assert.equal(dom.$('reader-view').hidden, false);
  assert.equal(dom.$('summary-content').textContent, summary);
  assert.equal(dom.$('page-counter').textContent, '1 / 12');
  assert.equal(app.store.state.session, null);
  app.dispose();
});

test('an expired saved session is discarded at startup without redirect or network', async () => {
  const dom = makeDOM('');
  dom.storage.set('paper-reader-v1', JSON.stringify({ session: { accessToken: 'expired-sample', expiresAt: 1 } }));
  const app = await startApp({ ...dom, Viewer, fetcher: () => { throw new Error('expired session must not fetch'); } });
  assert.equal(app.store.state.session, null);
  assert.equal(dom.$('login-view').hidden, false);
  assert.equal(dom.$('session-banner').hidden, false);
  app.dispose();
});
