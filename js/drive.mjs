import { validSession } from './login.mjs';
import { validatePdf, validFeedEvent, sameFeedEvent } from './feed.mjs';

export function escapeDriveValue(value) { return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
export function searchQuery(parent, name, folder = false) {
  return `'${escapeDriveValue(parent)}' in parents and trashed = false and name = '${escapeDriveValue(name)}'${folder ? " and mimeType = 'application/vnd.google-apps.folder'" : ''}`;
}
export class DriveError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class Drive {
  constructor(store, onExpired, fetcher = fetch) { this.store = store; this.onExpired = onExpired; this.fetcher = fetcher; this.uploads = new Map(); }
  headers() {
    if (!validSession(this.store.state.session)) { this.onExpired(); throw new DriveError(401, 'もう一度ログインしてください。'); }
    return { Authorization: `Bearer ${this.store.state.session.accessToken}` };
  }
  async request(path, params = {}, signal) {
    const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    url.search = new URLSearchParams(params).toString();
    const fetcher = this.fetcher;
    const response = await fetcher(url.href, { headers: this.headers(), cache: 'no-store', signal });
    if (response.status === 401) this.onExpired();
    if (!response.ok) throw new DriveError(response.status, `Drive の読み込みに失敗しました（${response.status}）。`);
    return response.json();
  }
  async find(parent, name, folder = false, signal) {
    const result = await this.request('files', { q: searchQuery(parent, name, folder), fields: 'files(id,name)', pageSize: '1' }, signal);
    return result.files?.[0]?.id || null;
  }
  async folders(signal) {
    const path = this.store.state.settings.path;
    const cached = this.store.state.folders[path];
    if (cached?.survey && cached?.reader) return cached;
    let parent = 'root';
    for (const name of path.split('/').map(s => s.trim()).filter(Boolean)) {
      parent = await this.find(parent, name, true, signal);
      if (!parent) throw new DriveError(404, 'survey フォルダが見つかりません。');
    }
    const reader = await this.find(parent, '_reader', true, signal);
    if (!reader) throw new DriveError(404, '_reader フォルダが見つかりません。');
    const ids = { survey: parent, reader };
    this.store.state.folders[path] = ids;
    this.store.save();
    return ids;
  }
  async library(signal) {
    const ids = await this.folders(signal);
    const id = await this.find(ids.reader, 'papers.json', false, signal);
    if (!id) throw new DriveError(404, 'papers.json が見つかりません。');
    return this.request(`files/${encodeURIComponent(id)}`, { alt: 'media' }, signal);
  }
  async appendReading(event) {
    if (!event?.id || !['未読', '読了'].includes(event.read_status) || !Number.isFinite(Date.parse(event.at)) || !event.at.endsWith('+09:00')) {
      throw new Error('読了の記録の形式を確認してください。');
    }
    return this.appendLog('reading_log.json', { id: event.id, read_status: event.read_status, at: event.at },
      row => row?.id === event.id && row.read_status === event.read_status && row.at === event.at);
  }
  async appendFeed(event) {
    if (!validFeedEvent(event)) throw new Error('フィードの記録の形式を確認してください。');
    const row = { key: event.key, action: event.action, at: event.at };
    if (event.action === 'pdf') Object.assign(row, { name: event.name, drive_id: event.drive_id });
    return this.appendLog('feed_log.json', row, existing => sameFeedEvent(existing, row));
  }
  async feedLog(signal) {
    const { reader } = await this.folders(signal);
    const id = await this.find(reader, 'feed_log.json', false, signal);
    if (!id) return [];
    const log = await this.request(`files/${encodeURIComponent(id)}`, { alt: 'media' }, signal);
    if (!log || !Array.isArray(log.events) || !log.events.every(validFeedEvent)) throw new Error('feed_log.json の記録を読めません。');
    return log.events;
  }
  async appendLog(name, event, matches) {
    if (!['reading_log.json', 'feed_log.json'].includes(name)) throw new Error('書き込めないファイルです。');
    const { reader } = await this.folders();
    const id = await this.find(reader, name);
    let log = { events: [] };
    if (id) {
      try { log = await this.request(`files/${encodeURIComponent(id)}`, { alt: 'media' }); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new Error(`${name} が壊れているため、上書きせず送信を止めました。`);
      }
      if (!log || !Array.isArray(log.events) || (name === 'feed_log.json' && !log.events.every(validFeedEvent))) throw new Error(`${name} の events を読めないため、上書きせず送信を止めました。`);
      // A write may have succeeded even when its response was lost.
      if (log.events.some(matches)) return;
    }
    log.events.push(event);
    let body = JSON.stringify(log);
    let contentType = 'application/json';
    if (!id) {
      const boundary = `paper_reader_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const metadata = { name, parents: [reader], mimeType: 'application/json' };
      body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--\r\n`;
      contentType = `multipart/related; boundary=${boundary}`;
    }
    const url = id ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const fetcher = this.fetcher;
    const response = await fetcher(url, { method: id ? 'PATCH' : 'POST', headers: { ...this.headers(), 'Content-Type': contentType }, body, cache: 'no-store' });
    if (response.status === 401) this.onExpired();
    if (!response.ok) throw new DriveError(response.status, `記録を送信できませんでした（${response.status}）。`);
  }
  async putFeedPdf(item, file) {
    await validatePdf(file);
    if (typeof item.pdf_name !== 'string' || !item.pdf_name.trim()) throw new Error('PDF の保存名がありません。');
    const key = JSON.stringify([this.store.state.settings.path, item.pdf_name]);
    if (!this.uploads.has(key)) {
      const upload = this.uploadFeedPdf(item.pdf_name, file).finally(() => this.uploads.delete(key));
      this.uploads.set(key, upload);
    }
    return this.uploads.get(key);
  }
  async uploadFeedPdf(name, file) {
    const { survey } = await this.folders();
    const existing = await this.find(survey, name);
    if (existing) return { name, drive_id: existing };
    const fetcher = this.fetcher;
    const check = response => {
      if (response.status === 401) this.onExpired();
      if (!response.ok) throw new DriveError(response.status, 'アップロードできませんでした');
    };
    const response = await fetcher('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/pdf', 'X-Upload-Content-Length': String(file.size) },
      body: JSON.stringify({ name, parents: [survey], mimeType: 'application/pdf' }), cache: 'no-store',
    });
    check(response);
    const location = new URL(response.headers.get('Location'));
    if (location.origin !== 'https://www.googleapis.com' || location.pathname !== '/upload/drive/v3/files' || location.searchParams.get('uploadType') !== 'resumable') {
      throw new Error('アップロード先を確認できませんでした。');
    }
    const uploaded = await fetcher(location.href, {
      method: 'PUT', headers: { ...this.headers(), 'Content-Type': 'application/pdf' }, body: file, cache: 'no-store',
    });
    check(uploaded);
    const result = await uploaded.json();
    if (!result?.id || typeof result.id !== 'string') throw new Error('アップロードした PDF を確認できませんでした。');
    return { name, drive_id: result.id };
  }
  async pdfId(paper, signal) {
    if (!paper.pdf) return null;
    if (paper.pdf.drive_id) return paper.pdf.drive_id;
    const ids = await this.folders(signal);
    return this.find(ids.survey, paper.pdf.name, false, signal);
  }
  pdfSource(id) {
    return { url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, headers: this.headers() };
  }
}
