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
let _createClient = null;

let _client = null;

/**
 * Returns true if the Home Group feature flag is enabled AND
 * Supabase config is present. Guards all sync/auth code paths.
 */
export function isHomeGroupEnabled() {
  return (
    import.meta.env.VITE_HOME_GROUP_ENABLED === 'true' &&
    !!import.meta.env.VITE_SUPABASE_URL &&
    !!import.meta.env.VITE_SUPABASE_ANON_KEY
  );
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
export async function signInWithGoogle() {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
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
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
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
 * Reset singleton (for testing).
 */
export function _resetClient() {
  _client = null;
}
