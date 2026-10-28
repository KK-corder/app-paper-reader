import { DEFAULT_PATH, clamp, normalizeFilters } from './core.mjs';

export const STORAGE_KEY = 'paper-reader-v1';
export function createStore(storage, onError = () => {}) {
  let saved;
  try { saved = JSON.parse(storage.getItem(STORAGE_KEY) || '{}'); } catch { saved = {}; }
  if (!saved || typeof saved !== 'object') saved = {};
  const state = {
    session: saved.session || null,
    pendingLogin: saved.pendingLogin || null,
    settings: { method: saved.settings?.method === 'popup' ? 'popup' : 'redirect', path: typeof saved.settings?.path === 'string' && saved.settings.path.trim() ? saved.settings.path : DEFAULT_PATH },
    folders: saved.folders && typeof saved.folders === 'object' ? saved.folders : {},
    pages: saved.pages && typeof saved.pages === 'object' ? saved.pages : {},
    panelWidth: clamp(Number(saved.panelWidth) || 50, 25, 75),
    filters: normalizeFilters(saved.filters),
    reading: {
      pending: Array.isArray(saved.reading?.pending) ? saved.reading.pending : [],
      overrides: saved.reading?.overrides && typeof saved.reading.overrides === 'object' ? saved.reading.overrides : {},
      lastAt: Number(saved.reading?.lastAt) || 0,
    },
    feed: {
      pending: Array.isArray(saved.feed?.pending) ? saved.feed.pending : [],
      overrides: saved.feed?.overrides && typeof saved.feed.overrides === 'object' ? saved.feed.overrides : {},
      demoEvents: Array.isArray(saved.feed?.demoEvents) ? saved.feed.demoEvents : [],
      lastAt: Number(saved.feed?.lastAt) || 0,
    },
  };
  return {
    state,
    save() {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
      catch { onError('端末に保存できません。読了の記録・ページ・ログイン状態は、閉じると失われます。'); return false; }
    },
    clearReading() { state.folders = {}; state.pages = {}; state.panelWidth = 50; this.save(); },
    page(id) { return Math.max(1, Math.floor(Number(state.pages[id]) || 1)); },
    setPage(id, page) { if (state.pages[id] !== page) { state.pages[id] = page; this.save(); } },
  };
}
