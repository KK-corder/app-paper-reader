import test from 'node:test';
import assert from 'node:assert/strict';
import { Drive } from '../js/drive.mjs';
import { createStore, STORAGE_KEY } from '../js/storage.mjs';
import { normalizeLibrary } from '../js/core.mjs';
import { acquisitionURL, createFeed, demoFeedDates, japanDay, pdfDays } from '../js/feed.mjs';
import { feedDrive } from './support/feed-drive.mjs';
import { savedSession, surveyPath } from './support/reading-drive.mjs';

const now = Date.parse('2026-10-28T08:00:00+09:00');
const pdf = new Blob(['%PDF-1.7\nfictional bytes'], { type: 'application/pdf' });
const item = { key: 'fictional', pdf_name: "fictional author's\\paper.pdf", skipped: false, pdf: null };
const pdfEvent = (at, key = 'fictional') => ({ key, action: 'pdf', at, name: item.pdf_name, drive_id: 'uploaded-id' });
function setup(server = feedDrive(), options = {}) {
  const values = new Map([[STORAGE_KEY, JSON.stringify(savedSession())]]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = createStore(storage);
  const errors = [];
  let expired = 0;
  const drive = new Drive(store, () => expired++, server.fetcher);
  const feed = createFeed(store, drive, { now: () => now, onError: message => errors.push(message), ...options });
  return { store, storage, values, drive, feed, server, errors, expired: () => expired };
}
const writes = server => server.requests.filter(r => r.options.method);

test('resumable POST metadata and PUT send the exact selected Blob; repeat and concurrent calls reuse an existing direct-child PDF', async () => {
  const { drive, server } = setup();
  const results = await Promise.all([drive.putFeedPdf(item, pdf), drive.putFeedPdf(item, pdf)]);
  assert.deepEqual(results, [{ name: item.pdf_name, drive_id: 'uploaded-id' }, { name: item.pdf_name, drive_id: 'uploaded-id' }]);
  const sent = writes(server);
  assert.equal(sent.length, 2);
  assert.deepEqual(JSON.parse(sent[0].options.body), { name: item.pdf_name, parents: ['survey-id'], mimeType: 'application/pdf' });
  assert.equal(sent[0].options.headers['X-Upload-Content-Length'], String(pdf.size));
  assert.equal(sent[1].options.body, pdf);
  assert.equal(sent[1].options.method, 'PUT');
  assert.equal((await drive.putFeedPdf(item, pdf)).drive_id, 'uploaded-id');
  assert.equal(writes(server).length, 2);
  assert.match(server.requests[0].url.searchParams.get('q'), /^'survey-id' in parents and trashed = false/);
});

test('existing same-name PDFs return the first ID with no upload, and invalid signatures send no request', async () => {
  const { drive, server } = setup();
  server.pdfs.set(item.pdf_name, 'existing-id');
  assert.equal((await drive.putFeedPdf(item, pdf)).drive_id, 'existing-id');
  assert.equal(writes(server).length, 0);
  server.requests.length = 0;
  for (const file of [new Blob(['fake'], { type: 'application/pdf' }), new Blob([' %PDF-']), new Blob([])]) {
    await assert.rejects(drive.putFeedPdf(item, file), /PDF ではないようです/);
  }
  await assert.rejects(drive.putFeedPdf({ ...item, pdf_name: '' }, pdf), /保存名/);
  assert.equal(server.requests.length, 0);
});

test('upload failures keep their status, session expiry is reported, and foreign resumable locations are never used', async () => {
  for (const status of [403, 404, 401]) {
    const { drive, server, expired } = setup();
    server.uploadFailure = status;
    await assert.rejects(drive.putFeedPdf(item, pdf), error => error.status === status);
    assert.equal(expired(), status === 401 ? 1 : 0);
    assert.equal(writes(server).length, 1);
  }
  const { drive, server } = setup();
  const fetcher = server.fetcher;
  drive.fetcher = async function (url, options) {
    assert.equal(this, undefined);
    const result = await fetcher(url, options);
    if (options.method === 'POST') result.headers.set('Location', 'https://example.invalid/upload');
    return result;
  };
  await assert.rejects(drive.putFeedPdf(item, pdf), /アップロード先/);
  assert.equal(writes(server).length, 1);
});

test('feed log creation then PATCH preserves all old rows and fields; retries do not duplicate successful writes', async () => {
  const { feed, drive, server } = setup();
  assert.deepEqual(await drive.feedLog(), []);
  feed.record(item.key, 'skip');
  await feed.flush();
  const first = structuredClone(server.log.events[0]);
  server.log.extra = { preserve: true };
  server.log.events[0].extra = 'preserve';
  feed.record(item.key, 'unskip');
  await feed.flush();
  assert.equal(server.log.events.length, 2);
  assert.deepEqual(server.log.events[0], { ...first, extra: 'preserve' });
  assert.deepEqual(server.log.extra, { preserve: true });
  assert.equal(writes(server)[1].url.pathname, '/upload/drive/v3/files/feed-log-id');
  assert.equal(writes(server)[1].options.method, 'PATCH');
  server.lostResponse = true;
  feed.record(item.key, 'pdf', { name: item.pdf_name, drive_id: 'uploaded-id' });
  await feed.flush();
  assert.equal(feed.pendingCount(), 1);
  await feed.flush();
  assert.equal(feed.pendingCount(), 0);
  assert.equal(server.log.events.length, 3);
  assert.equal(writes(server).length, 3);
  assert.deepEqual(await drive.feedLog(), server.log.events);
});

test('corrupt JSON, invalid events, or missing events are never overwritten', async () => {
  for (const log of [{ unexpected: 'keep' }, { events: [null] }, { events: 'bad' }, { events: [] }]) {
    const { server, feed, errors } = setup();
    server.log = structuredClone(log);
    server.invalidJSON = Array.isArray(log.events) && !log.events.length;
    feed.record('fictional', 'skip');
    await feed.flush();
    assert.equal(feed.pendingCount(), 1);
    assert.match(errors.at(-1), /feed_log.json.*上書きせず/);
    assert.equal(writes(server).length, 0);
    assert.deepEqual(server.log, log);
  }
});

test('failed appends persist across restart, serialize rapid taps, and flush after recovery without losing newer events', async () => {
  const { feed, server, storage, drive, store } = setup();
  server.logFailure = new TypeError('offline');
  feed.record(item.key, 'skip');
  feed.record(item.key, 'unskip');
  await feed.flush();
  const reloaded = createStore(storage);
  const resumed = createFeed(reloaded, drive, { now: () => now });
  assert.equal(resumed.pendingCount(), 2);
  server.logFailure = null;
  let once = false;
  server.beforeWrite = () => { if (!once) { once = true; resumed.record(item.key, 'pdf', { name: item.pdf_name, drive_id: 'uploaded-id' }); } };
  await Promise.all([resumed.flush(), resumed.flush()]);
  assert.deepEqual(server.log.events.map(e => e.action), ['skip', 'unskip', 'pdf']);
  assert.ok(server.log.events.every((e, i, all) => i === 0 || Date.parse(e.at) > Date.parse(all[i - 1].at)));
  assert.equal(resumed.pendingCount(), 0);
  assert.equal(createStore(storage).state.feed.pending.length, 0);
  assert.equal(resumed.days(), 1);
  assert.equal(store.state.reading.pending.length, 0);
});

test('PDF days use Japan dates, include today and six days before, and ignore duplicates, skips, older and future days', () => {
  assert.equal(japanDay(now), '2026-10-28');
  const events = [pdfEvent('2026-10-28T00:00:00+09:00'), pdfEvent('2026-10-28T08:00:00+09:00', 'other'), pdfEvent('2026-10-27T15:00:00Z'),
    pdfEvent('2026-10-22T00:00:00+09:00'), pdfEvent('2026-10-21T23:59:59+09:00'), pdfEvent('2026-10-20T12:00:00+09:00'),
    pdfEvent('2026-10-29T00:00:00+09:00'), { key: 'x', action: 'skip', at: '2026-10-27T08:00:00+09:00' }, pdfEvent('bad')];
  assert.equal(pdfDays(events, now), 2);
  const { feed } = setup();
  feed.mergeRemote(events);
  feed.record('new', 'pdf', { name: 'new.pdf', drive_id: 'new' });
  assert.equal(feed.days(), 2);
});

test('PDF and skip overrides survive until exports catch up or sent events reach the 24-hour export boundary', async () => {
  const { feed, store, storage } = setup();
  feed.record(item.key, 'pdf', { name: item.pdf_name, drive_id: 'uploaded-id' });
  await feed.flush();
  feed.record(item.key, 'skip');
  await feed.flush();
  const resumed = createFeed(createStore(storage), {}, { now: () => now });
  const stale = resumed.item(item, '2026-10-29T07:59:59+09:00');
  assert.equal(stale.pdf.drive_id, 'uploaded-id');
  assert.equal(stale.skipped, true);
  const matched = { ...item, pdf: stale.pdf, skipped: true };
  assert.deepEqual(resumed.item(matched, '2026-10-28T09:00:00+09:00'), matched);
  assert.deepEqual(createStore(storage).state.feed.overrides, {});
  // A fresh controller still has both overrides; verify expiry independently of matching.
  const original = createFeed(store, {}, { now: () => now });
  assert.equal(original.item(item, '2026-10-29T08:00:00.001+09:00'), item);
  assert.deepEqual(store.state.feed.overrides, {});
});

test('unsent overrides survive matching or two-day-newer exports and latest unskip wins intermediate skip', () => {
  const { feed, store } = setup();
  feed.record(item.key, 'skip');
  feed.record(item.key, 'unskip');
  feed.record(item.key, 'pdf', { name: item.pdf_name, drive_id: 'uploaded-id' });
  for (const skipped of [true, false]) {
    const overlaid = feed.item({ ...item, skipped }, '2026-10-30T08:00:00+09:00');
    assert.equal(overlaid.skipped, false);
    assert.equal(overlaid.pdf.drive_id, 'uploaded-id');
  }
  assert.equal(store.state.feed.pending.length, 3);
});

test('scope changes cannot send queued records elsewhere, demo is isolated, and local save failure rolls back', async () => {
  const { feed, store, storage, server, values } = setup();
  feed.record(item.key, 'skip');
  store.state.settings.path = 'other/survey';
  await feed.flush();
  assert.equal(server.requests.length, 0);
  assert.equal(feed.item(item, '').skipped, false);
  store.state.settings.path = surveyPath;
  const demo = createFeed(store, {}, { demo: true, now: () => now });
  demo.record(item.key, 'pdf', { name: item.pdf_name, drive_id: 'demo:fictional' });
  await demo.flush();
  assert.equal(demo.pendingCount(), 0);
  assert.equal(feed.pendingCount(), 1);
  assert.equal(demo.days(), 1);
  assert.equal(feed.days(), 0);
  store.clearReading();
  assert.equal(demo.item(item, '2099-01-01').pdf.drive_id, 'demo:fictional');
  assert.equal(feed.item(item, '').skipped, true);
  assert.deepEqual([...values.keys()], [STORAGE_KEY]);
  storage.setItem = () => { throw new Error('full'); };
  assert.equal(feed.record(item.key, 'unskip'), false);
  assert.equal(feed.item(item, '').skipped, true);
  assert.equal(feed.pendingCount(), 1);
});

test('optional feeds normalize safely, relative demo dates start today in Japan, and acquisition prefers OA then DOI then URL', () => {
  assert.deepEqual(normalizeLibrary({ papers: [] }).feed, []);
  assert.deepEqual(normalizeLibrary({ papers: [], feed: [null, {}] }).feed, []);
  const data = demoFeedDates({ feed: [{ key: 'a' }, { key: 'b' }] }, now);
  assert.deepEqual(data.feed.map(e => e.served), ['2026-10-28', '2026-10-27']);
  assert.equal(acquisitionURL({ oa_pdf: 'https://example.invalid/oa.pdf', doi: '10.0000/demo', url: 'https://example.invalid/' }), 'https://example.invalid/oa.pdf');
  assert.equal(acquisitionURL({ doi: '10.0000/demo?#' }), 'https://doi.org/10.0000/demo%3F%23');
  assert.equal(acquisitionURL({ url: 'https://example.invalid/' }), 'https://example.invalid/');
  assert.equal(acquisitionURL({ oa_pdf: 'javascript:alert(1)' }), '');
  assert.equal(acquisitionURL({}), '');
});
