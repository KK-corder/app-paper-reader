import assert from 'node:assert/strict';

export const surveyPath = 'University/01_reaserch/survey';
export function savedSession(extra = {}) {
  return {
    session: { accessToken: 'sample', expiresAt: Date.now() + 60_000 },
    folders: { [surveyPath]: { survey: 'survey-id', reader: 'reader-id' } },
    ...extra,
  };
}

export function readingDrive(library = { papers: [], generated: '' }, initialLog = null) {
  const server = { log: initialLog, requests: [], failure: null, beforeWrite: null, lostResponse: false, invalidJSON: false };
  server.fetcher = async function (input, options) {
    if (this !== undefined) throw new TypeError('fetch must be called without this');
    const url = new URL(input);
    server.requests.push({ url, options });
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(options.cache, 'no-store');
    assert.match(options.headers.Authorization, /^Bearer /);
    if (options.method) {
      await server.beforeWrite?.();
      if (server.failure instanceof Error) throw server.failure;
      if (server.failure) return { ok: false, status: server.failure };
      if (options.method === 'POST') {
        assert.equal(url.href, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
        assert.equal(server.log, null);
        const boundary = options.headers['Content-Type'].split('boundary=')[1];
        assert.match(options.headers['Content-Type'], /^multipart\/related;/);
        const parts = options.body.split(`--${boundary}`);
        const parse = part => JSON.parse(part.split('\r\n\r\n')[1].trim());
        assert.deepEqual(parse(parts[1]), { name: 'reading_log.json', parents: ['reader-id'], mimeType: 'application/json' });
        server.log = parse(parts[2]);
      } else {
        assert.equal(options.method, 'PATCH', 'only the permitted two write operations may be used');
        assert.equal(url.href, 'https://www.googleapis.com/upload/drive/v3/files/log-id?uploadType=media');
        assert.equal(options.headers['Content-Type'], 'application/json');
        server.log = JSON.parse(options.body);
      }
      if (server.lostResponse) { server.lostResponse = false; throw new TypeError('response lost'); }
      return { ok: true, status: 200 };
    }
    assert.ok(url.pathname.startsWith('/drive/v3/files'));
    let result;
    if (url.searchParams.has('q')) {
      const q = url.searchParams.get('q');
      assert.match(q, /^'reader-id' in parents and trashed = false and name = '/);
      if (q.endsWith("name = 'reading_log.json'")) result = { files: server.log === null ? [] : [{ id: 'log-id' }] };
      else { assert.ok(q.endsWith("name = 'papers.json'")); result = { files: [{ id: 'papers-id' }] }; }
    } else {
      assert.equal(url.searchParams.get('alt'), 'media');
      assert.ok(['/drive/v3/files/log-id', '/drive/v3/files/papers-id'].includes(url.pathname));
      result = url.pathname.endsWith('log-id') ? server.log : library;
    }
    return { ok: true, status: 200, json: async () => {
      if (server.invalidJSON && url.pathname.endsWith('log-id')) throw new SyntaxError('invalid JSON');
      return structuredClone(result);
    } };
  };
  return server;
}
