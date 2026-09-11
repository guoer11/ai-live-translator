import { config } from '../config.js';
import { History } from './history.js';
import { RealtimeTranslator } from './realtime.js';
import { auth, authorize, signIn } from './auth.js';
const $ = id => document.getElementById(id);
const billing = document.createElement('p');
billing.className = 'settings-note';
const billingLink = document.createElement('a');
billingLink.href = 'https://platform.openai.com/settings/organization/billing/overview';
billingLink.target = '_blank';
billingLink.rel = 'noopener noreferrer';
billingLink.textContent = '查看 OpenAI 餘額／儲值 ↗';
billing.append(billingLink, document.createElement('br'), '餘額以 OpenAI 帳務頁面為準，需登入付款帳號查看。');
$('account-email').after(billing);
let storage; try { storage = sessionStorage; } catch { /* Private browser restrictions. */ }
let prefs = {}; try { prefs = JSON.parse(localStorage.getItem('translator.preferences') || '{}'); } catch {}
if (!prefs || typeof prefs !== 'object') prefs = {};
const history = new History(storage, prefs.retention === 5 ? 5 : 10);
$('language').value = ['en', 'ja', 'ko'].includes(prefs.language) ? prefs.language : 'en';
$('retention').value = String(history.minutes);
$('font-size').value = prefs.large ? 'large' : 'normal';
document.body.classList.toggle('large', !!prefs.large);
let client = null, started = 0, wakeLock = null, demoMode = false;
let account = null, authRevision = 0, starting = false;
let standby = false, standbyTimer = null;
const STANDBY_MS = 30000;
function lock(message = '請使用家庭 Google 帳號登入。') {
  account = null; stop(); history.clear(); render();
  $('settings').close(); document.querySelector('.app').hidden = true;
  $('auth-gate').hidden = false; $('auth-message').textContent = message;
}
async function checkLogin() {
  const revision = ++authRevision;
  try {
    const verified = await authorize();
    if (revision !== authRevision) return;
    if (account?.userId !== verified.userId) { stop(); history.clear(); render(); }
    account = verified; $('account-email').textContent = verified.email;
    $('auth-gate').hidden = true; document.querySelector('.app').hidden = false;
  } catch (error) { if (revision === authRevision) lock(error.message); }
}
$('google-login').onclick = async () => {
  $('google-login').disabled = true;
  try { await signIn(); } catch (error) { $('auth-message').textContent = error.message; }
  finally { $('google-login').disabled = false; }
};
async function signOut() {
  ++authRevision; lock();
  const { error } = await auth.signOut({ scope: 'local' });
  if (error) $('auth-message').textContent = '登出未完成，請連線後再按一次登出。';
}
$('sign-out').onclick = signOut;
$('gate-sign-out').onclick = signOut;
auth.onAuthStateChange((event) => {
  // Supabase callbacks must not await another Auth method under its internal lock.
  if (event === 'SIGNED_OUT') { ++authRevision; lock(); }
  else setTimeout(checkLogin, 0);
});
let updateReady = false, updateReloading = false;
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
function reloadForUpdate() {
  if (updateReloading || client) return;
  updateReloading = true;
  window.location.reload();
}
function state(value) {
  $('status').textContent = { connecting: '正在連線…', listening: '收音中', translating: '正在翻譯…', standby: '待機中', stopped: '已停止', demo: '字幕示範 · 非即時翻譯' }[value] || '尚未開始';
  $('empty-title').textContent = { connecting: '正在連線…', listening: '聽取中…', translating: '正在翻譯…', standby: '待機中，30 秒內可快速繼續' }[value] || '準備好，就開始說話';
}
function controls(active) {
  $('language').disabled = active; $('demo').disabled = active; $('settings-button').disabled = active; $('clear').disabled = active;
  $('start').dataset.active = String(active);
  $('start').setAttribute('aria-pressed', String(active));
  $('start').setAttribute('aria-label', active ? '停止翻譯' : '開始翻譯');
  $('start-label').textContent = active ? '停止翻譯' : '開始翻譯';
}
function render() {
  const pane = $('conversation');
  const followLatest = pane.scrollHeight - pane.clientHeight - pane.scrollTop < 80;
  const anchor = [...$('history').children].find(li => li.getBoundingClientRect().bottom > pane.getBoundingClientRect().top);
  const anchorOffset = anchor?.getBoundingClientRect().top;
  const anchorId = anchor?.dataset.id;
  history.prune(); $('count').textContent = history.items.length;
  $('retention-label').textContent = `只保留最近 ${history.minutes} 分鐘，不同步到其他裝置`;
  $('empty').hidden = history.items.length > 0;
  const frag = document.createDocumentFragment();
  for (const row of history.items) {
    const li = document.createElement('li');
    li.dataset.id = row.id; li.dataset.status = row.status;
    const time = document.createElement('time'); time.dateTime = new Date(row.at).toISOString(); time.textContent = new Date(row.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) + (row.demo ? ' · 示範' : '');
    const original = document.createElement('p'); original.className = 'original'; original.textContent = row.original || '辨識原文中…';
    const translated = document.createElement('p'); translated.className = 'translated'; translated.textContent = row.translated || (row.status === 'pending' ? '翻譯中…' : '未完成翻譯');
    li.append(time, original, translated);
    if (['failed', 'interrupted'].includes(row.status)) { const label = document.createElement('p'); label.className = 'item-status'; label.textContent = '翻譯中斷，內容可能不完整'; li.append(label); }
    frag.append(li);
  }
  $('history').replaceChildren(frag);
  if (followLatest) pane.scrollTop = pane.scrollHeight;
  else {
    const restored = [...$('history').children].find(li => li.dataset.id === anchorId);
    if (restored) pane.scrollTop += restored.getBoundingClientRect().top - anchorOffset;
  }
  updateJump();
}
function updateJump() {
  const pane = $('conversation');
  $('jump-latest').hidden = pane.scrollHeight - pane.clientHeight - pane.scrollTop < 80;
}
$('conversation').addEventListener('scroll', updateJump, { passive: true });
$('jump-latest').onclick = () => { $('conversation').scrollTop = $('conversation').scrollHeight; updateJump(); };
function onEvent(e) {
  if (e.kind === 'input') history.add({ id: e.id });
  // ASR and model output are independent; upsert allows either event ordering.
  if (!history.items.some(x => x.id === e.id)) history.add({ id: e.id });
  const row = history.items.find(x => x.id === e.id);
  if (e.kind === 'original') history.update(e.id, { original: e.text });
  if (e.kind === 'delta') history.update(e.id, { translated: row.translated + e.text });
  if (e.kind === 'translation') history.update(e.id, { translated: e.text });
  if (e.kind === 'done') history.update(e.id, { translated: e.text || row.translated, status: e.status });
  render();
}
function stop(message = '') {
  clearTimeout(standbyTimer); standbyTimer = null; standby = false;
  const old = client; client = null; old?.stop();
  wakeLock?.release().catch(() => {}); wakeLock = null;
  history.items.forEach(x => { if (x.status === 'pending') x.status = 'interrupted'; });
  history.save(); controls(false); state('stopped'); if (message) notice(message); render();
  if (updateReady) setTimeout(reloadForUpdate, 0);
}
function microphoneError(error, fallback = '連線失敗，請稍後再試。') {
  const messages = { NotAllowedError: '無法使用麥克風，請在 Safari 的網站設定允許麥克風後重試。', NotFoundError: '找不到麥克風，請確認裝置或耳機已連接。', NotReadableError: '麥克風目前無法使用，請關閉其他收音程式後重試。', AbortError: '連線已取消。' };
  return messages[error?.name] || error?.message || fallback;
}
async function enterStandby() {
  if (!client || standby) return;
  const session = client;
  standby = true; controls(false); state('standby');
  notice('已停止傳送音訊；30 秒內再按麥克風可快速繼續。');
  wakeLock?.release().catch(() => {}); wakeLock = null;
  try {
    await session.pauseInput();
  } catch (error) {
    if (client === session) stop(microphoneError(error, '無法進入待機，翻譯連線已關閉。'));
    return;
  }
  if (client !== session || !standby) return;
  if (updateReady) { stop(); return; }
  standbyTimer = setTimeout(() => {
    if (client === session && standby) stop('快速待機已結束；下次按麥克風會重新連線。');
  }, STANDBY_MS);
}
async function resumeStandby() {
  if (!client || !standby) return;
  if (!navigator.onLine) { stop('目前沒有網路，連線後再開始翻譯。'); return; }
  const session = client;
  clearTimeout(standbyTimer); standbyTimer = null; standby = false;
  notice(); controls(true); state('connecting');
  try {
    await session.resumeInput();
    if (client !== session) return;
    state('listening');
    if (navigator.wakeLock) {
      try { const lock = await navigator.wakeLock.request('screen'); if (client === session && !standby) wakeLock = lock; else await lock.release(); } catch {}
    }
  } catch (error) {
    if (client === session) stop(microphoneError(error, '快速恢復失敗，請再按一次麥克風重新連線。'));
  }
}
$('start').onclick = async () => {
  if (starting) return;
  if (client) {
    starting = true;
    try { if (standby) await resumeStandby(); else await enterStandby(); }
    finally { starting = false; }
    return;
  }
  if (!navigator.onLine) { notice('目前沒有網路，連線後才能開始翻譯。'); return; }
  if (!config.sessionEndpoint) { notice('即時翻譯尚未啟用：管理者完成後端連線設定後即可使用。你可以先查看字幕示範。'); return; }
  starting = true;
  let verified;
  const revision = authRevision;
  try { verified = await authorize(); }
  catch (error) { lock(error.message); return; }
  if (!account || revision !== authRevision || verified.userId !== account.userId || document.hidden) { starting = false; return; }
  if (demoMode) { history.items = history.items.filter(x => !x.demo); demoMode = false; }
  notice(); controls(true); started = Date.now(); $('elapsed').textContent = '00:00';
  const session = new RealtimeTranslator({ endpoint: config.sessionEndpoint, language: $('language').value, accessToken: verified.token,
    onState: value => { if (client === session) state(value); },
    onEvent: e => { if (client === session) onEvent(e); },
    onError: message => { if (client === session) stop(message); },
  });
  client = session;
  try {
    await session.start();
    if (client === session && navigator.wakeLock) {
      try { const lock = await navigator.wakeLock.request('screen'); if (client === session && !standby) wakeLock = lock; else await lock.release(); } catch {}
    }
  } catch (error) {
    if (client === session) stop(microphoneError(error));
  } finally { starting = false; }
};
$('settings-button').onclick = () => $('settings').showModal();
$('close-settings').onclick = () => $('settings').close();
$('settings-form').onsubmit = e => {
  e.preventDefault();
  history.minutes = Number($('retention').value); document.body.classList.toggle('large', $('font-size').value === 'large');
  savePreferences(); render(); $('settings').close();
};
function savePreferences() { try { localStorage.setItem('translator.preferences', JSON.stringify({ language: $('language').value, retention: history.minutes, large: document.body.classList.contains('large') })); } catch {} }
$('language').onchange = () => {
  if (standby && client) stop('翻譯語言已變更，下次開始會使用新語言。');
  savePreferences(); if (demoMode) { history.items = history.items.filter(x => !x.demo); history.save(); demoMode = false; state('stopped'); render(); }
};
$('clear').onclick = () => { history.clear(); demoMode = false; state(standby ? 'standby' : 'stopped'); render(); };
$('demo').onclick = () => {
  if (client) stop();
  $('settings').close();
  const text = { en: ['Excuse me, how do I get to the station?', '不好意思，請問車站怎麼走？'], ja: ['すみません、駅はどこですか？', '不好意思，請問車站在哪裡？'], ko: ['실례합니다. 역이 어디에 있나요?', '不好意思，請問車站在哪裡？'] }[$('language').value];
  history.items = history.items.filter(x => !x.demo);
  history.add({ id: 'demo-' + Date.now(), original: text[0], translated: text[1], status: 'done', demo: true });
  demoMode = true; state('demo'); notice('這是字幕顯示示範，沒有開啟麥克風或呼叫翻譯服務。'); render();
  $('conversation').scrollTop = $('conversation').scrollHeight; updateJump();
};
setInterval(() => {
  const count = history.items.length; history.prune(); if (count !== history.items.length) render();
  if (client) { const seconds = Math.floor((Date.now() - started) / 1000); $('elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
}, 1000);
document.addEventListener('visibilitychange', () => { if (document.hidden && client) stop('已切換到背景，為避免持續連線已停止翻譯。'); if (!document.hidden) render(); });
window.addEventListener('pagehide', () => { if (client) stop(); });
window.addEventListener('offline', () => { if (client) stop('網路已中斷，已停止收音。'); else notice('目前離線，可以查看尚未到期的字幕。'); });
window.addEventListener('online', () => notice('網路已恢復，可以開始翻譯。'));
if ('serviceWorker' in navigator) {
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    updateReady = true;
    if (client) notice('新版本已下載，停止翻譯後會自動更新。');
    else reloadForUpdate();
  });
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname }).then(registration => {
    const activate = worker => {
      if (worker?.state === 'installed' && navigator.serviceWorker.controller) worker.postMessage({ type: 'SKIP_WAITING' });
    };
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => activate(worker));
    });
    registration.update().catch(() => {});
    setInterval(() => registration.update().catch(() => {}), 5 * 60 * 1000);
  }).catch(() => notice('離線快取無法啟用；有網路時仍可使用翻譯。'));
}
render();
if (!config.sessionEndpoint) notice('即時翻譯尚待後端設定完成。可先點「先看字幕示範」查看介面。');
