import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../dist/src/history.js';
import { RealtimeTranslator } from '../dist/src/realtime.js';
import { createHandler } from '../supabase/functions/realtime-session/handler.js';
import { prepareTranscript, cleanTranslation } from '../dist/src/language.js';
const envValues = { ALLOWED_ORIGINS: 'https://guoer11.github.io', OPENAI_API_KEY: 'server-only-key', TRANSLATOR_ACCESS_CODE: 'a-long-test-code-12345', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private-role-key' };
const request = (body = { sdp: 'v=0\r\n', language: 'en' }, code = envValues.TRANSLATOR_ACCESS_CODE, origin = envValues.ALLOWED_ORIGINS) => new Request('https://example.supabase.co/functions/v1/realtime-session', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-access-code': code }, body: JSON.stringify(body) });
const handler = fetcher => createHandler({ env: key => envValues[key], fetcher });

test('history expires exactly at TTL; corrupted/blocked storage works', () => {
  let now = 1000000; const h = new History({ getItem: () => 'bad', setItem: () => { throw Error(); } }, 5, () => now);
  h.add({ id: '1', original: 'hello' }); now += 299999; h.prune(); assert.equal(h.items.length, 1);
  now++; h.prune(); assert.equal(h.items.length, 0);
});
test('retention shortening and reload interrupt unfinished entries', () => {
  let saved = ''; const storage = { getItem: () => saved, setItem: (_, v) => saved = v }; let now = 1000000;
  const h = new History(storage, 10, () => now); h.add({ id: '1' });
  const resumed = new History(storage, 10, () => now); assert.equal(resumed.items[0].status, 'interrupted');
  now += 6 * 60000; h.minutes = 5; h.prune(); assert.equal(h.items.length, 0);
});
test('translation waits for the exact displayed ASR text and respects speech order', () => {
  const sent = [], events = []; const c = new RealtimeTranslator({ onEvent: e => events.push(e), onState: () => {}, onError: assert.fail });
  c.dc = { readyState: 'open', send: s => sent.push(JSON.parse(s)), close() {} };
  c.handle({ type: 'input_audio_buffer.committed', item_id: 'first' });
  c.handle({ type: 'input_audio_buffer.committed', item_id: 'second' });
  c.handle({ type: 'input_audio_buffer.committed', item_id: 'second' });
  assert.equal(sent.length, 0);
  c.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'second', transcript: 'Goodbye' });
  assert.equal(sent.length, 0, 'later ASR must not jump ahead of earlier speech');
  c.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'first', transcript: 'Hello' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].response.input[0].content[0].text, 'Hello');
  assert.equal(sent[0].response.input[0].type, 'message', 'never independently reinterpret audio');
  c.handle({ type: 'response.created', response: { id: 'r1', metadata: { input_item_id: 'first' } } });
  c.handle({ type: 'response.output_text.delta', response_id: 'r1', delta: '你好' });
  c.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'second', transcript: 'Goodbye' });
  c.handle({ type: 'response.done', response: { id: 'r1', status: 'completed', output: [{ content: [{ type: 'output_text', text: '你好' }] }] } });
  assert.equal(sent.length, 2); assert.equal(sent[1].response.input[0].content[0].text, 'Goodbye');
  assert.equal(events.find(x => x.kind === 'translation').id, 'first');
  assert.equal(events.find(x => x.kind === 'original').id, 'second'); c.stop();
});
test('Chinese is Traditional and Korean/Japanese are rejected outside selected pairs', () => {
  assert.equal(prepareTranscript('北京的冬天是非常冷的。', 'en').original, '北京的冬天是非常冷的。');
  assert.equal(prepareTranscript('你可能起来天国东我在罗什巴。', 'en').original, '你可能起來天國東我在羅什巴。');
  assert.equal(prepareTranscript('그때', 'en'), null);
  assert.equal(prepareTranscript('駅はどこですか？', 'en'), null);
  assert.equal(prepareTranscript('駅はどこですか？', 'ja').original, '駅はどこですか？');
  assert.equal(prepareTranscript('그때', 'ko').targetLanguage, 'zh');
  assert.equal(prepareTranscript('北京的冬天', 'en').targetLanguage, 'en');
  assert.equal(cleanTranslation('这是我的车站。', 'zh'), '這是我的車站。');
  assert.equal(cleanTranslation('그때', 'zh'), null);
  assert.equal(cleanTranslation('我无法开启档案', 'en'), null);
});
test('rejected ASR does not reach translator, and subsequent speech still works', () => {
  const sent = [], events = []; const c = new RealtimeTranslator({ language: 'en', onEvent: e => events.push(e), onState: () => {}, onError: assert.fail });
  c.dc = { readyState: 'open', send: s => sent.push(JSON.parse(s)), close() {} };
  c.handle({ type: 'input_audio_buffer.committed', item_id: 'bad' });
  c.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'bad', transcript: '그때' });
  assert.equal(sent.length, 0); assert.ok(events.some(e => e.status === 'failed'));
  c.handle({ type: 'input_audio_buffer.committed', item_id: 'good' });
  c.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'good', transcript: '请问车站怎么走？' });
  assert.equal(sent[0].response.input[0].content[0].text, '請問車站怎麼走？');
  assert.ok(sent[0].response.instructions.includes('American English')); c.stop();
});
test('stop closes microphone, connection, and suppresses late events', () => {
  let stopped = 0, closed = 0, events = 0;
  const c = new RealtimeTranslator({ onEvent: () => events++, onState: () => {}, onError: assert.fail });
  c.stream = { getTracks: () => [{ stop: () => stopped++ }] }; c.pc = { close: () => closed++ }; c.stop(); c.stop();
  c.handle({ type: 'input_audio_buffer.committed', item_id: 'late' });
  assert.equal(stopped, 1); assert.equal(closed, 1); assert.equal(events, 0); assert.equal(c.abort.signal.aborted, true);
});
test('wrong origin/access code never reaches quota or OpenAI', async () => {
  let calls = 0; const h = handler(async () => { calls++; throw Error(); });
  assert.equal((await h(request(undefined, undefined, 'https://evil.example'))).status, 403);
  assert.equal((await h(request(undefined, 'wrong'))).status, 401); assert.equal(calls, 0);
});
test('CORS preflight and malformed requests', async () => {
  const h = handler(assert.fail);
  const r = await h(new Request('https://example.supabase.co', { method: 'OPTIONS', headers: { origin: envValues.ALLOWED_ORIGINS } }));
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), envValues.ALLOWED_ORIGINS);
  assert.equal((await h(request({ language: 'fr', sdp: 'v=0' }))).status, 400);
  assert.equal((await h(request({ language: 'en', sdp: 'x'.repeat(70000) }))).status, 413);
});
test('quota fails closed; denied quota never creates a paid session', async () => {
  let calls = 0; const h = handler(async () => { calls++; return Response.json(false); });
  assert.equal((await h(request())).status, 429); assert.equal(calls, 1);
  assert.equal((await handler(async () => new Response('', { status: 500 }))(request())).status, 503);
});
test('all language pairs use server-controlled text sessions; secrets never returned', async () => {
  for (const language of ['en', 'ja', 'ko']) {
    const calls = [];
    const h = handler(async (url, init) => {
      calls.push({ url, init }); if (calls.length === 1) return Response.json(true);
      const config = JSON.parse(init.body.get('session'));
      assert.deepEqual(config.output_modalities, ['text']);
      assert.equal(config.audio.input.turn_detection.create_response, false);
      assert.equal(init.headers.Authorization, 'Bearer server-only-key');
      return new Response('v=0\r\nanswer');
    });
    const r = await h(request({ language, sdp: 'v=0\r\noffer' }));
    assert.equal(r.status, 200); assert.equal(await r.text(), 'v=0\r\nanswer');
    assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(calls.length, 2);
  }
});
test('upstream errors are sanitized and no key config fails closed', async () => {
  let count = 0;
  const r = await handler(async () => ++count === 1 ? Response.json(true) : new Response('secret-error', { status: 401 }))(request());
  assert.equal(r.status, 502); assert.ok(!(await r.text()).includes('secret-error'));
  const h = createHandler({ env: k => k === 'OPENAI_API_KEY' ? '' : envValues[k], fetcher: assert.fail });
  assert.equal((await h(request())).status, 503);
});
