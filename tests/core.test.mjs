import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canvasScale, clamp, currentPage, normalizeLibrary, pageLayout, selectPapers, tagCounts, normalizeFilters } from '../js/core.mjs';
import { createStore, STORAGE_KEY } from '../js/storage.mjs';
import { consumeRedirect, DRIVE_SCOPE, parseRedirect, redirectURL, validSession } from '../js/login.mjs';
import { Drive, escapeDriveValue, searchQuery } from '../js/drive.mjs';

const fixture = JSON.parse(readFileSync(new URL('../demo/papers.json', import.meta.url)));
const memory = () => { const values = new Map(); return { values, getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; };

test('library orders stars descending regardless of read status; filters tags and Japanese titles', () => {
  const { papers } = normalizeLibrary(fixture);
  assert.deepEqual(selectPapers(papers).map(p => p.id), ['demo-read', 'demo-first', 'demo-long', 'demo-no-pdf', 'demo-empty', 'demo-missing']);
  assert.deepEqual(selectPapers(papers, '光の模').map(p => p.id), ['demo-first']);
  assert.deepEqual(selectPapers(papers, '積み木').map(p => p.id), ['demo-first']);
  assert.equal(selectPapers(papers, 'EMPTY')[0].id, 'demo-empty');
  assert.equal(selectPapers(papers, '読書ui').length, 3);
  assert.equal(selectPapers(papers, 'not found').length, 0);
  assert.equal(papers[1].summary[1].heading, 'アブストラクト');
});

test('missing pdf, summary, tags and invalid optional values are safe', () => {
  const { papers } = normalizeLibrary({ papers: [{ id: 'empty', pdf: null }, { pdf: { name: '' }, summary: null, tags: null }] });
  assert.equal(papers[0].pdf, null);
  assert.deepEqual(papers[0].summary, []);
  assert.deepEqual(papers[0].tags, []);
  assert.equal(selectPapers(papers).length, 2);
  assert.throws(() => normalizeLibrary({}), /papers/);
});

test('Drive query escapes apostrophe and backslash and limits scope to a parent', () => {
  assert.equal(escapeDriveValue("author's\\draft.pdf"), "author\\'s\\\\draft.pdf");
  assert.equal(searchQuery('folder', "author's\\draft.pdf"), "'folder' in parents and trashed = false and name = 'author\\'s\\\\draft.pdf'");
  assert.match(searchQuery('root', 'folder', true), /mimeType = 'application\/vnd.google-apps.folder'/);
});

test('redirect validates state, token type and expiry; removes sensitive fragment even on failure', () => {
  const pending = { state: 'expected', createdAt: 1000 };
  const hash = '#access_token=sample%2Bvalue&expires_in=3600&token_type=Bearer&state=expected';
  const result = parseRedirect(hash, pending, 2000);
  assert.deepEqual(result.session, { accessToken: 'sample+value', expiresAt: 3602000 });
  assert.equal(validSession(result.session, 3601999), true);
  assert.equal(validSession(result.session, 3602000), false);
  for (const fragment of [hash.replace('expected', 'wrong'), hash.replace('3600', '-1'), hash.replace('Bearer', 'other')]) assert.equal(parseRedirect(fragment, pending, 2000).session, undefined);
  assert.equal(parseRedirect(hash, null, 2000).session, undefined);
  assert.equal(parseRedirect(hash, { state: 'expected' }, 2000).session, undefined);
  assert.equal(parseRedirect(hash, pending, 601001).session, undefined);
  const store = createStore(memory());
  store.state.pendingLogin = pending;
  let replaced;
  consumeRedirect({ hash, pathname: '/app-paper-reader/', search: '' }, { replaceState: (...args) => { replaced = args[2]; } }, store, 2000);
  assert.equal(replaced, '/app-paper-reader/');
  assert.equal(store.state.pendingLogin, null);
  assert.equal(store.state.session.accessToken, 'sample+value');
  consumeRedirect({ hash, pathname: '/app-paper-reader/', search: '' }, { replaceState() {} }, store, 2000);
  assert.equal(store.state.session, null);
  const url = new URL(redirectURL('example-client', 'https://example.test/app/', 'nonce'));
  assert.equal(url.searchParams.get('scope'), DRIVE_SCOPE);
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('state'), 'nonce');
});

