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
    const response = await this.fetcher(url.href, { headers: this.headers(), cache: 'no-store', signal });
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
