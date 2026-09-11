// Isolated world: only playback/caption text crosses to the extension, never credentials.
(() => {
  if (globalThis.__AI_CAPTION_CLOCK__) return;
  globalThis.__AI_CAPTION_CLOCK__ = true;
  let timer = null, sessionId = '', expectedVideo = '', missing = 0, liveCaptions = false;
  let liveSeq = 0, liveId = '', lastLiveText = '', lastLiveChangedAt = 0;

  const currentVideoId = () => new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];
  function notify(message) { chrome.runtime.sendMessage(message).catch(stop); }
  function resetLive() { liveSeq = 0; liveId = ''; lastLiveText = ''; lastLiveChangedAt = 0; }
  function stop() { clearInterval(timer); timer = null; sessionId = ''; resetLive(); }

  function captionText() {
    return [...document.querySelectorAll('.ytp-caption-segment')]
      .map(el => String(el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('')
      .trim();
  }

  function relatedText(a, b) {
    if (!a || !b) return false;
    if (a.startsWith(b) || b.startsWith(a)) return true;
    const max = Math.min(a.length, b.length, 18);
    let prefix = 0;
    while (prefix < max && a[prefix] === b[prefix]) prefix++;
    return prefix >= Math.min(8, Math.floor(max * .6));
  }

  function emitLive(text, final, time) {
    if (!liveId) liveId = `live:${++liveSeq}`;
    notify({ type: 'CAPTION_TEXT', sessionId, cue: { id: liveId, text, final, at: time } });
  }

  function captureLive(time) {
    const text = captionText();
    if (!text) {
      if (lastLiveText) emitLive(lastLiveText, true, time);
      liveId = ''; lastLiveText = ''; lastLiveChangedAt = 0;
      return;
    }
    if (text === lastLiveText) return;
    const now = Date.now();
    const sameCue = liveId && now - lastLiveChangedAt < 3500 && relatedText(lastLiveText, text);
    if (!sameCue && lastLiveText) {
      emitLive(lastLiveText, true, time);
      liveId = '';
    }
    lastLiveText = text;
    lastLiveChangedAt = now;
    emitLive(text, false, time);
  }

  function tick() {
    if (currentVideoId() !== expectedVideo) {
      notify({ type: 'CAPTION_VIDEO_CHANGED', sessionId }); stop(); return;
    }
    const player = document.getElementById('movie_player');
    const video = player?.querySelector('video') || document.querySelector('video');
    if (!video) {
      if (++missing >= 20) { notify({ type: 'CAPTION_UNAVAILABLE', sessionId }); stop(); }
      return;
    }
    missing = 0;
    const paused = video.paused || player?.classList.contains('ad-showing');
    const seeking = video.seeking;
    if (liveCaptions) {
      if (!paused && !seeking) captureLive(video.currentTime);
      return;
    }
    notify({ type: 'CAPTION_TICK', sessionId, time: video.currentTime, paused, seeking });
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'AI_CAPTION_STOP') { stop(); reply({ ok: true }); }
    if (message?.type === 'AI_CAPTION_START') {
      stop(); sessionId = message.sessionId; expectedVideo = message.videoId;
      liveCaptions = !!message.liveCaptions; missing = 0; resetLive();
      timer = setInterval(tick, liveCaptions ? 120 : 100); tick(); reply({ ok: true });
    }
  });
})();
