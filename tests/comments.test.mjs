import test from 'node:test';
import assert from 'node:assert/strict';
import { createComments, WRITE_PERMISSION_MESSAGE } from '../js/comments.mjs';
import { createStore, STORAGE_KEY } from '../js/storage.mjs';
import { Drive } from '../js/drive.mjs';
import { readingDrive, savedSession, surveyPath } from './support/reading-drive.mjs';

const source = { id: 'paper', comment: '元の文' };
const at = '2026-10-30T21:00:00.000+09:00';
function setup(initialLog = null) {
  const server = readingDrive(undefined, initialLog, 'comment_log.json');
  const values = new Map([[STORAGE_KEY, JSON.stringify(savedSession())]]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = createStore(storage);
  const drive = new Drive(store, () => {}, server.fetcher);
  const errors = [];
  const comments = createComments(store, drive, { now: () => Date.parse(at), onError: message => errors.push(message) });
  return { server, values, storage, store, drive, errors, comments };
}

test('comment log creates only permitted multipart and appends full text, newline and empty deletion to the same ID', async () => {
  const { comments, server, store, drive } = setup();
  assert.equal(comments.record(source, '全文\n次の行'), true);
  await comments.flush();
  const first = { id: 'paper', comment: '全文\n次の行', at };
  assert.deepEqual(server.log, { events: [first] });
  server.log.extra = 'keep';
  assert.equal(comments.record(source, ''), true);
  const second = store.state.comments.pending[0].event;
  assert.deepEqual(second, { id: 'paper', comment: '', at: '2026-10-30T21:00:00.001+09:00' });
  await comments.flush();
  assert.deepEqual(server.log, { events: [first, second], extra: 'keep' });
  const writes = server.requests.filter(r => r.options.method);
  assert.deepEqual(writes.map(r => r.options.method), ['POST', 'PATCH']);
  const patchIndex = server.requests.findIndex(r => r.options.method === 'PATCH');
  assert.equal(server.requests[patchIndex - 1].url.searchParams.get('alt'), 'media');
  await assert.rejects(drive.appendLog('papers.json', {}, () => false), /書き込めない/);
});

test('same source or override text, absent empty comment, feeds and over 1000 characters do not record; exactly 1000 works', async () => {
  const { comments, server, store, errors, drive } = setup();
  assert.equal(comments.record(source, source.comment), false);
  assert.equal(comments.record({ id: 'legacy' }, ''), false);
  assert.equal(comments.record({ ...source, feedKey: 'feed' }, '禁止'), false);
  assert.equal(comments.record(source, '文'.repeat(1001)), false);
  assert.match(errors.at(-1), /1000 字まで/);
  assert.equal(store.state.comments.lastAt, 0);
  assert.deepEqual(store.state.comments.overrides, {});
  assert.equal(comments.record(source, '文'.repeat(1000)), true);
  assert.equal(comments.record(source, '文'.repeat(1000)), false);
  await comments.flush();
  assert.equal(server.log.events.length, 1);
  assert.equal(comments.record(source, '😀'.repeat(1000)), true);
  assert.equal(comments.record(source, '😀'.repeat(1001)), false);
  for (const event of [{ id: 'paper', comment: '文'.repeat(1001), at }, { id: 'paper', comment: null, at }, { id: 'paper', comment: '', at: '2026-10-30T12:00:00Z' }]) {
    await assert.rejects(drive.appendComment(event), /形式/);
  }
  assert.equal(server.requests.filter(r => r.options.method).length, 1);
});

test('failed comment sends survive restart; 403 requests permission, 401 requests login, recovery clears the queue', async () => {
  for (const failure of [403, 401, new TypeError('offline')]) {
    const { comments, server, storage, errors } = setup();
    server.failure = failure;
    comments.record(source, '保存した文');
    await comments.flush();
    assert.equal(comments.pendingCount(), 1);
    if (failure === 403) assert.equal(errors.at(-1), WRITE_PERMISSION_MESSAGE);
    if (failure === 401) assert.match(errors.at(-1), /端末に残っています.*ログイン/);
    const store = createStore(storage);
    const resumed = createComments(store, new Drive(store, () => {}, server.fetcher));
    assert.equal(resumed.paper(source, '').comment, '保存した文');
    server.failure = null;
    await resumed.flush();
    assert.equal(resumed.pendingCount(), 0);
    assert.equal(createStore(storage).state.comments.pending.length, 0);
    assert.deepEqual(server.log.events, [{ id: source.id, comment: '保存した文', at }]);
  }
});

test('comments stay through stale exports, clear on matching export including empty deletion, and expire exactly at 24 hours', async () => {
  for (const text of ['変更', '']) {
    const { comments, store, storage } = setup();
    comments.record(source, text);
    await comments.flush();
    const reloaded = createStore(storage);
    const resumed = createComments(reloaded, {});
    for (const generated of ['', 'invalid', '2026-10-31T20:59:59.999+09:00']) {
      assert.equal(resumed.paper(source, generated).comment, text);
    }
    const matching = { ...source, comment: text };
    assert.equal(resumed.paper(matching, '2026-10-30T21:01:00+09:00'), matching);
    assert.deepEqual(createStore(storage).state.comments.overrides, {});
    assert.ok(Object.keys(store.state.comments.overrides).length);
  }
  for (const generated of ['2026-10-31T21:00:00+09:00', '2026-11-02T21:00:00+09:00']) {
    const { comments, storage } = setup();
    comments.record(source, '変更');
    await comments.flush();
    assert.equal(comments.paper(source, generated), source);
    assert.deepEqual(createStore(storage).state.comments.overrides, {});
  }
});

test('unsent comments survive matching or very old exports and intermediate exports cannot replace the latest comment', async () => {
  const { comments, server, store } = setup();
  comments.record(source, '1回目');
  comments.record(source, '2回目');
  server.failure = 403;
  await comments.flush();
  for (const comment of ['1回目', '2回目', '元の文']) {
    assert.equal(comments.paper({ ...source, comment }, '2099-01-01').comment, '2回目');
    assert.equal(Object.keys(store.state.comments.overrides).length, 1);
  }
  server.failure = null;
  await comments.flush();
  assert.equal(comments.paper({ ...source, comment: '1回目' }, '2026-10-30T21:01:00+09:00').comment, '2回目');
});

test('edits during comment sending are serialized, retain their order, and retries deduplicate a lost response', async () => {
  const { comments, server, store } = setup();
  let release;
  server.beforeWrite = () => new Promise(resolve => { release = resolve; });
  comments.record(source, '1回目');
  const sending = comments.flush();
  comments.record(source, '2回目');
  assert.equal(comments.flush(), sending);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  server.beforeWrite = null;
  release();
  await sending;
  assert.deepEqual(server.log.events.map(e => e.comment), ['1回目', '2回目']);
  assert.ok(Date.parse(server.log.events[1].at) > Date.parse(server.log.events[0].at));
  assert.equal(comments.paper(source, '').comment, '2回目');
  server.lostResponse = true;
  comments.record(source, '3回目');
  await comments.flush();
  assert.equal(store.state.comments.pending.length, 1);
  await comments.flush();
  assert.equal(store.state.comments.pending.length, 0);
  assert.deepEqual(server.log.events.map(e => e.comment), ['1回目', '2回目', '3回目']);
});

test('corrupt comment log is not overwritten and remains queued', async () => {
  for (const invalidJSON of [true, false]) {
    const { comments, server, errors } = setup({ unexpected: 'keep' });
    server.invalidJSON = invalidJSON;
    comments.record(source, '変更');
    await comments.flush();
    assert.match(errors.at(-1), /comment_log.json.*上書きせず/);
    assert.equal(comments.pendingCount(), 1);
    assert.equal(server.requests.filter(r => r.options.method).length, 0);
    assert.deepEqual(server.log, { unexpected: 'keep' });
  }
});

test('comment scopes isolate demo and changed folders; failed local writes roll back, including sent queue persistence', async () => {
  const { comments, server, store, storage, errors, values } = setup();
  comments.record(source, '本番');
  const demo = createComments(store, {}, { demo: true });
  demo.record(source, 'デモ');
  store.clearReading();
  await demo.flush();
  assert.equal(demo.paper(source, '2099-01-01').comment, 'デモ');
  assert.equal(demo.pendingCount(), 0);
  assert.equal(comments.paper(source, '').comment, '本番');
  store.state.settings.path = 'different/survey';
  assert.equal(comments.paper(source, ''), source);
  await comments.flush();
  assert.match(errors.at(-1), /道筋/);
  assert.equal(server.requests.length, 0);
  store.state.settings.path = surveyPath;
  store.state.folders = savedSession().folders;
  const save = storage.setItem;
  storage.setItem = () => { throw new Error('full'); };
  assert.equal(comments.record(source, '失敗'), false);
  assert.equal(comments.paper(source, '').comment, '本番');
  assert.equal(comments.pendingCount(), 1);
  await comments.flush();
  assert.equal(comments.pendingCount(), 1);
  assert.match(errors.at(-1), /送信済み.*端末に保存できません/);
  storage.setItem = save;
  await comments.flush();
  assert.equal(comments.pendingCount(), 0);
  assert.equal(server.log.events.length, 1);
  assert.deepEqual([...values.keys()], [STORAGE_KEY]);
});
