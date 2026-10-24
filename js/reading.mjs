export const WRITE_PERMISSION_MESSAGE = '読了を記録するには、もう一度ログインして書き込みを許可してください';

export function createReading(store, drive, { demo = false, onChange = () => {}, onError = () => {}, now = Date.now } = {}) {
  const state = store.state.reading;
  let running;
  const scope = () => demo ? 'demo' : store.state.settings.path;
  const key = id => JSON.stringify([scope(), id]);
  function record(id, readStatus) {
    const time = Math.max(now(), state.lastAt + 1);
    const event = { id, read_status: readStatus, at: new Date(time + 9 * 3600_000).toISOString().replace('Z', '+09:00') };
    const previous = state.overrides[key(id)];
    state.overrides[key(id)] = event;
    state.lastAt = time;
    if (!demo) state.pending.push({ path: scope(), event });
    if (!store.save()) {
      if (previous) state.overrides[key(id)] = previous; else delete state.overrides[key(id)];
      if (!demo) state.pending.pop();
      onError('端末に保存できなかったため、読了の変更を取り消しました。');
      return false;
    }
    onChange();
    return true;
  }
  function paper(paper, generated) {
    const event = state.overrides[key(paper.id)];
    if (!event) return paper;
    const generatedAt = Date.parse(generated);
    if (!demo && Date.parse(event.at) <= generatedAt) {
      delete state.overrides[key(paper.id)];
      store.save();
      return paper;
    }
    return { ...paper, read_status: event.read_status };
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
        await drive.appendReading(entry.event);
        state.pending.shift();
        if (!store.save()) {
          state.pending.unshift(entry);
          throw new Error('送信済みの記録を端末に保存できません。次回、ドライブの記録を確認して再試行します。');
        }
        onChange();
      } catch (error) {
        onError(error.status === 403 ? WRITE_PERMISSION_MESSAGE : error.status === 401 ? '読了の記録は端末に残っています。もう一度ログインしてください。' : error.message || '読了の記録を送信できません。通信が戻ったときに再試行します。', error);
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
