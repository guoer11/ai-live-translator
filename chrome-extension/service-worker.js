import { config } from './config.js';
import { parseCaptions } from './captions.js';
import { chooseSource } from './youtube.js';
let operation = 0, starting = false;

const AUTH_KEY = 'translator_extension_auth_v1';
const STATE_KEY = 'translator_extension_state_v1';
const OFFSCREEN_URL = 'offscreen.html';

async function getState() {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return stored[STATE_KEY] || { running: false };
}

async function setState(patch) {
  const next = { ...(await getState()), ...patch };
  await chrome.storage.session.set({ [STATE_KEY]: next });
  return next;
}

async function clearState(message = '') {
  const next = { running: false, tabId: null, language: null, size: null, source: null, sessionId: null, message };
  await chrome.storage.session.set({ [STATE_KEY]: next });
  return next;
}

async function getAuth() {
  const stored = await chrome.storage.local.get(AUTH_KEY);
  return stored[AUTH_KEY] || null;
}

async function saveAuth(auth) {
  await chrome.storage.local.set({ [AUTH_KEY]: auth });
  return auth;
}

async function clearAuth() {
  await chrome.storage.local.remove(AUTH_KEY);
}

async function verifyAccessToken(accessToken) {
  const response = await fetch(config.sessionEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '家庭帳號驗證失敗。');
  return data;
}

async function refreshAuth(auth) {
  if (!auth?.refreshToken) throw new Error('Google 登入已過期，請重新登入。');
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: config.supabaseKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: auth.refreshToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    await clearAuth();
    throw new Error('Google 登入已過期，請重新登入。');
  }
  const verified = await verifyAccessToken(data.access_token);
  return saveAuth({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || auth.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    email: verified.email,
    userId: verified.userId,
  });
}

async function ensureAuth() {
  let auth = await getAuth();
  if (!auth?.accessToken) throw new Error('請先使用家庭 Google 帳號登入。');
  if (!auth.expiresAt || auth.expiresAt - Date.now() < 90_000) auth = await refreshAuth(auth);
  return auth;
}

async function login() {
  const redirectTo = chrome.identity.getRedirectURL('supabase-auth');
  const url = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  const finalUrl = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  if (!finalUrl) throw new Error('Google 登入未完成。');

  const resultUrl = new URL(finalUrl);
  const params = new URLSearchParams(resultUrl.hash.slice(1));
  const error = params.get('error_description') || params.get('error');
  if (error) throw new Error(decodeURIComponent(error));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) {
    throw new Error('登入回傳資料不完整。請確認 Supabase 已允許 Chrome Extension 的 Redirect URL。');
  }
  const verified = await verifyAccessToken(accessToken);
  return saveAuth({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Number(params.get('expires_in') || 3600) * 1000,
    email: verified.email,
    userId: verified.userId,
  });
}

async function logout() {
  const auth = await getAuth();
  if (auth?.accessToken) {
    fetch(`${config.supabaseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${auth.accessToken}` },
    }).catch(() => {});
  }
  await stopTranslation();
  await clearAuth();
}

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = chrome.runtime.getContexts
    ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })
    : [];
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: '擷取目前分頁音訊並維持 WebRTC 即時翻譯連線',
  });
}

async function injectOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] });
  } catch {
    throw new Error('這個分頁無法顯示字幕。請在一般網站或 YouTube 影片頁使用。');
  }
}

async function sendToTab(tabId, message) {
  try { await chrome.tabs.sendMessage(tabId, message); } catch {}
}

async function startTranslation(language = 'en', size = 'medium', targetTabId = null, forceAudio = false) {
  const current = await getState();
  if (current.running) return current;
  if (starting) throw new Error('正在連線，請稍候。');
  starting = true;
  const run = ++operation;
  let tab;
  const check = () => { if (run !== operation) throw new Error('連線已取消。'); };
  try {
  const auth = await ensureAuth();
  tab = targetTabId ? await chrome.tabs.get(targetTabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id) throw new Error('找不到目前分頁。');
  if (tab.url && !/^https?:\/\//i.test(tab.url)) throw new Error('請在一般網頁或 YouTube 影片分頁使用。');
  let selected = forceAudio ? { source: 'tab' } : await chooseSource(tab, language, args => chrome.scripting.executeScript(args), parseCaptions);
  check();
  if (selected.source === 'caption') {
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['caption-source.js'] }); }
    catch { selected = { source: 'tab' }; }
  }

  await injectOverlay(tab.id);
  await sendToTab(tab.id, { type: 'AI_TRANSLATOR_SHOW', language, size });
  await ensureOffscreen();
  check();

  let streamId;
  if (selected.source === 'tab') {
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch {
    await sendToTab(tab.id, { type: 'AI_TRANSLATOR_HIDE' });
    throw new Error('無法擷取這個分頁的音訊，請重新整理影片頁後再試。');
  }
  }
  check();
  const sessionId = crypto.randomUUID();

  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'START_CAPTURE',
    streamId,
    tabId: tab.id,
    language,
    accessToken: auth.accessToken,
    endpoint: config.sessionEndpoint,
    source: selected.source,
    cues: selected.cues,
    sessionId,
  });
  if (!response?.ok) {
    await sendToTab(tab.id, { type: 'AI_TRANSLATOR_HIDE' });
    throw new Error(response?.error || '無法開始分頁翻譯。');
  }

  check();
  const state = await setState({ running: true, tabId: tab.id, language, size, source: selected.source, sessionId,
    message: selected.source === 'caption' ? 'YouTube 字幕 → AI 翻譯' : '分頁音訊 → ASR → AI 翻譯' });
  if (selected.source === 'caption') {
    const ack = await chrome.tabs.sendMessage(tab.id, { type: 'AI_CAPTION_START', sessionId, videoId: selected.videoId });
    if (!ack?.ok) throw new Error('無法讀取影片播放位置，請重新開始。');
  }
  return state;
  } catch (error) {
    if (run === operation) {
      if (tab?.id) await sendToTab(tab.id, { type: 'AI_TRANSLATOR_HIDE' });
      await stopTranslation(error.message);
    }
    throw error;
  } finally { starting = false; }
}

