import assert from 'node:assert/strict';

export function feedDrive(library = { papers: [] }) {
  const server = { library, log: null, readingLog: null, pdfs: new Map(), requests: [], uploadFailure: null, logFailure: null, logReadFailure: null, invalidJSON: false, lostResponse: false, beforeWrite: null };
  const response = (value, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => structuredClone(value) });
  let uploadName;
  server.fetcher = async function (input, options = {}) {
    if (this !== undefined) throw new TypeError('fetch must be called without this');
    const url = new URL(input);
    server.requests.push({ url, options });
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(options.cache, 'no-store');
    assert.match(options.headers.Authorization, /^Bearer /);
    if (!options.method) {
      if (url.searchParams.has('q')) {
        assert.equal(url.pathname, '/drive/v3/files');
        const query = url.searchParams.get('q');
        assert.match(query, / in parents and trashed = false and name = '/);
        if (query.startsWith("'reader-id'")) {
          if (query.endsWith("name = 'papers.json'")) return response({ files: [{ id: 'papers-id' }] });
          if (query.endsWith("name = 'feed_log.json'")) {
            if (server.logReadFailure) return response({}, server.logReadFailure);
            return response({ files: server.log === null ? [] : [{ id: 'feed-log-id' }] });
          }
          assert.ok(query.endsWith("name = 'reading_log.json'"));
          return response({ files: server.readingLog === null ? [] : [{ id: 'reading-log-id' }] });
        }
        assert.ok(query.startsWith("'survey-id'"));
        const name = query.match(/name = '((?:\\.|[^'])*)'$/)[1].replace(/\\(.)/g, '$1');
        return response({ files: server.pdfs.has(name) ? [{ id: server.pdfs.get(name) }, { id: 'ignored-duplicate' }] : [] });
      }
      assert.equal(url.searchParams.get('alt'), 'media');
      if (url.pathname === '/drive/v3/files/papers-id') return response(server.library);
      assert.ok(['/drive/v3/files/feed-log-id', '/drive/v3/files/reading-log-id'].includes(url.pathname));
      if (server.invalidJSON) return { ok: true, json: async () => { throw new SyntaxError('bad JSON'); } };
      return response(url.pathname.endsWith('/feed-log-id') ? server.log : server.readingLog);
    }
    await server.beforeWrite?.(url, options);
    if (url.searchParams.get('uploadType') === 'resumable') {
      assert.equal(url.pathname, '/upload/drive/v3/files');
      if (server.uploadFailure instanceof Error) throw server.uploadFailure;
      if (server.uploadFailure) return response({}, server.uploadFailure);
      if (options.method === 'POST') {
        const metadata = JSON.parse(options.body);
        assert.deepEqual(Object.keys(metadata).sort(), ['mimeType', 'name', 'parents']);
        assert.deepEqual(metadata.parents, ['survey-id']);
        assert.equal(metadata.mimeType, 'application/pdf');
        assert.equal(server.pdfs.has(metadata.name), false, 'existing PDFs must never be overwritten');
        uploadName = metadata.name;
        return response({}, 200, { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session' });
      }
      assert.equal(options.method, 'PUT');
      assert.equal(url.searchParams.get('upload_id'), 'session');
      assert.equal(await options.body.slice(0, 5).text(), '%PDF-');
      server.pdfs.set(uploadName, 'uploaded-id');
      return response({ id: 'uploaded-id' });
    }
    if (server.logFailure instanceof Error) throw server.logFailure;
    if (server.logFailure) return response({}, server.logFailure);
    let name, log;
    if (options.method === 'POST') {
      assert.equal(url.href, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
      const boundary = options.headers['Content-Type'].split('boundary=')[1];
      const parts = options.body.split(`--${boundary}`);
      const parse = part => JSON.parse(part.split('\r\n\r\n')[1].trim());
      const metadata = parse(parts[1]);
      assert.ok(['feed_log.json', 'reading_log.json'].includes(metadata.name));
      assert.deepEqual(metadata, { name: metadata.name, parents: ['reader-id'], mimeType: 'application/json' });
      name = metadata.name; log = parse(parts[2]);
    } else {
      assert.equal(options.method, 'PATCH', 'no other writes are permitted');
      assert.equal(url.searchParams.get('uploadType'), 'media');
      assert.ok(['/upload/drive/v3/files/feed-log-id', '/upload/drive/v3/files/reading-log-id'].includes(url.pathname));
      name = url.pathname.endsWith('/feed-log-id') ? 'feed_log.json' : 'reading_log.json';
      log = JSON.parse(options.body);
    }
    if (name === 'feed_log.json') server.log = log; else server.readingLog = log;
    if (server.lostResponse) { server.lostResponse = false; throw new TypeError('response lost'); }
    return response({});
  };
  return server;
}
