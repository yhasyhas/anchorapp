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

// Custom event name for "the pending queue length may have changed" —
// dispatched on every write/flush below so UI (see app-layout.tsx's retry
// banner) can stay in sync without polling localStorage. A plain
// window.dispatchEvent is enough here; there's only ever one tab/window
// worth of UI listening to this in practice.
export const SYNC_QUEUE_CHANGED_EVENT = "anchor-sync-queue-changed"

function notifyQueueChanged() {
  window.dispatchEvent(new CustomEvent(SYNC_QUEUE_CHANGED_EVENT))
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
    notifyQueueChanged()
  } catch {
    // Clé legacy corrompue — rien à récupérer
  }
}

export function addToSyncQueue(userId: string, item: SyncItem) {
  const queue = getSyncQueue(userId)
  queue.push(item)
  localStorage.setItem(userKey(QUEUE_KEY_BASE, userId), JSON.stringify(queue))
  notifyQueueChanged()
}

export function getSyncQueue(userId: string): SyncItem[] {
  const raw = localStorage.getItem(userKey(QUEUE_KEY_BASE, userId))
  return raw ? JSON.parse(raw) : []
}

// How many writes on THIS device haven't reached Supabase yet — surfaced in
// app-layout.tsx's banner so a stuck queue (e.g. she switched devices before
// this one ever reconnected) is visible and manually retryable, rather than
// failing silently forever.
export function getPendingSyncCount(userId: string): number {
  return getSyncQueue(userId).length
}

export function clearSyncQueue(userId: string) {
  localStorage.setItem(userKey(QUEUE_KEY_BASE, userId), JSON.stringify([]))
  notifyQueueChanged()
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
  notifyQueueChanged()
}

export function getLocalData<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  return raw ? JSON.parse(raw) : null
}

export function setLocalData(key: string, data: unknown) {
  localStorage.setItem(key, JSON.stringify(data))
}
