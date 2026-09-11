import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { CaptionClock, CaptionTranslator, parseCaptions } from '../chrome-extension/captions.js';
import { chooseSource } from '../chrome-extension/youtube.js';
const track = { events: [{ tStartMs: 0, dDurationMs: 10000, segs: [{ utf8: 'ポケパッドを使います。' }] }] };
test('automatic source selection prefers usable captions; rendered-caption fallback stays in caption mode', async () => {
  const tab = { id: 1, url: 'https://www.youtube.com/watch?v=example' };
  const automatic = await chooseSource(tab, 'ja', async options => {
    assert.equal(options.world, 'MAIN'); assert.deepEqual(options.args, ['ja']);
    return [{ result: { videoId: 'example', payload: track, kind: 'automatic', languageCode: 'ja' } }];
  }, parseCaptions);
  assert.equal(automatic.source, 'caption'); assert.equal(automatic.captionKind, 'automatic'); assert.equal(automatic.liveCaptions, false);
  const manual = await chooseSource(tab, 'ja', async () => [{ result: { videoId: 'example', payload: track, kind: 'manual', languageCode: 'ja' } }], parseCaptions);
  assert.equal(manual.source, 'caption'); assert.equal(manual.captionKind, 'manual');
  const live = await chooseSource(tab, 'ja', async () => [{ result: { videoId: 'example', live: true, kind: 'automatic', languageCode: 'ja' } }], parseCaptions);
  assert.equal(live.source, 'caption'); assert.equal(live.captionKind, 'automatic'); assert.equal(live.liveCaptions, true); assert.deepEqual(live.cues, []);
  for (const result of [null, { payload: {} }, { videoId: 'example', payload: {events:[]} }])
    assert.equal((await chooseSource(tab, 'ja', async () => [{ result }], parseCaptions)).source, 'tab');
  assert.equal((await chooseSource(tab, 'ja', async () => { throw Error('restricted track'); }, parseCaptions)).source, 'tab');
  assert.equal((await chooseSource({id:1,url:'https://example.com'}, 'ja', assert.fail, parseCaptions)).source, 'tab');
});

test('caption clock accepts rendered live cue envelope', () => {
  const emitted = [];
  const clock = new CaptionClock([], cue => emitted.push(cue), () => {});
  clock.tick({ liveCue: { id: 'live:1', text: '国内だけ勝っていて', final: false, at: 12.3 } });
  assert.deepEqual(emitted, [{ id: 'live:1', text: '国内だけ勝っていて', final: false, at: 12.3 }]);
});

function host() {
  const sent = [], messages = [], listeners = []; let captures = 0, stopped = 0;
  const stream = { getAudioTracks: () => [{ stop: () => stopped++ }], getTracks: () => [{ stop: () => stopped++ }] };
  class Peer {
    constructor() { this.dc = { readyState: 'open', send: s => sent.push(JSON.parse(s)), close() {} }; }
    createDataChannel() { return this.dc; }
    addTrack() {} addTransceiver() {}
    async createOffer() { return { sdp: 'v=0\r\n' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.dc.onopen(); }
    close() {}
  }
  class Audio {
    async resume() {} async close() {}
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { getFloatTimeDomainData(a) { a.fill(0); } }; }
  }
  const context = vm.createContext({ CaptionClock, CaptionTranslator, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, AbortController, Float32Array, RTCPeerConnection: Peer, AudioContext: Audio,
    navigator: { mediaDevices: { getUserMedia: async () => { captures++; return stream; } } },
    fetch: async (_url, init) => { messages.push(JSON.parse(init.body)); return new Response('v=0\r\n'); },
    chrome: { runtime: { id: 'test', onMessage: { addListener: f => listeners.push(f) }, sendMessage: async e => { messages.push(e); } } },
  });
  vm.runInContext(readFileSync(new URL('../chrome-extension/offscreen.js', import.meta.url),'utf8').replace(/^import .*;\n/, ''), context);
  return { context, sent, messages, captures: () => captures, stopped: () => stopped, listeners };
}
test('real offscreen caption branch never captures audio or translates ASR events', async () => {
  const h = host();
  h.context.options = { tabId: 1, language: 'ja', source: 'caption', sessionId: 's', endpoint: 'https://example.com', accessToken: 'test', cues: parseCaptions(track) };
  try {
    await vm.runInContext('startCapture(options)',h.context);
    assert.equal(h.captures(),0); assert.equal(h.messages[0].source,'caption');
    vm.runInContext("handleEvent({type:'conversation.item.input_audio_transcription.completed',item_id:'audio',transcript:'ignored'})",h.context);
    assert.equal(h.sent.length,0);
    h.listeners[0]({target:'offscreen',type:'CAPTION_TICK',sessionId:'s',time:1,paused:false},{id:'test'},()=>{});
    assert.equal(h.sent.length,1); assert.equal(h.sent[0].response.input[0].content[0].text,'ポケパッドを使います。');
    h.listeners[0]({target:'offscreen',type:'CAPTION_TICK',sessionId:'s',time:1.1,paused:false},{id:'test'},()=>{});
    assert.equal(h.sent.length,1);
  } finally { vm.runInContext('stopCapture()',h.context); }
});
test('real offscreen live caption envelope translates without tab audio capture', async () => {
  const h = host();
  h.context.options = { tabId: 1, language: 'ja', source: 'caption', sessionId: 's', endpoint: 'https://example.com', accessToken: 'test', cues: [] };
  try {
    await vm.runInContext('startCapture(options)',h.context);
    h.listeners[0]({target:'offscreen',type:'CAPTION_TICK',sessionId:'s',time:{liveCue:{id:'live:1',text:'国内だけ勝っていて',final:false,at:1}},paused:false},{id:'test'},()=>{});
    assert.equal(h.captures(),0); assert.equal(h.sent.length,1);
    assert.equal(h.sent[0].response.input[0].content[0].text,'国内だけ勝っていて');
  } finally { vm.runInContext('stopCapture()',h.context); }
});
test('real offscreen audio fallback retains tab capture and ASR completion path', async () => {
  const h = host(); h.context.options={tabId:1,source:'tab',language:'ja',streamId:'stream',endpoint:'https://example.com',accessToken:'test'};
  try {
    await vm.runInContext('startCapture(options)',h.context);
    assert.equal(h.captures(),1); assert.equal(h.messages[0].source,'tab');
    vm.runInContext("handleEvent({type:'conversation.item.input_audio_transcription.completed',item_id:'audio',transcript:'山札を見ます'})",h.context);
    assert.equal(h.sent[0].response.input[0].content[0].text,'山札を見ます');
  } finally { vm.runInContext('stopCapture()',h.context); }
  assert.equal(h.stopped(),1);
});
test('audio fallback starts quick translation from partial ASR before the turn completes', async () => {
  const h = host(); h.context.options={tabId:1,source:'tab',language:'ja',streamId:'stream',endpoint:'https://example.com',accessToken:'test'};
  try {
    await vm.runInContext('startCapture(options)',h.context);
    vm.runInContext("handleEvent({type:'conversation.item.input_audio_transcription.delta',item_id:'audio',delta:'これはポケモンカードのテストです。'})",h.context);
    assert.equal(h.sent.length,1);
    assert.match(h.sent[0].response.metadata.quick_job,/^quick:/);
    assert.equal(h.sent[0].response.input[0].content[0].text,'これはポケモンカードのテストです。');
  } finally { vm.runInContext('stopCapture()',h.context); }
});
