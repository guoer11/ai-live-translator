(() => {
  if (globalThis.__AI_LIVE_TRANSLATOR_OVERLAY__) return;
  globalThis.__AI_LIVE_TRANSLATOR_OVERLAY__ = true;

  const HOST_ID = '__ai_live_translate_overlay__';
  const NATIVE_CAPTION_STYLE_ID = '__ai_live_translate_hide_native_captions__';
  let captionMode = false;
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

        /* Caption mode visually replaces YouTube's own subtitle line. The original
           Japanese/English cue stays available to the translator but is not duplicated. */
        .caption-mode{background:transparent;border:0;border-radius:0;padding:0;box-shadow:none;backdrop-filter:none;line-height:1.35}
        .caption-mode .original{display:none}
        .caption-mode .translated{display:inline;padding:2px 9px 4px;background:rgba(8,8,8,.72);border-radius:2px;font-size:28px;font-weight:650;line-height:1.35;-webkit-box-decoration-break:clone;box-decoration-break:clone;text-shadow:0 1px 4px rgba(0,0,0,1),0 0 2px rgba(0,0,0,.95)}
        .caption-mode.small .translated{font-size:22px}
        .caption-mode.large .translated{font-size:34px}
        .caption-mode.error{background:transparent}
        .caption-mode.error .translated{background:rgba(126,24,20,.86)}
        @media(max-width:700px){.translated{font-size:25px}.large .translated{font-size:31px}.caption-mode .translated{font-size:22px}.caption-mode.large .translated{font-size:27px}}
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

  function hideNativeYouTubeCaptions() {
    if (document.getElementById(NATIVE_CAPTION_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = NATIVE_CAPTION_STYLE_ID;
    // Keep caption DOM alive for the live-caption fallback. Opacity is used instead
    // of display:none/visibility:hidden so YouTube keeps rendering/updating cue text.
    style.textContent = '.ytp-caption-window-container{opacity:0!important;pointer-events:none!important}';
    (document.head || document.documentElement).appendChild(style);
  }

  function restoreNativeYouTubeCaptions() {
    document.getElementById(NATIVE_CAPTION_STYLE_ID)?.remove();
  }

  function playerRect() {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    const rect = player?.getBoundingClientRect?.();
    if (!rect || rect.width < 160 || rect.height < 90 || rect.bottom <= 0 || rect.top >= window.innerHeight) return null;
    return rect;
  }

  function applyAudioLayout() {
    host.style.left = '50%';
    host.style.bottom = '7vh';
    host.style.width = 'min(88vw, 1100px)';
  }

  function applyCaptionLayout() {
    const rect = playerRect();
    if (!rect) {
      applyAudioLayout();
      return;
    }
    const center = rect.left + rect.width / 2;
    const offsetFromPlayerBottom = Math.max(44, Math.min(90, rect.height * 0.105));
    host.style.left = `${center}px`;
    host.style.bottom = `${Math.max(10, window.innerHeight - rect.bottom + offsetFromPlayerBottom)}px`;
    host.style.width = `${Math.max(260, Math.min(1100, rect.width * 0.86))}px`;
  }

  function setDisplayMode(source) {
    captionMode = source === 'caption' && /(^|\.)youtube\.com$/.test(location.hostname);
    box.classList.toggle('caption-mode', captionMode);
    if (captionMode) {
      hideNativeYouTubeCaptions();
      applyCaptionLayout();
    } else {
      restoreNativeYouTubeCaptions();
      applyAudioLayout();
    }
  }

  function moveIntoFullscreen() {
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
    if (captionMode) applyCaptionLayout();
  }

  document.addEventListener('fullscreenchange', moveIntoFullscreen, true);
  window.addEventListener('resize', () => { if (captionMode) applyCaptionLayout(); }, { passive: true });
  window.addEventListener('scroll', () => { if (captionMode) applyCaptionLayout(); }, { passive: true });

  chrome.runtime.onMessage.addListener(message => {
    if (!message?.type?.startsWith('AI_TRANSLATOR_')) return;

    if (message.type === 'AI_TRANSLATOR_SHOW') {
      box.classList.remove('small', 'medium', 'large', 'pending', 'error');
      box.classList.add(message.size || 'medium');
      setDisplayMode(message.source);
      original.textContent = '';
      translated.textContent = captionMode ? '正在連接字幕翻譯…' : '正在連接 AI 即時翻譯…';
      host.style.display = 'block';
      moveIntoFullscreen();
      return;
    }

    if (message.type === 'AI_TRANSLATOR_HIDE') {
      host.style.display = 'none';
      captionMode = false;
      box.classList.remove('caption-mode');
      restoreNativeYouTubeCaptions();
      applyAudioLayout();
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
