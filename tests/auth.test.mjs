import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, verifiedGoogleEmail } from '../supabase/functions/realtime-session/handler.js';
const env = k => ({ ALLOWED_ORIGINS: 'https://guoer11.github.io', OPENAI_API_KEY: 'test-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-key' })[k];
const user = { id: 'user', email: 'family@example.com', email_confirmed_at: '2026-09-10', identities: [{ provider: 'google', identity_data: { email: 'family@example.com', email_verified: true } }] };
const req = (token = 'token', method = 'GET') => new Request('https://example.com', { method, headers: { origin: env('ALLOWED_ORIGINS'), ...(token ? { authorization: `Bearer ${token}` } : { 'x-access-code': 'old-code' }) } });
test('only verified Google identity matching the confirmed email is accepted', () => {
  assert.equal(verifiedGoogleEmail(user), user.email);
  for (const changed of [{ identities: [] }, { email_confirmed_at: null }, { is_anonymous: true }, { email: 'other@example.com' }, { identities: [{ provider: 'email' }], user_metadata: { provider: 'google', email_verified: true } }, { identities: [{ provider: 'google', identity_data: { email: user.email, email_verified: false } }] }]) assert.equal(verifiedGoogleEmail({ ...user, ...changed }), null);
});
test('missing token and legacy access code cannot reach Auth, quota or OpenAI', async () => {
  const h = createHandler({ env, fetcher: assert.fail });
  assert.equal((await h(req(null))).status, 401);
});
test('invalid token, unlisted user and failed lookup cannot reach paid APIs', async () => {
  for (const scenario of ['invalid', 'unlisted', 'lookup-down', 'auth-down']) {
    let calls = 0;
    const h = createHandler({ env, fetcher: async url => {
      calls++;
      if (url.endsWith('/auth/v1/user')) return scenario === 'invalid' ? new Response('', { status: 401 }) : scenario === 'auth-down' ? new Response('', { status: 503 }) : Response.json(user);
      assert.ok(url.includes('/translator_allowed_users?'));
      return scenario === 'lookup-down' ? new Response('', { status: 503 }) : Response.json([]);
    } });
    assert.equal((await h(req('token', 'POST'))).status, { invalid: 401, unlisted: 403, 'lookup-down': 503, 'auth-down': 503 }[scenario]);
    assert.ok(calls <= 2);
  }
});
test('access check is no-store and never spends quota; removal takes effect on next check', async () => {
  let allowed = true;
  const h = createHandler({ env, fetcher: async (url, init) => {
    if (url.endsWith('/auth/v1/user')) { assert.equal(init.headers.Authorization, 'Bearer token'); return Response.json(user); }
    assert.ok(url.includes('/translator_allowed_users?'));
    assert.equal(init.headers.Authorization, 'Bearer server-key');
    assert.equal(new URL(url).searchParams.get('email'), `eq.${user.email}`);
    return Response.json(allowed ? [{ email: user.email, can_manage_glossary: false }] : []);
  } });
  const r = await h(req()); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), { email: user.email, userId: 'user', canManageGlossary: false });
  allowed = false; assert.equal((await h(req())).status, 403);
});
