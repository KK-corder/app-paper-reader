import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp } from '../js/app.mjs';
import { makeDOM } from './support/dom.mjs';
import { readingDrive, savedSession } from './support/reading-drive.mjs';
import { webcrypto } from 'node:crypto';

class Viewer {
  constructor(scroller, pages, callbacks) { this.callbacks = callbacks; this.zoom = 1; this.calls = []; }
  close() { this.zoom = 1; }
  schedule() {}
  relayout(zoom) { this.zoom = zoom; }
  async open(source, page) { this.calls.push({ source, page }); this.callbacks.onReady(12); this.callbacks.onPage(page, 12); }
}

const fixture = JSON.parse(await readFile(new URL('../demo/papers.json', import.meta.url)));
function fakeFetch(request, options) {
  if (this !== undefined) throw new TypeError('fetch must be called without this');
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
  assert.match($('paper-list').children[0].textContent, /Previously Read Paper/);
  assert.match($('paper-list').children[3].textContent, /PDF なし/);
  assert.match($('paper-list').children[5].textContent, /PDF なし/);
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
  await reloaded.$('paper-list').children.find(row => row.textContent.includes('Imaginary Light Blocks')).emit('click');
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
    if (url.searchParams.get('q')?.endsWith("name = 'feed_log.json'")) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: true, json: async () => url.searchParams.has('alt') ? { papers: [{ ...fixture.papers[2], pdf: { name: 'demo.pdf', drive_id: 'pdf-id' } }] } : { files: [{ id: 'json-id' }] } };
  } });
  assert.equal(reads, 3);
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

const detailStatus = dom => dom.$('details-content').descendants('dd')[9].textContent;

test('demo read button updates details and rows without changing the selected ordering, survives app reload, and never writes to Drive', async () => {
  const dom = makeDOM();
  let app = await startApp({ ...dom, Viewer, fetcher: fakeFetch });
  await dom.$('paper-list').children[1].emit('click');
  const title = dom.$('reader-title').textContent;
  assert.equal(dom.$('read-toggle').textContent, '読了にする');
  await dom.$('read-toggle').emit('click');
  assert.equal(dom.$('read-toggle').textContent, '未読に戻す');
  assert.equal(detailStatus(dom), '読了');
  assert.equal(dom.$('paper-list').children[1].children[0].textContent, title);
  assert.match(dom.$('paper-list').children.find(row => row.children[0].textContent === title).textContent, /読了/);
  assert.equal(app.store.state.reading.pending.length, 0);
  assert.equal(app.viewer.calls.length, 1, 'changing read status must not reopen the PDF');
  app.dispose();
  const reloaded = makeDOM('?demo=1', dom.storage);
  app = await startApp({ ...reloaded, Viewer, fetcher: fakeFetch });
  await reloaded.$('paper-list').children.find(row => row.children[0].textContent === title).emit('click');
  assert.equal(reloaded.$('read-toggle').textContent, '未読に戻す');
  assert.equal(detailStatus(reloaded), '読了');
  await reloaded.$('read-toggle').emit('click');
  assert.equal(reloaded.$('read-toggle').textContent, '読了にする');
  assert.equal(detailStatus(reloaded), '未読');
  assert.equal(reloaded.$('paper-list').children[1].children[0].textContent, title);
  app.dispose();
});

function realLibrary() {
  return { generated: '2026-01-01T00:00:00+09:00', papers: [{ ...fixture.papers[2], pdf: { name: 'demo.pdf', drive_id: 'pdf-id' } }] };
}

