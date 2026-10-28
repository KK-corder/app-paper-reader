const DAY = 24 * 3600_000;
const string = value => typeof value === 'string' ? value : '';
export const japanTimestamp = time => new Date(time + 9 * 3600_000).toISOString().replace('Z', '+09:00');
export const japanDay = (time = Date.now()) => japanTimestamp(time).slice(0, 10);

export function normalizeFeed(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && string(item.key)).map(item => ({
    ...Object.fromEntries(['key', 'served', 'title', 'authors', 'venue', 'doi', 'url', 'oa_pdf', 'abstract', 'ja', 'why', 'pdf_name'].map(key => [key, string(item[key])])),
    year: Number.isFinite(item.year) ? item.year : null,
    pdf: item.pdf && string(item.pdf.name).trim() ? { name: item.pdf.name, drive_id: string(item.pdf.drive_id) || null } : null,
    skipped: item.skipped === true,
    notion_id: string(item.notion_id) || null,
  })).sort((a, b) => b.served.localeCompare(a.served));
}

export function demoFeedDates(data, time = Date.now()) {
  return { ...data, feed: (data.feed || []).map((item, index) => ({ ...item, served: japanDay(time - index * DAY) })) };
}

export function validFeedEvent(event) {
  return !!(event && string(event.key) && ['pdf', 'skip', 'unskip'].includes(event.action)
    && string(event.at).endsWith('+09:00') && Number.isFinite(Date.parse(event.at))
    && (event.action !== 'pdf' || (string(event.name) && string(event.drive_id))));
}
export function sameFeedEvent(a, b) {
  return a?.key === b?.key && a?.action === b?.action && a?.at === b?.at
    && (a.action !== 'pdf' || (a.name === b.name && a.drive_id === b.drive_id));
}
export function pdfDays(events, time = Date.now()) {
  const today = japanDay(time);
  const first = japanDay(time - 6 * DAY);
  return new Set(events.filter(event => event?.action === 'pdf' && Number.isFinite(Date.parse(event.at)))
    .map(event => japanDay(Date.parse(event.at))).filter(day => day >= first && day <= today)).size;
}
export async function validatePdf(file) {
  if (!file || new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== '%PDF-') {
    throw new Error('PDF ではないようです');
  }
}
export function doiURL(doi) {
  return doi ? `https://doi.org/${encodeURI(doi).replace(/[?#]/g, encodeURIComponent)}` : '';
}
export function acquisitionURL(item, baseURL) {
  const candidate = item.oa_pdf || doiURL(item.doi) || item.url;
  if (!candidate) return '';
  try { const url = new URL(candidate, baseURL); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}
export function manualUploadMessage(name) {
  return `アプリから survey に入れられませんでした。iPhone の『ファイル』で、ダウンロードした PDF を Google ドライブの survey フォルダへ『${name}』の名前で移してください`;
}
export function feedPaper(item) {
  return {
    id: `feed:${item.key}`, feedKey: item.key, title: item.title, authors: item.authors, venue: item.venue, year: item.year, doi: item.doi, pdf: item.pdf,
    summary: [['これは何の論文か', item.ja], ['あなたにとっての意味', item.why], ['アブストラクト', item.abstract]]
      .filter(([, text]) => text).map(([heading, text]) => ({ heading, text })),
  };
}

export function createFeed(store, drive, { demo = false, onChange = () => {}, onError = () => {}, now = Date.now } = {}) {
  const state = store.state.feed;
  const remote = new Map();
  let running;
  const scope = () => demo ? 'demo' : store.state.settings.path;
  const key = id => JSON.stringify([scope(), id]);
  function mergeRemote(events, path = scope()) {
    const combined = [...(remote.get(path) || [])];
    for (const event of events) if (validFeedEvent(event) && !combined.some(row => sameFeedEvent(row, event))) combined.push(event);
    remote.set(path, combined);
  }
  function record(id, action, pdf) {
    const time = Math.max(now(), state.lastAt + 1);
    const event = { key: id, action, at: japanTimestamp(time), ...(action === 'pdf' ? { name: pdf?.name, drive_id: pdf?.drive_id } : {}) };
    if (!validFeedEvent(event)) return false;
    const previous = state.overrides[key(id)];
    state.overrides[key(id)] = { ...previous, skipped: event, ...(action === 'pdf' ? { pdf: event } : {}) };
    state.lastAt = time;
    if (demo) state.demoEvents.push(event);
    else state.pending.push({ path: scope(), event });
    if (!store.save()) {
      if (previous) state.overrides[key(id)] = previous; else delete state.overrides[key(id)];
      if (demo) state.demoEvents.pop(); else state.pending.pop();
      onError('端末に記録を保存できませんでした。もう一度お試しください。');
      return false;
    }
    onChange();
    return true;
  }
  function item(source, generated) {
    const overrides = state.overrides[key(source.key)];
    if (!overrides) return source;
    let result = source;
    let changed = false;
    for (const field of ['pdf', 'skipped']) {
      const event = overrides[field];
      if (!event) continue;
      const pending = state.pending.some(entry => entry.path === scope() && sameFeedEvent(entry.event, event));
      const caughtUp = field === 'pdf' ? !!source.pdf : source.skipped === (event.action === 'skip');
      const expired = Date.parse(generated) - Date.parse(event.at) >= DAY;
      if (!demo && !pending && (caughtUp || expired)) { delete overrides[field]; changed = true; }
      else result = { ...result, [field]: field === 'pdf' ? { name: event.name, drive_id: event.drive_id } : event.action === 'skip' };
    }
    if (changed) {
      if (!Object.keys(overrides).length) delete state.overrides[key(source.key)];
      store.save();
    }
    return result;
  }
  async function send() {
    onError('');
    while (state.pending.length) {
      const entry = state.pending[0];
      if (entry.path !== store.state.settings.path) {
        onError('未送信の記録を送るには、設定の survey フォルダの道筋を記録時のものに戻してください。');
        break;
      }
      try {
        await drive.appendFeed(entry.event);
        mergeRemote([entry.event], entry.path);
        state.pending.shift();
        if (!store.save()) {
          state.pending.unshift(entry);
          throw new Error('送信済みの記録を端末に保存できません。次回、ドライブの記録を確認して再試行します。');
        }
        onChange();
      } catch (error) {
        onError(error.status === 401 ? 'フィードの記録は端末に残っています。もう一度ログインしてください。'
          : error.status === 403 ? 'フィードの記録は端末に残っています。もう一度ログインして書き込みを許可してください。'
          : error.message || 'フィードの記録を送信できません。通信が戻ったときに再試行します。', error);
        break;
      }
    }
  }
  function flush() {
    if (demo || (!state.pending.length && !running)) return Promise.resolve();
    if (!running) running = send().finally(() => { running = null; });
    return running;
  }
  return {
    record, item, flush, mergeRemote,
    pendingCount: () => demo ? 0 : state.pending.length,
    days: () => pdfDays(demo ? state.demoEvents : [...(remote.get(scope()) || []), ...state.pending.filter(entry => entry.path === scope()).map(entry => entry.event)], now()),
  };
}
