import { readFileSync } from 'node:fs';

export class Node {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.listeners = new Map(); this.attributes = {};
    this._text = ''; this.className = ''; this.hidden = false; this.value = ''; this.disabled = false;
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.scrollTop = 0; this.scrollLeft = 0; this.clientWidth = 416; this.clientHeight = 280;
    this.classList = { contains: name => this.className.split(' ').includes(name), toggle: (name, enabled) => {
      const classes = new Set(this.className.split(' ').filter(Boolean));
      if (enabled ?? !classes.has(name)) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(' ');
    } };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(listener => listener !== fn)); }
  async emit(type, values = {}) { for (const fn of this.listeners.get(type) || []) await fn({ preventDefault() {}, touches: [], ...values }); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture() {}
  focus() { this.ownerDocument.activeElement = this; }
  getContext() { return {}; }
  descendants(tag) { return this.children.flatMap(child => [...(child.tagName === tag.toUpperCase() ? [child] : []), ...child.descendants(tag)]); }
}

export function makeDOM(search = '?demo=1', storage = new Map()) {
  const document = new Node('document');
  document.ownerDocument = document;
  document.createElement = tag => new Node(tag, document);
  document.head = document.createElement('head');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const ids = new Map();
  for (const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = document.createElement(match[1]);
    node.id = match[2];
    node.hidden = /\shidden\b/.test(match[0]);
    ids.set(match[2], node);
  }
  document.getElementById = id => { if (!ids.has(id)) throw new Error(`Missing element ${id}`); return ids.get(id); };
  const settings = [document.createElement('button'), document.createElement('button')];
  document.querySelectorAll = selector => selector === '.open-settings' ? settings : [];
  const window = {
    listeners: new Map(), addEventListener: Node.prototype.addEventListener, removeEventListener: Node.prototype.removeEventListener, emit: Node.prototype.emit,
    location: { search, hash: '', pathname: '/PaperReader/', origin: 'http://localhost:8080' },
    history: { replaceState() {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    navigator: { clipboard: { async writeText(text) { this.text = text; } } },
  };
  return { document, window, storage, settings, $: id => document.getElementById(id) };
}

export async function eventually(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  throw new Error('Condition did not become true');
}
