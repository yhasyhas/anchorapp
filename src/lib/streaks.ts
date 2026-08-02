import { localDateStr } from "@/lib/utils"
import type { MoodLog, DailyAnchor } from "@/types"

export interface StreakData {
  currentMoodStreak: number
  currentAnchorStreak: number
  bestMoodStreak: number
  bestAnchorStreak: number
  // Intention (valeur technique brute, ex. "Courage") la plus fréquente sur les jours du
  // streak en cours — null tant que le streak n'a pas atteint MIN_STREAK_FOR_INTENTION ou
  // qu'aucune intention n'a été posée sur cette période. L'appelant traduit/affiche.
  moodStreakIntention: string | null
  anchorStreakIntention: string | null
}

// Palier à partir duquel un streak passe du chiffre mécanique ("7 🔥") à la formule avec
// sens ("7 days of showing up with courage") — règle produit : la constance se célèbre
// avec intention seulement une fois qu'elle est établie, pas dès le premier jour.
export const MIN_STREAK_FOR_INTENTION = 3

// Paliers qui déclenchent une célébration dédiée plein écran (anchor streak uniquement).
export const ANCHOR_STREAK_MILESTONES = [7, 14, 21, 30] as const

export function reachedAnchorMilestone(streak: number): number | null {
  return (ANCHOR_STREAK_MILESTONES as readonly number[]).includes(streak) ? streak : null
}

// Convertit "YYYY-MM-DD" en index de jour (jours depuis l'epoch) pour comparer deux
// dates calendaires sans se soucier du fuseau horaire ou des changements d'heure DST
function dayIndex(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000)
}

function addDaysLocal(date: Date, amount: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + amount)
  return d
}

// Meilleur streak, strict : reconstruit une timeline calendaire continue en comparant les
// dates consécutives triées — un jour sans ligne (trou dans le calendrier) casse le streak.
// Utilisé tel quel pour le mood streak (voir règle de grâce plus bas pour les ancres).
export function calculateBestStreakFromDates(dates: string[]): number {
  if (dates.length === 0) return 0
  const sorted = [...new Set(dates)].sort()
  let best = 1
  let current = 1
  for (let i = 1; i < sorted.length; i++) {
    current = dayIndex(sorted[i]) - dayIndex(sorted[i - 1]) === 1 ? current + 1 : 1
    best = Math.max(best, current)
  }
  return best
}

// ─── Grace day (ancres uniquement — règle produit) ───
//
// UN jour manqué ne casse pas l'anchor streak si les 3 ancres sont de nouveau complétées
// le jour suivant le trou : la constance n'est pas un contrat mécanique, une pause n'est
// pas un échec. Le jeton de grâce est unique par streak et se consomme au premier trou
// rencontré — un second trou (même isolé) casse le streak, et un trou de 2+ jours
// consécutifs le casse toujours (la grâce ne couvre qu'un seul jour manqué à la fois).
//
// Le mood streak, lui, reste strict : logger une humeur est un simple tap, pas un geste
// qui mérite d'excuse — voir calculateBestStreakFromDates / currentStreakRun(allowGrace=false).
export function calculateBestAnchorStreakWithGrace(dates: string[]): number {
  if (dates.length === 0) return 0
  const sorted = [...new Set(dates)].sort()

  // Consommer la grâce au premier trou rencontré n'est PAS toujours optimal : un trou
  // plus tardif peut ouvrir une chaîne plus longue que celle obtenue en graciant le tout
  // premier trou venu (classique "plus longue sous-suite avec au plus un trou toléré").
  // On garde donc, à chaque jour, deux états : la meilleure série qui s'y termine sans
  // avoir encore utilisé sa grâce (noGrace), et la meilleure série qui s'y termine ayant
  // déjà consommé sa grâce, ici ou avant (withGrace) — et on prend le meilleur des deux.
  let noGrace = 1
  let withGrace = 1
  let best = 1

  for (let i = 1; i < sorted.length; i++) {
    const gap = dayIndex(sorted[i]) - dayIndex(sorted[i - 1])
    let nextNoGrace: number
    let nextWithGrace: number

    if (gap === 1) {
      nextNoGrace = noGrace + 1
      nextWithGrace = withGrace + 1
    } else if (gap === 2) {
      // Un jour manqué : soit la grâce est consommée ici pour prolonger une chaîne
      // encore intacte (noGrace + 1), soit on repart de zéro — une chaîne ayant déjà
      // utilisé sa grâce ne peut pas franchir un second trou.
      nextNoGrace = 1
      nextWithGrace = noGrace + 1
    } else {
      // Trou de 2+ jours : la grâce ne couvre qu'un seul jour manqué, aucune chaîne
      // ne survit à un trou de cette taille.
      nextNoGrace = 1
      nextWithGrace = 1
    }

    noGrace = nextNoGrace
    withGrace = nextWithGrace
    best = Math.max(best, noGrace, withGrace)
  }

  return best
}

