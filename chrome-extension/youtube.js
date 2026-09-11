// Runs in MAIN world via chrome.scripting. No tokens or extension state are passed.
export async function probeYouTubeCaptions(language) {
  if (!['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(location.hostname)) return null;
  const player = document.getElementById('movie_player');
  const videoId = new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];
  if (!videoId || player?.classList.contains('ad-showing')) return null;
  let response;
  try { response = player?.getPlayerResponse?.(); } catch {}
  if (response?.videoDetails?.videoId !== videoId) response = window.ytInitialPlayerResponse;
  if (response?.videoDetails?.videoId !== videoId) return null;
  const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks)) return null;
  // Prefer the selected source language, manual before automatic captions.
  const candidates = tracks.filter(t => t.languageCode?.split('-')[0] === language)
    .sort((a, b) => Number(a.kind === 'asr') - Number(b.kind === 'asr')).slice(0, 2);
  for (const track of candidates) {
    try {
      const url = new URL(track.baseUrl);
      if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
        || url.pathname !== '/api/timedtext' || url.username || url.password) continue;
      url.searchParams.set('fmt', 'json3');
      const r = await fetch(url.href, { credentials: 'same-origin', signal: AbortSignal.timeout(2500) });
      if (!r.ok) continue;
      const reader = r.body.getReader(); let size = 0, text = ''; const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 4_000_000) { await reader.cancel(); throw new Error('Caption track too large'); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      const payload = JSON.parse(text);
      if (Array.isArray(payload.events) && payload.events.some(e => e.segs?.some(s => s.utf8?.trim())))
        return { videoId, payload, kind: track.kind === 'asr' ? 'automatic' : 'manual' };
    } catch { /* Missing, restricted or changed tracks use the existing audio path. */ }
  }
  return null;
}

export async function chooseSource(tab, language, executeScript, parse) {
  try {
    const url = new URL(tab.url || '');
    if (!['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) return { source: 'tab' };
    const [result] = await executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: probeYouTubeCaptions, args: [language] });
    const data = result?.result;
    const cues = parse(data?.payload);
    if (data?.videoId && cues.length) return { source: 'caption', captionKind: data.kind === 'automatic' ? 'automatic' : 'manual', videoId: data.videoId, cues };
  } catch { /* A probe failure does not disable translation. */ }
  return { source: 'tab' };
}
