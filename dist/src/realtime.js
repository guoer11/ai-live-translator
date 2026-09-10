// WebRTC transports microphone audio. The data channel carries subtitles/control only.
export class RealtimeTranslator {
  constructor({ endpoint, language, accessCode, onEvent, onState, onError }) {
    Object.assign(this, { endpoint, language, accessCode, onEvent, onState, onError });
    this.closed = false; this.queue = []; this.active = null; this.responses = new Map();
    this.seen = new Set(); this.abort = new AbortController();
  }
  async start() {
    if (!globalThis.isSecureContext) throw new Error('請使用 HTTPS 網址開啟翻譯。');
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) throw new Error('這個瀏覽器不支援麥克風即時翻譯，請改用 Safari。');
    this.onState('connecting');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (this.closed) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream;
    this.pc = new RTCPeerConnection();
    for (const track of stream.getAudioTracks()) {
      this.pc.addTrack(track, stream);
      track.onended = () => this.fail('麥克風已中斷，請重新開始翻譯。');
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
    const response = await fetch(this.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access-Code': this.accessCode },
      body: JSON.stringify({ sdp: offer.sdp, language: this.language }), signal: this.abort.signal,
    });
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
  handle(e) {
    if (this.closed) return;
    if (e.type === 'input_audio_buffer.speech_started') this.onState('listening');
    if (e.type === 'input_audio_buffer.committed' && !this.seen.has(e.item_id)) {
      this.seen.add(e.item_id);
      this.onEvent({ kind: 'input', id: e.item_id });
      this.queue.push(e.item_id); this.next();
    }
    if (e.type === 'conversation.item.input_audio_transcription.completed') {
      this.onEvent({ kind: 'original', id: e.item_id, text: e.transcript });
    }
    if (e.type === 'conversation.item.input_audio_transcription.failed') {
      this.onEvent({ kind: 'original', id: e.item_id, text: '（這句原文無法辨識）' });
    }
    if (e.type === 'response.created') this.responses.set(e.response.id, e.response.metadata?.input_item_id || this.active);
    const id = this.responses.get(e.response_id);
    if (e.type === 'response.output_text.delta' && id) this.onEvent({ kind: 'delta', id, text: e.delta });
    if (e.type === 'response.output_text.done' && id) this.onEvent({ kind: 'translation', id, text: e.text });
    if (e.type === 'response.done') {
      const inputId = this.responses.get(e.response.id) || e.response.metadata?.input_item_id;
      const text = (e.response.output || []).flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('\n');
      if (inputId) this.onEvent({ kind: 'done', id: inputId, text, status: e.response.status === 'completed' ? 'done' : 'failed' });
      this.responses.delete(e.response.id);
      if (inputId === this.active) { clearTimeout(this.responseTimer); this.active = null; this.next(); }
    }
    if (e.type === 'error') this.fail('翻譯服務回報錯誤，請停止後重試。');
  }
  next() {
    if (this.closed || this.active) return;
    const id = this.queue.shift();
    if (!id) { this.onState('listening'); return; }
    this.active = id; this.onState('translating');
    // One response per input item: rapid turns cannot overwrite each other's captions.
    this.send({ type: 'response.create', response: {
      conversation: 'none', metadata: { input_item_id: id }, output_modalities: ['text'],
      input: [{ type: 'item_reference', id }],
    }});
    this.responseTimer = setTimeout(() => this.fail('翻譯回應逾時，已停止收音。請重新開始。'), 45000);
  }
  fail(message) { if (this.closed) return; this.stop(); this.onError(message); }
  stop() {
    if (this.closed) return;
    this.closed = true; this.abort.abort(); this.readyReject?.(new Error('已停止連線'));
    for (const timer of [this.limitTimer, this.connectTimer, this.responseTimer, this.disconnectTimer]) clearTimeout(timer);
    this.dc?.close(); this.pc?.close(); this.stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    this.queue = []; this.responses.clear(); this.seen.clear();
  }
}
