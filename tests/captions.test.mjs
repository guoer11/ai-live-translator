import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptions, CaptionClock, CaptionTranslator } from '../chrome-extension/captions.js';
test('caption clock sends available phrases before cue end and finalizes same ID without repeats', () => {
  const cues = parseCaptions({ events: [{ tStartMs: 1000, dDurationMs: 6000, segs: [{ utf8: 'ポケパッドを使って', tOffsetMs: 0 }, { utf8: '山札を見ます。', tOffsetMs: 500 }] }] });
  const sent = []; const clock = new CaptionClock(cues, c => sent.push(c), () => {});
  clock.tick(1); clock.tick(1.1); clock.tick(1.5); clock.tick(1.8);
  assert.equal(sent.length, 2); assert.equal(sent[0].id, sent[1].id);
  assert.equal(sent[0].final, false); assert.equal(sent[1].final, true);
});
test('caption seek clears old revisions; paused playback sends nothing', () => {
  let resets = 0; const sent = []; const clock = new CaptionClock(parseCaptions({events:[{tStartMs:0,dDurationMs:10000,segs:[{utf8:'こんにちは。'}]}]}), c => sent.push(c), () => resets++);
  clock.tick(1, true); assert.equal(sent.length, 0); clock.tick(1); clock.tick(0, false, true); clock.tick(.1);
  assert.equal(resets, 1); assert.notEqual(sent[0].id, sent[1].id);
});
test('fast revision is immediate, deduplicated and stale translation cannot replace current cue', () => {
  const sent = [], shown = []; const t = new CaptionTranslator({send:e=>sent.push(e),publish:(...v)=>shown.push(v)});
  t.update({id:'a',text:'ポケパッドを使います',final:false});
  t.update({id:'a',text:'ポケパッドを使います',final:true});
  assert.equal(sent.length,1); assert.equal(sent[0].response.instructions,undefined,'inherit mandatory server glossary');
  const key=sent[0].response.metadata.caption_job;
  t.handle({type:'response.created',response:{id:'r1',metadata:{caption_job:key}}});
  t.update({id:'a',text:'ポケパッドを使います。山札を見ます',final:true});
  t.handle({type:'response.output_text.delta',response_id:'r1',delta:'前半句快譯'}); assert.equal(shown[0][2],true,'a usable prefix must not wait for the rest of the sentence');
  t.handle({type:'response.done',response:{id:'r1',output:[]}}); assert.equal(sent.length,2);
  const key2=sent[1].response.metadata.caption_job;
  t.handle({type:'response.created',response:{id:'r2',metadata:{caption_job:key2}}});
  t.handle({type:'response.output_text.delta',response_id:'r2',delta:'使用寶可平板'});
  assert.equal(shown.at(-1)[1],'使用寶可平板');
  const count = shown.length;
  t.handle({type:'response.output_text.delta',response_id:'r1',delta:'過時譯文'});
  t.update({id:'b',text:'次に引きます。',final:true}); assert.equal(shown.length,count,'new cue must retain previous Chinese');
});
