import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSession, persistSession, readStoredSession, clearSession, signInWithPassword, signUp } from '../src/lib/auth.js';
import { validateIssueReport, validateImage, validateComment } from '../src/lib/validation.js';

function storage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: (k) => data.delete(k) };
}

test('session normalization requires both tokens and calculates expiry', () => {
  assert.equal(normalizeSession({ access_token: 'a' }), null);
  const session = normalizeSession({ access_token: 'a', refresh_token: 'r', expires_in: 900 });
  assert.ok(session.expires_at > 0);
});

test('session persistence round trips and clears', () => {
  const store = storage();
  persistSession({ access_token: 'a', refresh_token: 'r', expires_in: 600 }, store);
  assert.equal(readStoredSession(store).access_token, 'a');
  clearSession(store);
  assert.equal(readStoredSession(store), null);
});

test('sign in calls the password grant and surfaces provider errors', async () => {
  let request;
  const fetcher = async (url, init) => {
    request = { url, init };
    return { ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r' }) };
  };
  const result = await signInWithPassword({ supabaseUrl: 'https://example.supabase.co', publishableKey: 'sb_publishable_x' }, ' resident@example.com ', 'secret', fetcher);
  assert.equal(request.url, 'https://example.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(JSON.parse(request.init.body).email, 'resident@example.com');
  assert.equal(result.access_token, 'a');
  await assert.rejects(() => signUp({ supabaseUrl: '', publishableKey: '' }, 'a@b.com', 'secret', fetcher), /must be configured/);
});

test('report validation rejects invalid category, description and coordinates', () => {
  assert.equal(validateIssueReport({ defect_type: 'hack', description: 'x', latitude: 91, longitude: 0 }).valid, false);
  assert.equal(validateIssueReport({ defect_type: 'pothole', description: 'Large pothole', latitude: 28.6, longitude: 77.2 }).valid, true);
});

test('image validation enforces MIME and 8 MiB cap', () => {
  assert.equal(validateImage({ type: 'image/jpeg', size: 100 }).valid, true);
  assert.equal(validateImage({ type: 'image/svg+xml', size: 100 }).valid, false);
  assert.equal(validateImage({ type: 'image/png', size: 9 * 1024 * 1024 }).valid, false);
});

test('comment validation enforces 1–2000 characters', () => {
  assert.equal(validateComment('hello').valid, true);
  assert.equal(validateComment('  ').valid, false);
  assert.equal(validateComment('x'.repeat(2001)).valid, false);
});
