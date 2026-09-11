// Isolated world: only playback state crosses to the extension, never credentials.
(() => {
  if (globalThis.__AI_CAPTION_CLOCK__) return;
  globalThis.__AI_CAPTION_CLOCK__ = true;
  let timer = null, sessionId = '', expectedVideo = '', missing = 0;
  const currentVideoId = () => new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];
  function stop() { clearInterval(timer); timer = null; sessionId = ''; }
  function notify(message) { chrome.runtime.sendMessage(message).catch(stop); }
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
    notify({ type: 'CAPTION_TICK', sessionId, time: video.currentTime,
      paused: video.paused || player?.classList.contains('ad-showing'), seeking: video.seeking });
  }
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'AI_CAPTION_STOP') { stop(); reply({ ok: true }); }
    if (message?.type === 'AI_CAPTION_START') {
      stop(); sessionId = message.sessionId; expectedVideo = message.videoId;
      missing = 0; timer = setInterval(tick, 100); tick(); reply({ ok: true });
    }
  });
})();
