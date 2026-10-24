import { CLIENT_ID } from '../config.js';
import { clamp, errorMessage, normalizeLibrary, selectPapers } from './core.mjs';
import { createStore } from './storage.mjs';
import { consumeRedirect, DRIVE_SCOPE, loadGIS, redirectURL, validSession } from './login.mjs';
import { Drive } from './drive.mjs';
import { createReading } from './reading.mjs';
import { PdfViewer } from './pdf-viewer.mjs';

export function element(document, tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function renderInformation(document, paper, summary, details, clipboard) {
  const el = (tag, text, cls) => element(document, tag, text, cls);
  summary.replaceChildren();
  details.replaceChildren();
  if (!paper.summary.length) summary.append(el('p', '要約なし'));
  for (const section of paper.summary) {
    const block = el('section', undefined, 'summary-section');
    block.append(el('h2', section.heading), el('p', section.text));
    summary.append(block);
  }
  const dl = el('dl');
  let readStatusNode;
  const fields = [['題', paper.title], ['和題', paper.title_jp], ['著者', paper.authors], ['年', paper.year], ['会場', paper.venue], ['Type', paper.type], ['DOI', paper.doi], ['タグ', paper.tags.join('・')], ['Importance', paper.importance], ['Read Status', paper.read_status]];
  for (const [name, value] of fields) {
    const dd = el('dd');
    if (name === 'DOI' && value) {
      const link = el('a', value);
      link.href = `https://doi.org/${encodeURI(value).replace(/[?#]/g, encodeURIComponent)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      dd.append(link);
    } else dd.textContent = value === null || value === '' ? '—' : String(value);
    if (name === 'Read Status') readStatusNode = dd;
    dl.append(el('dt', name), dd);
  }
  dl.append(el('dt', 'BibTeX'));
  const bibtex = el('dd');
  bibtex.append(el('pre', paper.bibtex || '—'));
  const copy = el('button', 'BibTeX をコピー');
  copy.disabled = !paper.bibtex;
  const message = el('span', '', 'copy-message');
  message.setAttribute('role', 'status');
  copy.addEventListener('click', async () => {
    try { await clipboard.writeText(paper.bibtex); message.textContent = 'コピーしました'; }
    catch { message.textContent = 'コピーできませんでした。本文を選択してコピーしてください。'; }
  });
  bibtex.append(copy, message);
  dl.append(bibtex);
  details.append(dl);
  return readStatusNode;
}

export async function startApp({ window, document, fetcher = fetch, Viewer = PdfViewer, clientId = CLIENT_ID }) {
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => element(document, tag, text, cls);
  const demo = new URLSearchParams(window.location.search).get('demo') === '1';
  const notify = message => { $('notice').textContent = message; $('notice').hidden = !message; };
  let storage;
  try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error(); } }; }
  const store = createStore(storage, notify);
  let view = 'login';
  let previousView = 'login';
  let library = { papers: [], generated: '' };
  let activePaper = null;
  let readStatusNode;
  let epoch = 0;
  let listingController;
  let pdfController;
  let expiryTimer;
  let popupClient;
  let popupPreparing;
  let readingError = '';
  const pdfAvailability = new Map();
  const sessionGood = () => validSession(store.state.session);
  const pageKey = id => `${demo ? 'demo:' : ''}${id}`;

  function show(name) {
    view = name;
    for (const candidate of ['login', 'list', 'reader', 'settings']) $(`${candidate}-view`).hidden = candidate !== name;
    if (name === 'reader') viewer.schedule();
  }
  function loginUI(message = '') {
    $('login-message').textContent = !clientId ? 'config.js にクライアント ID を入れる' : message;
    $('login-button').disabled = !clientId;
  }
  function expired() {
    if (demo) return;
    store.state.session = null;
    store.save();
    clearTimeout(expiryTimer);
    $('session-banner').hidden = false;
    loginUI('もう一度ログインしてください。');
    if (view === 'list' || view === 'login') show('login');
    if (view === 'settings') settingsUI();
  }
  const drive = new Drive(store, expired, fetcher);
  const reading = createReading(store, drive, { demo,
    onChange: () => { drawList(); if (activePaper) drawReading(); readingUI(); },
    onError: (message, error) => {
      if (!message && $('notice').textContent === readingError) notify('');
      readingError = message;
      readingUI();
      if (message) notify(message);
      if (error?.status === 403 || error?.status === 401) $('session-banner').hidden = false;
    },
  });

  function readingUI() {
    const count = reading.pendingCount();
    $('reading-pending').textContent = count ? `未送信の記録: ${count} 件` : '';
    $('reading-error').textContent = readingError;
  }
  function drawReading() {
    const paper = reading.paper(activePaper, library.generated);
    $('read-toggle').textContent = paper.read_status === '読了' ? '未読に戻す' : '読了にする';
    if (readStatusNode) readStatusNode.textContent = paper.read_status || '—';
  }
  const viewer = new Viewer($('pdf-scroll'), $('pdf-pages'), {
    onPage: (page, total) => {
      $('page-counter').textContent = `${page} / ${total}`;
      $('zoom-label').textContent = `${Math.round(viewer.zoom * 100)}%`;
      if (activePaper) store.setPage(pageKey(activePaper.id), page);
    },
    onProgress: progress => {
      $('pdf-status').hidden = false;
      $('pdf-status').textContent = progress.retry ? '分割読み込みができないため、PDF 全体を読み直しています…' : `PDF を読み込み中… ${progress.total ? `${Math.min(100, Math.round(progress.loaded / progress.total * 100))}%` : progress.loaded ? `${(progress.loaded / 1048576).toFixed(1)} MB` : ''}`;
    },
    onReady: () => { $('pdf-status').hidden = true; },
    onError: error => {
      if (error.status === 401) expired();
      if (error.status === 404 && activePaper) { pdfAvailability.set(activePaper.id, null); drawList(); }
      $('pdf-status').textContent = error.status === 404 ? 'PDF なし（見つかりません）' : errorMessage(error);
      $('pdf-status').hidden = false;
    },
    fetcher,
  });

  function armExpiry() {
    clearTimeout(expiryTimer);
    if (!demo && sessionGood()) expiryTimer = setTimeout(expired, Math.min(2_147_483_647, store.state.session.expiresAt - Date.now() + 10));
  }
  async function loggedIn(session) {
    store.state.session = session;
    store.save();
    $('session-banner').hidden = true;
    armExpiry();
    const sending = reading.flush();
    if (activePaper && (view === 'reader' || (view === 'settings' && previousView === 'reader'))) {
      if (view === 'settings') settingsUI();
      notify('ログインしました。表示中の論文はそのまま読めます。');
      const id = pdfAvailability.get(activePaper.id);
      if (id) await viewer.open(drive.pdfSource(id), store.page(pageKey(activePaper.id)), false, true);
    } else await loadList();
    await sending;
  }
  async function preparePopup() {
    if (!clientId || demo || popupClient) return;
    if (popupPreparing) return popupPreparing;
    popupPreparing = loadGIS(document, window).then(oauth => {
      popupClient = oauth.initTokenClient({ client_id: clientId, scope: DRIVE_SCOPE,
        callback: response => {
          if (response.error || !response.access_token || !(Number(response.expires_in) > 0)) { notify('ログインできませんでした。設定から方式を変えて試してください。'); return; }
          return loggedIn({ accessToken: response.access_token, expiresAt: Date.now() + Number(response.expires_in) * 1000 });
        }, error_callback: () => notify('ログイン画面を開けないか、閉じられました。設定から方式を変えて試してください。'),
      });
    }).catch(error => notify(errorMessage(error))).finally(() => { popupPreparing = null; });
    return popupPreparing;
  }
  function login() {
    if (demo) return;
    if (!clientId) { loginUI(); notify('config.js にクライアント ID を入れる'); return; }
    if (store.state.settings.method === 'popup') {
      if (!popupClient) { preparePopup(); notify('ログインの準備中です。少し待ってからもう一度押してください。'); return; }
      popupClient.requestAccessToken();
    } else {
      const bytes = new Uint8Array(24);
      window.crypto.getRandomValues(bytes);
      const state = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      store.state.pendingLogin = { state, createdAt: Date.now(), paperId: activePaper?.id || null };
      if (!store.save()) return;
      window.location.assign(redirectURL(clientId, window.location.origin + window.location.pathname, state));
    }
  }

  function drawList() {
    const papers = selectPapers(library.papers.map(paper => reading.paper(paper, library.generated)), $('filter').value);
    $('paper-list').replaceChildren();
    $('count').textContent = `${papers.length} 本 / ${library.papers.length} 本`;
    $('generated').textContent = library.generated ? `書き出し: ${library.generated}` : '書き出し日時: —';
    if (!papers.length) $('paper-list').append(el('p', '該当する論文はありません。', 'muted'));
    for (const paper of papers) {
      const card = el('button', undefined, 'paper-card');
      card.append(el('h2', paper.title || '—'), el('p', paper.title_jp || '—', 'muted'));
      const meta = el('div', undefined, 'paper-meta');
      meta.append(el('span', `${paper.year ?? '—'} · ${paper.venue || '—'}`), el('span', paper.importance || '—', 'stars'), el('span', paper.read_status || '—'));
      if (!paper.pdf || pdfAvailability.get(paper.id) === null) meta.append(el('span', 'PDF なし', 'no-pdf'));
      card.append(meta);
      const tags = el('div', undefined, 'paper-tags');
      for (const tag of paper.tags) tags.append(el('span', tag, 'badge'));
      card.append(tags);
      card.addEventListener('click', () => openPaper(library.papers.find(item => item.id === paper.id)));
      $('paper-list').append(card);
    }
  }

  async function resolvePdf(paper, signal) {
    if (!paper.pdf) return null;
    if (pdfAvailability.has(paper.id)) return pdfAvailability.get(paper.id);
    let source;
    if (demo) {
      const url = new URL(`../demo/${encodeURIComponent(paper.pdf.name)}`, import.meta.url).href;
      const response = await fetcher(url, { method: 'HEAD', cache: 'no-store', signal });
      if (!response.ok && response.status !== 404) throw new Error(`PDF の確認に失敗しました（${response.status}）。`);
      source = response.ok ? url : null;
    } else source = await drive.pdfId(paper, signal);
    if (!signal.aborted) pdfAvailability.set(paper.id, source);
    return source;
  }

  async function loadList() {
    listingController?.abort();
    listingController = new AbortController();
    const { signal } = listingController;
    if (!demo && !sessionGood()) { expired(); return; }
    show('list');
    $('reload').disabled = true;
    $('list-message').textContent = '一覧を読み込み中…';
    try {
      let data;
      if (demo) {
        const response = await fetcher(new URL('../demo/papers.json', import.meta.url), { cache: 'no-store', signal });
        if (!response.ok) throw new Error('デモの一覧を読めません。');
        data = await response.json();
      } else data = await drive.library(signal);
      if (signal.aborted) return;
      library = normalizeLibrary(data);
      pdfAvailability.clear();
      drawList();
      $('list-message').textContent = 'PDF の有無を確認中…';
      // Bound requests while checking name-only PDFs in a library with many entries.
      let index = 0;
      const check = async () => {
        while (index < library.papers.length && !signal.aborted) {
          const paper = library.papers[index++];
          await resolvePdf(paper, signal);
          if (!signal.aborted) drawList();
        }
      };
      await Promise.all([check(), check(), check()]);
      if (!signal.aborted) $('list-message').textContent = '';
    } catch (error) {
      if (!signal.aborted) {
        if (error.status === 401) expired();
        $('list-message').textContent = errorMessage(error);
      }
    } finally { if (!signal.aborted) $('reload').disabled = false; }
  }

  function setTab(tab) {
    for (const name of ['summary', 'details']) {
      $(`${name}-tab`).setAttribute('aria-selected', String(name === tab));
      $(`${name}-tab`).tabIndex = name === tab ? 0 : -1;
      $(`${name}-content`).hidden = name !== tab;
    }
  }
  function setSheet(open) {
    $('reader-layout').classList.toggle('sheet-open', open);
    $('sheet-toggle').setAttribute('aria-expanded', String(open));
    $('sheet-toggle').textContent = open ? '情報を閉じる' : '情報を開く';
  }
  function setWidth(value) {
    store.state.panelWidth = clamp(value, 25, 75);
    $('reader-layout').style.setProperty('--pdf-width', `${store.state.panelWidth}%`);
    $('splitter').setAttribute('aria-valuenow', String(Math.round(store.state.panelWidth)));
  }

  async function openPaper(paper) {
    const request = ++epoch;
    pdfController?.abort();
    pdfController = new AbortController();
    const { signal } = pdfController;
    activePaper = paper;
    viewer.close();
    show('reader');
    setSheet(false);
    setTab('summary');
    setWidth(store.state.panelWidth);
    $('reader-title').textContent = paper.title || '—';
    $('page-counter').textContent = '— / —';
    $('zoom-label').textContent = '100%';
    readStatusNode = renderInformation(document, reading.paper(paper, library.generated), $('summary-content'), $('details-content'), window.navigator.clipboard);
    drawReading();
    $('summary-content').scrollTop = 0;
    $('details-content').scrollTop = 0;
    $('pdf-status').textContent = 'PDF を読み込み中…';
    $('pdf-status').hidden = false;
    try {
      const id = await resolvePdf(paper, signal);
      if (request !== epoch) return;
      if (!id) { $('pdf-status').textContent = 'PDF なし'; return; }
      const source = demo ? { url: id } : drive.pdfSource(id);
      await viewer.open(source, store.page(pageKey(paper.id)));
    } catch (error) {
      if (request === epoch && !signal.aborted) { $('pdf-status').textContent = errorMessage(error); $('pdf-status').hidden = false; }
    }
  }

  function settingsUI() {
    readingUI();
    $('login-state').textContent = demo ? 'デモ（ログイン不要）' : sessionGood() ? 'ログイン中' : 'ログインしていない';
    $('client-hint').textContent = !demo && !clientId ? 'config.js にクライアント ID を入れる' : '';
    $('settings-login').disabled = demo || !clientId;
    $('logout').disabled = demo || !store.state.session;
    $('login-method').value = store.state.settings.method;
    $('survey-path').value = store.state.settings.path;
    const ids = store.state.folders[store.state.settings.path];
    $('folder-ids').textContent = ids ? `使用中のフォルダ ID — survey: ${ids.survey} / _reader: ${ids.reader}` : 'フォルダ ID はまだ覚えていません。';
  }

  $('filter').addEventListener('input', drawList);
  $('read-toggle').addEventListener('click', () => {
    if (!activePaper) return;
    const paper = reading.paper(activePaper, library.generated);
    if (reading.record(paper.id, paper.read_status === '読了' ? '未読' : '読了')) return reading.flush();
  });
  $('reload').addEventListener('click', loadList);
  for (const id of ['login-button', 'settings-login', 'session-login']) $(id).addEventListener('click', login);
  for (const button of document.querySelectorAll('.open-settings')) button.addEventListener('click', () => { previousView = view; settingsUI(); $('settings-message').textContent = ''; show('settings'); });
  $('settings-back').addEventListener('click', () => { show(previousView); if (previousView === 'list') loadList(); });
  $('back-list').addEventListener('click', () => {
    epoch++;
    pdfController?.abort();
    viewer.close();
    activePaper = null;
    if (!demo && !sessionGood()) { expired(); show('login'); } else { show('list'); drawList(); }
  });
  $('sheet-toggle').addEventListener('click', () => setSheet(!$('reader-layout').classList.contains('sheet-open')));
  $('sheet-close').addEventListener('click', () => { setSheet(false); $('sheet-toggle').focus(); });
  for (const tab of ['summary', 'details']) {
    $(`${tab}-tab`).addEventListener('click', () => setTab(tab));
    $(`${tab}-tab`).addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const target = event.key === 'Home' ? 'summary' : event.key === 'End' ? 'details' : tab === 'summary' ? 'details' : 'summary';
        setTab(target); $(`${target}-tab`).focus();
      }
    });
  }
  $('zoom-in').addEventListener('click', () => viewer.relayout(viewer.zoom * 1.25));
  $('zoom-out').addEventListener('click', () => viewer.relayout(viewer.zoom / 1.25));
  let dragging = false;
  $('splitter').addEventListener('pointerdown', event => { dragging = true; $('splitter').setPointerCapture(event.pointerId); event.preventDefault(); });
  $('splitter').addEventListener('pointermove', event => {
    if (!dragging) return;
    const rect = $('reader-layout').getBoundingClientRect();
    setWidth((event.clientX - rect.left) / rect.width * 100);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('splitter').addEventListener(type, () => { if (dragging) { dragging = false; store.save(); } });
  $('splitter').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setWidth(event.key === 'Home' ? 25 : event.key === 'End' ? 75 : store.state.panelWidth + (event.key === 'ArrowRight' ? 2 : -2));
    store.save();
  });
  $('login-method').addEventListener('change', () => { if ($('login-method').value === 'popup') preparePopup(); });
  $('settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const path = $('survey-path').value.split('/').map(s => s.trim()).filter(Boolean).join('/');
    if (!path) { $('settings-message').textContent = 'survey フォルダの道筋を入力してください。'; return; }
    listingController?.abort();
    pdfAvailability.clear();
    store.state.settings = { method: $('login-method').value === 'popup' ? 'popup' : 'redirect', path };
    store.save();
    settingsUI();
    $('settings-message').textContent = '設定を保存しました。';
    if (store.state.settings.method === 'popup') preparePopup();
  });
  $('logout').addEventListener('click', () => {
    listingController?.abort(); pdfController?.abort(); epoch++;
    store.state.session = null; store.state.pendingLogin = null; store.save();
    clearTimeout(expiryTimer);
    viewer.close(); activePaper = null; library = { papers: [], generated: '' }; pdfAvailability.clear();
    drawList(); previousView = 'login'; $('session-banner').hidden = true; settingsUI(); loginUI();
  });
  $('clear-reading').addEventListener('click', () => {
    listingController?.abort();
    store.clearReading(); pdfAvailability.clear(); setWidth(50); settingsUI();
    $('settings-message').textContent = 'フォルダ ID・読んだページ・パネル幅を消しました。';
  });
  document.addEventListener('visibilitychange', () => { if (!demo && store.state.session && !sessionGood()) expired(); });
  const online = () => reading.flush();
  window.addEventListener('online', online);
  const resumePaperId = store.state.pendingLogin?.paperId;
  const redirect = consumeRedirect(window.location, window.history, store);
  loginUI(redirect.error || 'Google アカウントでログインしてください。');
  $('demo-badge').hidden = !demo;
  if (!demo && store.state.settings.method === 'popup') preparePopup();
  armExpiry();
  if (demo || sessionGood()) await loadList();
  else { if (store.state.session) expired(); show('login'); }
  if (!demo && redirect.session && resumePaperId) {
    const paper = library.papers.find(paper => paper.id === resumePaperId);
    if (paper) await openPaper(paper);
  }
  await reading.flush();
  if ('serviceWorker' in window.navigator) window.navigator.serviceWorker.register('./sw.js').catch(() => notify('アプリの殻を保存できませんでした。通信がある状態で利用してください。'));
  return { store, viewer, openPaper, loadList, dispose() { clearTimeout(expiryTimer); window.removeEventListener('online', online); listingController?.abort(); pdfController?.abort(); viewer.close(); } };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') startApp({ window, document }).catch(() => {
  const notice = document.getElementById('notice');
  notice.hidden = false;
  notice.textContent = '起動できませんでした。ページを再読み込みしてください。';
});
