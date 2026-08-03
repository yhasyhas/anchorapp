// Quick-reply chips shown under each check-in text field — pure, synchronous,
// local-only (no network, no AI call), so they're always available offline
// and never need a consent gate: nothing here ever leaves the device.

export type CheckInField = "what_matters" | "what_avoiding" | "what_felt_real"

type LangMap = Record<"en" | "sw", string[]>

interface Theme {
  keywords: LangMap
  chips: LangMap
}

const MAX_CHIPS = 4

// Small, hand-picked set of recurring life themes. Matching is intentionally
// simple (substring search over both languages' keyword lists, regardless of
// UI language) since her own free text may not match the app's current
// language — only the returned chip LABELS are language-specific.
const THEMES: Theme[] = [
  {
    keywords: {
      en: ["work", "job", "meeting", "boss", "deadline", "office", "career", "client", "project"],
      sw: ["kazi", "mkutano", "bosi", "mradi", "ofisi"],
    },
    chips: {
      en: ["Work again", "Better today", "Same heaviness"],
      sw: ["Kazi tena", "Bora leo", "Uzito uleule"],
    },
  },
  {
    keywords: {
      en: ["family", "mom", "dad", "mother", "father", "sister", "brother", "kids", "husband", "wife", "partner", "parents"],
      sw: ["familia", "mama", "baba", "dada", "kaka", "mtoto", "mume", "mke", "wazazi"],
    },
    chips: {
      en: ["Family stuff", "Still on my mind", "Lighter today"],
      sw: ["Mambo ya familia", "Bado kichwani", "Nyepesi leo"],
    },
  },
  {
    keywords: {
      en: ["tired", "sleep", "rest", "exhausted", "sleepy", "fatigue"],
      sw: ["choka", "usingizi", "pumzika", "uchovu"],
    },
    chips: {
      en: ["Still tired", "Slept better", "Need rest"],
      sw: ["Bado nimechoka", "Nililala vizuri", "Nahitaji kupumzika"],
    },
  },
  {
    keywords: {
      en: ["conversation", "argument", "fight", "conflict", "avoid", "confront"],
      sw: ["mazungumzo", "ugomvi", "mzozo", "epuka"],
    },
    chips: {
      en: ["That conversation", "Still avoiding it", "Talked it through"],
      sw: ["Mazungumzo hayo", "Bado naepuka", "Tumezungumza"],
    },
  },
  {
    keywords: {
      en: ["pain", "sick", "body", "headache", "hurt"],
      sw: ["maumivu", "mgonjwa", "mwili", "kichwa"],
    },
    chips: {
      en: ["Body stuff", "Feeling better", "Still off"],
      sw: ["Mambo ya mwili", "Najisikia vizuri zaidi", "Bado si sawa"],
    },
  },
]

const GENERIC_CHIPS: Record<CheckInField, LangMap> = {
  what_matters: {
    en: ["Small win today", "Nothing major", "A quiet moment"],
    sw: ["Ushindi mdogo leo", "Hakuna kikubwa", "Wakati wa utulivu"],
  },
  what_avoiding: {
    en: ["Nothing big", "Same as before", "A hard conversation"],
    sw: ["Hakuna kikubwa", "Kama kawaida", "Mazungumzo magumu"],
  },
  what_felt_real: {
    en: ["A quiet moment", "Time with someone", "Just breathing"],
    sw: ["Wakati wa utulivu", "Muda na mtu", "Kupumua tu"],
  },
}

// `recentTexts` should already be scoped to roughly the last week — the
// caller (checkin.tsx) reuses the same 7-day check-in fetch built for the
// personalized follow-up question.
export function getQuickReplyChips(field: CheckInField, recentTexts: string[], language: "en" | "sw"): string[] {
  const haystack = recentTexts.join(" ").toLowerCase()

  const matched: string[] = []
  for (const theme of THEMES) {
    const keywords = [...theme.keywords.en, ...theme.keywords.sw]
    if (keywords.some((kw) => haystack.includes(kw))) {
      matched.push(...theme.chips[language])
    }
  }

  const combined = [...matched, ...GENERIC_CHIPS[field][language]]
  return Array.from(new Set(combined)).slice(0, MAX_CHIPS)
}
