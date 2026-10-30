import { normalizeFeed } from './feed.mjs';
import { normalizeFigure } from './figures.mjs';

export const DEFAULT_PATH = 'University/01_reaserch/survey';
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const string = value => typeof value === 'string' ? value : '';

export function normalizeLibrary(data) {
  if (!data || !Array.isArray(data.papers)) throw new Error('papers.json の papers 配列を読めません');
  return {
    generated: string(data.generated),
    feed: normalizeFeed(data.feed),
    papers: data.papers.filter(p => p && typeof p === 'object').map((p, index) => ({
      id: string(p.id) || `missing-id-${index}`,
      ...Object.fromEntries(['title', 'title_jp', 'authors', 'venue', 'type', 'doi', 'importance', 'read_status', 'bibtex', 'added', 'comment'].map(key => [key, string(p[key])])),
      year: typeof p.year === 'number' && Number.isFinite(p.year) ? p.year : null,
      tags: Array.isArray(p.tags) ? p.tags.filter(t => typeof t === 'string') : [],
      pdf: p.pdf && string(p.pdf.name).trim() ? { name: p.pdf.name, drive_id: string(p.pdf.drive_id) || null } : null,
      figure: normalizeFigure(p.figure),
      summary: Array.isArray(p.summary) ? p.summary.filter(s => s && typeof s === 'object').map(s => ({ heading: string(s.heading), text: string(s.text) })) : [],
    })),
  };
}

export function tagCounts(papers) {
  const counts = new Map();
  for (const paper of papers) for (const tag of new Set(paper.tags)) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
}

export function normalizeFilters(filters = {}, availableTags) {
  const tags = Array.isArray(filters?.tags) ? [...new Set(filters.tags.filter(tag => typeof tag === 'string'))] : [];
  return {
    status: ['unread', 'read'].includes(filters?.status) ? filters.status : 'all',
    tags: availableTags ? tags.filter(tag => availableTags.has(tag)) : tags,
  };
}

export function normalizeSort(sort) {
  return ['stars-desc', 'stars-asc', 'added-desc', 'added-asc'].includes(sort) ? sort : 'stars-desc';
}

function compareAdded(a, b, direction) {
  const left = Date.parse(a.added), right = Date.parse(b.added);
  if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
  if (!Number.isFinite(right)) return -1;
  return (left - right) * direction;
}

export function selectPapers(papers, query = '', filters = {}, sort) {
  const needle = query.trim().toLocaleLowerCase();
  const { status, tags } = normalizeFilters(filters);
  const stars = p => (p.importance.match(/★/g) || []).length;
  const order = normalizeSort(sort);
  return papers.filter(p => (status === 'all' || (p.read_status === '未読') === (status === 'unread'))
    && tags.every(tag => p.tags.includes(tag))
    && [p.title, p.title_jp, ...p.tags].some(s => s.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => (order.startsWith('stars')
      ? (stars(a) - stars(b)) * (order === 'stars-asc' ? 1 : -1) || compareAdded(a, b, -1)
      : compareAdded(a, b, order === 'added-asc' ? 1 : -1)) || a.title.localeCompare(b.title, 'ja'));
}

export function currentPage(tops, scrollTop, height) {
  const probe = scrollTop + Math.min(48, height * 0.2);
  let index = 0;
  while (index + 1 < tops.length && tops[index + 1] <= probe) index++;
  return index + 1;
}

export function pageLayout(sizes, width, zoom) {
  let top = 12;
  const pages = sizes.map(size => {
    const scale = Math.max(32, width - 24) / sizes[0].width * zoom;
    const page = { top, width: size.width * scale, height: size.height * scale, scale };
    top += page.height + 12;
    return page;
  });
  return { pages, height: top, width: Math.max(width, ...pages.map(p => p.width + 24)) };
}

export function canvasScale(width, height, deviceRatio) {
  return Math.min(deviceRatio || 1, Math.sqrt(4_000_000 / (width * height)), 8192 / Math.max(width, height));
}

export function errorMessage(error) {
  if (error?.status === 401 || error?.code === 'login') return 'ログインの期限が切れました。もう一度ログインしてください。';
  if (error?.status === 404) return '見つかりません。フォルダの道筋やファイル名を確認してください。';
  if (error?.status === 403) return '読み取りが許可されていません。Google アカウントと共有設定を確認してください。';
  if (error?.name === 'InvalidPDFException' || error?.name === 'PasswordException') return '読めない PDF です（破損またはパスワード保護）。';
  return error?.message || '読み込めませんでした。通信を確認して再試行してください。';
}
