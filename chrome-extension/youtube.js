// Runs in MAIN world via chrome.scripting. No tokens or extension state are passed.
export async function probeYouTubeCaptions(language) {
  const hosts = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalizeTrack = (track = {}) => ({
    ...track,
    languageCode: String(track.languageCode || track.language_code || track.lang || '').trim(),
    kind: String(track.kind || '').trim(),
    baseUrl: String(track.baseUrl || track.base_url || '').trim(),
    vssId: String(track.vssId || track.vss_id || '').trim(),
  });
  const trackKey = track => `${track.languageCode}|${track.kind}|${track.vssId}|${track.baseUrl}`;

  if (!hosts.has(location.hostname)) return null;
  const player = document.getElementById('movie_player');
  const videoId = new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];
  if (!videoId || player?.classList.contains('ad-showing')) return null;

  try { player?.loadModule?.('captions'); } catch {}
  try { player?.loadModule?.('subtitles'); } catch {}
  let apiTracks = [];
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const tracks = player?.getOption?.('captions', 'tracklist');
      if (Array.isArray(tracks) && tracks.length) { apiTracks = tracks.map(normalizeTrack); break; }
    } catch {}
    await sleep(120);
  }

  const responses = [];
  try { responses.push(player?.getPlayerResponse?.()); } catch {}
  responses.push(window.ytInitialPlayerResponse);
  responses.push(window.ytplayer?.config?.args?.raw_player_response);
  const raw = window.ytplayer?.config?.args?.player_response;
  if (typeof raw === 'string') {
    try { responses.push(JSON.parse(raw)); } catch {}
  } else responses.push(raw);

  const responseTracks = [];
  for (const response of responses.filter(Boolean)) {
    if (response?.videoDetails?.videoId && response.videoDetails.videoId !== videoId) continue;
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (Array.isArray(tracks)) responseTracks.push(...tracks.map(normalizeTrack));
  }

  const merged = new Map();
  for (const track of [...responseTracks, ...apiTracks]) {
    const key = trackKey(track);
    if (!merged.has(key)) merged.set(key, track);
  }
  const candidates = [...merged.values()]
    .filter(t => t.languageCode?.split('-')[0] === language)
    .sort((a, b) => Number(a.kind === 'asr') - Number(b.kind === 'asr'))
    .slice(0, 4);

  for (const track of candidates) {
    if (!track.baseUrl) continue;
    try {
      const url = new URL(track.baseUrl);
      if (url.protocol !== 'https:' || !hosts.has(url.hostname)
        || url.pathname !== '/api/timedtext' || url.username || url.password) continue;
      url.searchParams.set('fmt', 'json3');
      const r = await fetch(url.href, { credentials: 'same-origin', signal: AbortSignal.timeout(2500) });
      if (!r.ok || !r.body) continue;
      const reader = r.body.getReader(); let size = 0, text = ''; const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 4_000_000) { await reader.cancel(); text = ''; break; }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      if (!text.trim()) continue;
      const payload = JSON.parse(text);
      if (Array.isArray(payload.events) && payload.events.some(e => e.segs?.some(s => s.utf8?.trim())))
        return { videoId, payload, kind: track.kind === 'asr' ? 'automatic' : 'manual', languageCode: track.languageCode };
    } catch { /* try the next track */ }
  }

  // Newer YouTube sessions can expose and render captions while /api/timedtext
  // returns a successful but empty response. Fall back to the rendered player captions.
  const live = candidates[0] || apiTracks.find(t => t.languageCode?.split('-')[0] === language);
  if (live) {
    try { player?.setOption?.('captions', 'track', live); } catch {}
    try {
      if (typeof player?.isSubtitlesOn === 'function' && !player.isSubtitlesOn()) player.toggleSubtitlesOn?.();
    } catch {}
    return {
      videoId,
      live: true,
      kind: live.kind === 'asr' ? 'automatic' : 'manual',
      languageCode: live.languageCode || language,
    };
  }
  return null;
}

export async function chooseSource(tab, language, executeScript, parse) {
  try {
    const url = new URL(tab.url || '');
    if (!['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) return { source: 'tab' };
    const [result] = await executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: probeYouTubeCaptions, args: [language] });
    const data = result?.result;
    if (data?.videoId && data?.live) {
      return {
        source: 'caption',
        captionKind: data.kind === 'automatic' ? 'automatic' : 'manual',
        captionLanguage: data.languageCode || language,
        liveCaptions: true,
        videoId: data.videoId,
        cues: [],
      };
    }
    const cues = parse(data?.payload);
    if (data?.videoId && cues.length) return {
      source: 'caption',
      captionKind: data.kind === 'automatic' ? 'automatic' : 'manual',
      captionLanguage: data.languageCode || language,
      liveCaptions: false,
      videoId: data.videoId,
      cues,
    };
  } catch { /* A probe failure does not disable translation. */ }
  return { source: 'tab' };
}
