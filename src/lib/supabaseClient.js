/**
 * Supabase client — lazy singleton, only initialized when Home Group is enabled.
 * Never imported at module level by non-group code.
 *
 * IMPORTANT: VITE_SUPABASE_ANON_KEY is intentionally client-exposed.
 * Supabase anon keys are designed for browser use — RLS enforces security.
 * See: https://supabase.com/docs/guides/api/api-keys
 */
// Dynamic import — @supabase/supabase-js is only loaded when initSupabase() is
// called (feature flag on + env vars set). This lets the app build and run
// without the package installed when VITE_HOME_GROUP_ENABLED is not 'true'.
import { isNative, NATIVE_AUTH_REDIRECT } from './nativeShell';

let _createClient = null;

let _client = null;

/**
 * Returns true if the Home Group feature flag is enabled AND
 * Supabase config is present. Guards all sync/auth code paths.
 */
export function isHomeGroupEnabled() {
  return (
    !!import.meta.env.VITE_SUPABASE_URL &&
    !!import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}

/**
 * Returns true if the Friends feature flag is enabled.
 * Requires Home Group as prerequisite (Supabase Auth must be live).
 * Guards all friend search, friend graph, and direct share code paths.
 */
export function isFriendsEnabled() {
  return isHomeGroupEnabled();
}

/**
 * Get or create the Supabase client singleton.
 * Throws if called when feature flag is off — callers must gate with
 * isHomeGroupEnabled() first.
 */
/**
 * Pre-load the Supabase SDK. Call once during Home Group boot (useHomeGroup).
 * No-op if already loaded or feature flag is off.
 */
export async function initSupabase() {
  if (_createClient || !isHomeGroupEnabled()) return;
  // @vite-ignore prevents Rollup from resolving at build time — the package
  // only needs to be installed when VITE_HOME_GROUP_ENABLED='true'.
  const mod = await import(/* @vite-ignore */ '@supabase/supabase-js');
  _createClient = mod.createClient;
}

/**
 * Get or create the Supabase client singleton.
 * Requires initSupabase() to have completed first.
 * Throws if called when feature flag is off — callers must gate with
 * isHomeGroupEnabled() first.
 */
export function getSupabase() {
  if (_client) return _client;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }

  if (!_createClient) {
    throw new Error(
      'Supabase SDK not loaded. Call initSupabase() before getSupabase().'
    );
  }

  _client = _createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,  // for magic link / OAuth redirect
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  return _client;
}

/**
 * Get current auth session (null if not signed in).
 */
export async function getSession() {
  if (!isHomeGroupEnabled() || !_createClient) return null;
  const { data: { session } } = await getSupabase().auth.getSession();
  return session;
}

/**
 * Get current user ID from session (null if not signed in).
 */
export async function getCurrentUserId() {
  const session = await getSession();
  return session?.user?.id || null;
}

/**
 * Sign in with Google OAuth.
 * Redirects the browser — does not return on success.
 */
// On a device the page origin is https://localhost / capacitor://localhost,
// which a browser can't return to, so sign-in comes back through the app's
// URL scheme instead (nativeShell.js -> completeNativeSignIn below).
function authRedirectUrl() {
  return isNative ? NATIVE_AUTH_REDIRECT : `${window.location.origin}/auth/callback`;
}

export async function signInWithGoogle() {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: authRedirectUrl(),
    },
  });
  if (error) throw error;
}

/**
 * Sign in with magic link (email).
 */
export async function signInWithMagicLink(email) {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: authRedirectUrl(),
    },
  });
  if (error) throw error;
}

/**
 * Finish a native sign-in from com.spicehub.app://auth/callback. Implicit flow
 * puts the tokens in the fragment; PKCE would send ?code= instead.
 */
export async function completeNativeSignIn(callbackUrl) {
  await initSupabase();
  const u = new URL(callbackUrl);
  const code = u.searchParams.get('code');
  const params = new URLSearchParams(u.hash.slice(1));
  const { error } = code
    ? await getSupabase().auth.exchangeCodeForSession(code)
    : await getSupabase().auth.setSession({
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token'),
      });
  if (error) throw error;
}

/**
 * Sign out. Does NOT clear local profile — only tears down Supabase session.
 */
export async function signOut() {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

/**
 * Permanently delete the signed-in account and its cloud data
 * (supabase/migrations/007_delete_my_account.sql). The avatar file goes through
 * the Storage API first because storage objects shouldn't be deleted with SQL.
 * Required by App Store guideline 5.1.1(v) and Google Play's deletion policy.
 */
export async function deleteMyAccount() {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Not signed in');
  await supabase.storage.from('avatars').remove([`${userId}/avatar.jpg`]).catch(() => {});
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
  // The user no longer exists server-side, so only drop the local session.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}

/**
 * Reset singleton (for testing).
 */
export function _resetClient() {
  _client = null;
}
