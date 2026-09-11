import { CaptionClock, CaptionTranslator } from './captions.js';
let stream = null;
let sourceMode = 'tab', captionClock = null, captionTranslator = null, sessionId = '';
let generation = 0, connectAbort = null, connectTimer = null, readyReject = null;
let audioContext = null;
let audioMonitorTimer = null;
let pc = null;
let dc = null;
let closed = true;
let activeTabId = null;
let language = 'en';
let endpoint = '';
let accessToken = '';
let queue = [];
let turns = new Map();
let responses = new Map();
let activeTurn = null;
let responseTimer = null;
let audioDetected = false;
let transcriptDetected = false;
let lastCompleted = { original: '', translated: '' };

function sendRuntime(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function publish(original = '', translated = '', pending = false) {
  if (!activeTabId) return;
  sendRuntime({ type: 'OFFSCREEN_SUBTITLE', sessionId, tabId: activeTabId, original, translated, pending });
}

function fail(message) {
  if (closed) return;
  const failedSession = sessionId;
  stopCapture();
  sendRuntime({ type: 'OFFSCREEN_ERROR', sessionId: failedSession, error: message || '翻譯連線已中斷。' });
}

function send(event) {
  if (!closed && dc?.readyState === 'open') dc.send(JSON.stringify(event));
}

function reserve(id) {
  if (!id || turns.has(id)) return;
  turns.set(id, { id, state: 'waiting', original: '', partial: '', translated: '' });
  queue.push(id);
}

function startAudioMonitor(source) {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const startedAt = Date.now();
  let announcedAudio = false;

  clearInterval(audioMonitorTimer);
  audioMonitorTimer = setInterval(() => {
    if (closed || !audioContext) return;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const sample of data) sum += sample * sample;
    const rms = Math.sqrt(sum / data.length);
    if (rms > 0.003) {
      audioDetected = true;
      if (!announcedAudio && !transcriptDetected && !lastCompleted.translated) {
        announcedAudio = true;
        publish('', '已偵測到影片音訊，正在辨識…', true);
      }
    } else if (!audioDetected && Date.now() - startedAt > 4500 && !transcriptDetected) {
      publish('', '尚未偵測到分頁音訊，請確認影片正在播放且有聲音。', true);
    }
  }, 300);
}

function translateNext() {
  if (closed || activeTurn) return;
  while (queue.length && turns.get(queue[0])?.state === 'failed') queue.shift();
  const id = queue[0];
  if (!id) return;
  const turn = turns.get(id);
  if (!turn || turn.state !== 'ready') return;
  queue.shift();
  turn.state = 'translating';
  activeTurn = id;

  send({
    type: 'response.create',
    response: {
      conversation: 'none',
      metadata: { input_item_id: id },
      output_modalities: ['text'],
      input: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: turn.original }],
      }],
    },
  });

  clearTimeout(responseTimer);
  responseTimer = setTimeout(() => fail('翻譯回應逾時，請停止後再試。'), 45000);
}

function handleEvent(event) {
  if (closed || !event?.type) return;
  if (sourceMode === 'caption') {
    if (event.type === 'error' && event.error?.code !== 'response_cancel_not_active') fail('字幕翻譯服務回報錯誤，請停止後重試。');
    else captionTranslator?.handle(event);
    return;
  }

  if (event.type === 'input_audio_buffer.speech_started') {
    if (!lastCompleted.translated && !transcriptDetected) publish('', '偵測到語音，正在辨識…', true);
    return;
  }

  if (event.type === 'input_audio_buffer.committed') reserve(event.item_id);

  if (event.type === 'conversation.item.input_audio_transcription.delta') {
    reserve(event.item_id);
    const turn = turns.get(event.item_id);
    if (!turn || turn.state !== 'waiting') return;
    transcriptDetected = true;
    turn.partial += event.delta || '';
    const partial = turn.partial.trim();
    if (partial) publish(partial, lastCompleted.translated || '正在辨識並翻譯…', true);
    return;
  }

  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    reserve(event.item_id);
    const turn = turns.get(event.item_id);
    if (!turn || turn.state !== 'waiting') return;
    transcriptDetected = true;
    const original = String(event.transcript || turn.partial || '').trim();
    if (!original) {
      turn.state = 'failed';
      translateNext();
      return;
    }
    turn.original = original;
    turn.state = 'ready';
    publish(original, lastCompleted.translated || '正在翻譯…', true);
    translateNext();
    return;
  }

  if (event.type === 'conversation.item.input_audio_transcription.failed') {
    reserve(event.item_id);
    const turn = turns.get(event.item_id);
    if (turn) turn.state = 'failed';
    translateNext();
    return;
  }

  if (event.type === 'response.created') {
    const id = event.response?.metadata?.input_item_id || activeTurn;
    if (event.response?.id && id) responses.set(event.response.id, id);
    return;
  }

  const responseId = event.response_id || event.response?.id;
  const itemId = responseId ? responses.get(responseId) : null;

  if (event.type === 'response.output_text.delta' && itemId) {
    const turn = turns.get(itemId);
    if (!turn) return;
    turn.translated += event.delta || '';
    // Show partial Chinese as soon as it exists; this makes video subtitles feel
    // realtime while still preserving the previous completed line beforehand.
    if (turn.translated.trim()) publish(turn.original, turn.translated.trim(), true);
    return;
  }

  if (event.type === 'response.output_text.done' && itemId) {
    const turn = turns.get(itemId);
    if (!turn) return;
    turn.translated = String(event.text || turn.translated || '').trim();
    if (turn.translated) {
      lastCompleted = { original: turn.original, translated: turn.translated };
      publish(turn.original, turn.translated, false);
    }
    return;
  }

  if (event.type === 'response.done') {
    const id = responses.get(event.response?.id) || event.response?.metadata?.input_item_id || activeTurn;
    if (id && turns.has(id)) {
      const turn = turns.get(id);
      const text = (event.response?.output || [])
        .flatMap(x => x.content || [])
        .filter(x => x.type === 'output_text')
        .map(x => x.text || '')
        .join('\n')
        .trim();
      if (text) turn.translated = text;
      turn.state = 'done';
      const translated = turn.translated || '（翻譯無法確認）';
      lastCompleted = { original: turn.original, translated };
      publish(turn.original, translated, false);
    }
    if (event.response?.id) responses.delete(event.response.id);
    clearTimeout(responseTimer);
    responseTimer = null;
    if (id === activeTurn) activeTurn = null;
    translateNext();
    return;
  }

  if (event.type === 'error') fail('翻譯服務回報錯誤，請停止後重試。');
}

