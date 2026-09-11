import { config } from '../config.js';
const client = globalThis.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
    storageKey: 'translator.google.auth' },
});
export const auth = client.auth;
let lastAuthorized = null;
let lastAuthorizedAt = 0;
const AUTH_CACHE_MS = 5 * 60 * 1000;

function sameSessionUser(session) {
  return !!lastAuthorized && lastAuthorized.userId === session?.user?.id;
}

export async function authorize() {
  const { data, error } = await auth.getSession();
  if (error || !data.session) {
    lastAuthorized = null; lastAuthorizedAt = 0;
    throw new Error('請使用家庭 Google 帳號登入。');
  }
  const session = data.session;
  const token = session.access_token;

  // The Edge Function validates the JWT and allow-list again when a Realtime
  // session is actually created. Reuse a recent successful gate check here so
  // stop -> start does not depend on a second, redundant iOS fetch.
  if (sameSessionUser(session) && Date.now() - lastAuthorizedAt < AUTH_CACHE_MS) {
    return { ...lastAuthorized, token };
  }

  try {
    const response = await fetch(config.sessionEndpoint, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        lastAuthorized = null; lastAuthorizedAt = 0;
        throw new Error(result.error || '請使用家庭 Google 帳號登入。');
      }
      // A temporary gate-check failure must not sign out an already verified
      // family member. The subsequent POST still performs server-side auth.
      if (sameSessionUser(session)) return { ...lastAuthorized, token };
      throw new Error(result.error || '目前無法確認使用權限，請稍後再試。');
    }
    lastAuthorized = { email: result.email, userId: result.userId };
    lastAuthorizedAt = Date.now();
    return { ...lastAuthorized, token };
  } catch (error) {
    if (sameSessionUser(session)) return { ...lastAuthorized, token };
    if (/abort|timeout/i.test(`${error?.name || ''} ${error?.message || ''}`)) {
      throw new Error('登入驗證逾時，請確認網路後再試。');
    }
    throw error;
  }
}
export async function signIn() {
  const settings = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: config.supabaseKey }, signal: AbortSignal.timeout(10000),
  });
  if (!settings.ok || !(await settings.json()).external?.google) throw new Error('Google 登入尚未完成設定，請聯絡管理者。');
  const { error } = await auth.signInWithOAuth({ provider: 'google', options: {
    redirectTo: new URL('../', import.meta.url).href, queryParams: { prompt: 'select_account' },
  } });
  if (error) throw error;
}
