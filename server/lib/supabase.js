'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase environment variables. Check SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_KEY.'
  );
}

/**
 * supabaseAdmin — Service Role client.
 * Has full database access and bypasses Row Level Security.
 * Use only on the server side for privileged operations.
 */
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

/**
 * supabasePublic — Anon Key client.
 * Respects Row Level Security.
 * Use when operating in the context of an unauthenticated request.
 */
const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

/**
 * supabaseForUser — Creates a Supabase client authenticated as the given user.
 * The JWT is injected as a global header so all requests are made in user context.
 * RLS policies apply as if the user is making the request directly.
 *
 * @param {string} jwt — The user's access token from their session
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function supabaseForUser(jwt) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
  });
}

module.exports = { supabaseAdmin, supabasePublic, supabaseForUser };
