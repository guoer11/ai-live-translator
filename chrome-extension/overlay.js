(() => {
  if (globalThis.__AI_LIVE_TRANSLATOR_OVERLAY__) return;
  globalThis.__AI_LIVE_TRANSLATOR_OVERLAY__ = true;

  const HOST_ID = '__ai_live_translate_overlay__';
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.left = '50%';
    host.style.bottom = '7vh';
    host.style.transform = 'translateX(-50%)';
    host.style.width = 'min(88vw, 1100px)';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'none';
    host.style.display = 'none';

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .box{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif;background:rgba(8,12,18,.34);color:#fff;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:8px 16px 10px;box-shadow:0 3px 16px rgba(0,0,0,.18);backdrop-filter:blur(2px);text-align:center;line-height:1.4;text-wrap:balance}
        .original{font-size:16px;color:rgba(255,255,255,.82);margin:0 0 3px;min-height:1.2em;text-shadow:0 1px 4px rgba(0,0,0,.95),0 0 2px rgba(0,0,0,.9)}
        .translated{font-size:30px;font-weight:700;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;text-shadow:0 2px 6px rgba(0,0,0,1),0 0 3px rgba(0,0,0,.95)}
        .small .original{font-size:13px}.small .translated{font-size:24px}
        .large .original{font-size:19px}.large .translated{font-size:38px}
        .pending .translated{opacity:.9}
        .error{background:rgba(126,24,20,.82)}
        @media(max-width:700px){.translated{font-size:25px}.large .translated{font-size:31px}}
      </style>
      <div class="box medium">
        <p class="original"></p>
        <p class="translated">AI 即時翻譯準備中…</p>
      </div>`;

    const parent = document.fullscreenElement || document.documentElement;
    parent.appendChild(host);
  }

  const root = host.shadowRoot;
  const box = root.querySelector('.box');
  const original = root.querySelector('.original');
  const translated = root.querySelector('.translated');

  function moveIntoFullscreen() {
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  document.addEventListener('fullscreenchange', moveIntoFullscreen, true);

  chrome.runtime.onMessage.addListener(message => {
    if (!message?.type?.startsWith('AI_TRANSLATOR_')) return;

    if (message.type === 'AI_TRANSLATOR_SHOW') {
      box.classList.remove('small', 'medium', 'large', 'pending', 'error');
      box.classList.add(message.size || 'medium');
      original.textContent = '';
      translated.textContent = '正在連接 AI 即時翻譯…';
      host.style.display = 'block';
      moveIntoFullscreen();
      return;
    }

    if (message.type === 'AI_TRANSLATOR_HIDE') {
      host.style.display = 'none';
      return;
    }

    if (message.type === 'AI_TRANSLATOR_SUBTITLE') {
      box.classList.toggle('pending', !!message.pending);
      box.classList.remove('error');
      if (message.original) original.textContent = message.original;
      if (message.translated) translated.textContent = message.translated;
      host.style.display = 'block';
      moveIntoFullscreen();
      return;
    }

    if (message.type === 'AI_TRANSLATOR_ERROR') {
      box.classList.add('error');
      box.classList.remove('pending');
      original.textContent = '';
      translated.textContent = message.message || '翻譯連線已中斷。';
      host.style.display = 'block';
      moveIntoFullscreen();
    }
  });
})();
