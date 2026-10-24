import { validSession } from './login.mjs';

export function escapeDriveValue(value) { return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
export function searchQuery(parent, name, folder = false) {
  return `'${escapeDriveValue(parent)}' in parents and trashed = false and name = '${escapeDriveValue(name)}'${folder ? " and mimeType = 'application/vnd.google-apps.folder'" : ''}`;
}
export class DriveError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class Drive {
  constructor(store, onExpired, fetcher = fetch) { this.store = store; this.onExpired = onExpired; this.fetcher = fetcher; }
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
    const { reader } = await this.folders();
    const id = await this.find(reader, 'reading_log.json');
    let log = { events: [] };
    if (id) {
      try { log = await this.request(`files/${encodeURIComponent(id)}`, { alt: 'media' }); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new Error('reading_log.json が壊れているため、上書きせず送信を止めました。');
      }
      if (!log || !Array.isArray(log.events)) throw new Error('reading_log.json の events を読めないため、上書きせず送信を止めました。');
      // A write may have succeeded even when its response was lost.
      if (log.events.some(row => row?.id === event.id && row.read_status === event.read_status && row.at === event.at)) return;
    }
    log.events.push({ id: event.id, read_status: event.read_status, at: event.at });
    let body = JSON.stringify(log);
    let contentType = 'application/json';
    if (!id) {
      const boundary = `paper_reader_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const metadata = { name: 'reading_log.json', parents: [reader], mimeType: 'application/json' };
      body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--\r\n`;
      contentType = `multipart/related; boundary=${boundary}`;
    }
    const url = id ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const fetcher = this.fetcher;
    const response = await fetcher(url, { method: id ? 'PATCH' : 'POST', headers: { ...this.headers(), 'Content-Type': contentType }, body, cache: 'no-store' });
    if (response.status === 401) this.onExpired();
    if (!response.ok) throw new DriveError(response.status, `読了の記録を送信できませんでした（${response.status}）。`);
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
