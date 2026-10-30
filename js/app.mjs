import { CLIENT_ID } from '../config.js';
import { clamp, errorMessage, normalizeLibrary, normalizeFilters, normalizeSort, selectPapers, tagCounts } from './core.mjs';
import { createStore } from './storage.mjs';
import { consumeRedirect, DRIVE_SCOPE, loadGIS, redirectURL, validSession } from './login.mjs';
import { Drive } from './drive.mjs';
import { createReading } from './reading.mjs';
import { createComments, COMMENT_LIMIT, commentLength } from './comments.mjs';
import { createFeed, demoFeedDates, feedPaper, japanDay, manualUploadMessage, validatePdf } from './feed.mjs';
import { renderFeed } from './feed-view.mjs';
import { createFigureLoader, observeFigures } from './figures.mjs';
import { PdfViewer } from './pdf-viewer.mjs';

export function element(document, tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function renderPaperRow(document, paper, noPdf) {
  const el = (tag, text, cls) => element(document, tag, text, cls);
  const row = el('button', undefined, 'paper-row');
  row.setAttribute('data-paper-id', paper.id);
  const frame = el('span', undefined, 'paper-figure');
  frame.setAttribute('aria-hidden', 'true');
  frame.append(el('span', [...paper.title_jp.trim()][0] || '図なし'));
  const text = el('span', undefined, 'paper-text');
  const heading = el('span', undefined, 'paper-heading');
  heading.append(el('span', paper.title_jp || paper.title || '—', 'paper-title'));
  const status = el('span', undefined, 'paper-status');
  status.append(el('span', paper.importance || '—', 'stars'), el('span', paper.read_status || '—'));
  if (noPdf) status.append(el('span', 'PDF なし', 'no-pdf'));
  heading.append(status);
  text.append(heading);
  if (paper.title_jp && paper.title) text.append(el('span', paper.title, 'muted paper-title-en'));
  if (paper.authors) text.append(el('span', paper.authors, 'muted paper-authors'));
  if (paper.comment) {
    const comment = el('span', undefined, 'paper-comment');
    comment.append(el('small', 'コメント'), el('span', paper.comment));
    text.append(comment);
  }
  row.append(frame, text);
  return { row, frame };
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
  const fields = paper.feedKey ? [['題', paper.title], ['著者', paper.authors], ['掲載先', paper.venue], ['年', paper.year], ['DOI', paper.doi]].filter(([, value]) => value !== '' && value !== null) : [['題', paper.title], ['和題', paper.title_jp], ['著者', paper.authors], ['年', paper.year], ['会場', paper.venue], ['Type', paper.type], ['DOI', paper.doi], ['タグ', paper.tags.join('・')], ['Importance', paper.importance], ['Read Status', paper.read_status]];
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
  if (paper.feedKey) { details.append(dl); return; }
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
  let library = { papers: [], feed: [], generated: '' };
  let activePaper = null;
  let readStatusNode;
  let epoch = 0;
  let listingController;
  let pdfController;
  let expiryTimer;
  let popupClient;
  let popupPreparing;
  let readingError = '';
  let commentError = '';
  let feedError = '';
  let uploading = false;
  let waitingExpanded = false;
  let listScrollTop = 0;
  const feedMessages = new Map();
  const demoPdfs = new Map();
  const pdfAvailability = new Map();
  const sessionGood = () => validSession(store.state.session);
  const pageKey = id => `${demo ? 'demo:' : ''}${id}`;

  function show(name) {
    if (view === 'list') listScrollTop = $('library-scroll').scrollTop;
    view = name;
    for (const candidate of ['login', 'list', 'reader', 'settings']) $(`${candidate}-view`).hidden = candidate !== name;
    if (name === 'reader') viewer.schedule();
    if (name === 'list') $('library-scroll').scrollTop = listScrollTop;
    else figures.disconnect();
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
  const figureLoader = createFigureLoader(async (figure, signal) => {
    if (!demo) return drive.figureBlob(figure, signal);
    const response = await fetcher(new URL(`../demo/figures/${encodeURIComponent(figure.name)}`, import.meta.url), { cache: 'no-store', signal });
    if (!response.ok) throw new Error('図を読み込めませんでした。');
    return response.blob();
  });
  const figures = observeFigures({ Observer: window.IntersectionObserver, root: $('library-scroll'), loader: figureLoader, document });
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

  const feed = createFeed(store, drive, { demo,
    onChange: () => { drawFeed(); readingUI(); },
    onError: (message, error) => {
      if (!message && $('notice').textContent === feedError) notify('');
      feedError = message;
      readingUI();
      if (message) notify(message);
      if (error?.status === 403 || error?.status === 401) $('session-banner').hidden = false;
    },
  });
  const comments = createComments(store, drive, { demo,
    onChange: () => { drawList(); readingUI(); },
    onError: (message, error) => {
      if (!message && $('notice').textContent === commentError) notify('');
      commentError = message;
      readingUI();
      if (message) notify(message);
      if (error?.status === 403 || error?.status === 401) $('session-banner').hidden = false;
    },
  });
  const flushRecords = () => Promise.all([reading.flush(), feed.flush(), comments.flush()]);

  function drawFeed() {
    renderFeed(document, $('feed-list'), (library.feed || []).map(item => feed.item(item, library.generated)), {
      today: japanDay(), days: feed.days(), onOpen: openFeed, onUpload: uploadFeed,
      waitingExpanded, onToggleWaiting: () => { waitingExpanded = !waitingExpanded; drawFeed(); },
      onSkip: (item, action) => { if (!uploading && feed.record(item.key, action)) return feed.flush(); },
      clipboard: window.navigator.clipboard, messages: feedMessages, busy: uploading,
    });
  }
  async function openFeed(item) {
    const source = library.feed.find(row => row.key === item.key) || item;
    const current = feed.item(source, library.generated);
    const registered = library.papers.find(paper => paper.id === current.notion_id);
    if (registered && current.pdf?.drive_id && current.pdf.drive_id !== registered.pdf?.drive_id) pdfAvailability.delete(registered.id);
    return openPaper(registered ? { ...registered, pdf: current.pdf || registered.pdf } : feedPaper(current));
  }
  async function uploadFeed(item, file) {
    if (uploading) return;
    uploading = true;
    $('reload').disabled = true;
    $('logout').disabled = true;
    feedMessages.set(item.key, { text: 'アップロード中…' });
    drawFeed();
    let uploaded;
    try {
      if (demo) {
        await validatePdf(file);
        uploaded = { name: item.pdf_name, drive_id: `demo:${item.key}` };
        const previous = demoPdfs.get(item.key);
        if (previous) URL.revokeObjectURL(previous);
        demoPdfs.set(item.key, URL.createObjectURL(file));
      } else uploaded = await drive.putFeedPdf(item, file);
    } catch (error) {
      const manual = [403, 404].includes(error.status);
      const text = manual ? manualUploadMessage(item.pdf_name)
        : error.message === 'PDF ではないようです' ? error.message : 'アップロードできませんでした';
      feedMessages.set(item.key, { text, ...(manual ? { copyName: item.pdf_name } : {}) });
      if (error.status === 401) notify(text + '。もう一度ログインしてください。');
    } finally {
      uploading = false;
      $('reload').disabled = false;
      $('logout').disabled = demo || !store.state.session;
    }
    if (uploaded) {
      feedMessages.delete(item.key);
      const recorded = feed.record(item.key, 'pdf', uploaded);
      const registered = library.papers.find(paper => paper.id === item.notion_id);
      const paper = registered ? { ...registered, pdf: uploaded } : feedPaper({ ...item, pdf: uploaded });
      pdfAvailability.delete(paper.id);
      const sending = recorded ? feed.flush() : Promise.resolve();
      await openPaper(paper);
      await sending;
    }
    drawFeed();
  }

  function readingUI() {
    const count = reading.pendingCount() + feed.pendingCount() + comments.pendingCount();
    $('reading-pending').textContent = count ? `未送信の記録: ${count} 件` : '';
    $('reading-error').textContent = [readingError, feedError, commentError].filter(Boolean).join('\n');
  }
  function drawReading() {
    $('read-toggle').hidden = !!activePaper.feedKey;
    if (activePaper.feedKey) return;
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
    const sending = flushRecords();
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

  const statusButtons = new Map();
  const tagButtons = new Map();
  for (const [status, label] of [['all', 'すべて'], ['unread', '未読'], ['read', '読了']]) {
    const button = el('button', label);
    button.addEventListener('click', () => {
      store.state.filters.status = status;
      store.save();
      drawList();
    });
    statusButtons.set(status, button);
    $('status-filters').append(button);
  }
  function rebuildTags() {
    const counts = tagCounts(library.papers);
    const filters = normalizeFilters(store.state.filters, new Set(counts.map(item => item.tag)));
    if (filters.tags.length !== store.state.filters.tags.length) {
      store.state.filters = filters;
      store.save();
    }
    tagButtons.clear();
    $('tag-filters').replaceChildren();
    for (const { tag, count } of counts) {
      const button = el('button', tag + ' ' + count);
      button.addEventListener('click', () => {
        const tags = store.state.filters.tags;
        store.state.filters.tags = tags.includes(tag) ? tags.filter(value => value !== tag) : [...tags, tag];
        store.save();
        drawList();
      });
      tagButtons.set(tag, button);
      $('tag-filters').append(button);
    }
  }

  function drawList() {
    const scrollTop = view === 'list' ? $('library-scroll').scrollTop : listScrollTop;
    figures.disconnect();
    drawFeed();
    const filters = store.state.filters;
    for (const [status, button] of statusButtons) button.setAttribute('aria-pressed', String(filters.status === status));
    for (const [tag, button] of tagButtons) button.setAttribute('aria-pressed', String(filters.tags.includes(tag)));
    $('clear-filters').hidden = !($('filter').value.trim() || filters.status !== 'all' || filters.tags.length);
    $('sort').value = store.state.sort;
    const papers = selectPapers(library.papers.map(paper => comments.paper(reading.paper(paper, library.generated), library.generated)), $('filter').value, filters, store.state.sort);
    $('paper-list').replaceChildren();
    $('count').textContent = `${papers.length} 本 / ${library.papers.length} 本`;
    $('generated').textContent = library.generated ? `書き出し: ${library.generated}` : '書き出し日時: —';
    if (!papers.length) $('paper-list').append(el('p', '該当する論文はありません。', 'muted'));
    for (const paper of papers) {
      const { row, frame } = renderPaperRow(document, paper, !paper.pdf || pdfAvailability.get(paper.id) === null);
      row.addEventListener('click', () => openPaper(library.papers.find(item => item.id === paper.id)));
      $('paper-list').append(row);
      if (view === 'list') figures.observe(row, frame, paper.figure);
    }
    if (view === 'list') $('library-scroll').scrollTop = scrollTop;
  }

  async function resolvePdf(paper, signal) {
    if (!paper.pdf) return null;
    if (pdfAvailability.has(paper.id)) return pdfAvailability.get(paper.id);
    let source;
    if (demo) {
      const demoKey = paper.pdf.drive_id?.startsWith('demo:') ? paper.pdf.drive_id.slice(5) : paper.feedKey;
      if (demoPdfs.has(demoKey)) return demoPdfs.get(demoKey);
      const url = new URL(`../demo/${encodeURIComponent(paper.pdf.drive_id?.startsWith('demo:') ? 'reader-demo.pdf' : paper.pdf.name)}`, import.meta.url).href;
      const response = await fetcher(url, { method: 'HEAD', cache: 'no-store', signal });
      if (!response.ok && response.status !== 404) throw new Error(`PDF の確認に失敗しました（${response.status}）。`);
      source = response.ok ? url : null;
    } else source = await drive.pdfId(paper, signal);
    if (!signal.aborted) pdfAvailability.set(paper.id, source);
    return source;
  }

  async function loadList() {
    if (uploading) return;
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
        data = demoFeedDates(await response.json());
      } else data = await drive.library(signal);
      if (signal.aborted) return;
      library = normalizeLibrary(data);
      rebuildTags();
      pdfAvailability.clear();
      drawList();
      $('list-message').textContent = 'PDF の有無を確認中…';
      let feedLogError = '';
      const path = store.state.settings.path;
      const logRead = demo ? Promise.resolve() : drive.feedLog(signal).then(events => {
        if (!signal.aborted) { feed.mergeRemote(events, path); drawFeed(); }
      }).catch(() => { feedLogError = 'PDF を入れた日の記録を読み込めませんでした。通信が戻ったら再読み込みしてください。'; });
      // Bound requests while checking name-only PDFs in a library with many entries.
      let index = 0;
      const check = async () => {
        while (index < library.papers.length && !signal.aborted) {
          const paper = library.papers[index++];
          await resolvePdf(paper, signal);
          if (!signal.aborted) drawList();
        }
      };
      await Promise.all([check(), check(), check(), logRead]);
      if (!signal.aborted) $('list-message').textContent = feedLogError;
    } catch (error) {
      if (!signal.aborted) {
        if (error.status === 401) expired();
        $('list-message').textContent = errorMessage(error);
      }
    } finally { if (!signal.aborted) $('reload').disabled = false; }
  }

  function setTab(tab) {
    if (tab === 'comment' && activePaper?.feedKey) return;
    for (const name of ['summary', 'details', 'comment']) {
      $(`${name}-tab`).setAttribute('aria-selected', String(name === tab));
      $(`${name}-tab`).tabIndex = name === tab ? 0 : -1;
      $(`${name}-content`).hidden = name !== tab;
    }
  }
  function commentUI() {
    const length = commentLength($('comment-editor').value);
    $('comment-count').textContent = length > COMMENT_LIMIT ? `${length} 字 / 1000 字までです。短くしてから保存してください。` : `${length} / 1000 字`;
    $('comment-save').disabled = !activePaper || !!activePaper.feedKey || length > COMMENT_LIMIT
      || $('comment-editor').value === (comments.paper(activePaper, library.generated).comment || '');
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
    $('comment-tab').hidden = !!paper.feedKey;
    $('comment-editor').value = paper.feedKey ? '' : comments.paper(paper, library.generated).comment || '';
    $('comment-message').textContent = '';
    $('comment-content').scrollTop = 0;
    commentUI();
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
    if (demo && paper.feedKey && paper.pdf?.drive_id?.startsWith('demo:') && !demoPdfs.has(paper.feedKey)) {
      notify('デモでは選んだ PDF 本体は保存しません。再読み込み後は同梱の架空 PDF を表示します。');
    }
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
    $('logout').disabled = uploading || demo || !store.state.session;
    $('login-method').value = store.state.settings.method;
    $('survey-path').value = store.state.settings.path;
    const ids = store.state.folders[store.state.settings.path];
    $('folder-ids').textContent = ids ? `使用中のフォルダ ID — survey: ${ids.survey} / _reader: ${ids.reader}` : 'フォルダ ID はまだ覚えていません。';
  }

  $('filter').addEventListener('input', drawList);
  $('sort').addEventListener('change', () => {
    store.state.sort = normalizeSort($('sort').value);
    store.save();
    drawList();
  });
  $('comment-editor').addEventListener('input', () => { $('comment-message').textContent = ''; commentUI(); });
  $('comment-save').addEventListener('click', () => {
    if (!activePaper || activePaper.feedKey) return;
    if (comments.record(activePaper, $('comment-editor').value, library.generated)) {
      $('comment-message').textContent = '端末に保存しました。';
      commentUI();
      return comments.flush();
    }
    commentUI();
  });
  $('clear-filters').addEventListener('click', () => {
    $('filter').value = '';
    store.state.filters = normalizeFilters();
    store.save();
    drawList();
  });
  $('read-toggle').addEventListener('click', () => {
    if (!activePaper || activePaper.feedKey) return;
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
  for (const tab of ['summary', 'details', 'comment']) {
    $(`${tab}-tab`).addEventListener('click', () => setTab(tab));
    $(`${tab}-tab`).addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const tabs = activePaper?.feedKey ? ['summary', 'details'] : ['summary', 'details', 'comment'];
        const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
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
    if (uploading) { $('settings-message').textContent = 'アップロードが終わってから設定を保存してください。'; return; }
    const path = $('survey-path').value.split('/').map(s => s.trim()).filter(Boolean).join('/');
    if (!path) { $('settings-message').textContent = 'survey フォルダの道筋を入力してください。'; return; }
    listingController?.abort();
    pdfAvailability.clear();
    figures.disconnect(); figureLoader.clear();
    library = { papers: [], feed: [], generated: '' };
    feedMessages.clear();
    drawList();
    store.state.settings = { method: $('login-method').value === 'popup' ? 'popup' : 'redirect', path };
    store.save();
    settingsUI();
    $('settings-message').textContent = '設定を保存しました。';
    if (store.state.settings.method === 'popup') preparePopup();
  });
  $('logout').addEventListener('click', () => {
    if (uploading) return;
    listingController?.abort(); pdfController?.abort(); epoch++;
    figures.disconnect(); figureLoader.clear();
    store.state.session = null; store.state.pendingLogin = null; store.save();
    clearTimeout(expiryTimer);
    viewer.close(); activePaper = null; library = { papers: [], feed: [], generated: '' }; pdfAvailability.clear();
    drawList(); previousView = 'login'; $('session-banner').hidden = true; settingsUI(); loginUI();
  });
  $('clear-reading').addEventListener('click', () => {
    listingController?.abort();
    store.clearReading(); pdfAvailability.clear(); setWidth(50); settingsUI();
    $('settings-message').textContent = 'フォルダ ID・読んだページ・パネル幅を消しました。';
  });
  document.addEventListener('visibilitychange', () => { if (!demo && store.state.session && !sessionGood()) expired(); });
  const online = () => flushRecords();
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
    else {
      const item = library.feed.find(item => `feed:${item.key}` === resumePaperId);
      if (item) await openFeed(item);
    }
  }
  await flushRecords();
  if ('serviceWorker' in window.navigator) window.navigator.serviceWorker.register('./sw.js').catch(() => notify('アプリの殻を保存できませんでした。通信がある状態で利用してください。'));
  return { store, viewer, openPaper, loadList, dispose() { figures.disconnect(); figureLoader.clear(); clearTimeout(expiryTimer); window.removeEventListener('online', online); for (const url of demoPdfs.values()) URL.revokeObjectURL(url); listingController?.abort(); pdfController?.abort(); viewer.close(); } };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') startApp({ window, document }).catch(() => {
  const notice = document.getElementById('notice');
  notice.hidden = false;
  notice.textContent = '起動できませんでした。ページを再読み込みしてください。';
});