async function stopTranslation(message = '已停止翻譯。') {
  operation++;
  const state = await getState();
  if (state.tabId) await sendToTab(state.tabId, { type: 'AI_CAPTION_STOP' });
  if (state.tabId) await sendToTab(state.tabId, { type: 'AI_TRANSLATOR_HIDE' });
  try { await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_CAPTURE' }); } catch {}
  try {
    if (chrome.offscreen?.closeDocument) await chrome.offscreen.closeDocument();
  } catch {}
  return clearState(message);
}

async function publicState(message, error = false) {
  const auth = await getAuth();
  const state = await getState();
  return {
    ...state,
    email: auth?.email || null,
    message: message ?? state.message,
    error,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.target === 'offscreen') return false;
  if (sender.tab) {
    if (!['CAPTION_TICK', 'CAPTION_VIDEO_CHANGED', 'CAPTION_UNAVAILABLE'].includes(message?.type)) return false;
    (async () => {
      const state = await getState();
      if (!state.running || state.source !== 'caption' || state.tabId !== sender.tab.id || state.sessionId !== message.sessionId) return;
      if (message.type === 'CAPTION_TICK') {
        if (!Number.isFinite(message.time) || message.time < 0) return;
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CAPTION_TICK', sessionId: state.sessionId,
          time: message.time, paused: !!message.paused, seeking: !!message.seeking });
      } else {
        await stopTranslation('影片已變更，重新判斷字幕來源…');
        await startTranslation(state.language, state.size, state.tabId, message.type === 'CAPTION_UNAVAILABLE');
      }
    })().catch(error => stopTranslation(error.message));
    return false;
  }

  if (message?.type === 'OFFSCREEN_SUBTITLE') {
    if (sender.url !== chrome.runtime.getURL(OFFSCREEN_URL)) return false;
    const { tabId, original, translated, pending } = message;
    getState().then(state => {
      if (state.running && state.tabId === tabId && state.sessionId === message.sessionId)
        return sendToTab(tabId, { type: 'AI_TRANSLATOR_SUBTITLE', original, translated, pending });
    });
    return false;
  }
  if (message?.type === 'OFFSCREEN_ERROR') {
    if (sender.url !== chrome.runtime.getURL(OFFSCREEN_URL)) return false;
    (async () => {
      const state = await getState();
      if (!state.running || state.sessionId !== message.sessionId) return;
      if (state.tabId) await sendToTab(state.tabId, { type: 'AI_TRANSLATOR_ERROR', message: message.error });
      await stopTranslation(message.error || '翻譯連線已中斷。');
    })();
    return false;
  }

  (async () => {
    try {
      if (message?.type === 'GET_STATUS') return sendResponse({ ok: true, state: await publicState() });
      if (message?.type === 'LOGIN') {
        const auth = await login();
        return sendResponse({ ok: true, state: await publicState(`已登入 ${auth.email}`) });
      }
      if (message?.type === 'LOGOUT') {
        await logout();
        return sendResponse({ ok: true, state: await publicState('已登出。') });
      }
      if (message?.type === 'START_TRANSLATION') {
        const state = await startTranslation(message.language, message.size);
        return sendResponse({ ok: true, state: { ...state, email: (await getAuth())?.email || null } });
      }
      if (message?.type === 'STOP_TRANSLATION') {
        const state = await stopTranslation();
        return sendResponse({ ok: true, state: { ...state, email: (await getAuth())?.email || null } });
      }
      sendResponse({ ok: false, error: '不支援的操作。' });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || '操作失敗。' });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const state = await getState();
  if (state.running && state.tabId === tabId) await stopTranslation('影片分頁已關閉。');
});
