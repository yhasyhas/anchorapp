// Stockage local scopé par utilisateur — évite qu'un compte voie les données
// (cache IA, préférences, flags UI) d'un compte précédent sur le même appareil.

export function userKey(base: string, userId: string): string {
  return `${base}_${userId}`
}

export function getUserLocalData<T>(base: string, userId: string): T | null {
  const raw = localStorage.getItem(userKey(base, userId))
  return raw ? JSON.parse(raw) : null
}

export function setUserLocalData(base: string, userId: string, data: unknown): void {
  localStorage.setItem(userKey(base, userId), JSON.stringify(data))
}

export function removeUserLocalData(base: string, userId: string): void {
  localStorage.removeItem(userKey(base, userId))
}

// Anciennes clés non scopées (avant l'introduction du scoping par user.id) — de simples
// préférences/flags/cache, donc aucune perte de données réelle à les supprimer.
const LEGACY_UNSCOPED_KEYS = [
  "anchor_ai_enabled",
  "anchor_ai_checkins",
  "anchor_ai_insights_cache",
  "anchor_morning_ritual_done",
  "anchor_has_seen_onboarding",
]

// À appeler une fois la session utilisateur connue (voir auth-context.tsx). Idempotent :
// ne fait plus rien une fois les anciennes clés supprimées.
export function cleanupLegacyLocalStorage(): void {
  for (const key of LEGACY_UNSCOPED_KEYS) {
    localStorage.removeItem(key)
  }
}
