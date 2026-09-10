import { config } from '../config.js';
const client = globalThis.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
    storageKey: 'translator.google.auth' },
});
export const auth = client.auth;
export async function authorize() {
  const { data, error } = await auth.getSession();
  if (error || !data.session) throw new Error('請使用家庭 Google 帳號登入。');
  const token = data.session.access_token;
  const response = await fetch(config.sessionEndpoint, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '無法確認使用權限。');
  return { ...result, token };
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