interface StreakRun {
  length: number
  // Jours réellement complétés du streak en cours, ordre chronologique (ancien → récent).
  // Un trou gracié n'y figure pas — la grâce préserve la continuité du compteur, elle ne
  // fabrique pas un jour qui n'a pas eu lieu.
  dates: string[]
}

// Streak courant : part d'aujourd'hui et remonte tant que les jours sont consécutifs (ou
// graciés une fois, si allowGrace). Si aujourd'hui n'est pas encore logué, on part d'hier
// à la place — la journée n'est pas terminée, donc on ne casse pas le streak d'hier.
function currentStreakRun(dateSet: Set<string>, allowGrace: boolean): StreakRun {
  const now = new Date()
  let cursor = dateSet.has(localDateStr(now)) ? now : addDaysLocal(now, -1)
  if (!dateSet.has(localDateStr(cursor))) return { length: 0, dates: [] }

  const dates: string[] = []
  let graceUsed = false

  while (true) {
    const cursorStr = localDateStr(cursor)
    if (dateSet.has(cursorStr)) {
      dates.push(cursorStr)
      cursor = addDaysLocal(cursor, -1)
      continue
    }
    if (allowGrace && !graceUsed) {
      graceUsed = true
      cursor = addDaysLocal(cursor, -1)
      continue
    }
    break
  }

  return { length: dates.length, dates: dates.reverse() }
}

// Intention dominante sur une période de streak : celle posée le plus souvent
// (daily_anchors.daily_intention) durant ces jours précis. Retourne la valeur technique
// brute (ex. "Courage") — traduction et mise en forme reviennent à l'appelant (i18n).
export function dominantIntentionForStreak(streakDates: string[], anchors: DailyAnchor[]): string | null {
  if (streakDates.length === 0) return null
  const dateSet = new Set(streakDates)
  const freq: Record<string, number> = {}
  for (const a of anchors) {
    if (!a.daily_intention || !dateSet.has(a.date)) continue
    freq[a.daily_intention] = (freq[a.daily_intention] || 0) + 1
  }
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]
  return top ? top[0] : null
}

export function calculateStreaks(moods: MoodLog[], anchors: DailyAnchor[]): StreakData {
  const today = localDateStr()

  // ✅ Toute humeur logguée compte : great, okay, meh, low, stressed
  const moodDates = new Set(moods.filter((m) => m.mood && m.date <= today).map((m) => m.date))
  // ✅ Les 3 ancres doivent être complétées
  const anchorDates = new Set(
    anchors
      .filter((a) => a.future_completed && a.mindbody_completed && a.life_completed && a.date <= today)
      .map((a) => a.date)
  )

  const moodRun = currentStreakRun(moodDates, false)
  const anchorRun = currentStreakRun(anchorDates, true)

  return {
    currentMoodStreak: moodRun.length,
    currentAnchorStreak: anchorRun.length,
    bestMoodStreak: calculateBestStreakFromDates([...moodDates]),
    bestAnchorStreak: calculateBestAnchorStreakWithGrace([...anchorDates]),
    moodStreakIntention:
      moodRun.length >= MIN_STREAK_FOR_INTENTION ? dominantIntentionForStreak(moodRun.dates, anchors) : null,
    anchorStreakIntention:
      anchorRun.length >= MIN_STREAK_FOR_INTENTION ? dominantIntentionForStreak(anchorRun.dates, anchors) : null,
  }
}
