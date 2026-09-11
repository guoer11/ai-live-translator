let stream = null;
let audioContext = null;
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

function sendRuntime(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function publish(original = '', translated = '', pending = false) {
  if (!activeTabId) return;
  sendRuntime({ type: 'OFFSCREEN_SUBTITLE', tabId: activeTabId, original, translated, pending });
}

function fail(message) {
  if (closed) return;
  stopCapture();
  sendRuntime({ type: 'OFFSCREEN_ERROR', error: message || '翻譯連線已中斷。' });
}

function send(event) {
  if (!closed && dc?.readyState === 'open') dc.send(JSON.stringify(event));
}

function reserve(id) {
  if (!id || turns.has(id)) return;
  turns.set(id, { id, state: 'waiting', original: '', translated: '' });
  queue.push(id);
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

  // Do not override the server-owned session instructions here. The session
  // contains the shared Pokémon TCG glossary and Taiwan terminology rules.
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

  if (event.type === 'input_audio_buffer.committed') reserve(event.item_id);

  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    reserve(event.item_id);
    const turn = turns.get(event.item_id);
    if (!turn || turn.state !== 'waiting') return;
    const original = String(event.transcript || '').trim();
    if (!original) {
      turn.state = 'failed';
      translateNext();
      return;
    }
    turn.original = original;
    turn.state = 'ready';
    // Keep the previous completed subtitle visible while this new sentence is
    // being translated. Replacing it with "翻譯中…" made readable subtitles
    // disappear too early during continuous video playback.
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
    // Buffer partial model output. The previous completed subtitle remains on
    // screen until the new translation is complete, preventing flicker.
    return;
  }

  if (event.type === 'response.output_text.done' && itemId) {
    const turn = turns.get(itemId);
    if (!turn) return;
    turn.translated = String(event.text || turn.translated || '').trim();
    if (turn.translated) publish(turn.original, turn.translated, false);
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
      publish(turn.original, turn.translated || '（翻譯無法確認）', false);
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
  closed = false;
  activeTabId = options.tabId;
  language = options.language;
  endpoint = options.endpoint;
  accessToken = options.accessToken;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: options.streamId,
        },
      },
      video: false,
    });

    // tabCapture 會讓該分頁本身靜音；把擷取到的音訊重新接回喇叭。
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioContext.destination);

    pc = new RTCPeerConnection();
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    dc = pc.createDataChannel('oai-events');
    dc.onmessage = message => {
      try { handleEvent(JSON.parse(message.data)); }
      catch { fail('字幕資料格式異常，請重新開始。'); }
    };
    dc.onclose = () => { if (!closed) fail('翻譯連線已關閉，請重新開始。'); };
    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'failed') fail('網路連線失敗，請停止後重試。');
    };

    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('連線逾時，請重新開始。')), 25000);
      dc.onopen = () => { clearTimeout(timer); resolve(); };
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ sdp: offer.sdp, language }),
      cache: 'no-store',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || '無法建立翻譯連線。');
    }
    const answer = await response.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await ready;
    publish('', '正在聆聽影片音訊…', true);
  } catch (error) {
    const message = error?.message || '無法開始影片翻譯。';
    stopCapture();
    throw new Error(message);
  }
}

function stopCapture() {
  closed = true;
  clearTimeout(responseTimer);
  responseTimer = null;
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
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;
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
