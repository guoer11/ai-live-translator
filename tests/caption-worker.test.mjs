import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { parseCaptions } from '../chrome-extension/captions.js';
import { chooseSource } from '../chrome-extension/youtube.js';

for (const hasCaptions of [true, false]) test(`worker selects ${hasCaptions ? 'captions without tabCapture' : 'audio fallback'} and rejects stale subtitles`, async () => {
  const storage = {}, sent = [], listeners = []; let captures = 0;
  const area = { get: async key => ({[key]:storage[key]}), set: async value => Object.assign(storage,value) };
  storage.translator_extension_auth_v1 = {accessToken:'test',expiresAt:Date.now()+3600000};
  const runtime = {id:'test',getURL:p=>`chrome-extension://test/${p}`,getContexts:async()=>[{}],
    sendMessage:async message=>{sent.push(message); return {ok:true};},onMessage:{addListener:f=>listeners.push(f)}};
  const context = vm.createContext({crypto:webcrypto,URL,URLSearchParams,Date,parseCaptions,chooseSource,
    config:{sessionEndpoint:'https://example.com'},
    chrome:{runtime,storage:{session:area,local:area},offscreen:{closeDocument:async()=>{}},
      tabCapture:{getMediaStreamId:async()=>{captures++;return 'stream';}},
      tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=abc'}],
        sendMessage:async(_id,message)=>{sent.push(message);return {ok:true};},onRemoved:{addListener(){}}},
      scripting:{executeScript:async options=>options.world==='MAIN' ? [{result:hasCaptions ? {videoId:'abc',payload:{events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'山札を見ます。'}]}]}}:null}] : []},
    }});
  vm.runInContext(readFileSync(new URL('../chrome-extension/service-worker.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
  const state = await vm.runInContext("startTranslation('ja')",context);
  assert.equal(state.source,hasCaptions?'caption':'tab'); assert.equal(captures,hasCaptions?0:1);
  assert.equal(sent.find(m=>m.type==='START_CAPTURE').source,state.source);
  const subtitle = {type:'OFFSCREEN_SUBTITLE',tabId:1,sessionId:'old',translated:'過期'};
  listeners[0](subtitle,{id:'test',url:runtime.getURL('offscreen.html')},()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.some(m=>m.translated==='過期'),false);
  listeners[0]({...subtitle,sessionId:state.sessionId,translated:'山牌'}, {id:'test',url:runtime.getURL('offscreen.html')},()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.some(m=>m.translated==='山牌'),true);
  await vm.runInContext('stopTranslation()',context);
});
