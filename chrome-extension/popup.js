const $ = id => document.getElementById(id);
let running = false;
let signedIn = false;

function setStatus(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function render(state = {}) {
  running = !!state.running;
  signedIn = !!state.email;
  $('account').textContent = state.email || '尚未登入';
  $('login').hidden = signedIn;
  $('logout').hidden = !signedIn;
  $('toggle').textContent = running ? '停止翻譯' : '開始翻譯目前分頁';
  $('toggle').classList.toggle('running', running);
  $('language').disabled = running;
  $('size').disabled = running;
  $('toggle').disabled = !signedIn && !running;
  if (state.language) $('language').value = state.language;
  if (state.size) $('size').value = state.size;
  if (state.message) setStatus(state.message, !!state.error);
  else setStatus(running ? '翻譯中，字幕會顯示在影片下方。' : '準備就緒');
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '操作失敗，請再試一次。');
  return response;
}

$('login').addEventListener('click', async () => {
  $('login').disabled = true;
  setStatus('正在開啟 Google 登入…');
  try { render((await send({ type: 'LOGIN' })).state); }
  catch (error) { setStatus(error.message, true); }
  finally { $('login').disabled = false; }
});

$('logout').addEventListener('click', async () => {
  try { render((await send({ type: 'LOGOUT' })).state); }
  catch (error) { setStatus(error.message, true); }
});

$('toggle').addEventListener('click', async () => {
  $('toggle').disabled = true;
  setStatus(running ? '正在停止…' : '正在擷取目前分頁音訊…');
  try {
    const type = running ? 'STOP_TRANSLATION' : 'START_TRANSLATION';
    const response = await send({ type, language: $('language').value, size: $('size').value });
    render(response.state);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    $('toggle').disabled = false;
  }
});

for (const id of ['language', 'size']) {
  $(id).addEventListener('change', () => chrome.storage.local.set({ [`pref_${id}`]: $(id).value }));
}

(async () => {
  const prefs = await chrome.storage.local.get(['pref_language', 'pref_size']);
  if (prefs.pref_language) $('language').value = prefs.pref_language;
  if (prefs.pref_size) $('size').value = prefs.pref_size;
  try { render((await send({ type: 'GET_STATUS' })).state); }
  catch (error) { setStatus(error.message, true); }
})();
