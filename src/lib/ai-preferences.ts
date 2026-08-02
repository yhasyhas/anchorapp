// Préférences de consentement IA — module central pour éviter que les clés
// localStorage soient dupliquées entre settings.tsx et ai-service.ts.
import { userKey } from "@/lib/user-storage"

const AI_ENABLED_BASE = "anchor_ai_enabled"
const AI_CHECKINS_BASE = "anchor_ai_checkins"

export function isAiEnabled(userId: string): boolean {
  return localStorage.getItem(userKey(AI_ENABLED_BASE, userId)) === "true"
}

export function isAiCheckInsEnabled(userId: string): boolean {
  return localStorage.getItem(userKey(AI_CHECKINS_BASE, userId)) === "true"
}

export function setAiEnabled(userId: string, enabled: boolean): void {
  localStorage.setItem(userKey(AI_ENABLED_BASE, userId), String(enabled))
}

export function setAiCheckInsEnabled(userId: string, enabled: boolean): void {
  localStorage.setItem(userKey(AI_CHECKINS_BASE, userId), String(enabled))
}
