import { supabase } from "@/lib/supabase"

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushState =
  | "unsupported"
  | "ios-not-installed"
  | "denied"
  | "subscribed"
  | "not-subscribed"

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

// iOS Safari only allows Web Push once the site has been added to the home
// screen (standalone display mode) — asking for permission before that just
// fails silently, so callers need to know to show install guidance instead.
function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

export async function getPushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return "ios-not-installed"
  if (!isPushSupported()) return "unsupported"
  if (Notification.permission === "denied") return "denied"

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription ? "subscribed" : "not-subscribed"
  } catch {
    return "not-subscribed"
  }
}

async function saveSubscription(userId: string, subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON()
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      keys: json.keys,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  )
  if (error) throw error
}

export async function requestPushPermission(userId: string): Promise<PushState> {
  if (isIOS() && !isStandalone()) return "ios-not-installed"
  if (!isPushSupported()) return "unsupported"
  if (!VAPID_PUBLIC_KEY) {
    console.error("push.ts: VITE_VAPID_PUBLIC_KEY is not configured")
    return "unsupported"
  }

  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    return permission === "denied" ? "denied" : "not-subscribed"
  }

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  await saveSubscription(userId, subscription)
  return "subscribed"
}

export async function unsubscribePush(userId: string): Promise<void> {
  if (!isPushSupported()) return

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint)
}
