import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFeed } from '../js/feed-view.mjs';
import { japanDay, normalizeFeed } from '../js/feed.mjs';
import { makeDOM } from './support/dom.mjs';

function draw(items, today = '2026-10-28') {
  const dom = makeDOM();
  const container = dom.$('feed-list');
  renderFeed(dom.document, container, normalizeFeed(items), { today, days: 0, messages: new Map() });
  return container;
}
const item = (index, served) => ({ key: String(index), title: `架空 ${index}`, served });

test('waiting counts zero through six, hides empty heading, and limits newest rows to five', () => {
  for (const count of [0, 1, 4, 5, 6, 13]) {
    const items = Array.from({ length: count }, (_, index) => item(index, `2026-10-${String(index + 1).padStart(2, '0')}`));
    const container = draw(items);
    const rows = container.children.filter(node => node.className === 'feed-waiting');
    assert.equal(rows.length, Math.min(count, 5));
    assert.deepEqual(rows.map(row => row.descendants('time')[0].textContent), items.map(i => i.served).reverse().slice(0, 5));
    assert.equal(container.descendants('h2').some(node => node.textContent === `PDF 待ち ${count} 本`), count > 0);
    assert.deepEqual(container.descendants('button').filter(node => node.textContent.startsWith('残り ')).map(node => node.textContent), count > 5 ? [`残り ${count - 5} 本を表示`] : []);
  }
});

test('age appears only beyond seven Japanese calendar days, across midnight and year boundary', () => {
  for (const [time, served, expected] of [
    ['2026-10-28T14:59:59Z', '2026-10-21', ''],
    ['2026-10-28T15:00:00Z', '2026-10-21', '8 日前'],
    ['2026-10-28T15:00:00Z', '2026-10-22', ''],
    ['2026-10-28T15:00:00Z', '2026-10-23', ''],
    ['2027-01-01T00:00:00+09:00', '2026-12-24', '8 日前'],
  ]) {
    const container = draw([item(1, served)], japanDay(Date.parse(time)));
    const ages = container.descendants('small').filter(node => node.textContent.includes('日前'));
    assert.equal(ages.map(node => node.textContent.trim()).join(''), expected);
    assert.equal(container.descendants('time')[0].textContent, served);
  }
});
