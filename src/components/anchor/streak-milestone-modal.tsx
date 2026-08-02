import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { ConfettiBurst } from "@/components/anchor/confetti"
import { EveningReleaseAnimation } from "@/components/anchor/evening-release-animation"
import { isCheckInTime } from "@/lib/utils"

interface StreakMilestoneModalProps {
  milestone: number | null
  // Intention déjà traduite et mise en minuscule par l'appelant (même transformation que
  // la carte streak sur Home) — cette modale n'a pas à connaître la valeur technique brute.
  intentionLabel: string | null
  onClose: () => void
}

// Célébration dédiée à un palier d'anchor streak (7/14/21/30 jours) — dans l'esprit du
// morning ritual / evening release : plein écran, douce, une seule action possible
// (continuer). L'animation suit le moment de la journée : confetti (énergique, journée)
// avant l'heure du check-in, particules qui montent (calme, soir) après — cf.
// isCheckInTime() déjà utilisé pour le time-gate du check-in du soir.
export function StreakMilestoneModal({ milestone, intentionLabel, onClose }: StreakMilestoneModalProps) {
  const { t } = useTranslation()

  if (milestone === null) return null

  const sentence = intentionLabel
    ? t("streak_milestone.sentence_with_intention", { count: milestone, intention: intentionLabel })
    : t("streak_milestone.sentence_fallback", { count: milestone })

  const evening = isCheckInTime()

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/98 backdrop-blur-md p-6">
      <div className="relative flex flex-col items-center text-center">
        {evening ? <EveningReleaseAnimation active /> : <ConfettiBurst active />}

        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-peach/30">
          <span className="text-4xl">&#x2693;</span>
        </div>

        <p className="mt-6 font-heading text-2xl font-semibold text-foreground">
          {t("streak_milestone.title")}
        </p>
        <p className="mt-3 max-w-xs text-base text-foreground/90 leading-relaxed">
          {sentence}
        </p>
        <p className="mt-2 text-sm italic text-muted-foreground">
          {t("streak_milestone.encouragement")}
        </p>
      </div>

      <Button onClick={onClose} className="mt-10" size="lg">
        {t("streak_milestone.dismiss")}
      </Button>
    </div>
  )
}
