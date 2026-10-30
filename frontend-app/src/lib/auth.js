const AUTH_STORAGE_KEY = 'civicpulse_session';

export function normalizeSession(session) {
  if (!session?.access_token || !session?.refresh_token) return null;
  const expiresAt = Number(session.expires_at)
    || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
  return { ...session, expires_at: expiresAt };
}

export function readStoredSession(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(AUTH_STORAGE_KEY);
    return raw ? normalizeSession(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function persistSession(session, storage = globalThis.localStorage) {
  const normalized = normalizeSession(session);
  if (!normalized) throw new Error('Authentication response did not contain a valid session.');
  storage?.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearSession(storage = globalThis.localStorage) {
  storage?.removeItem(AUTH_STORAGE_KEY);
}

async function authRequest({ supabaseUrl, publishableKey, path, body, fetchImpl = fetch }) {
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase URL and publishable key must be configured.');
  const response = await fetchImpl(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.msg || payload.message || payload.error_description || 'Authentication failed.');
  }
  return payload;
}

export function signInWithPassword(config, email, password, fetchImpl) {
  return authRequest({ ...config, path: 'token?grant_type=password', body: { email: email.trim(), password }, fetchImpl });
}

export function signUp(config, email, password, fetchImpl) {
  return authRequest({ ...config, path: 'signup', body: { email: email.trim(), password }, fetchImpl });
}

export function refreshAuthSession(config, refreshToken, fetchImpl) {
  return authRequest({ ...config, path: 'token?grant_type=refresh_token', body: { refresh_token: refreshToken }, fetchImpl });
}

export async function signOutRemote(config, accessToken, fetchImpl = fetch) {
  if (!accessToken) return;
  const response = await fetchImpl(`${config.supabaseUrl.replace(/\/+$/, '')}/auth/v1/logout`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 401) throw new Error('Remote sign out failed.');
}
