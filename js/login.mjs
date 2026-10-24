export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file';
export const validSession = (session, now = Date.now()) => Boolean(session?.accessToken && Number.isFinite(session.expiresAt) && session.expiresAt > now);

export function parseRedirect(hash, pending, now = Date.now()) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const handled = ['access_token', 'error', 'state'].some(key => params.has(key));
  if (!handled) return { handled: false };
  if (!pending?.state || !Number.isFinite(pending.createdAt) || params.get('state') !== pending.state || now - pending.createdAt > 600_000 || now < pending.createdAt) {
    return { handled: true, error: 'ログインを確認できませんでした（state が一致しないか、時間が経過しました）。もう一度ログインしてください。' };
  }
  if (params.has('error')) return { handled: true, error: 'ログインがキャンセルされたか、許可されませんでした。' };
  const seconds = Number(params.get('expires_in'));
  if (!params.get('access_token') || params.get('token_type')?.toLowerCase() !== 'bearer' || !Number.isFinite(now + seconds * 1000) || seconds <= 0) {
    return { handled: true, error: 'ログインの応答を読めませんでした。もう一度ログインしてください。' };
  }
  return { handled: true, session: { accessToken: params.get('access_token'), expiresAt: now + seconds * 1000 } };
}

export function consumeRedirect(location, history, store, now = Date.now()) {
  const result = parseRedirect(location.hash, store.state.pendingLogin, now);
  if (result.handled) {
    history.replaceState(null, '', location.pathname + location.search);
    store.state.pendingLogin = null;
    store.state.session = result.session || null;
    store.save();
  }
  return result;
}

export function redirectURL(clientId, redirectUri, state) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'token', scope: DRIVE_SCOPE, state }).toString();
  return url.href;
}

let gisPromise;
export function loadGIS(document, global = globalThis) {
  if (global.google?.accounts?.oauth2) return Promise.resolve(global.google.accounts.oauth2);
  if (!gisPromise) gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const timer = setTimeout(() => finish(new Error('ログイン用スクリプトを読み込めません。通信を確認してください。')), 15000);
    function finish(error) {
      clearTimeout(timer);
      if (error) { gisPromise = null; script.remove(); reject(error); }
      else resolve(global.google.accounts.oauth2);
    }
    script.onload = () => finish(global.google?.accounts?.oauth2 ? null : new Error('ログインを準備できませんでした。'));
    script.onerror = () => finish(new Error('ログイン用スクリプトを読み込めません。'));
    document.head.append(script);
  });
  return gisPromise;
}
