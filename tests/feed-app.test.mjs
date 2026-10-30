import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp } from '../js/app.mjs';
import { japanDay } from '../js/feed.mjs';
import { makeDOM, eventually } from './support/dom.mjs';
import { feedDrive } from './support/feed-drive.mjs';
import { savedSession } from './support/reading-drive.mjs';

const fixture = JSON.parse(await readFile(new URL('../demo/papers.json', import.meta.url)));
const pdfBytes = await readFile(new URL('../demo/reader-demo.pdf', import.meta.url));
const file = new Blob([pdfBytes], { type: 'application/pdf' });
class Viewer {
  constructor(scroller, pages, callbacks) { this.callbacks = callbacks; this.zoom = 1; this.calls = []; }
  close() {}
  schedule() {}
  async open(source, page) { this.calls.push({ source, page }); this.callbacks.onReady(); this.callbacks.onPage(page, 12); }
}
function demoFetch(input, options) {
  assert.equal(this, undefined);
  const url = String(input);
  assert.ok(url.startsWith('file:'), 'demo requests must only read bundled fixtures');
  assert.equal(options.cache, 'no-store');
  return Promise.resolve(url.endsWith('papers.json') ? { ok: true, json: async () => structuredClone(fixture) }
    : { ok: !url.includes('missing-demo'), status: url.includes('missing-demo') ? 404 : 200 });
}
const card = dom => dom.$('feed-list').children.find(node => node.className === 'feed-card');
const waiting = dom => dom.$('feed-list').children.filter(node => node.className === 'feed-waiting');
const button = (node, label) => node.descendants('button').find(child => child.textContent === label);
async function choose(node, selected = file) {
  const input = node.descendants('input')[0];
  assert.equal(input.accept, 'application/pdf');
  assert.equal(input.type, 'file');
  input.files = [selected];
  await input.emit('change');
  assert.equal(input.value, '', 'same file must be selectable again');
}
function libraryForDrive() {
  return { papers: [], generated: new Date().toISOString(), feed: [{ ...fixture.feed[0], served: japanDay(), oa_pdf: 'https://example.invalid/fictional.pdf' }] };
}
async function realApp(t, server = feedDrive(libraryForDrive()), saved = savedSession()) {
  const dom = makeDOM('');
  dom.storage.set('paper-reader-v1', JSON.stringify(saved));
  const app = await startApp({ ...dom, Viewer, fetcher: server.fetcher });
  t.after(() => app.dispose());
  return { ...dom, app, server };
}

test('demo shows today summaries, a collapsed abstract, five waiting papers, and days independently of filters and search', async t => {
  const dom = makeDOM();
  const app = await startApp({ ...dom, Viewer, fetcher: demoFetch });
  t.after(() => app.dispose());
  const text = dom.$('feed-list').textContent;
  assert.match(text, /今日の一本/);
  assert.match(text, /これは何の論文か/);
  assert.match(text, /あなたにとっての意味/);
  assert.match(text, /この 7 日で PDF を入れた日 0\/7/);
  assert.equal(waiting(dom).length, 5);
  assert.equal(card(dom).descendants('details')[0].open, false);
  const getPdf = card(dom).descendants('a').find(node => node.textContent === 'PDF を取ってくる');
  assert.equal(getPdf.href, 'http://localhost:8080/PaperReader/demo/reader-demo.pdf');
  assert.equal(getPdf.target, '_blank');
  assert.equal(getPdf.rel, 'noopener');
  assert.match(waiting(dom)[1].textContent, /学内ネットワーク／VPN/);
  card(dom).descendants('details')[0].open = true;
  dom.$('filter').value = 'no-matching-paper';
  await dom.$('filter').emit('input');
  await button(dom.$('status-filters'), '読了').emit('click');
  assert.equal(dom.$('count').textContent, '0 本 / 6 本');
  assert.equal(dom.$('feed-list').textContent, text);
  assert.equal(card(dom).descendants('details')[0].open, true);
});

