// Pure JSON3 parsing and playback-time scheduling; no network or Chrome globals.
export function parseCaptions(payload) {
  if (!Array.isArray(payload?.events) || payload.events.length > 50000) return [];
  const cues = [];
  for (const [index, event] of payload.events.entries()) {
    if (!Array.isArray(event.segs) || !Number.isFinite(event.tStartMs)) continue;
    const start = event.tStartMs / 1000;
    const end = start + Math.max(0.1, Math.min(Number(event.dDurationMs) || 3000, 30000) / 1000);
    let parts = [], text = '', part = 0;
    const flush = () => {
      if (!text.trim()) return;
      cues.push({ id: `${index}:${part++}`, start: parts[0].at, end, parts });
      parts = []; text = '';
    };
    for (const seg of event.segs) {
      const value = String(seg.utf8 || '').replace(/\n/g, ' ').slice(0, 2000);
      const at = start + Math.max(0, Number(seg.tOffsetMs) || 0) / 1000;
      // Manual captions often put several sentences into one segment.
      for (const chunk of value.match(/[^。！？!?\n]{1,64}[。！？!?]?/gu) || []) {
        parts.push({ at, text: chunk }); text += chunk;
        if (/[。！？!?]$/.test(chunk) || text.length >= 48) flush();
      }
    }
    flush();
  }
  return cues.sort((a, b) => a.start - b.start);
}

export class CaptionClock {
  constructor(cues, emit, reset) { this.cues = cues; this.emit = emit; this.reset = reset; this.lastTime = null; this.sent = new Map(); this.epoch = 0; }
  tick(time, paused = false, seeking = false) {
    if (!Number.isFinite(time)) return;
    if (seeking || (this.lastTime != null && (time < this.lastTime - .5 || time > this.lastTime + 2))) {
      this.sent.clear(); this.epoch++; this.reset();
    }
    this.lastTime = time;
    if (paused || seeking) return;
    for (const cue of this.cues) {
      if (cue.start > time) break;
      if (cue.end < time) continue;
      const parts = cue.parts.filter(p => p.at <= time);
      const text = parts.map(p => p.text).join('').trim();
      const final = parts.length === cue.parts.length;
      if (!text || (!final && text.length < 8)) continue;
      const key = `${this.epoch}:${cue.id}`, previous = this.sent.get(key);
      if (previous?.text === text && previous.final === final) continue;
      // Never reset a trailing debounce: continuous captions still update promptly.
      if (previous && !final && time - previous.time < .3) continue;
      this.sent.set(key, { text, final, time });
      this.emit({ id: key, text, final, at: time });
    }
    if (this.sent.size > 400) this.sent = new Map([...this.sent].slice(-200));
  }
}

// Out-of-band Realtime responses retain session instructions (including glossary).
export class CaptionTranslator {
  constructor({ send, publish, now = Date.now }) {
    Object.assign(this, { send, publish, now });
    this.items = new Map(); this.jobs = new Map(); this.pending = new Set();
    this.order = 0; this.visible = -1; this.serial = 0;
    this.previous = ''; this.closed = false;
  }
  update(cue) {
    if (this.closed || !cue?.id || typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 2000) return;
    let item = this.items.get(cue.id);
    if (item?.text === cue.text) {
      item.final ||= cue.final;
      if (item.translation && item.displayRevision === item.revision && item.order === this.visible) this.publish(item.text, item.translation, !item.final);
      return;
    }
    if (!item) { item = { id: cue.id, order: this.order++, revision: 0 }; this.items.set(cue.id, item); }
    Object.assign(item, { text: cue.text, final: cue.final, revision: item.revision + 1, received: this.now() });
    this.pending.add(item.id);
    // Bound backlog instead of translating seconds-old captions after the speaker.
    while (this.pending.size > 4) this.pending.delete(this.pending.values().next().value);
    this.pump();
  }
  pump() {
    if (this.closed) return;
    for (const id of [...this.pending]) {
      if (this.jobs.size >= 2) break;
      if ([...this.jobs.values()].some(j => j.id === id)) continue;
      this.pending.delete(id);
      const item = this.items.get(id);
      if (!item || item.order < this.visible || this.now() - item.received > 2500) continue;
      const key = `caption:${++this.serial}`;
      this.jobs.set(key, { ...item, translation: '', started: this.now() });
      this.send({ type: 'response.create', response: { conversation: 'none', metadata: { caption_job: key },
        output_modalities: ['text'], max_output_tokens: 256,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: item.text }] }],
      } });
    }
    if (this.items.size > 300) for (const [id, item] of this.items) if (item.order < this.visible - 10) this.items.delete(id);
  }
  handle(event) {
    const key = event.response?.metadata?.caption_job;
    if (event.type === 'response.created' && key?.startsWith('caption:') && !this.jobs.has(key)) {
      this.send({ type: 'response.cancel', response_id: event.response.id }); return;
    }
    if (event.type === 'response.created' && this.jobs.has(key)) this.jobs.get(key).responseId = event.response.id;
    const job = this.jobs.get(key) || [...this.jobs.values()].find(j => j.responseId && j.responseId === (event.response_id || event.response?.id));
    if (!job) return;
    const item = this.items.get(job.id);
    if (event.type === 'response.output_text.delta') job.translation += event.delta || '';
    if (event.type === 'response.output_text.done') job.translation = event.text || job.translation;
    if (event.type === 'response.done') {
      const text = (event.response.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text || '').join('');
      if (text) job.translation = text;
    }
    if (item && job.revision >= (item.displayRevision || 0) && job.order >= this.visible && job.translation.trim()
      && ['response.output_text.delta', 'response.output_text.done', 'response.done'].includes(event.type)) {
      this.visible = job.order; item.translation = job.translation.trim(); item.displayRevision = job.revision; this.previous = item.translation;
      this.publish(job.text, item.translation, event.type !== 'response.done' || !item.final || item.revision !== job.revision);
    }
    if (event.type === 'response.done') {
      for (const [k, j] of this.jobs) if (j === job) this.jobs.delete(k);
      this.pump();
    }
  }
  reset() {
    for (const job of this.jobs.values()) if (job.responseId) this.send({ type: 'response.cancel', response_id: job.responseId });
    this.items.clear(); this.jobs.clear(); this.pending.clear(); this.visible = -1;
  }
  stop() { this.reset(); this.closed = true; }
}