test('one storage key persists page 7 and split bounds; clear preserves settings and session', () => {
  const storage = memory();
  let store = createStore(storage);
  store.setPage('demo:paper', 7);
  store.state.panelWidth = 73;
  store.state.session = { accessToken: 'sample', expiresAt: 6000 };
  store.state.settings.method = 'popup';
  store.state.folders = { path: { survey: 'id', reader: 'reader' } };
  store.save();
  store = createStore(storage);
  assert.equal(store.page('demo:paper'), 7);
  assert.equal(store.state.panelWidth, 73);
  assert.deepEqual([...storage.values.keys()], [STORAGE_KEY]);
  store.clearReading();
  assert.equal(store.page('demo:paper'), 1);
  assert.equal(store.state.panelWidth, 50);
  assert.deepEqual(store.state.folders, {});
  assert.equal(store.state.settings.method, 'popup');
  assert.equal(store.state.session.accessToken, 'sample');
  assert.equal(clamp(90, 25, 75), 75);
  assert.equal(clamp(-5, 25, 75), 25);
});

test('corrupt or denied storage does not crash and reports failure', () => {
  const messages = [];
  const store = createStore({ getItem: () => '{', setItem: () => { throw new Error(); } }, message => messages.push(message));
  assert.equal(store.page('x'), 1);
  assert.equal(store.save(), false);
  assert.equal(messages.length, 1);
});

test('page geometry restores page 7 at multiple widths and limits canvas memory', () => {
  for (const width of [211, 390, 422, 633]) for (const zoom of [0.5, 1, 4]) {
    const layout = pageLayout(Array.from({ length: 12 }, () => ({ width: 612, height: 792 })), width, zoom);
    assert.equal(currentPage(layout.pages.map(p => p.top), layout.pages[6].top, 280), 7);
    const page = layout.pages[0];
    const ratio = canvasScale(page.width, page.height, 3);
    assert.ok(page.width * page.height * ratio ** 2 <= 4_000_001);
    assert.ok(page.width * ratio <= 8192);
  }
});

