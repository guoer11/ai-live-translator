import { config } from '../config.js';
import { History } from './history.js';
import { RealtimeTranslator } from './realtime.js';
const $ = id => document.getElementById(id);
let storage; try { storage = sessionStorage; } catch { /* Private browser restrictions. */ }
let prefs = {}; try { prefs = JSON.parse(localStorage.getItem('translator.preferences') || '{}'); } catch {}
if (!prefs || typeof prefs !== 'object') prefs = {};
const history = new History(storage, prefs.retention === 5 ? 5 : 10);
$('language').value = ['en', 'ja', 'ko'].includes(prefs.language) ? prefs.language : 'en';
$('retention').value = String(history.minutes);
$('font-size').value = prefs.large ? 'large' : 'normal';
document.body.classList.toggle('large', !!prefs.large);
let accessCode = '', client = null, started = 0, wakeLock = null, demoMode = false;
let updateReady = false, updateReloading = false;
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
function reloadForUpdate() {
  if (updateReloading || client) return;
  updateReloading = true;
  window.location.reload();
}
function state(value) {
  $('status').textContent = { connecting: '正在連線…', listening: '收音中', translating: '正在翻譯…', stopped: '已停止', demo: '字幕示範 · 非即時翻譯' }[value] || '尚未開始';
  $('empty-title').textContent = { connecting: '正在連線…', listening: '聽取中…', translating: '正在翻譯…' }[value] || '準備好，就開始說話';
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
  const old = client; client = null; old?.stop();
  wakeLock?.release().catch(() => {}); wakeLock = null;
  history.items.forEach(x => { if (x.status === 'pending') x.status = 'interrupted'; });
  history.save(); controls(false); state('stopped'); if (message) notice(message); render();
  if (updateReady) setTimeout(reloadForUpdate, 0);
}
$('start').onclick = async () => {
  if (client) { stop(); return; }
  if (!navigator.onLine) { notice('目前沒有網路，連線後才能開始翻譯。'); return; }
  if (!config.sessionEndpoint) { notice('即時翻譯尚未啟用：管理者完成後端連線設定後即可使用。你可以先查看字幕示範。'); return; }
  if (!accessCode) { notice('請先在設定輸入測試使用碼。'); $('settings').showModal(); return; }
  if (demoMode) { history.items = history.items.filter(x => !x.demo); demoMode = false; }
  notice(); controls(true); started = Date.now(); $('elapsed').textContent = '00:00';
  const session = new RealtimeTranslator({ endpoint: config.sessionEndpoint, language: $('language').value, accessCode,
    onState: value => { if (client === session) state(value); },
    onEvent: e => { if (client === session) onEvent(e); },
    onError: message => { if (client === session) stop(message); },
  });
  client = session;
  try {
    await session.start();
    if (client === session && navigator.wakeLock) {
      try { const lock = await navigator.wakeLock.request('screen'); if (client === session) wakeLock = lock; else await lock.release(); } catch {}
    }
  } catch (error) {
    if (client !== session) return;
    const messages = { NotAllowedError: '無法使用麥克風，請在 Safari 的網站設定允許麥克風後重試。', NotFoundError: '找不到麥克風，請確認裝置或耳機已連接。', NotReadableError: '麥克風目前無法使用，請關閉其他收音程式後重試。', AbortError: '連線已取消。' };
    stop(messages[error.name] || error.message || '連線失敗，請稍後再試。');
  }
};
$('settings-button').onclick = () => $('settings').showModal();
$('close-settings').onclick = () => $('settings').close();
$('settings-form').onsubmit = e => {
  e.preventDefault(); accessCode = $('access-code').value.trim();
  history.minutes = Number($('retention').value); document.body.classList.toggle('large', $('font-size').value === 'large');
  savePreferences(); render(); $('settings').close();
};
function savePreferences() { try { localStorage.setItem('translator.preferences', JSON.stringify({ language: $('language').value, retention: history.minutes, large: document.body.classList.contains('large') })); } catch {} }
$('language').onchange = () => { savePreferences(); if (demoMode) { history.items = history.items.filter(x => !x.demo); history.save(); demoMode = false; state('stopped'); render(); } };
$('clear').onclick = () => { history.clear(); demoMode = false; state('stopped'); render(); };
$('demo').onclick = () => {
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
document.addEventListener('visibilitychange', () => { if (document.hidden && client) stop('已切換到背景，為避免持續收音已停止翻譯。'); if (!document.hidden) render(); });
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