import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * The app's Supabase client, or null when it isn't configured (missing or
 * invalid env vars). Callers treat null as offline and use bundled passages.
 */
export const supabase = create()

function create() {
  if (!url || !anonKey) return null
  try {
    return createClient(url, anonKey, {
      // No accounts: keep the auth client from reading or writing localStorage.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  } catch (error) {
    console.warn('Supabase client not created; running on bundled passages.', error)
    return null
  }
}
