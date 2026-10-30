export const COMMENT_LIMIT = 1000;
export const commentLength = text => Array.from(text).length;
export const WRITE_PERMISSION_MESSAGE = 'コメントを記録するには、もう一度ログインして書き込みを許可してください';

export function createComments(store, drive, { demo = false, onChange = () => {}, onError = () => {}, now = Date.now } = {}) {
  const state = store.state.comments;
  let running;
  const scope = () => demo ? 'demo' : store.state.settings.path;
  const key = id => JSON.stringify([scope(), id]);
  function record(source, comment, generated) {
    if (!source?.id || source.feedKey || typeof comment !== 'string') return false;
    if (commentLength(comment) > COMMENT_LIMIT) {
      onError('コメントは 1000 字までです。短くしてから保存してください。');
      return false;
    }
    if (comment === (paper(source, generated).comment || '')) return false;
    const time = Math.max(now(), state.lastAt + 1);
    const event = { id: source.id, comment, at: new Date(time + 9 * 3600_000).toISOString().replace('Z', '+09:00') };
    const previous = state.overrides[key(source.id)];
    state.overrides[key(source.id)] = event;
    state.lastAt = time;
    if (!demo) state.pending.push({ path: scope(), event });
    if (!store.save()) {
      if (previous) state.overrides[key(source.id)] = previous; else delete state.overrides[key(source.id)];
      if (!demo) state.pending.pop();
      onError('端末に保存できなかったため、コメントの変更を取り消しました。');
      return false;
    }
    onChange();
    return true;
  }
  function paper(source, generated) {
    if (source.feedKey) return source;
    const event = state.overrides[key(source.id)];
    if (!event) return source;
    const pending = state.pending.some(entry => entry.path === scope() && entry.event.id === source.id && entry.event.at === event.at);
    const caughtUp = (source.comment || '') === event.comment;
    const expired = Date.parse(generated) - Date.parse(event.at) >= 24 * 3600_000;
    if (!demo && !pending && (caughtUp || expired)) {
      delete state.overrides[key(source.id)];
      store.save();
      return source;
    }
    return { ...source, comment: event.comment };
  }
  async function send() {
    onError('');
    while (state.pending.length) {
      const entry = state.pending[0];
      if (entry.path !== store.state.settings.path) {
        onError('未送信の記録を送るには、設定の survey フォルダの道筋を記録時のものに戻してください。');
        break;
      }
      try {
        await drive.appendComment(entry.event);
        state.pending.shift();
        if (!store.save()) {
          state.pending.unshift(entry);
          throw new Error('送信済みの記録を端末に保存できません。次回、ドライブの記録を確認して再試行します。');
        }
        onChange();
      } catch (error) {
        onError(error.status === 403 ? WRITE_PERMISSION_MESSAGE : error.status === 401 ? 'コメントの記録は端末に残っています。もう一度ログインしてください。' : error.message || 'コメントの記録を送信できません。通信が戻ったときに再試行します。', error);
        break;
      }
    }
  }
  function flush() {
    if (demo) return Promise.resolve();
    if (!state.pending.length && !running) return Promise.resolve();
    if (!running) running = send().finally(() => { running = null; });
    return running;
  }
  return { record, paper, flush, pendingCount: () => demo ? 0 : state.pending.length };
}
