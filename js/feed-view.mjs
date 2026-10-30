import { acquisitionURL, doiURL } from './feed.mjs';

export function renderFeed(document, container, items, { today, days, onOpen, onUpload, onSkip, clipboard, messages, busy, waitingExpanded = false, onToggleWaiting }) {
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const button = (label, action) => {
    const node = el('button', label);
    node.disabled = busy;
    node.addEventListener('click', action);
    return node;
  };
  const link = (label, href) => {
    const node = el('a', label);
    node.href = href; node.target = '_blank'; node.rel = 'noopener';
    return node;
  };
  function actions(item, card) {
    const row = el('div', undefined, 'feed-actions');
    if (item.pdf) row.append(button('読む', () => onOpen(item)));
    else {
      const url = acquisitionURL(item, document.baseURI);
      if (url) {
        row.append(link('PDF を取ってくる', url));
        if (!item.oa_pdf) row.append(el('small', '学内ネットワーク／VPN で開く', 'muted'));
      }
      if (item.pdf_name) {
        const input = el('input');
        input.type = 'file'; input.accept = 'application/pdf'; input.hidden = true;
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          input.value = '';
          if (file) await onUpload(item, file);
        });
        row.append(button('PDF を入れる', () => input.click()), input);
      }
      row.append(button('見送る', () => onSkip(item, 'skip')));
    }
    card.append(row);
    const status = messages.get(item.key);
    if (status) {
      const message = el('p', status.text, 'feed-message');
      message.setAttribute('role', 'status');
      card.append(message);
      if (status.copyName) {
        card.append(button('PDF の名前をコピー', async () => {
          try { await clipboard.writeText(status.copyName); message.textContent = status.text + '（コピーしました）'; }
          catch { message.textContent = status.text + '（コピーできませんでした。名前を選択してコピーしてください）'; }
        }));
      }
    }
  }
  const previousAbstract = container.querySelector?.('details');
  const abstractOpen = container.getAttribute('data-current') === items[0]?.key && previousAbstract?.open;
  container.setAttribute('data-current', items[0]?.key || '');
  container.hidden = !items.length;
  container.replaceChildren();
  if (!items.length) return;
  const current = items[0]?.served === today ? items[0] : null;
  if (current) {
    container.append(el('h2', '今日の一本'));
    const card = el('article', undefined, 'feed-card');
    if (current.title) card.append(el('h3', current.title));
    if (current.skipped && !current.pdf) {
      card.append(el('span', '見送り済み・', 'muted'), button('取り消す', () => onSkip(current, 'unskip')));
    } else {
      const metadata = [current.venue, current.year, current.authors].filter(value => value !== '' && value !== null);
      if (metadata.length) card.append(el('p', metadata.join(' · '), 'muted'));
      for (const [heading, text] of [['これは何の論文か', current.ja], ['あなたにとっての意味', current.why]]) {
        if (text) { const section = el('section'); section.append(el('h4', heading), el('p', text)); card.append(section); }
      }
      if (current.abstract) {
        const abstract = el('details');
        abstract.open = !!abstractOpen;
        abstract.append(el('summary', 'アブストラクト'), el('p', current.abstract));
        card.append(abstract);
      }
      if (current.doi) card.append(link(`DOI: ${current.doi}`, doiURL(current.doi)));
      actions(current, card);
    }
    container.append(card);
  }
  const waiting = items.filter(item => item.served !== today && !item.pdf && !item.skipped);
  if (waiting.length) {
    container.append(el('h2', `PDF 待ち ${waiting.length} 本`));
    for (const item of waitingExpanded ? waiting : waiting.slice(0, 5)) {
      const row = el('article', undefined, 'feed-waiting');
      const title = el('div');
      title.append(el('h3', item.title), el('time', item.served, 'muted'));
      const age = (Date.parse(today) - Date.parse(item.served)) / 86400_000;
      if (age > 7) title.append(el('small', ` ${age} 日前`, 'muted'));
      row.append(title);
      actions(item, row);
      container.append(row);
    }
  }
  if (waiting.length > 5) {
    const toggle = button(waitingExpanded ? 'たたむ' : `残り ${waiting.length - 5} 本を表示`, onToggleWaiting);
    toggle.setAttribute('aria-expanded', String(waitingExpanded));
    container.append(toggle);
  }
  container.append(el('p', `この 7 日で PDF を入れた日 ${days}/7`, 'muted feed-days'));
}