test('demo PDF selection opens its actual Blob and summary, hides read status, and persists Read/days without storing PDF bytes', async t => {
  const dom = makeDOM();
  let app = await startApp({ ...dom, Viewer, fetcher: demoFetch });
  t.after(() => app.dispose());
  await choose(card(dom));
  assert.equal(dom.$('reader-view').hidden, false);
  assert.match(app.viewer.calls.at(-1).source.url, /^blob:/);
  const response = await fetch(app.viewer.calls.at(-1).source.url);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(pdfBytes));
  assert.equal(dom.$('read-toggle').hidden, true);
  await dom.$('read-toggle').emit('click');
  assert.deepEqual(app.store.state.reading.overrides, {});
  assert.deepEqual(dom.$('summary-content').descendants('h2').map(n => n.textContent), ['これは何の論文か', 'あなたにとっての意味', 'アブストラクト']);
  assert.match(dom.$('summary-content').textContent, new RegExp(fixture.feed[0].ja));
  assert.deepEqual(dom.$('details-content').descendants('dt').map(n => n.textContent), ['題', '著者', '掲載先', '年', 'DOI']);
  await dom.$('back-list').emit('click');
  assert.ok(button(card(dom), '読む'));
  assert.match(dom.$('feed-list').textContent, /日 1\/7/);
  assert.equal(app.store.state.feed.pending.length, 0);
  assert.doesNotMatch(dom.storage.get('paper-reader-v1'), /blob:|%PDF-|base64/);
  app.dispose();
  const reloaded = makeDOM('?demo=1', dom.storage);
  app = await startApp({ ...reloaded, Viewer, fetcher: demoFetch });
  assert.ok(button(card(reloaded), '読む'));
  assert.match(reloaded.$('feed-list').textContent, /日 1\/7/);
  await button(card(reloaded), '読む').emit('click');
  assert.match(app.viewer.calls.at(-1).source.url, /demo\/reader-demo.pdf$/);
  assert.match(reloaded.$('notice').textContent, /再読み込み後は同梱の架空 PDF/);
  assert.match(reloaded.$('summary-content').textContent, /これは何の論文か/);
});

test('demo skip removes a waiting row, folds today, and unskip restores it without incrementing days, including after restart', async t => {
  const dom = makeDOM();
  let app = await startApp({ ...dom, Viewer, fetcher: demoFetch });
  t.after(() => app.dispose());
  await button(waiting(dom)[0], '見送る').emit('click');
  assert.equal(waiting(dom).length, 5);
  assert.match(dom.$('feed-list').textContent, /PDF 待ち 12 本/);
  assert.equal(waiting(dom).at(-1).descendants('h3')[0].textContent, fixture.feed[8].title);
  await button(card(dom), '見送る').emit('click');
  assert.match(card(dom).textContent, /見送り済み・取り消す/);
  assert.equal(card(dom).descendants('details').length, 0);
  assert.match(dom.$('feed-list').textContent, /日 0\/7/);
  app.dispose();
  const reload = makeDOM('?demo=1', dom.storage);
  app = await startApp({ ...reload, Viewer, fetcher: demoFetch });
  assert.equal(waiting(reload).length, 5);
  assert.match(card(reload).textContent, /見送り済み/);
  await button(card(reload), '取り消す').emit('click');
  assert.ok(button(card(reload), 'PDF を入れる'));
  assert.match(reload.$('feed-list').textContent, /日 0\/7/);
  while (waiting(reload).length) await button(waiting(reload)[0], '見送る').emit('click');
  assert.doesNotMatch(reload.$('feed-list').textContent, /PDF 待ち/);
});

