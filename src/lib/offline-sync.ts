import { supabase } from "@/lib/supabase"
import { userKey } from "@/lib/user-storage"

// Ancienne clé non scopée (avant le scoping par user.id) — contient potentiellement des
// écritures en attente non synchronisées, donc on la migre plutôt que de la supprimer :
// perdre ces entrées ferait perdre de vraies données utilisateur, contrairement aux
// simples préférences/flags nettoyés dans user-storage.ts.
const LEGACY_QUEUE_KEY = "anchor_sync_queue"
const QUEUE_KEY_BASE = "anchor_sync_queue"

interface SyncItem {
  table: string
  action: "upsert" | "insert"
  data: Record<string, unknown>
  conflictKey?: string
}

export function isOnline(): boolean {
  return navigator.onLine
}

// À appeler une fois la session utilisateur connue. Rattache les écritures en attente de
// l'ancienne clé globale (pré-scoping) à cet utilisateur — best-effort, ces entrées
// portent déjà leur propre user_id, donc RLS refusera silencieusement celles qui
// n'appartiennent pas réellement à cet utilisateur au moment de la sync.
export function migrateLegacySyncQueue(userId: string) {
  const raw = localStorage.getItem(LEGACY_QUEUE_KEY)
  if (!raw) return
  localStorage.removeItem(LEGACY_QUEUE_KEY)

  try {
    const legacyItems: SyncItem[] = JSON.parse(raw)
    if (!Array.isArray(legacyItems) || legacyItems.length === 0) return
    const queue = getSyncQueue(userId)
    localStorage.setItem(userKey(QUEUE_KEY_BASE, userId), JSON.stringify([...queue, ...legacyItems]))
  } catch {
    // Clé legacy corrompue — rien à récupérer
  }
}

export function addToSyncQueue(userId: string, item: SyncItem) {
  const queue = getSyncQueue(userId)
  queue.push(item)
  localStorage.setItem(userKey(QUEUE_KEY_BASE, userId), JSON.stringify(queue))
}

export function getSyncQueue(userId: string): SyncItem[] {
  const raw = localStorage.getItem(userKey(QUEUE_KEY_BASE, userId))
  return raw ? JSON.parse(raw) : []
}

export function clearSyncQueue(userId: string) {
  localStorage.setItem(userKey(QUEUE_KEY_BASE, userId), JSON.stringify([]))
}

export async function processSyncQueue(userId: string) {
  if (!isOnline()) return

  const queue = getSyncQueue(userId)
  if (queue.length === 0) return

  const failed: SyncItem[] = []

  for (const item of queue) {
    try {
      if (item.action === "upsert") {
        const { error } = await supabase
          .from(item.table)
          .upsert(item.data, { onConflict: item.conflictKey })
        if (error) {
          failed.push(item)
        }
      } else {
        const { error } = await supabase.from(item.table).insert(item.data)
        if (error) {
          failed.push(item)
        }
      }
    } catch {
      failed.push(item)
    }
  }

  localStorage.setItem(userKey(QUEUE_KEY_BASE, userId), JSON.stringify(failed))
}

export function getLocalData<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  return raw ? JSON.parse(raw) : null
}

export function setLocalData(key: string, data: unknown) {
  localStorage.setItem(key, JSON.stringify(data))
}
