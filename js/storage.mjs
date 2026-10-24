import { DEFAULT_PATH, clamp } from './core.mjs';

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
  };
  return {
    state,
    save() {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
      catch { onError('端末に保存できません。ページやログイン状態は、閉じると失われます。'); return false; }
    },
    clearReading() { state.folders = {}; state.pages = {}; state.panelWidth = 50; this.save(); },
    page(id) { return Math.max(1, Math.floor(Number(state.pages[id]) || 1)); },
    setPage(id, page) { if (state.pages[id] !== page) { state.pages[id] = page; this.save(); } },
  };
}