test('Drive upload and same-name reuse open the returned ID and append only the permitted feed event', async t => {
  for (const exists of [false, true]) {
    const server = feedDrive(libraryForDrive());
    if (exists) server.pdfs.set(fixture.feed[0].pdf_name, 'existing-id');
    const dom = await realApp(t, server);
    await choose(card(dom));
    const id = exists ? 'existing-id' : 'uploaded-id';
    assert.equal(dom.app.viewer.calls.at(-1).source.url, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    assert.equal(server.log.events.length, 1);
    assert.deepEqual(server.log.events[0], { key: fixture.feed[0].key, action: 'pdf', at: server.log.events[0].at, name: fixture.feed[0].pdf_name, drive_id: id });
    assert.match(server.log.events[0].at, /\+09:00$/);
    assert.equal(server.requests.filter(r => r.url.searchParams.get('uploadType') === 'resumable').length, exists ? 0 : 2);
    assert.match(dom.$('feed-list').textContent, /日 1\/7/);
    assert.equal(dom.app.store.state.feed.pending.length, 0);
  }
});

test('403 and 404 upload failures show manual instructions and copy the exact pdf_name, then allow selecting again', async t => {
  for (const status of [403, 404]) {
    const dom = await realApp(t);
    dom.server.uploadFailure = status;
    await choose(card(dom));
    assert.match(card(dom).textContent, /アプリから survey に入れられませんでした/);
    assert.ok(card(dom).textContent.includes(`『${fixture.feed[0].pdf_name}』`));
    await button(card(dom), 'PDF の名前をコピー').emit('click');
    assert.equal(dom.window.navigator.clipboard.text, fixture.feed[0].pdf_name);
    assert.equal(dom.app.viewer.calls.length, 0);
    assert.equal(dom.app.store.state.feed.pending.length, 0);
    dom.server.uploadFailure = null;
    await choose(card(dom));
    assert.equal(dom.app.viewer.calls.length, 1);
  }
});

test('bad signature and network failure send no PDF or log, recover by reselection, and expiry displays upload failure', async t => {
  const dom = await realApp(t);
  const initial = dom.server.requests.length;
  await choose(card(dom), new Blob(['not a PDF'], { type: 'application/pdf' }));
  assert.match(card(dom).textContent, /PDF ではないようです/);
  assert.equal(dom.server.requests.length, initial);
  dom.server.uploadFailure = new TypeError('offline');
  await choose(card(dom));
  assert.match(card(dom).textContent, /アップロードできませんでした/);
  assert.equal(dom.server.log, null);
  dom.server.uploadFailure = 401;
  await choose(card(dom));
  assert.match(dom.$('notice').textContent, /アップロードできませんでした.*ログイン/);
  assert.equal(dom.$('session-banner').hidden, false);
});

test('log-only failure opens the PDF, persists a pending event, counts it in settings, and online retry clears it', async t => {
  const dom = await realApp(t);
  dom.server.logFailure = 403;
  await choose(card(dom));
  assert.equal(dom.$('reader-view').hidden, false);
  assert.equal(dom.app.viewer.calls.length, 1);
  assert.equal(dom.app.store.state.feed.pending.length, 1);
  assert.match(dom.$('feed-list').textContent, /日 1\/7/);
  assert.doesNotMatch(dom.$('feed-list').textContent, /アプリから survey に入れられませんでした/);
  await dom.settings[0].emit('click');
  assert.equal(dom.$('reading-pending').textContent, '未送信の記録: 1 件');
  dom.server.logFailure = null;
  await dom.window.emit('online');
  assert.equal(dom.$('reading-pending').textContent, '');
  assert.equal(dom.app.store.state.feed.pending.length, 0);
  assert.equal(dom.server.log.events.length, 1);
  assert.match(dom.$('feed-list').textContent, /日 1\/7/);
});

test('startup combines and retries reading and feed pending records, and remote log failures leave the list usable', async t => {
  const library = libraryForDrive();
  const server = feedDrive(library);
  const at = new Date(Date.now() + 9 * 3600_000).toISOString().replace('Z', '+09:00');
  const saved = savedSession();
  const path = Object.keys(saved.folders)[0];
  saved.reading = { pending: [{ path, event: { id: 'fictional', read_status: '読了', at } }] };
  saved.feed = { pending: [{ path, event: { key: 'fictional', action: 'pdf', at, name: 'fictional.pdf', drive_id: 'id' } }] };
  server.logFailure = 403;
  server.logReadFailure = 500;
  const dom = await realApp(t, server, saved);
  assert.equal(dom.$('list-view').hidden, false);
  assert.ok(button(card(dom), 'PDF を入れる'));
  assert.match(dom.$('list-message').textContent, /記録を読み込めませんでした/);
  await dom.settings[0].emit('click');
  assert.equal(dom.$('reading-pending').textContent, '未送信の記録: 2 件');
  server.logFailure = null;
  server.logReadFailure = null;
  await dom.window.emit('online');
  assert.equal(server.log.events.length, 1);
  assert.equal(server.readingLog.events.length, 1);
  assert.equal(dom.$('reading-pending').textContent, '');
});

test('a registered feed opens its normal paper and read toggle; unregistered entries omit empty data and absent acquisition/upload links', async t => {
  const server = feedDrive(libraryForDrive());
  server.library.feed[0].notion_id = 'registered';
  server.library.papers.push({ ...fixture.papers[0], id: 'registered', pdf: null });
  const dom = await realApp(t, server);
  await choose(card(dom));
  assert.equal(dom.$('read-toggle').hidden, false);
  assert.match(dom.$('summary-content').textContent, /新規性と貢献/);
  assert.equal(dom.app.viewer.calls.at(-1).source.url, 'https://www.googleapis.com/drive/v3/files/uploaded-id?alt=media');
  await dom.$('read-toggle').emit('click');
  assert.equal(server.readingLog.events[0].id, 'registered');
  await dom.$('back-list').emit('click');
  server.library.feed[0] = { key: 'empty', served: japanDay(), title: '<b>fictional</b>' };
  await dom.app.loadList();
  assert.equal(card(dom).descendants('a').length, 0);
  assert.equal(card(dom).descendants('input').length, 0);
  assert.equal(card(dom).descendants('b').length, 0);
  assert.equal(card(dom).descendants('h4').length, 0);
  server.library.feed = [];
  await dom.app.loadList();
  assert.equal(dom.$('feed-list').hidden, true);
  delete server.library.feed;
  await dom.app.loadList();
  assert.equal(dom.$('paper-list').children.length, 1);
  assert.equal(dom.$('feed-list').hidden, true);
});

test('while upload is pending, duplicate selections and folder changes cannot start a second upload or redirect the event', async t => {
  const dom = await realApp(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  dom.server.beforeWrite = async (url, options) => { if (options.method === 'PUT') await gate; };
  const originalCard = card(dom);
  const uploading = choose(originalCard);
  await eventually(() => dom.server.requests.some(r => r.options.method === 'PUT'));
  assert.match(card(dom).textContent, /アップロード中/);
  assert.equal(button(card(dom), 'PDF を入れる').disabled, true);
  await choose(originalCard);
  await dom.settings[0].emit('click');
  dom.$('survey-path').value = 'other/survey';
  await dom.$('settings-form').emit('submit');
  assert.match(dom.$('settings-message').textContent, /アップロードが終わってから/);
  release();
  await uploading;
  assert.equal(dom.server.requests.filter(r => r.options.method === 'PUT').length, 1);
  assert.equal(dom.server.log.events.length, 1);
  assert.equal(dom.app.store.state.settings.path, Object.keys(savedSession().folders)[0]);
});

test('feed direct ID overrides a stale missing-PDF cache for a registered paper after restart', async t => {
  const server = feedDrive(libraryForDrive());
  server.library.feed[0].notion_id = 'registered';
  server.library.papers.push({ ...fixture.papers[0], id: 'registered', pdf: { name: 'old-missing.pdf', drive_id: null } });
  const saved = savedSession();
  const path = Object.keys(saved.folders)[0];
  const event = { key: fixture.feed[0].key, action: 'pdf', at: new Date(Date.now() + 9 * 3600_000).toISOString().replace('Z', '+09:00'), name: fixture.feed[0].pdf_name, drive_id: 'fresh-id' };
  saved.feed = { pending: [{ path, event }], overrides: { [JSON.stringify([path, event.key])]: { pdf: event } } };
  const dom = await realApp(t, server, saved);
  assert.match(dom.$('paper-list').textContent, /PDF なし/);
  await button(card(dom), '読む').emit('click');
  assert.equal(dom.app.viewer.calls.at(-1).source.url, 'https://www.googleapis.com/drive/v3/files/fresh-id?alt=media');
  assert.equal(dom.$('read-toggle').hidden, false);
});

test('popup re-login retries feed records while preserving the current feed paper and page', async t => {
  const dom = makeDOM('');
  const saved = savedSession();
  saved.settings = { method: 'popup', path: Object.keys(saved.folders)[0] };
  dom.storage.set('paper-reader-v1', JSON.stringify(saved));
  let popup;
  dom.window.google = { accounts: { oauth2: { initTokenClient(options) { popup = options; return { requestAccessToken() {} }; } } } };
  const server = feedDrive(libraryForDrive());
  const app = await startApp({ ...dom, Viewer, fetcher: server.fetcher, clientId: 'test-client' });
  t.after(() => app.dispose());
  server.logFailure = 403;
  await choose(card(dom));
  app.viewer.callbacks.onPage(7, 12);
  server.logFailure = null;
  await popup.callback({ access_token: 'new-sample', expires_in: 3600 });
  assert.equal(app.store.state.feed.pending.length, 0);
  assert.equal(app.viewer.calls.at(-1).page, 7);
  assert.equal(dom.$('read-toggle').hidden, true);
  assert.match(dom.$('summary-content').textContent, /これは何の論文か/);
  assert.equal(server.log.events.length, 1);
});

test('demo expands, collapses, refills after PDF upload, and forgets expansion on restart', async t => {
  const dom = makeDOM();
  let app = await startApp({ ...dom, Viewer, fetcher: demoFetch });
  t.after(() => app.dispose());
  const list = dom.$('feed-list');
  assert.match(list.textContent, /PDF 待ち 13 本/);
  assert.equal(waiting(dom).length, 5);
  const saved = dom.storage.get('paper-reader-v1');
  await button(list, '残り 8 本を表示').emit('click');
  assert.equal(waiting(dom).length, 13);
  assert.equal(button(list, 'たたむ').getAttribute('aria-expanded'), 'true');
  await button(list, 'たたむ').emit('click');
  assert.equal(waiting(dom).length, 5);
  assert.equal(dom.storage.get('paper-reader-v1'), saved);
  await choose(waiting(dom)[0]);
  await dom.$('back-list').emit('click');
  assert.match(list.textContent, /PDF 待ち 12 本/);
  assert.equal(waiting(dom).length, 5);
  assert.equal(waiting(dom).at(-1).descendants('h3')[0].textContent, fixture.feed[8].title);
  await button(list, '残り 7 本を表示').emit('click');
  app.dispose();
  const reload = makeDOM('?demo=1', dom.storage);
  app = await startApp({ ...reload, Viewer, fetcher: demoFetch });
  assert.equal(waiting(reload).length, 5);
  assert.ok(button(reload.$('feed-list'), '残り 7 本を表示'));
});
