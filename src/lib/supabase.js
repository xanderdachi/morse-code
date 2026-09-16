import { PostgrestClient } from '@supabase/postgrest-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * The app's Supabase database client, or null when it isn't configured
 * (missing or invalid env vars). Callers treat null as offline and use bundled
 * passages.
 *
 * Just PostgREST, not supabase-js: the app has no accounts, storage or realtime,
 * and supabase-js builds a client for each of those whether they're used or not.
 * Requests go out as supabase-js sends them: the key as `apikey` and as the
 * bearer token, against the public schema.
 */
export const supabase = create()

function create() {
  if (!url || !anonKey) return null
  try {
    return new PostgrestClient(new URL('rest/v1', url.endsWith('/') ? url : `${url}/`).href, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      schema: 'public',
    })
  } catch (error) {
    console.warn('Supabase client not created; running on bundled passages.', error)
    return null
  }
}