test('403 shows permission guidance and pending count; popup login asks both scopes and retries without losing paper/page; online retries network failure', async () => {
  const dom = makeDOM('');
  const saved = savedSession();
  saved.settings = { method: 'popup', path: 'University/01_reaserch/survey' };
  dom.storage.set('paper-reader-v1', JSON.stringify(saved));
  let popupOptions;
  let requested = 0;
  dom.window.google = { accounts: { oauth2: { initTokenClient(options) {
    popupOptions = options;
    return { requestAccessToken() { requested++; } };
  } } } };
  const server = readingDrive(realLibrary());
  const app = await startApp({ ...dom, Viewer, fetcher: server.fetcher, clientId: 'test-client' });
  assert.deepEqual(popupOptions.scope.split(' '), ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file']);
  await dom.$('paper-list').children[0].emit('click');
  app.viewer.callbacks.onPage(7, 12);
  server.failure = 403;
  await dom.$('read-toggle').emit('click');
  assert.equal(detailStatus(dom), '読了');
  assert.equal(dom.$('session-banner').hidden, false);
  assert.equal(requested, 0, 'never initiate login without a user click');
  assert.match(dom.$('notice').textContent, /読了を記録するには、もう一度ログインして書き込みを許可してください/);
  await dom.settings[0].emit('click');
  assert.equal(dom.$('reading-pending').textContent, '未送信の記録: 1 件');
  assert.match(dom.$('reading-error').textContent, /書き込みを許可/);
  await dom.$('settings-login').emit('click');
  assert.equal(requested, 1);
  server.failure = null;
  await popupOptions.callback({ access_token: 'new-sample', expires_in: 3600 });
  assert.equal(dom.$('reading-pending').textContent, '');
  assert.equal(dom.$('reading-error').textContent, '');
  assert.equal(app.store.state.reading.pending.length, 0);
  assert.equal(server.log.events.length, 1);
  assert.equal(app.viewer.calls.at(-1).page, 7);
  await dom.$('settings-back').emit('click');
  assert.equal(dom.$('reader-view').hidden, false);
  assert.equal(dom.$('page-counter').textContent, '7 / 12');
  server.failure = new TypeError('offline');
  await dom.$('read-toggle').emit('click');
  assert.equal(app.store.state.reading.pending.length, 1);
  assert.equal(detailStatus(dom), '未読');
  server.failure = null;
  await dom.window.emit('online');
  assert.equal(app.store.state.reading.pending.length, 0);
  assert.deepEqual(server.log.events.map(e => e.read_status), ['読了', '未読']);
  app.dispose();
});

test('redirect login requests both scopes, restores the open paper/page and sends pending records on startup', async () => {
  const dom = makeDOM('');
  dom.storage.set('paper-reader-v1', JSON.stringify(savedSession()));
  dom.window.crypto = webcrypto;
  let assigned;
  dom.window.location.assign = url => { assigned = new URL(url); };
  const server = readingDrive(realLibrary());
  let app = await startApp({ ...dom, Viewer, fetcher: server.fetcher, clientId: 'test-client' });
  await dom.$('paper-list').children[0].emit('click');
  app.viewer.callbacks.onPage(7, 12);
  server.failure = 403;
  await dom.$('read-toggle').emit('click');
  await dom.$('session-login').emit('click');
  assert.deepEqual(assigned.searchParams.get('scope').split(' '), ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file']);
  const state = assigned.searchParams.get('state');
  app.dispose();
  const reloaded = makeDOM('', dom.storage);
  reloaded.window.location.hash = `#access_token=new-sample&token_type=Bearer&expires_in=3600&state=${state}`;
  server.failure = null;
  app = await startApp({ ...reloaded, Viewer, fetcher: server.fetcher, clientId: 'test-client' });
  assert.equal(reloaded.$('reader-view').hidden, false);
  assert.equal(reloaded.$('reader-title').textContent, realLibrary().papers[0].title);
  assert.equal(reloaded.$('page-counter').textContent, '7 / 12');
  assert.equal(reloaded.$('read-toggle').textContent, '未読に戻す');
  assert.equal(app.store.state.reading.pending.length, 0);
  assert.equal(server.log.events.length, 1);
  app.dispose();
});

test('app startup resends saved pending events; a corrupt log stays untouched and its reason is visible in settings', async () => {
  const dom = makeDOM('');
  const entry = { path: 'University/01_reaserch/survey', event: { id: realLibrary().papers[0].id, read_status: '読了', at: '2026-10-24T20:00:00+09:00' } };
  dom.storage.set('paper-reader-v1', JSON.stringify(savedSession({ reading: { pending: [entry] } })));
  const server = readingDrive(realLibrary(), { events: [] });
  server.invalidJSON = true;
  const app = await startApp({ ...dom, Viewer, fetcher: server.fetcher });
  await dom.settings[0].emit('click');
  assert.match(dom.$('reading-error').textContent, /reading_log.json が壊れている/);
  assert.equal(dom.$('reading-pending').textContent, '未送信の記録: 1 件');
  assert.equal(server.requests.filter(r => r.options.method).length, 0);
  server.invalidJSON = false;
  await dom.window.emit('online');
  assert.deepEqual(server.log.events, [entry.event]);
  app.dispose();
});

test('refreshed stale papers.json preserves the override until 24 hours, including list and basic information', async () => {
  const dom = makeDOM('');
  dom.storage.set('paper-reader-v1', JSON.stringify(savedSession()));
  const library = realLibrary();
  const server = readingDrive(library);
  const app = await startApp({ ...dom, Viewer, fetcher: server.fetcher });
  await dom.$('paper-list').children[0].emit('click');
  const summaryNode = dom.$('summary-content').children[0];
  await dom.$('read-toggle').emit('click');
  assert.equal(dom.$('summary-content').children[0], summaryNode, 'status updates must preserve the reading panel');
  assert.equal(detailStatus(dom), '読了');
  await dom.$('back-list').emit('click');
  library.generated = new Date(Date.parse(server.log.events[0].at) + 1000).toISOString();
  await dom.$('reload').emit('click');
  assert.match(dom.$('paper-list').children[0].textContent, /読了/);
  await dom.$('paper-list').children[0].emit('click');
  assert.equal(detailStatus(dom), '読了');
  assert.equal(dom.$('read-toggle').textContent, '未読に戻す');
  await dom.$('back-list').emit('click');
  library.generated = '2099-01-01T00:00:00+09:00';
  await dom.$('reload').emit('click');
  assert.match(dom.$('paper-list').children[0].textContent, /未読/);
  assert.deepEqual(app.store.state.reading.overrides, {});
  await dom.$('paper-list').children[0].emit('click');
  assert.equal(detailStatus(dom), '未読');
  assert.equal(dom.$('read-toggle').textContent, '読了にする');
  app.dispose();
});

test('demo filters combine status, all selected tags and search; reset, persistence and read button update results', async () => {
  const dom = makeDOM();
  let app = await startApp({ ...dom, Viewer, fetcher: fakeFetch });
  let $ = dom.$;
  const status = value => $('status-filters').children.find(button => button.textContent === value);
  const tag = value => $('tag-filters').children.find(button => button.textContent === value);
  const count = value => assert.equal($('count').textContent, value + ' 本 / 6 本');
  count(6);
  assert.equal($('clear-filters').hidden, true);
  assert.equal($('tag-filters').children[0].textContent, '読書UI 3');
  assert.deepEqual($('tag-filters').children.map(button => Number(button.textContent.split(' ').at(-1))), [3, 2, 2, 1, 1]);
  await status('未読').emit('click');
  count(5);
  assert.equal(status('未読').getAttribute('aria-pressed'), 'true');
  await status('読了').emit('click');
  count(1);
  assert.match($('paper-list').textContent, /既読/);
  await status('すべて').emit('click');
  await tag('読書UI 3').emit('click');
  count(3);
  await tag('架空実験 2').emit('click');
  count(2);
  assert.equal(tag('架空実験 2').getAttribute('aria-pressed'), 'true');
  await status('未読').emit('click');
  count(1);
  $('filter').value = '光の模';
  await $('filter').emit('input');
  count(0);
  assert.equal($('paper-list').textContent, '該当する論文はありません。');
  assert.equal($('clear-filters').hidden, false);
  $('filter').value = '読書ui';
  await $('filter').emit('input');
  count(1);
  assert.equal($('paper-list').children[0].children[0].textContent, fixture.papers.find(paper => paper.id === 'demo-long').title);
  app.dispose();
  const reloaded = makeDOM('?demo=1', dom.storage);
  app = await startApp({ ...reloaded, Viewer, fetcher: fakeFetch });
  $ = reloaded.$;
  assert.equal($('filter').value, '');
  assert.deepEqual(app.store.state.filters, { status: 'unread', tags: ['読書UI', '架空実験'] });
  count(1);
  await $('paper-list').children[0].emit('click');
  await $('read-toggle').emit('click');
  await $('back-list').emit('click');
  count(0);
  await $('clear-filters').emit('click');
  count(6);
  assert.equal($('clear-filters').hidden, true);
  assert.deepEqual(app.store.state.filters, { status: 'all', tags: [] });
  await tag('読書UI 3').emit('click');
  await tag('読書UI 3').emit('click');
  count(6);
  $('filter').value = 'missing';
  await $('filter').emit('input');
  assert.equal($('clear-filters').hidden, false);
  await $('clear-filters').emit('click');
  assert.equal($('filter').value, '');
  count(6);
  assert.equal($('clear-filters').hidden, true);
  assert.deepEqual([...dom.storage.keys()], ['paper-reader-v1']);
  app.dispose();
});

test('library refresh rebuilds tag counts, prunes vanished selections and treats punctuation as text', async () => {
  const dom = makeDOM();
  const special = '<b> tag " & [x]';
  let library = { papers: fixture.papers.map(paper => ({ ...paper, tags: [special, 'stay'], pdf: null })) };
  dom.storage.set('paper-reader-v1', JSON.stringify({ filters: { status: 'unread', tags: ['gone', special] }, pages: { saved: 7 } }));
  const app = await startApp({ ...dom, Viewer, fetcher: async () => ({ ok: true, json: async () => library }) });
  const { $ } = dom;
  assert.deepEqual(app.store.state.filters.tags, [special]);
  assert.equal($('count').textContent, '5 本 / 6 本');
  const chip = $('tag-filters').children.find(button => button.textContent === special + ' 6');
  assert.ok(chip);
  assert.equal(chip.children.length, 0);
  await chip.emit('click');
  assert.deepEqual(app.store.state.filters.tags, []);
  await chip.emit('click');
  library = { papers: [{ ...fixture.papers[2], tags: ['stay'], pdf: null }] };
  await $('reload').emit('click');
  assert.deepEqual($('tag-filters').children.map(button => button.textContent), ['stay 1']);
  assert.deepEqual(app.store.state.filters, { status: 'unread', tags: [] });
  const saved = JSON.parse(dom.storage.get('paper-reader-v1'));
  assert.deepEqual(saved.filters.tags, []);
  assert.equal(saved.pages.saved, 7);
  assert.equal($('count').textContent, '1 本 / 1 本');
  app.dispose();
});

test('demo four sorts persist across reload, filters/search/reset preserve sort and read toggles do not reorder', async t => {
  const dom = makeDOM();
  let app = await startApp({ ...dom, Viewer, fetcher: fakeFetch });
  t.after(() => app.dispose());
  let $ = dom.$;
  const titles = () => $('paper-list').children.map(card => card.children[0].textContent);
  const title = id => fixture.papers.find(p => p.id === id).title;
  const orders = {
    'stars-desc': ['demo-read', 'demo-first', 'demo-long', 'demo-no-pdf', 'demo-empty', 'demo-missing'],
    'stars-asc': ['demo-empty', 'demo-missing', 'demo-no-pdf', 'demo-first', 'demo-long', 'demo-read'],
    'added-desc': ['demo-first', 'demo-empty', 'demo-long', 'demo-no-pdf', 'demo-read', 'demo-missing'],
    'added-asc': ['demo-missing', 'demo-read', 'demo-no-pdf', 'demo-long', 'demo-empty', 'demo-first'],
  };
  for (const [sort, ids] of Object.entries(orders)) {
    $('sort').value = sort;
    await $('sort').emit('change');
    assert.deepEqual(titles(), ids.map(title));
    await $('status-filters').children.find(b => b.textContent === '未読').emit('click');
    $('filter').value = '読書UI';
    await $('filter').emit('input');
    assert.deepEqual(titles(), ids.filter(id => ['demo-long', 'demo-first'].includes(id)).map(title));
    await $('clear-filters').emit('click');
    assert.equal($('sort').value, sort);
    assert.deepEqual(titles(), ids.map(title));
    await $('paper-list').children.find(card => card.children[0].textContent === title('demo-first')).emit('click');
    await $('read-toggle').emit('click');
    assert.deepEqual(titles(), ids.map(title));
    await $('read-toggle').emit('click');
    await $('back-list').emit('click');
    app.dispose();
    const reload = makeDOM('?demo=1', dom.storage);
    app = await startApp({ ...reload, Viewer, fetcher: fakeFetch });
    $ = reload.$;
    assert.equal($('sort').value, sort);
    assert.deepEqual(titles(), ids.map(title));
  }
});

test('demo authors/comments, edit/save/list/restart/delete, length guard, draft discard and feed tab isolation', async t => {
  const dom = makeDOM();
  let app = await startApp({ ...dom, Viewer, fetcher: fakeFetch });
  t.after(() => app.dispose());
  let $ = dom.$;
  const card = id => $('paper-list').children.find(n => n.children[0].textContent === fixture.papers.find(p => p.id === id).title);
  const comment = id => card(id).children.find(n => n.className === 'paper-comment');
  for (const p of fixture.papers) {
    assert.equal(card(p.id).children.some(n => n.className === 'muted paper-authors'), !!p.authors);
    assert.equal(!!comment(p.id), !!p.comment);
    if (p.comment) assert.equal(comment(p.id).children[1].textContent, p.comment);
  }
  await card('demo-first').emit('click');
  assert.equal($('comment-editor').value, fixture.papers[2].comment);
  assert.ok($('comment-editor').value.split('\n').length > 3);
  await $('details-tab').emit('keydown', { key: 'ArrowRight' });
  assert.equal($('comment-content').hidden, false);
  assert.equal($('comment-tab').getAttribute('aria-selected'), 'true');
  assert.equal($('comment-save').disabled, true);
  const saved = '<img src=x>\n架空の編集したコメント';
  $('comment-editor').value = saved;
  await $('comment-editor').emit('input');
  await $('comment-save').emit('click');
  assert.equal($('comment-save').disabled, true);
  assert.equal(comment('demo-first').children[1].textContent, saved);
  assert.equal(comment('demo-first').descendants('img').length, 0);
  const state = structuredClone(app.store.state.comments);
  await $('comment-save').emit('click');
  assert.deepEqual(app.store.state.comments, state);
  $('comment-editor').value = '文'.repeat(1001);
  await $('comment-editor').emit('input');
  assert.equal($('comment-save').disabled, true);
  assert.match($('comment-count').textContent, /1000 字まで/);
  await $('comment-save').emit('click');
  assert.deepEqual(app.store.state.comments, state);
  $('comment-editor').value = '文'.repeat(1000);
  await $('comment-editor').emit('input');
  assert.equal($('comment-save').disabled, false);
  $('comment-editor').value = '保存しない下書き';
  await $('comment-editor').emit('input');
  await $('back-list').emit('click');
  await card('demo-first').emit('click');
  assert.equal($('comment-editor').value, saved);
  assert.equal(app.store.state.comments.pending.length, 0);
  app.dispose();
  const reload = makeDOM('?demo=1', dom.storage);
  app = await startApp({ ...reload, Viewer, fetcher: fakeFetch });
  $ = reload.$;
  assert.equal(comment('demo-first').children[1].textContent, saved);
  await card('demo-first').emit('click');
  assert.equal($('comment-editor').value, saved);
  $('comment-editor').value = '';
  await $('comment-editor').emit('input');
  await $('comment-save').emit('click');
  await $('back-list').emit('click');
  assert.equal(comment('demo-first'), undefined);
  await card('demo-first').emit('click');
  assert.equal($('comment-editor').value, '');
  const beforeFeed = JSON.stringify(app.store.state.comments);
  await app.openPaper({ ...fixture.papers[2], id: 'feed:example', feedKey: 'example', pdf: null });
  assert.equal($('comment-tab').hidden, true);
  await $('details-tab').emit('keydown', { key: 'ArrowRight' });
  assert.equal($('summary-tab').getAttribute('aria-selected'), 'true');
  await $('comment-tab').emit('click');
  assert.equal($('comment-content').hidden, true);
  $('comment-editor').value = '禁止';
  await $('comment-save').emit('click');
  assert.equal(JSON.stringify(app.store.state.comments), beforeFeed);
  assert.deepEqual([...dom.storage.keys()], ['paper-reader-v1']);
});

test('comment 403 exposes login and pending count, online retries, startup sends saved queue and matching export clears the card override', async t => {
  const dom = makeDOM('');
  dom.storage.set('paper-reader-v1', JSON.stringify(savedSession()));
  const library = realLibrary();
  const server = readingDrive(library, null, 'comment_log.json');
  let app = await startApp({ ...dom, Viewer, fetcher: server.fetcher });
  t.after(() => app.dispose());
  let $ = dom.$;
  await $('paper-list').children[0].emit('click');
  server.failure = 403;
  $('comment-editor').value = '新しいメモ';
  await $('comment-editor').emit('input');
  await $('comment-save').emit('click');
  assert.match($('paper-list').textContent, /新しいメモ/);
  assert.match($('notice').textContent, /コメント.*もう一度ログイン.*書き込みを許可/);
  assert.equal($('session-banner').hidden, false);
  assert.equal($('reading-pending').textContent, '未送信の記録: 1 件');
  app.dispose();
  const reload = makeDOM('', dom.storage);
  server.failure = null;
  app = await startApp({ ...reload, Viewer, fetcher: server.fetcher });
  $ = reload.$;
  assert.equal($('reading-pending').textContent, '');
  assert.deepEqual(server.log.events.map(e => e.comment), ['新しいメモ']);
  assert.match($('paper-list').textContent, /新しいメモ/);
  await $('paper-list').children[0].emit('click');
  server.failure = new TypeError('offline');
  $('comment-editor').value = '次のメモ';
  await $('comment-editor').emit('input');
  await $('comment-save').emit('click');
  $('comment-editor').value = 'まだ保存しない';
  await $('comment-editor').emit('input');
  server.failure = null;
  await reload.window.emit('online');
  assert.equal($('comment-editor').value, 'まだ保存しない', 'send completion must not discard a newer draft');
  assert.equal($('reading-pending').textContent, '');
  assert.deepEqual(server.log.events.map(e => e.comment), ['新しいメモ', '次のメモ']);
  library.papers[0].comment = '次のメモ';
  await $('back-list').emit('click');
  await $('reload').emit('click');
  assert.deepEqual(app.store.state.comments.overrides, {});
  assert.match($('paper-list').textContent, /次のメモ/);
});
