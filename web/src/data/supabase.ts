import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The project URL and publishable (anon) key are public by design (SPEC.md,
// "Access, roles and secrets"). Row-level security is what protects data.
// import.meta.env exists only under Vite; Node scripts (supabase/tests) pass their own client.
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_KEY

export const configured = Boolean(url && key)

export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  key ?? 'missing-key',
  { auth: { persistSession: true, autoRefreshToken: true } },
)

let signingIn: Promise<string> | null = null

/** Signs this device in anonymously the first time; returns the user id. */
export function ensureSignedIn(): Promise<string> {
  signingIn ??= (async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session?.user) return data.session.user.id
    const res = await supabase.auth.signInAnonymously()
    if (res.error || !res.data.user) {
      signingIn = null
      throw res.error ?? new Error('Anonymous sign-in failed')
    }
    return res.data.user.id
  })()
  return signingIn
}

export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