async function startCapture(options) {
  stopCapture();
  const run = generation;
  closed = false;
  connectAbort = new AbortController();
  sourceMode = options.source === 'caption' ? 'caption' : 'tab';
  sessionId = options.sessionId;
  activeTabId = options.tabId;
  language = options.language;
  endpoint = options.endpoint;
  accessToken = options.accessToken;
  audioDetected = false;
  transcriptDetected = false;
  lastCompleted = { original: '', translated: '' };

  try {
    if (sourceMode === 'tab') {
    const captured = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: options.streamId,
        },
      },
      video: false,
    });
    if (closed || run !== generation) { captured.getTracks().forEach(t => t.stop()); return; }
    stream = captured;

    if (!stream.getAudioTracks().length) throw new Error('這個分頁沒有可擷取的音訊軌。');

    // tabCapture 會讓該分頁本身靜音；把擷取到的音訊重新接回喇叭。
    audioContext = new AudioContext();
    await audioContext.resume().catch(() => {});
    if (closed || run !== generation) return;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioContext.destination);
    startAudioMonitor(source);
    }

    pc = new RTCPeerConnection();
    if (sourceMode === 'tab') for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    dc = pc.createDataChannel('oai-events');
    dc.onmessage = message => {
      if (run !== generation) return;
      try { handleEvent(JSON.parse(message.data)); }
      catch { fail('字幕資料格式異常，請重新開始。'); }
    };
    dc.onclose = () => { if (!closed && run === generation) fail('翻譯連線已關閉，請重新開始。'); };
    pc.onconnectionstatechange = () => {
      if (run === generation && pc?.connectionState === 'failed') fail('網路連線失敗，請停止後重試。');
    };

    const ready = new Promise((resolve, reject) => {
      readyReject = reject;
      connectTimer = setTimeout(() => { reject(new Error('連線逾時，請重新開始。')); connectAbort?.abort(); }, 25000);
      dc.onopen = () => { clearTimeout(connectTimer); readyReject = null; resolve(); };
    });
    ready.catch(() => {});

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ sdp: offer.sdp, language, source: sourceMode }),
      cache: 'no-store',
      signal: connectAbort.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || '無法建立翻譯連線。');
    }
    const answer = await response.text();
    if (closed || run !== generation) return;
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await ready;
    if (closed || run !== generation) return;
    if (sourceMode === 'caption') {
      captionTranslator = new CaptionTranslator({ send, publish });
      captionClock = new CaptionClock(options.cues, cue => captionTranslator.update(cue), () => captionTranslator.reset());
      publish('', '字幕模式：等待影片字幕…', true);
    } else publish('', '正在偵測影片音訊…', true);
  } catch (error) {
    const message = error?.message || '無法開始影片翻譯。';
    if (run === generation) stopCapture();
    throw new Error(message);
  }
}

function stopCapture() {
  generation++;
  captionTranslator?.stop(); captionTranslator = null; captionClock = null;
  closed = true;
  sessionId = '';
  connectAbort?.abort(); connectAbort = null;
  clearTimeout(connectTimer); connectTimer = null;
  readyReject?.(new Error('連線已取消。')); readyReject = null;
  clearTimeout(responseTimer);
  clearInterval(audioMonitorTimer);
  responseTimer = null;
  audioMonitorTimer = null;
  try { dc?.close(); } catch {}
  try { pc?.close(); } catch {}
  for (const track of stream?.getTracks?.() || []) {
    try { track.stop(); } catch {}
  }
  if (audioContext) audioContext.close().catch(() => {});
  stream = null;
  audioContext = null;
  pc = null;
  dc = null;
  queue = [];
  turns.clear();
  responses.clear();
  activeTurn = null;
  activeTabId = null;
  audioDetected = false;
  transcriptDetected = false;
  lastCompleted = { original: '', translated: '' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab) return false;
  if (message.type === 'CAPTION_TICK') {
    if (message.sessionId === sessionId && !closed) {
      if ([...captionTranslator?.jobs?.values() || []].some(j => Date.now() - j.started > 15000)) fail('字幕翻譯逾時，請重新開始。');
      else captionClock?.tick(message.time, message.paused, message.seeking);
    }
    return false;
  }
  (async () => {
    try {
      if (message.type === 'START_CAPTURE') {
        await startCapture(message);
        sendResponse({ ok: true });
        return;
      }
      if (message.type === 'STOP_CAPTURE') {
        stopCapture();
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: '不支援的音訊操作。' });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || '音訊擷取失敗。' });
    }
  })();
  return true;
});
