const KEY = 'translator.history.v1';
export class History {
  constructor(storage, minutes = 10, now = Date.now) {
    this.storage = storage; this.minutes = minutes; this.now = now; this.items = [];
    try { const data = JSON.parse(storage?.getItem(KEY) || '[]');
      if (Array.isArray(data)) this.items = data.filter(x => typeof x.id === 'string' && Number.isFinite(x.at) && typeof x.original === 'string' && typeof x.translated === 'string').map(x => ({ ...x, status: x.status === 'pending' ? 'interrupted' : x.status }));
    } catch { /* Storage may be disabled on this device. In-memory mode still works. */ }
    this.prune();
  }
  prune() { this.items = this.items.filter(x => x.at > this.now() - this.minutes * 60000 && x.at <= this.now()).slice(-300); this.save(); }
  save() { try { this.storage?.setItem(KEY, JSON.stringify(this.items)); } catch { /* In-memory fallback. */ } }
  add(item) { this.prune(); if (!this.items.some(x => x.id === item.id)) this.items.push({ at: this.now(), original: '', translated: '', status: 'pending', ...item }); this.prune(); }
  update(id, patch) { const item = this.items.find(x => x.id === id); if (item) Object.assign(item, patch); this.prune(); }
  clear() { this.items = []; this.save(); }
}
