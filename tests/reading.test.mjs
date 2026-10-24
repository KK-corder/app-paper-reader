import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY } from '../js/storage.mjs';
import { Drive } from '../js/drive.mjs';
import { createReading, WRITE_PERMISSION_MESSAGE } from '../js/reading.mjs';
import { readingDrive, savedSession, surveyPath } from './support/reading-drive.mjs';

function setup(server = readingDrive(), saved = savedSession()) {
  const values = new Map([[STORAGE_KEY, JSON.stringify(saved)]]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = createStore(storage);
  const drive = new Drive(store, () => { store.state.session = null; store.save(); }, server.fetcher);
  const errors = [];
  const reading = createReading(store, drive, { now: () => Date.parse('2026-10-24T20:00:00+09:00'), onError: message => errors.push(message) });
  return { store, storage, values, drive, reading, errors, server };
}

test('creates only reading_log.json as multipart and appends to the same ID preserving every previous row and extra field', async () => {
  const { reading, server, store } = setup();
  reading.record('paper', '読了');
  const first = structuredClone(store.state.reading.pending[0].event);
  assert.equal(first.at, '2026-10-24T20:00:00.000+09:00');
  await reading.flush();
  assert.deepEqual(server.log, { events: [first] });
  server.log.extra = 'preserve';
  reading.record('paper', '未読');
  const second = structuredClone(store.state.reading.pending[0].event);
  await reading.flush();
  assert.deepEqual(server.log, { events: [first, second], extra: 'preserve' });
  assert.equal(reading.pendingCount(), 0);
  assert.deepEqual(server.requests.filter(r => r.options.method).map(r => r.options.method), ['POST', 'PATCH']);
  const patchIndex = server.requests.findIndex(r => r.options.method === 'PATCH');
  assert.equal(server.requests[patchIndex - 1].url.href, 'https://www.googleapis.com/drive/v3/files/log-id?alt=media');
});

test('403, network errors and expired sessions retain queued records across restart and login; successes alone leave the queue', async () => {
  for (const failure of [403, 401, new TypeError('offline')]) {
    const { reading, store, storage, server, errors } = setup();
    server.failure = failure;
    reading.record('paper', '読了');
    await reading.flush();
    assert.equal(reading.pendingCount(), 1);
    if (failure === 403) assert.equal(errors.at(-1), WRITE_PERMISSION_MESSAGE);
    const reloaded = createStore(storage);
    assert.equal(reloaded.state.reading.pending.length, 1);
    reloaded.state.session = savedSession().session;
    server.failure = null;
    const resumed = createReading(reloaded, new Drive(reloaded, () => {}, server.fetcher));
    await resumed.flush();
    assert.equal(resumed.pendingCount(), 0);
    assert.equal(createStore(storage).state.reading.pending.length, 0);
    assert.deepEqual(server.log.events, [store.state.reading.pending[0].event]);
  }
  const { reading, store, server } = setup();
  store.state.session.expiresAt = 1;
  reading.record('paper', '読了');
  await reading.flush();
  assert.equal(reading.pendingCount(), 1);
  assert.equal(server.requests.length, 0);
});

test('serializes rapid taps and taps arriving during resend, with strictly increasing timestamps and no duplicate writes', async () => {
  const { reading, server, store } = setup();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  server.beforeWrite = () => gate;
  reading.record('paper', '読了');
  const sending = reading.flush();
  reading.record('paper', '未読');
  reading.record('paper', '読了');
  assert.equal(reading.flush(), sending);
  const expected = store.state.reading.pending.map(entry => entry.event);
  release();
  await sending;
  assert.deepEqual(server.log.events, expected);
  assert.equal(server.requests.filter(r => r.options.method).length, 3);
  assert.deepEqual(expected.map(e => e.read_status), ['読了', '未読', '読了']);
  assert.ok(expected.every((e, i) => !i || Date.parse(e.at) > Date.parse(expected[i - 1].at)));
  assert.equal(reading.pendingCount(), 0);
});

test('resend after a lost successful response finds the identical event instead of appending it twice', async () => {
  const { reading, server } = setup();
  server.lostResponse = true;
  reading.record('paper', '読了');
  await reading.flush();
  assert.equal(reading.pendingCount(), 1);
  assert.equal(server.log.events.length, 1);
  await reading.flush();
  assert.equal(reading.pendingCount(), 0);
  assert.equal(server.log.events.length, 1);
  assert.equal(server.requests.filter(r => r.options.method).length, 1);
});

test('a failure after the first success removes only that success and resumes the rest in order', async () => {
  const { reading, server, store, storage } = setup();
  let writes = 0;
  server.beforeWrite = () => { if (++writes === 2) server.failure = 403; };
  for (const status of ['読了', '未読', '読了']) reading.record('paper', status);
  const events = store.state.reading.pending.map(entry => entry.event);
  await reading.flush();
  assert.deepEqual(server.log.events, events.slice(0, 1));
  assert.deepEqual(createStore(storage).state.reading.pending.map(entry => entry.event), events.slice(1));
  server.failure = null;
  await reading.flush();
  assert.deepEqual(server.log.events, events);
  assert.equal(reading.pendingCount(), 0);
});

test('invalid JSON or missing events stops without overwriting any existing log', async () => {
  for (const invalidJSON of [true, false]) {
    const server = readingDrive(undefined, { unexpected: 'keep' });
    server.invalidJSON = invalidJSON;
    const { reading, errors } = setup(server);
    reading.record('paper', '読了');
    await reading.flush();
    assert.equal(reading.pendingCount(), 1);
    assert.match(errors.at(-1), /reading_log.json.*上書きせず/);
    assert.equal(server.requests.filter(r => r.options.method).length, 0);
    assert.deepEqual(server.log, { unexpected: 'keep' });
  }
});

test('local overrides apply only after generated; pruning them never drops unsent events or changes the source paper', () => {
  const { reading, store, storage, values } = setup();
  const paper = { id: 'paper', read_status: '未読' };
  store.setPage('paper', 7);
  reading.record('paper', '読了');
  assert.equal(reading.paper(paper, '2026-10-24T19:59:59+09:00').read_status, '読了');
  assert.equal(paper.read_status, '未読');
  const reloaded = createReading(createStore(storage), {});
  assert.equal(reloaded.paper(paper, '2026-10-24T19:59:59+09:00').read_status, '読了');
  assert.equal(reading.paper(paper, '2026-10-24T20:00:01+09:00').read_status, '未読');
  assert.deepEqual(store.state.reading.overrides, {});
  assert.equal(reading.pendingCount(), 1);
  assert.equal(createStore(storage).page('paper'), 7);
  assert.deepEqual([...values.keys()], [STORAGE_KEY]);
});

test('demo changes never send real pending records and cannot affect real overrides; clear-reading preserves both', async () => {
  const { reading, store, server } = setup();
  reading.record('paper', '読了');
  const demo = createReading(store, {}, { demo: true });
  demo.record('paper', '未読');
  store.clearReading();
  await demo.flush();
  assert.equal(server.requests.length, 0);
  assert.equal(reading.pendingCount(), 1);
  assert.equal(demo.pendingCount(), 0);
  const paper = { id: 'paper', read_status: '未読' };
  assert.equal(reading.paper(paper, '').read_status, '読了');
  assert.equal(demo.paper(paper, '2099-01-01T00:00:00+09:00').read_status, '未読');
});

test('changing the survey path cannot send queued records to a different folder; failed local saves do not submit a change', async () => {
  const { reading, store, storage, server, errors } = setup();
  reading.record('paper', '読了');
  store.state.settings.path = 'different/survey';
  await reading.flush();
  assert.equal(server.requests.length, 0);
  assert.match(errors.at(-1), /道筋/);
  store.state.settings.path = surveyPath;
  storage.setItem = () => { throw new Error('full'); };
  assert.equal(reading.record('paper', '未読'), false);
  assert.equal(reading.pendingCount(), 1);
  assert.equal(reading.paper({ id: 'paper' }, '').read_status, '読了');
});
