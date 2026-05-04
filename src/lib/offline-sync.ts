import { supabase } from "@/lib/supabase"

const QUEUE_KEY = "anchor_sync_queue"

interface SyncItem {
  table: string
  action: "upsert" | "insert"
  data: Record<string, unknown>
  conflictKey?: string
}

export function isOnline(): boolean {
  return navigator.onLine
}

export function addToSyncQueue(item: SyncItem) {
  const queue = getSyncQueue()
  queue.push(item)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function getSyncQueue(): SyncItem[] {
  const raw = localStorage.getItem(QUEUE_KEY)
  return raw ? JSON.parse(raw) : []
}

export function clearSyncQueue() {
  localStorage.setItem(QUEUE_KEY, JSON.stringify([]))
}

export async function processSyncQueue() {
  if (!isOnline()) return

  const queue = getSyncQueue()
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

  localStorage.setItem(QUEUE_KEY, JSON.stringify(failed))
}

export function getLocalData<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  return raw ? JSON.parse(raw) : null
}

export function setLocalData(key: string, data: unknown) {
  localStorage.setItem(key, JSON.stringify(data))
}
