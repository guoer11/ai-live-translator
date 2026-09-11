import { prepareTranscript, cleanTranslation, translationInstructions } from './language.js';
// The displayed ASR text is the sole translation input, never a second audio interpretation.
export class RealtimeTranslator {
  constructor({ endpoint, language, accessToken, onEvent, onState, onError }) {
    Object.assign(this, { endpoint, language, accessToken, onEvent, onState, onError });
    this.closed = false; this.queue = []; this.active = null; this.responses = new Map();
    this.seen = new Set(); this.abort = new AbortController();
    this.turns = new Map();
    this.audioSender = null; this.audioTrack = null; this.inputPaused = false;
  }
  microphoneConstraints() {
    return { audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
  }
  async start() {
    if (!globalThis.isSecureContext) throw new Error('請使用 HTTPS 網址開啟翻譯。');
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) throw new Error('這個瀏覽器不支援麥克風即時翻譯，請改用 Safari。');
    this.onState('connecting');
    const stream = await navigator.mediaDevices.getUserMedia(this.microphoneConstraints());
    if (this.closed) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream;
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length || audioTracks.some(track => track.readyState === 'ended' || !track.enabled)) {
      throw new Error('麥克風沒有可用的音訊，請重新開始翻譯。');
    }
    this.pc = new RTCPeerConnection();
    for (const track of audioTracks) {
      this.audioSender = this.pc.addTrack(track, stream);
      this.audioTrack = track;
      this.watchAudioTrack(track);
    }
    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onmessage = message => {
      try { this.handle(JSON.parse(message.data)); } catch { this.fail('字幕資料格式異常，請重新連線。'); }
    };
    this.dc.onclose = () => { if (!this.closed) this.fail('翻譯連線已關閉，請重新開始。'); };
    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === 'failed') this.fail('網路連線失敗，請檢查網路後重新開始。');
      if (this.pc?.connectionState === 'disconnected') {
        this.disconnectTimer ??= setTimeout(() => this.fail('網路中斷，已停止收音。'), 8000);
      } else { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }
    };
    const ready = new Promise((resolve, reject) => {
      this.readyReject = reject;
      this.connectTimer = setTimeout(() => { reject(new Error('連線逾時，請重新開始翻譯。')); this.abort.abort(); }, 25000);
      this.dc.onopen = () => { clearTimeout(this.connectTimer); this.readyReject = null; resolve(); };
    });
    // Attach a rejection handler immediately while the SDP request is pending.
    ready.catch(() => {});
    const offer = await this.pc.createOffer();
    if (this.closed) return;
    await this.pc.setLocalDescription(offer);
    let response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.accessToken}` },
        body: JSON.stringify({ sdp: offer.sdp, language: this.language }), signal: this.abort.signal,
      });
    } catch (error) {
      if (this.closed) throw error;
      if (this.abort.signal.aborted) throw new Error('連線逾時，請重新開始翻譯。');
      if (!navigator.onLine) throw new Error('網路已中斷，請確認網路後重新開始。');
      const detail = `${error?.name || ''} ${error?.message || ''}`;
      if (/load failed|failed to fetch|network|fetch failed/i.test(detail)) {
        throw new Error('無法連上翻譯服務，請確認網路後再按一次麥克風。');
      }
      throw error;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || '無法建立翻譯連線，請稍後再試。');
    }
    const sdp = await response.text();
    if (this.closed) return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    await ready;
    if (this.closed) return;
    this.onState('listening');
    this.limitTimer = setTimeout(() => this.fail('本次翻譯已滿 10 分鐘，已停止收音；可以再次開始。'), 10 * 60000);
  }
  send(event) { if (!this.closed && this.dc?.readyState === 'open') this.dc.send(JSON.stringify(event)); }
  async pauseInput() {
    if (this.closed || this.inputPaused) return;
    const track = this.audioTrack;
    if (!track || !this.audioSender) throw new Error('麥克風連線狀態異常，請重新開始翻譯。');
    this.inputPaused = true;
    // Stop carrying microphone audio immediately. Keep a short silent tail so
    // server VAD can finish the last spoken turn before the sender is detached.
    track.enabled = false;
    await new Promise(resolve => setTimeout(resolve, 1400));
    if (this.closed) return;
    try {
      await this.audioSender.replaceTrack(null);
    } catch (error) {
      if (!this.closed) { track.enabled = true; this.inputPaused = false; }
      throw error;
    }
  }
  async resumeInput() {
    if (this.closed) throw new Error('翻譯連線已關閉，請重新開始。');
    if (!this.inputPaused) return;
    let track = this.audioTrack;
    let newStream = null;
    if (!track || track.readyState === 'ended') {
      newStream = await navigator.mediaDevices.getUserMedia(this.microphoneConstraints());
      if (this.closed) { newStream.getTracks().forEach(t => t.stop()); return; }
      track = newStream.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') {
        newStream.getTracks().forEach(t => t.stop());
        throw new Error('麥克風沒有可用的音訊，請重新開始翻譯。');
      }
      this.stream?.getTracks().forEach(t => { t.onended = null; t.onmute = null; t.onunmute = null; t.stop(); });
      this.stream = newStream; this.audioTrack = track; this.watchAudioTrack(track);
    }
    try {
      await this.audioSender.replaceTrack(track);
      track.enabled = true;
      this.inputPaused = false;
    } catch (error) {
      if (newStream) newStream.getTracks().forEach(t => t.stop());
      throw error;
    }
  }
  watchAudioTrack(track) {
    // A live WebRTC connection does not mean the capture source is supplying audio.
    // Tolerate a brief route change, but never silently keep a muted session alive.
    track.onended = () => this.fail('麥克風已中斷，請重新開始翻譯。');
    track.onmute = () => {
      if (this.closed || this.muteTimer) return;
      this.muteTimer = setTimeout(() => {
        this.muteTimer = null;
        if (track.muted) this.fail('麥克風音訊已中斷超過 3 秒，已停止收音。請確認通話或耳機狀態後重新開始。');
      }, 3000);
    };
    track.onunmute = () => { clearTimeout(this.muteTimer); this.muteTimer = null; };
    if (track.muted) track.onmute();
  }
  handle(e) {
    if (this.closed) return;
    if (e.type === 'input_audio_buffer.speech_started') this.onState('listening');
    if (e.type === 'input_audio_buffer.committed' && !this.seen.has(e.item_id)) {
      this.reserve(e.item_id);
    }
    if (e.type === 'conversation.item.input_audio_transcription.completed') {
      this.reserve(e.item_id);
      const turn = this.turns.get(e.item_id);
      if (turn.state !== 'waiting') return;
      clearTimeout(turn.timer);
      const parsed = prepareTranscript(e.transcript, this.language);
      if (!parsed) { this.rejectTurn(e.item_id, '這句沒有辨識到選定的語言，請再說一次。'); return; }
      Object.assign(turn, parsed, { state: 'ready' });
      this.onEvent({ kind: 'original', id: e.item_id, text: parsed.original });
      this.next();
    }
    if (e.type === 'conversation.item.input_audio_transcription.failed') {
      this.reserve(e.item_id);
      if (this.turns.get(e.item_id).state === 'waiting') this.rejectTurn(e.item_id, '這句原文無法辨識，請再說一次。');
    }
    if (e.type === 'response.created') this.responses.set(e.response.id, e.response.metadata?.input_item_id || this.active);
    const id = this.responses.get(e.response_id);
    if (e.type === 'response.output_text.delta' && id) {
      const turn = this.turns.get(id);
      turn.output = (turn.output || '') + e.delta;
      this.publishTranslation(id, turn.output);
    }
    if (e.type === 'response.output_text.done' && id) {
      this.turns.get(id).output = e.text;
      this.publishTranslation(id, e.text);
    }
    if (e.type === 'response.done') {
      const inputId = this.responses.get(e.response.id) || e.response.metadata?.input_item_id;
      const text = (e.response.output || []).flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('\n');
      if (inputId && this.turns.has(inputId)) {
        const turn = this.turns.get(inputId);
        const cleaned = cleanTranslation(text || turn.output || '', turn.targetLanguage);
        turn.state = 'done';
        this.onEvent({ kind: 'done', id: inputId, text: cleaned?.trim() ? cleaned : '（翻譯無法確認，請再說一次）', status: e.response.status === 'completed' && cleaned?.trim() ? 'done' : 'failed' });
      }
      this.responses.delete(e.response.id);
      if (inputId === this.active) { clearTimeout(this.responseTimer); this.active = null; this.next(); }
    }
    if (e.type === 'error') this.fail('翻譯服務回報錯誤，請停止後重試。');
  }
  reserve(id) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.turns.set(id, { state: 'waiting', timer: setTimeout(() => this.rejectTurn(id, '原文辨識逾時，請再說一次。'), 20000) });
    this.onEvent({ kind: 'input', id }); this.queue.push(id);
  }
  rejectTurn(id, message) {
    if (this.closed) return;
    const turn = this.turns.get(id); if (!turn || turn.state === 'failed') return;
    clearTimeout(turn.timer); turn.state = 'failed';
    this.onEvent({ kind: 'original', id, text: '（語音未確認）' });
    this.onEvent({ kind: 'done', id, text: message, status: 'failed' });
    this.next();
  }
  publishTranslation(id, text) {
    const cleaned = cleanTranslation(text, this.turns.get(id).targetLanguage);
    this.onEvent({ kind: 'translation', id, text: cleaned === null ? '（正在確認翻譯語言…）' : cleaned });
  }
  next() {
    if (this.closed || this.active) return;
    while (this.queue.length && this.turns.get(this.queue[0])?.state === 'failed') this.queue.shift();
    const id = this.queue[0];
    if (!id) { this.onState(this.inputPaused ? 'standby' : 'listening'); return; }
    const turn = this.turns.get(id);
    if (turn.state !== 'ready') return;
    this.queue.shift(); turn.state = 'translating';
    this.active = id; this.onState('translating');
    // Wait for ASR, then translate exactly the text displayed for this turn.
    this.send({ type: 'response.create', response: {
      conversation: 'none', metadata: { input_item_id: id }, output_modalities: ['text'],
      instructions: translationInstructions(turn.targetLanguage),
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.original }] }],
    }});
    this.responseTimer = setTimeout(() => this.fail('翻譯回應逾時，已停止收音。請重新開始。'), 45000);
  }
  fail(message) { if (this.closed) return; this.stop(); this.onError(message); }
  stop() {
    if (this.closed) return;
    this.closed = true; this.abort.abort(); this.readyReject?.(new Error('已停止連線'));
    for (const timer of [this.limitTimer, this.connectTimer, this.responseTimer, this.disconnectTimer, this.muteTimer]) clearTimeout(timer);
    this.dc?.close(); this.pc?.close(); this.stream?.getTracks().forEach(t => { t.onended = null; t.onmute = null; t.onunmute = null; t.stop(); });
    this.audioTrack = null; this.audioSender = null; this.inputPaused = false;
    this.queue = []; this.responses.clear(); this.seen.clear();
    for (const turn of this.turns.values()) clearTimeout(turn.timer);
    this.turns.clear();
  }
}
