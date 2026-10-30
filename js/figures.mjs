export function normalizeFigure(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.name !== 'string' || !value.name.trim()) return null;
  return { name: value.name, drive_id: typeof value.drive_id === 'string' ? value.drive_id.trim() || null : null };
}

export function createFigureLoader(readBlob, urls = URL) {
  const entries = new Map();
  let queue = [];
  let active = 0;

  function pump() {
    while (active < 4 && queue.length) {
      const entry = queue.shift();
      active++;
      Promise.resolve().then(() => readBlob(entry.figure, entry.controller.signal)).then(blob => {
        if (blob && entries.get(entry.figure.drive_id) === entry) entry.url = urls.createObjectURL(blob);
      }).catch(() => {
        // Failed images stay placeholders for this page, including cached 404s.
      }).finally(() => {
        active--;
        entry.resolve(entry.url || null);
        pump();
      });
    }
  }

  function cancelQueued(id) {
    queue = queue.filter(entry => {
      if (id !== undefined && entry.figure.drive_id !== id) return true;
      entries.delete(entry.figure.drive_id);
      entry.resolve(null);
      return false;
    });
  }

  return {
    load(figure) {
      figure = normalizeFigure(figure);
      if (!figure?.drive_id) return Promise.resolve(null);
      const id = figure.drive_id;
      if (!entries.has(id)) {
        const entry = { figure, controller: new AbortController() };
        entry.promise = new Promise(resolve => { entry.resolve = resolve; });
        entries.set(id, entry);
        queue.push(entry);
        pump();
      }
      return entries.get(id).promise;
    },
    cancelQueued,
    clear() {
      cancelQueued();
      for (const entry of entries.values()) {
        entry.controller.abort();
        if (entry.url) urls.revokeObjectURL(entry.url);
      }
      entries.clear();
    },
  };
}

export function observeFigures({ Observer, root, loader, document }) {
  const targets = new Map();
  const observer = Observer ? new Observer(entries => {
    for (const entry of entries) {
      const target = targets.get(entry.target);
      if (!target) continue;
      target.visible = entry.isIntersecting;
      if (!entry.isIntersecting) {
        target.request = null;
        if (![...targets.values()].some(other => other.visible && other.figure.drive_id === target.figure.drive_id)) loader.cancelQueued(target.figure.drive_id);
        continue;
      }
      if (target.request || target.loaded) continue;
      const request = target.request = {};
      loader.load(target.figure).then(url => {
        if (target.request !== request) return;
        target.request = null;
        if (!url || targets.get(entry.target) !== target) return;
        target.loaded = true;
        const image = document.createElement('img');
        image.alt = '';
        image.width = 88;
        image.height = 66;
        image.addEventListener('error', () => target.frame.replaceChildren(target.placeholder));
        image.src = url;
        target.frame.replaceChildren(image);
      });
    }
  }, { root, rootMargin: '300px' }) : null;

  return {
    observe(row, frame, figure) {
      if (!figure?.drive_id) return;
      targets.set(row, { frame, figure, placeholder: frame.children[0] });
      observer?.observe(row);
    },
    disconnect() {
      observer?.disconnect();
      targets.clear();
      loader.cancelQueued();
    },
  };
}
