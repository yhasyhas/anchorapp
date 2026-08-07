import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import { cleanupLegacyLocalStorage } from "@/lib/user-storage"
import { migrateLegacySyncQueue } from "@/lib/offline-sync"
import i18n from "@/lib/i18n"
import type { Session, User } from "@supabase/supabase-js"
import type { Profile } from "@/types"

interface AuthContextType {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  updateProfile: (updates: Partial<Profile>) => Promise<void>
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

// Silent, best-effort: keeps profiles.timezone in sync with wherever the
// user is actually opening the app from, instead of leaving everyone on the
// column default ('Africa/Nairobi'). No UI, no user action — the reminders
// cron (api/cron/reminders.ts) reads this to compute each user's local
// time. Fire-and-forget on purpose: this must never block or fail loading
// the rest of the app, and a stale value just self-corrects next session.
function syncBrowserTimezone(userId: string, storedTimezone: string) {
  let browserTimezone: string
  try {
    browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return
  }
  if (!browserTimezone || browserTimezone === storedTimezone) return

  supabase.from("profiles").update({ timezone: browserTimezone }).eq("id", userId).then(
    () => {},
    () => {}
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        ;(async () => {
          await fetchProfile(session.user.id)
        })()
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId: string) {
    // Une fois l'identité connue : purge les anciennes clés localStorage non scopées
    // (préférences/flags/cache d'un éventuel compte précédent sur cet appareil) et
    // rattache à ce compte les écritures offline en attente de l'ancienne queue globale.
    // Idempotent — no-op après le premier passage.
    cleanupLegacyLocalStorage()
    migrateLegacySyncQueue(userId)

    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()

    setProfile(data)
    setLoading(false)

    if (data) {
      syncBrowserTimezone(userId, data.timezone)
      // i18next boots hardcoded to English (src/lib/i18n.ts) — without this, a Swahili
      // user sees English on every fresh load/reload until she re-toggles it herself in
      // Settings, since settings.tsx's handleLanguageChange is otherwise the only caller
      // of changeLanguage.
      if (data.preferred_language && data.preferred_language !== i18n.language) {
        i18n.changeLanguage(data.preferred_language)
      }
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signUp(email: string, password: string, fullName: string) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { error: error.message }

    if (data.user) {
      await supabase.from("profiles").insert({
        id: data.user.id,
        full_name: fullName,
        preferred_language: "en",
      })
    }

    // CRITIQUE : quand "Confirm email" est OFF, Supabase retourne data.session immédiatement
    // Il faut la capturer et la propager au state SANS attendre onAuthStateChange
    if (data.session) {
      setSession(data.session)
      setUser(data.session.user)
      await fetchProfile(data.session.user.id)
    }

    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
  }

  async function updateProfile(updates: Partial<Profile>) {
    if (!user) return
    const { data } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select()
      .maybeSingle()
    if (data) setProfile(data)
  }

  // Permanently deletes the account server-side (api/delete-account.ts),
  // which cascade-deletes every row across every table via each table's
  // `user_id REFERENCES auth.users(id) ON DELETE CASCADE`, plus her voice
  // notes in Storage. Throws on failure so the caller (Settings' danger
  // zone) can show an error instead of silently signing her out of an
  // account that still exists.
  async function deleteAccount() {
    if (!session) throw new Error("not_authenticated")

    const response = await fetch("/api/delete-account", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error || `delete_failed_${response.status}`)
    }

    await supabase.auth.signOut()
    setProfile(null)
  }

  return (
    <AuthContext.Provider
      value={{ session, user, profile, loading, signIn, signUp, signOut, updateProfile, deleteAccount }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within AuthProvider")
  return context
}
