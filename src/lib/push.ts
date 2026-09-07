import { Capacitor } from "@capacitor/core"
import { PushNotifications } from "@capacitor/push-notifications"
import { supabase } from "@/lib/supabase"
import { getUserLocalData, setUserLocalData, removeUserLocalData } from "@/lib/user-storage"

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushState =
  | "unsupported"
  | "ios-not-installed"
  | "denied"
  | "subscribed"
  | "not-subscribed"

// getPushState/requestPushPermission/unsubscribePush are the only exports
// consumed by UI (reminders-section.tsx, push-nudge.tsx, onboarding-modal.tsx)
// — each dispatches to a web (Web Push/VAPID) or native (FCM via
// @capacitor/push-notifications) implementation below, so none of those
// call sites need to know which platform they're running on.

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

async function getPushStateWeb(): Promise<PushState> {
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

async function requestPushPermissionWeb(userId: string): Promise<PushState> {
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

async function unsubscribePushWeb(userId: string): Promise<void> {
  if (!isPushSupported()) return

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint)
}

// Native (FCM) — @capacitor/push-notifications has no local equivalent of
// PushManager.getSubscription(), so the last-registered token is cached
// locally (same userKey-scoped localStorage pattern used elsewhere in the
// app) purely so unsubscribePush can find it to delete server-side; it's
// never read for anything else.
const NATIVE_TOKEN_KEY_BASE = "anchor_native_push_token"

function nativePlatform(): "ios" | "android" {
  return Capacitor.getPlatform() === "ios" ? "ios" : "android"
}

async function getPushStateNative(): Promise<PushState> {
  try {
    const { receive } = await PushNotifications.checkPermissions()
    if (receive === "denied") return "denied"
    return receive === "granted" ? "subscribed" : "not-subscribed"
  } catch {
    return "not-subscribed"
  }
}

function registerAndSaveToken(userId: string): Promise<PushState> {
  return new Promise((resolve) => {
    let settled = false

    PushNotifications.addListener("registration", async (token) => {
      if (settled) return
      settled = true
      try {
        const { error } = await supabase.from("push_tokens").upsert(
          {
            user_id: userId,
            platform: nativePlatform(),
            token: token.value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "token" }
        )
        if (error) throw error
        setUserLocalData(NATIVE_TOKEN_KEY_BASE, userId, token.value)
        resolve("subscribed")
      } catch (err) {
        console.error("push.ts: failed to save native push token:", err)
        resolve("not-subscribed")
      }
    }).catch(() => {})

    PushNotifications.addListener("registrationError", (err) => {
      if (settled) return
      settled = true
      console.error("push.ts: native push registration failed:", err)
      resolve("not-subscribed")
    }).catch(() => {})

    PushNotifications.register().catch(() => {
      if (settled) return
      settled = true
      resolve("not-subscribed")
    })
  })
}

async function requestPushPermissionNative(userId: string): Promise<PushState> {
  const { receive } = await PushNotifications.requestPermissions()
  if (receive !== "granted") return receive === "denied" ? "denied" : "not-subscribed"
  return registerAndSaveToken(userId)
}

async function unsubscribePushNative(userId: string): Promise<void> {
  const token = getUserLocalData<string>(NATIVE_TOKEN_KEY_BASE, userId)
  await PushNotifications.unregister().catch(() => {})
  if (token) {
    await supabase.from("push_tokens").delete().eq("user_id", userId).eq("token", token)
    removeUserLocalData(NATIVE_TOKEN_KEY_BASE, userId)
  }
}

export function getPushState(): Promise<PushState> {
  return Capacitor.isNativePlatform() ? getPushStateNative() : getPushStateWeb()
}

export function requestPushPermission(userId: string): Promise<PushState> {
  return Capacitor.isNativePlatform() ? requestPushPermissionNative(userId) : requestPushPermissionWeb(userId)
}

export function unsubscribePush(userId: string): Promise<void> {
  return Capacitor.isNativePlatform() ? unsubscribePushNative(userId) : unsubscribePushWeb(userId)
}
