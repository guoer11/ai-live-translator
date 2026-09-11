// Runs in MAIN world via chrome.scripting. No tokens or extension state are passed.
const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeTrack(track = {}) {
  return {
    ...track,
    languageCode: String(track.languageCode || track.language_code || track.lang || '').trim(),
    kind: String(track.kind || '').trim(),
    baseUrl: String(track.baseUrl || track.base_url || '').trim(),
    vssId: String(track.vssId || track.vss_id || '').trim(),
  };
}

function trackKey(track) {
  return `${track.languageCode}|${track.kind}|${track.vssId}|${track.baseUrl}`;
}

async function playerCaptionTracks(player) {
  try { player?.loadModule?.('captions'); } catch {}
  try { player?.loadModule?.('subtitles'); } catch {}
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const tracks = player?.getOption?.('captions', 'tracklist');
      if (Array.isArray(tracks) && tracks.length) return tracks.map(normalizeTrack);
    } catch {}
    await sleep(120);
  }
  return [];
}

function playerResponse(player) {
  const candidates = [];
  try { candidates.push(player?.getPlayerResponse?.()); } catch {}
  candidates.push(window.ytInitialPlayerResponse);
  candidates.push(window.ytplayer?.config?.args?.raw_player_response);
  const raw = window.ytplayer?.config?.args?.player_response;
  if (typeof raw === 'string') {
    try { candidates.push(JSON.parse(raw)); } catch {}
  } else candidates.push(raw);
  return candidates.filter(Boolean);
}

async function fetchCaptionPayload(track) {
  if (!track.baseUrl) return null;
  try {
    const url = new URL(track.baseUrl);
    if (url.protocol !== 'https:' || !YOUTUBE_HOSTS.has(url.hostname)
      || url.pathname !== '/api/timedtext' || url.username || url.password) return null;
    url.searchParams.set('fmt', 'json3');
    const r = await fetch(url.href, { credentials: 'same-origin', signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const reader = r.body?.getReader?.();
    if (!reader) return null;
    let size = 0, text = ''; const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4_000_000) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (!text.trim()) return null;
    const payload = JSON.parse(text);
    return Array.isArray(payload.events) && payload.events.some(e => e.segs?.some(s => s.utf8?.trim())) ? payload : null;
  } catch { return null; }
}

function enableLiveCaptionTrack(player, track) {
  try { player?.loadModule?.('captions'); } catch {}
  try { player?.loadModule?.('subtitles'); } catch {}
  try { player?.setOption?.('captions', 'track', track); } catch {}
  try {
    if (typeof player?.isSubtitlesOn === 'function' && !player.isSubtitlesOn()) player.toggleSubtitlesOn?.();
  } catch {}
}

export async function probeYouTubeCaptions(language) {
  if (!YOUTUBE_HOSTS.has(location.hostname)) return null;
  const player = document.getElementById('movie_player');
  const videoId = new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];
  if (!videoId || player?.classList.contains('ad-showing')) return null;

  const apiTracks = await playerCaptionTracks(player);
  const responseTracks = [];
  for (const response of playerResponse(player)) {
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

  // Prefer the existing timedtext path when YouTube still returns usable JSON3.
  for (const track of candidates) {
    const payload = await fetchCaptionPayload(track);
    if (payload) return { videoId, payload, kind: track.kind === 'asr' ? 'automatic' : 'manual', languageCode: track.languageCode };
  }

  // Newer YouTube sessions can expose a caption track to the player while /api/timedtext
  // returns an empty body. In that case use the captions already rendered by the player.
  const live = candidates[0] || apiTracks.find(t => t.languageCode?.split('-')[0] === language);
  if (live) {
    enableLiveCaptionTrack(player, live);
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
    if (!YOUTUBE_HOSTS.has(url.hostname)) return { source: 'tab' };
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
