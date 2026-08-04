import { useTranslation } from "react-i18next"
import type { DailyAnchor } from "@/types"

export interface AnchorDef {
  key: "future" | "mindbody" | "life"
  icon: string
  borderColor: string
  title: string
  subtitle: string
  task: string
  completed: boolean
  onTaskChange: (value: string) => void
  onCheckChange: (value: boolean) => void
}

export interface UseAnchorDefsResult {
  anchorDefs: AnchorDef[]
  // Shared shape for both the soft-mode single-anchor picker and the
  // tracking list — lets tracking mode filter down to "just the categories
  // she actually filled" without duplicating the 3 cards' worth of JSX for
  // the soft-mode case.
  filledAnchorDefs: AnchorDef[]
  softAllFilledDone: boolean
  allAnchorsDone: boolean
  hasAnyAnchorText: string | boolean
}

// Extracted from src/pages/home.tsx — pure derivation from `anchor` plus the
// `saveAnchor` callback already owned by the page (anchor persistence itself
// stays there, this hook only builds the per-category view models both the
// normal 3-card view and the Soft Mode single-anchor picker read from).
export function useAnchorDefs(anchor: DailyAnchor, saveAnchor: (updates: Partial<DailyAnchor>) => void): UseAnchorDefsResult {
  const { t } = useTranslation()

  const anchorDefs: AnchorDef[] = [
    {
      key: "future",
      icon: "\u{1F331}",
      borderColor: "var(--sage)",
      title: t("anchors.future"),
      subtitle: t("anchors.future_sub"),
      task: anchor.future_task,
      completed: anchor.future_completed,
      onTaskChange: (v: string) => saveAnchor({ future_task: v }),
      onCheckChange: (v: boolean) => saveAnchor({ future_completed: v }),
    },
    {
      key: "mindbody",
      icon: "\u{1F9E0}",
      borderColor: "var(--rose-accent)",
      title: t("anchors.mindbody"),
      subtitle: t("anchors.mindbody_sub"),
      task: anchor.mindbody_task,
      completed: anchor.mindbody_completed,
      onTaskChange: (v: string) => saveAnchor({ mindbody_task: v }),
      onCheckChange: (v: boolean) => saveAnchor({ mindbody_completed: v }),
    },
    {
      key: "life",
      icon: "\u{1F30D}",
      borderColor: "var(--lavender)",
      title: t("anchors.life"),
      subtitle: t("anchors.life_sub"),
      task: anchor.life_task,
      completed: anchor.life_completed,
      onTaskChange: (v: string) => saveAnchor({ life_task: v }),
      onCheckChange: (v: boolean) => saveAnchor({ life_completed: v }),
    },
  ]

  const filledAnchorDefs = anchorDefs.filter((d) => d.task)
  const softAllFilledDone = filledAnchorDefs.length > 0 && filledAnchorDefs.every((d) => d.completed)
  const allAnchorsDone = anchor.future_completed && anchor.mindbody_completed && anchor.life_completed
  const hasAnyAnchorText = anchor.future_task || anchor.mindbody_task || anchor.life_task

  return { anchorDefs, filledAnchorDefs, softAllFilledDone, allAnchorsDone, hasAnyAnchorText }
}
