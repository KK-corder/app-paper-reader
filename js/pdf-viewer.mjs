import { canvasScale, clamp, currentPage, pageLayout } from './core.mjs';
import { DriveError } from './drive.mjs';

const vendor = new URL('../vendor/pdfjs/', import.meta.url);
let library;
export async function pdfLibrary() {
  library ||= import(new URL('pdf.min.mjs', vendor));
  const pdfjs = await library;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', vendor).href;
  return pdfjs;
}

export async function downloadPdf(source, progress, signal, fetcher = fetch) {
  const response = await fetcher(source.url, { headers: source.headers, cache: 'no-store', signal });
  if (!response.ok) throw new DriveError(response.status, `PDF の取得に失敗しました（${response.status}）。`);
  const total = Number(response.headers.get('Content-Length')) || 0;
  if (!response.body?.getReader) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    progress({ loaded, total });
  }
  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}

function canRetry(error) {
  return error?.name !== 'AbortError' && error?.name !== 'InvalidPDFException' && error?.name !== 'PasswordException' && ![401, 403, 404].includes(error?.status);
}

export class PdfViewer {
  constructor(scroller, pages, { onPage, onProgress, onError, onReady, getLibrary = pdfLibrary, fetcher = fetch }) {
    Object.assign(this, { scroller, pages, onPage, onProgress, onError, onReady, getLibrary, fetcher });
    this.zoom = 1;
    this.generation = 0;
    this.rows = [];
    this.tops = [];
    this.tasks = new Set();
    this.scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    this.scroller.addEventListener('touchstart', e => this.touchStart(e), { passive: false });
    this.scroller.addEventListener('touchmove', e => this.touchMove(e), { passive: false });
    this.scroller.addEventListener('touchend', e => this.touchEnd(e), { passive: false });
    this.scroller.addEventListener('touchcancel', e => this.touchEnd(e), { passive: false });
    // Safari also emits gesture events; prevent its page-level zoom inside the PDF only.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) this.scroller.addEventListener(type, e => e.preventDefault(), { passive: false });
    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        if (this.doc && this.scroller.clientWidth > 0 && this.scroller.clientWidth !== this.layoutWidth) this.relayout();
      }, 120);
    });
    this.resizeObserver.observe(scroller);
  }

  async open(source, page = 1, full = false, preserve = false) {
    if (!preserve) this.close();
    const generation = ++this.generation;
    this.source = source;
    this.full = full;
    const controller = new AbortController();
    this.controller?.abort();
    this.controller = controller;
    let task;
    let doc;
    try {
      const pdfjs = await this.getLibrary();
      if (generation !== this.generation) return;
      const options = {
        cMapUrl: new URL('cmaps/', vendor).href, cMapPacked: true,
        standardFontDataUrl: new URL('standard_fonts/', vendor).href,
        isEvalSupported: false,
      };
      if (full) options.data = await downloadPdf(source, this.onProgress, controller.signal, this.fetcher);
      else Object.assign(options, { url: source.url, httpHeaders: source.headers, disableAutoFetch: true, disableStream: true });
      if (generation !== this.generation) return;
      task = pdfjs.getDocument(options);
      this.tasks.add(task);
      task.onProgress = progress => { if (generation === this.generation) this.onProgress(progress); };
      doc = await task.promise;
      const sizes = [];
      for (let number = 1; number <= doc.numPages; number++) {
        if (generation !== this.generation) return;
        const pdfPage = await doc.getPage(number);
        const viewport = pdfPage.getViewport({ scale: 1 });
        sizes.push({ width: viewport.width, height: viewport.height });
      }
      if (generation !== this.generation) return;
      const oldTask = this.documentTask;
      this.cancelRenders();
      this.doc = doc;
      this.documentTask = task;
      if (oldTask && oldTask !== task) { this.tasks.delete(oldTask); await oldTask.destroy(); }
      if (generation !== this.generation) return;
      this.sizes = sizes;
      this.pages.replaceChildren();
      this.rows = sizes.map((_, index) => {
        const element = this.pages.ownerDocument.createElement('div');
        element.className = 'pdf-page';
        element.setAttribute('aria-label', `PDF ${index + 1} ページ`);
        this.pages.append(element);
        return { element, canvas: null, render: null, revision: -1 };
      });
      this.revision = 0;
      this.applyLayout();
      const number = clamp(Math.floor(page), 1, doc.numPages);
      this.scroller.scrollTop = number === 1 ? 0 : this.tops[number - 1];
      this.scroller.scrollLeft = 0;
      this.onReady(doc.numPages);
      this.schedule();
    } catch (error) {
      if (task && task !== this.documentTask) { this.tasks.delete(task); await task.destroy().catch(() => {}); }
      if (generation !== this.generation) return;
      if (!full && canRetry(error)) {
        this.onProgress({ retry: true });
        return this.open(source, page, true, preserve);
      }
      this.onError(error);
    }
  }

  close() {
    this.generation++;
    this.controller?.abort();
    this.cancelRenders();
    for (const task of this.tasks) task.destroy().catch(() => {});
    this.tasks.clear();
    this.doc = null;
    this.documentTask = null;
    this.rows = [];
    this.tops = [];
    this.zoom = 1;
    this.pinch = null;
    this.pages.style.transform = '';
    this.pages.style.width = '';
    this.pages.style.height = '';
    this.pages.replaceChildren();
    cancelAnimationFrame(this.frame);
    this.frame = null;
    clearTimeout(this.resizeTimer);
  }

  applyLayout() {
    this.layoutWidth = this.scroller.clientWidth;
    const layout = pageLayout(this.sizes, this.layoutWidth, this.zoom);
    this.tops = layout.pages.map(p => p.top);
    this.pages.style.width = `${layout.width}px`;
    this.pages.style.height = `${layout.height}px`;
    this.rows.forEach((row, index) => {
      row.layout = layout.pages[index];
      Object.assign(row.element.style, { top: `${row.layout.top}px`, left: `${Math.max(12, (layout.width - row.layout.width) / 2)}px`, width: `${row.layout.width}px`, height: `${row.layout.height}px` });
    });
  }

  relayout(nextZoom = this.zoom, anchor) {
    if (!this.doc) return;
    const page = currentPage(this.tops, this.scroller.scrollTop, this.scroller.clientHeight) - 1;
    const fraction = (this.scroller.scrollTop - this.tops[page]) / this.rows[page].layout.height;
    this.zoom = clamp(nextZoom, 0.5, 4);
    this.revision++;
    this.cancelRenders();
    this.applyLayout();
    this.scroller.scrollTop = anchor ? anchor.top : this.tops[page] + fraction * this.rows[page].layout.height;
    if (anchor) this.scroller.scrollLeft = anchor.left;
    this.schedule();
  }

  schedule() {
    if (this.frame || !this.doc || this.pinch) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.update(); });
  }

  update() {
    if (!this.doc || !this.scroller.clientHeight) return;
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight;
    this.onPage(currentPage(this.tops, top, height), this.doc.numPages);
    this.rows.forEach(row => {
      const nearby = row.layout.top + row.layout.height >= top - height * 0.5 && row.layout.top <= top + height * 1.5;
      row.wanted = nearby;
      if (!nearby) {
        row.render?.cancel();
        if (row.canvas) { row.canvas.width = 0; row.canvas.height = 0; row.canvas.remove(); row.canvas = null; row.revision = -1; }
      }
    });
    this.pump();
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    const generation = this.generation;
    try {
      while (generation === this.generation && this.doc) {
        const index = this.rows.findIndex(row => row.wanted && row.revision !== this.revision);
        if (index < 0) break;
        const row = this.rows[index];
        const revision = this.revision;
        const page = await this.doc.getPage(index + 1);
        if (generation !== this.generation) break;
        if (!row.wanted || revision !== this.revision) continue;
        const viewport = page.getViewport({ scale: row.layout.scale });
        const ratio = canvasScale(viewport.width, viewport.height, globalThis.devicePixelRatio);
        const canvas = this.pages.ownerDocument.createElement('canvas');
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        canvas.setAttribute('aria-hidden', 'true');
        const render = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
        row.render = render;
        try {
          await render.promise;
          if (generation === this.generation && revision === this.revision && row.wanted) {
            if (row.canvas) { row.canvas.width = 0; row.canvas.height = 0; }
            row.element.replaceChildren(canvas);
            row.canvas = canvas;
            row.revision = revision;
            this.onReady(this.doc.numPages);
          } else { canvas.width = 0; canvas.height = 0; }
        } catch (error) {
          canvas.width = 0; canvas.height = 0;
          if (error.name !== 'RenderingCancelledException') throw error;
        } finally { row.render = null; page.cleanup(); }
      }
    } catch (error) {
      if (generation === this.generation) {
        if (!this.full && canRetry(error)) {
          this.onProgress({ retry: true });
          await this.open(this.source, currentPage(this.tops, this.scroller.scrollTop, this.scroller.clientHeight), true, true);
        } else { this.onError(error); this.renderFailed = true; }
      }
    } finally {
      this.pumping = false;
      if (!this.renderFailed && this.rows.some(row => row.wanted && row.revision !== this.revision)) this.schedule();
    }
  }

  cancelRenders() { this.renderFailed = false; for (const row of this.rows) row.render?.cancel(); }

  touchStart(event) {
    if (event.touches.length !== 2 || !this.doc) return;
    event.preventDefault();
    const [a, b] = event.touches;
    const rect = this.scroller.getBoundingClientRect();
    this.pinch = { distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), zoom: this.zoom,
      x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top,
      top: this.scroller.scrollTop, left: this.scroller.scrollLeft, next: this.zoom };
  }

  touchMove(event) {
    if (!this.pinch || event.touches.length !== 2) return;
    event.preventDefault();
    const [a, b] = event.touches;
    const pinch = this.pinch;
    pinch.next = clamp(pinch.zoom * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.distance, 0.5, 4);
    const scale = pinch.next / pinch.zoom;
    this.pages.style.transformOrigin = `${pinch.left + pinch.x}px ${pinch.top + pinch.y}px`;
    this.pages.style.transform = `scale(${scale})`;
  }

  touchEnd(event) {
    if (!this.pinch || event.touches.length >= 2) return;
    event.preventDefault();
    const pinch = this.pinch;
    const ratio = pinch.next / pinch.zoom;
    this.pinch = null;
    this.pages.style.transform = '';
    this.relayout(pinch.next, { top: (pinch.top + pinch.y) * ratio - pinch.y, left: (pinch.left + pinch.x) * ratio - pinch.x });
  }
}
