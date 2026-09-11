import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, captionSessionConfig, sessionConfig } from '../supabase/functions/realtime-session/handler.js';
const user={id:'test',email:'family@example.com',email_confirmed_at:'2026-01-01',identities:[{provider:'google',identity_data:{email:'family@example.com',email_verified:true}}]};
const env=k=>({ALLOWED_ORIGINS:'https://example.com',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server',OPENAI_API_KEY:'private-key'})[k];
const request=(body,authenticated=true)=>new Request('https://example.com/session',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json',...(authenticated?{authorization:'Bearer test'}:{})},body:JSON.stringify(body)});
test('caption session has no ASR/VAD and inherits exact Pokémon mappings; microphone unchanged',()=>{
  const c=captionSessionConfig('ja','model',[{source:'ポケパッド',target:'寶可平板'}]);
  assert.equal(c.audio.input.transcription,null);assert.equal(c.audio.input.turn_detection,null);
  assert.match(c.instructions,/ポケパッド → 寶可平板/);assert.match(c.instructions,/Taiwan/);
  assert.equal(sessionConfig('ja','model').audio.input.turn_detection.silence_duration_ms,1200);
});
test('caption backend loads ja/shared glossary and retains it across model fallback',async()=>{
  let openai=0;
  const h=createHandler({env,fetcher:async(url,init)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json(user);
    if(url.includes('/translator_allowed_users'))return Response.json([{email:user.email,can_manage_glossary:false}]);
    if(url.includes('/translator_take_session'))return Response.json(true);
    if(url.includes('/translator_glossary')){assert.equal(new URL(url).searchParams.get('language'),'in.(ja,shared)');return Response.json([{source_text:'ポケパッド',target_text:'寶可平板'}]);}
    assert.equal(url,'https://api.openai.com/v1/realtime/calls');openai++;
    const session=JSON.parse(init.body.get('session'));assert.match(session.instructions,/寶可平板/);assert.equal(session.audio.input.transcription,null);
    return openai===1?new Response('',{status:404}):new Response('v=0\r\n');
  }});
  assert.equal((await h(request({language:'ja',source:'caption',sdp:'v=0\r\n'}))).status,200);assert.equal(openai,2);
});
test('caption requires auth; glossary failure fails closed; glossary admin remains restricted',async()=>{
  const h=createHandler({env,fetcher:async url=>{
    if(url.endsWith('/auth/v1/user'))return Response.json(user);
    if(url.includes('/translator_allowed_users'))return Response.json([{email:user.email,can_manage_glossary:false}]);
    if(url.includes('/translator_take_session'))return Response.json(true);
    if(url.includes('/translator_glossary'))return new Response('',{status:503});
    assert.fail('must not create paid session without glossary');
  }});
  const body={language:'ja',source:'caption',sdp:'v=0\r\n'};
  assert.equal((await h(request(body,false))).status,401);
  assert.equal((await h(request(body))).status,503);
  assert.equal((await h(request({action:'glossary.save',item:{}}))).status,403);
});