test('Drive traverses folders once, uses direct IDs, requests only reads, and handles 401', async () => {
  const store = createStore(memory());
  store.state.session = { accessToken: 'sample', expiresAt: Date.now() + 60000 };
  let count = 0;
  let expired = 0;
  const requests = [];
  const drive = new Drive(store, () => expired++, async (url, options) => {
    requests.push({ url: new URL(url), options });
    return { ok: true, status: 200, json: async () => new URL(url).searchParams.has('alt') ? fixture : { files: [{ id: `id-${++count}` }, { id: 'second-ignored' }] } };
  });
  await drive.library();
  assert.equal(count, 5);
  assert.deepEqual(store.state.folders[store.state.settings.path], { survey: 'id-3', reader: 'id-4' });
  await drive.library();
  assert.equal(count, 6);
  assert.equal(await drive.pdfId({ pdf: { drive_id: 'direct', name: 'sample.pdf' } }), 'direct');
  assert.equal(count, 6);
  await drive.pdfId({ pdf: { name: "a'\\b.pdf" } });
  assert.match(requests.at(-1).url.searchParams.get('q'), /a\\'\\\\b.pdf/);
  for (const request of requests) {
    assert.equal(request.options.method, undefined);
    assert.equal(request.options.cache, 'no-store');
    assert.equal(request.options.headers.Authorization, 'Bearer sample');
  }
  drive.fetcher = async () => ({ ok: false, status: 401 });
  await assert.rejects(drive.library(), error => error.status === 401);
  assert.equal(expired, 1);
  store.state.session.expiresAt = 1;
  assert.throws(() => drive.headers(), error => error.status === 401);
  assert.equal(expired, 2);
});

test('Drive calls the fetcher as a plain function, as Safari requires for window.fetch', async () => {
  const store = createStore(memory());
  store.state.session = { accessToken: 'sample', expiresAt: Date.now() + 60000 };
  const drive = new Drive(store, () => {}, function (url) {
    if (this !== undefined) throw new TypeError('Can only call Window.fetch on instances of Window');
    return Promise.resolve({ ok: true, status: 200, json: async () => new URL(url).searchParams.has('alt') ? fixture : { files: [{ id: 'id' }] } });
  });
  await drive.library();
});

test('filters preserve star order, count papers once per tag, and include every non-unread status as read', () => {
  const { papers } = normalizeLibrary(fixture);
  assert.deepEqual(selectPapers(papers, '', { status: 'unread', tags: ['読書UI'] }).map(p => p.id), ['demo-first', 'demo-long']);
  assert.deepEqual(selectPapers(papers, '', { tags: ['読書UI', '架空実験'] }).map(p => p.id), ['demo-read', 'demo-long']);
  const statuses = ['未読', '読了', '既読', '', 'その他'].map((read_status, i) => ({ ...papers[0], id: String(i), read_status }));
  assert.deepEqual(selectPapers(statuses, '', { status: 'read' }).map(p => p.id), ['1', '2', '3', '4']);
  assert.deepEqual(tagCounts([{ tags: ['a', 'a', 'b'] }, { tags: ['b'] }]), [{ tag: 'b', count: 2 }, { tag: 'a', count: 1 }]);
  assert.deepEqual(normalizeFilters({ status: 'bad', tags: ['a', 'a', null, 'gone'] }, new Set(['a'])), { status: 'all', tags: ['a'] });
  assert.deepEqual(normalizeFilters(null), { status: 'all', tags: [] });
});

test('filter storage defaults for old data and validates malformed saved choices without changing existing fields', () => {
  const storage = memory();
  storage.setItem(STORAGE_KEY, JSON.stringify({ pages: { paper: 7 }, filters: { status: 'bad', tags: 'bad' } }));
  const store = createStore(storage);
  assert.deepEqual(store.state.filters, { status: 'all', tags: [] });
  store.state.filters = { status: 'read', tags: ['a'] };
  store.save();
  const reloaded = createStore(storage);
  assert.deepEqual(reloaded.state.filters, { status: 'read', tags: ['a'] });
  assert.equal(reloaded.page('paper'), 7);
  assert.deepEqual(createStore(memory()).state.filters, { status: 'all', tags: [] });
});

test('four sort orders resolve star/date/title ties and keep missing or invalid dates last in both directions', () => {
  const rows = [
    { id: 'a', title: 'A', importance: '★★', added: '2026-10-20T00:00:00+09:00', read_status: '未読' },
    { id: 'b', title: 'B', importance: '★★', added: '2026-10-22T00:00:00+09:00', read_status: '読了' },
    { id: 'c', title: 'C', importance: '★', added: '2026-10-22T00:00:00+09:00' },
    { id: 'd', title: 'D', importance: '★★', added: 'bad' },
    { id: 'e', title: 'E', importance: '★★' },
    { id: 'f', title: 'F', importance: '★★', added: '2026-10-21T15:00:00Z' },
  ].map(p => ({ ...p, tags: ['tag'] }));
  const { papers } = normalizeLibrary({ papers: rows });
  const orders = {
    'stars-desc': ['b', 'f', 'a', 'd', 'e', 'c'],
    'stars-asc': ['c', 'b', 'f', 'a', 'd', 'e'],
    'added-desc': ['b', 'c', 'f', 'a', 'd', 'e'],
    'added-asc': ['a', 'b', 'c', 'f', 'd', 'e'],
  };
  for (const [sort, expected] of Object.entries(orders)) {
    assert.deepEqual(selectPapers(papers, '', {}, sort).map(p => p.id), expected);
    assert.deepEqual(selectPapers(papers, 'tag', { tags: ['tag'], status: 'read' }, sort).map(p => p.id), expected.filter(id => id !== 'a'));
  }
  assert.deepEqual(selectPapers(papers, '', {}, 'unknown').map(p => p.id), orders['stars-desc']);
  assert.deepEqual(papers.map(p => p.id), rows.map(p => p.id), 'sorting must not mutate the source');
  assert.equal(papers[4].added, '');
  assert.ok(papers.every(p => p.comment === ''));
});

test('old storage and papers accept missing added/comments; all saved sorts reload and unknown sorts default', () => {
  const storage = memory();
  for (const sort of [undefined, 'unknown', null, 'stars-desc', 'stars-asc', 'added-desc', 'added-asc']) {
    storage.setItem(STORAGE_KEY, JSON.stringify({ sort, pages: { paper: 7 } }));
    const store = createStore(storage);
    const expected = typeof sort === 'string' && sort !== 'unknown' ? sort : 'stars-desc';
    assert.equal(store.state.sort, expected);
    assert.deepEqual(store.state.comments, { pending: [], overrides: {}, lastAt: 0 });
    store.save();
    assert.equal(createStore(storage).state.sort, expected);
    assert.equal(createStore(storage).page('paper'), 7);
  }
  const { papers } = normalizeLibrary({ papers: [{ id: 'old' }, { id: 'invalid', added: null, comment: 42 }] });
  assert.ok(papers.every(p => p.added === '' && p.comment === ''));
});
