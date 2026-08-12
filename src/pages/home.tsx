import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Haptics, ImpactStyle } from "@capacitor/haptics"
import { useAuth } from "@/lib/auth-context"
import { getWeekKey } from "@/lib/ai-service"
import { getMemberNames } from "@/lib/circle"
import { getActiveSharedIntentions } from "@/lib/circle-intentions"
import {
  resolveMoveReason,
  pickFeaturedSuggestion,
  getMoveMoodCorrelation,
  buildVisibleSuggestions,
  materializeDefaultSuggestions,
  filterByAnchorCategory,
  excludeUsedTitles,
  usedTitlesForToday,
  getRecentlyUsedTitles,
} from "@/lib/move-selection"
import { MoveOfTheDayCard } from "@/components/anchor/move-of-the-day-card"
import { MovePickerSheet } from "@/components/anchor/move-picker-sheet"
import { MIN_STREAK_FOR_INTENTION } from "@/lib/streaks"
import { resolveIntentionLabel, buildSelectableIntentions } from "@/lib/intentions"
import { useCustomIntentions } from "@/hooks/use-custom-intentions"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Info,
  Heart,
  Sparkles,
  Lock,
  Pencil,
  Sun,
  Moon,
  Volume2,
  Square,
  Check,
  Lightbulb,
} from "lucide-react"
import { AppIcon } from "@/components/icons/app-icon"
import type { AppIconSource } from "@/components/icons/app-icon"
import { isSpeechSynthesisAvailable, speak, stopSpeaking } from "@/lib/speech"
import { moodConfig } from "@/lib/constants"
import { canCheckAnchors, getTimeUntilAnchorCheck } from "@/lib/utils"
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion"
import { OnboardingModal } from "@/components/onboarding/onboarding-modal"
import { MorningRitual } from "@/components/anchor/morning-ritual"
import { ConfettiBurst } from "@/components/anchor/confetti"
import { GentleNudgeModal } from "@/components/anchor/gentle-nudge-modal"
import { PushNudge } from "@/components/anchor/push-nudge"
import { JournalCard } from "@/components/anchor/journal-card"
import { StreakMilestoneModal } from "@/components/anchor/streak-milestone-modal"
import { CircleInviteNudge } from "@/components/circle/circle-invite-nudge"
import { SosWidget } from "@/components/anchor/sos-widget"
import { GratitudeDropCard } from "@/components/anchor/gratitude-drop-card"
import { GratitudeReminderCard } from "@/components/anchor/gratitude-reminder-card"
import { JarOpeningModal } from "@/components/anchor/jar-opening-modal"
import { SoftModeNudgeCard } from "@/components/anchor/soft-mode-nudge-card"
import { SoftModeBadge } from "@/components/anchor/soft-mode-badge"
import { useSoftMode } from "@/hooks/use-soft-mode"
import { useAnchorDefs } from "@/hooks/use-anchor-defs"
import { useNudgeArbitration } from "@/hooks/use-nudge-arbitration"
import { useDailyCycle } from "@/hooks/use-daily-cycle"
import type { TFunction } from "i18next"
import type { AnchorCategory, CircleSharedIntention, CustomIntention } from "@/types"

function intentionLabel(
  t: TFunction,
  rawIntention: string | null,
  language: "en" | "sw",
  customIntentions: CustomIntention[]
): string | null {
  const resolved = resolveIntentionLabel(t, rawIntention, language, customIntentions)
  return resolved ? resolved.toLowerCase() : null
}

function getGreetingKey(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "home.greeting"
  if (hour < 18) return "home.greeting_afternoon"
  return "home.greeting_evening"
}

// Tone-aware sub-line under the greeting — same tone family (gentle/direct/poetic) the
// companion message and weekly letter already use (see src/lib/ai-service.ts), but this one
// is a static i18n string rather than an AI call: it needs to render instantly with the
// greeting, before profile/context data has finished loading.
function getSubtitleKey(tone: string | undefined): string {
  if (tone === "direct") return "home.subtitle_direct"
  if (tone === "poetic") return "home.subtitle_poetic"
  return "home.subtitle"
}

export function HomePage() {
  const { t, i18n } = useTranslation()
  const language = i18n.language === "sw" ? "sw" : "en"
  const { user, profile, updateProfile } = useAuth()
  const { customIntentions } = useCustomIntentions(user?.id)
  const [isSpeakingCompanion, setIsSpeakingCompanion] = useState(false)

  useEffect(() => {
    return () => stopSpeaking()
  }, [])

  function handleToggleCompanionSpeech() {
    if (isSpeakingCompanion) {
      stopSpeaking()
      setIsSpeakingCompanion(false)
      return
    }
    const message = cycle.companionMsg || t("companion.default_message")
    setIsSpeakingCompanion(true)
    speak(message, language, () => setIsSpeakingCompanion(false))
  }
  const {
    softModeActive,
    showEnterNudge: showSoftEnterNudge,
    showExitNudge: showSoftExitNudge,
    softExpanded,
    setSoftExpanded,
    softCategory,
    setSoftCategory,
    checkEnterTrigger: checkSoftEnterTrigger,
    checkExitTrigger: checkSoftExitTrigger,
    acceptSoftMode,
    dismissEnterNudge: dismissSoftEnterNudge,
    exitSoftMode,
    dismissExitNudge: dismissSoftExitNudge,
  } = useSoftMode(user, profile, updateProfile)

  const cycle = useDailyCycle(user, profile, softModeActive, checkSoftEnterTrigger, checkSoftExitTrigger)

  // Circle Mission 3 (grace gift badge) + Mission 2 (shared intention
  // pre-fill) — deliberately a small, self-contained fetch here rather than
  // folded into useDailyCycle beyond the grace-gift streak math it already
  // needed: Home is the only page that needs a friend's name or the active
  // shared intention, so there's no reason for every daily-cycle consumer
  // to pull this in.
  const [graceGiftSenderName, setGraceGiftSenderName] = useState("")
  const [sharedIntention, setSharedIntention] = useState<CircleSharedIntention | null>(null)
  const sharedIntentionAppliedRef = useRef(false)

  useEffect(() => {
    if (!user) return
    getActiveSharedIntentions()
      .then((rows) => setSharedIntention(rows.find((r) => r.status === "accepted") ?? null))
      .catch(() => {})
  }, [user])

  useEffect(() => {
    if (!cycle.graceGift) return
    getMemberNames()
      .then((names) => setGraceGiftSenderName(names[cycle.graceGift!.sender_id] || ""))
      .catch(() => {})
  }, [cycle.graceGift])

  // Applies once, only once real data has loaded (loadingCompanion flips
  // false right after loadContextData resolves) and only if she hasn't
  // already set today's intention herself — a default to pre-select, never
  // a silent overwrite (see this mission's own "modifiable individuellement
  // sans friction" requirement).
  useEffect(() => {
    if (
      sharedIntentionAppliedRef.current ||
      !sharedIntention ||
      cycle.loadingCompanion ||
      cycle.dayMode !== "planning" ||
      cycle.anchor.daily_intention
    ) {
      return
    }
    sharedIntentionAppliedRef.current = true
    cycle.saveAnchor({ daily_intention: sharedIntention.intention })
  }, [sharedIntention, cycle.loadingCompanion, cycle.dayMode, cycle.anchor.daily_intention])

  const firstName = profile?.full_name?.split(" ")[0] ?? ""
  const { anchorDefs, filledAnchorDefs, softAllFilledDone, allAnchorsDone, hasAnyAnchorText } = useAnchorDefs(
    cycle.anchor,
    cycle.saveAnchor
  )

  const moodDone = cycle.selectedMood !== null
  const anchorsDone = allAnchorsDone
  const cycleComplete = moodDone && anchorsDone && cycle.checkInDone

  const showWrappedTeaser = new Date().getDate() >= 28
  const { activeNudge, setGratitudeNudgeWants, setPushNudgeWants } = useNudgeArbitration(
    showSoftEnterNudge,
    showSoftExitNudge,
    showWrappedTeaser
  )

  // "Move of the day" + planning picker — same shared selection logic as
  // src/pages/move.tsx (src/lib/move-selection.ts), fed from state
  // useDailyCycle already loads (recentMoods, recentAnchors, streaks,
  // moveSuggestions). Only shown before the day is locked in.
  const moveWeekKey = getWeekKey()
  const defaultMoveSuggestions = materializeDefaultSuggestions(t)
  const allVisibleMoveSuggestions = buildVisibleSuggestions(cycle.moveSuggestions, moveWeekKey, defaultMoveSuggestions)
  const moveReason = resolveMoveReason({ recentMoods: cycle.recentMoods, currentAnchorStreak: cycle.streaks.currentAnchorStreak })

  // Point 1b: a suggestion already sitting in one of today's 3 anchors must
  // never be offered again for another. Point 1c: soft-prefer suggestions
  // not used in the last 3 days, falling back to the full (still deduped)
  // pool if that empties it out.
  const usedTodayTitles = usedTitlesForToday(cycle.anchor)
  const recentlyUsedTitles = getRecentlyUsedTitles(cycle.recentAnchors, 3)

  function poolFor(anchorCategory: AnchorCategory) {
    const categoryPool = filterByAnchorCategory(allVisibleMoveSuggestions, anchorCategory)
    const deduped = excludeUsedTitles(categoryPool, usedTodayTitles)
    const varied = excludeUsedTitles(deduped, recentlyUsedTitles)
    return varied.length > 0 ? varied : deduped
  }

  // Point 1a: only ever pick from suggestions tagged with the SAME
  // anchor_category as the field being targeted — this is what stops e.g. a
  // "stretch" (mindbody) suggestion from ever landing on the Life card.
  const moveCtaTarget: "life" | "mindbody" | undefined = !cycle.anchor.life_task
    ? "life"
    : !cycle.anchor.mindbody_task
      ? "mindbody"
      : undefined

  const featuredMovePick =
    moveReason !== "absence" && moveCtaTarget ? pickFeaturedSuggestion(poolFor(moveCtaTarget), moveReason) : null
  const featuredMoveTitle = moveReason === "absence" ? t("move.absence_fallback") : featuredMovePick?.title
  const featuredMoveCategory = moveReason === "absence" ? "physical" : featuredMovePick?.category ?? "physical"
  const featuredMoveIsAi = featuredMovePick?.generated_by === "ai"
  const moveCorrelationHint = featuredMoveTitle
    ? getMoveMoodCorrelation(featuredMoveTitle, cycle.recentAnchors, cycle.recentCheckInMoods)
    : null

  function handleAddMoveToAnchor(target: "life" | "mindbody") {
    if (!featuredMoveTitle) return
    if (target === "life") cycle.saveAnchor({ life_task: featuredMoveTitle })
    else cycle.saveAnchor({ mindbody_task: featuredMoveTitle })
  }

  // Point 2: the suggestions picker on each planning anchor card, filtered to
  // that card's category and using the same today/recent exclusion as the
  // featured pick above.
  const [pickerAnchor, setPickerAnchor] = useState<AnchorCategory | null>(null)
  const pickerSuggestions = pickerAnchor ? poolFor(pickerAnchor) : []

  function handlePickMove(title: string) {
    if (!pickerAnchor) return
    const field = pickerAnchor === "future" ? "future_task" : pickerAnchor === "mindbody" ? "mindbody_task" : "life_task"
    cycle.saveAnchor({ [field]: title })
  }

  function handleSaveIntention(value: string) {
    cycle.saveAnchor({ daily_intention: value })
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <ConfettiBurst active={cycle.showConfetti} />
      <OnboardingModal />
      <MorningRitual onComplete={() => {}} />

      <GentleNudgeModal
        open={cycle.nudgeOpen}
        onClose={cycle.dismissNudgeModal}
        onChoose={cycle.handleNudgeChoose}
        onContinue={cycle.handleNudgeContinue}
        type={cycle.nudgeType}
      />

      <StreakMilestoneModal
        milestone={cycle.streakMilestone}
        intentionLabel={intentionLabel(t, cycle.streaks.anchorStreakIntention, language, customIntentions)}
        onClose={cycle.dismissStreakMilestone}
      />

      <JarOpeningModal open={cycle.jarModalOpen} onClose={cycle.closeJarModal} gratitudes={cycle.jarGratitudes} />

      <MovePickerSheet
        open={pickerAnchor !== null}
        onOpenChange={(open) => !open && setPickerAnchor(null)}
        anchorLabel={pickerAnchor ? t(`anchors.${pickerAnchor}`) : ""}
        suggestions={pickerSuggestions}
        onPick={handlePickMove}
      />

      {/* ── Greeting ── */}
      <div className="min-w-0">
        <h1 className="font-heading text-anchor-greeting font-bold text-foreground">
          {t(getGreetingKey())}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(getSubtitleKey(profile?.tone))}</p>
        {softModeActive && (
          <div className="mt-2">
            <SoftModeBadge onExit={exitSoftMode} />
          </div>
        )}
      </div>

      {/* ── Intention Hero ── */}
      <IntentionHeroCard
        intention={cycle.anchor.daily_intention}
        loading={cycle.loadingCompanion}
        language={language}
        customIntentions={customIntentions}
        onSave={handleSaveIntention}
      />

      {/* ── Mood selector — 1 tap, all 5 visible, no scroll needed at 390px ── */}
      <div className="flex justify-between gap-2">
        {moodConfig.map(({ key, icon, color }) => (
          <button
            key={key}
            onClick={() => cycle.handleMoodSelect(key)}
            aria-pressed={cycle.selectedMood === key}
            aria-label={t(`mood.${key}`)}
            className={`flex min-h-11 flex-1 flex-col items-center gap-1 rounded-xl p-3 transition-all duration-200 ${
              prefersReducedMotionSafeScale(cycle.selectedMood === key)
            }`}
            style={{ backgroundColor: color }}
          >
            <AppIcon icon={icon} active={cycle.selectedMood === key} decorative className="text-foreground" />
            <span className="text-xs font-medium text-foreground">{t(`mood.${key}`)}</span>
          </button>
        ))}
      </div>

      {/* ── 3 Anchors ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-lg font-semibold">
              {softModeActive && !softExpanded ? t("soft_mode.one_thing_title") : t("home.anchors_title")}
            </h2>
            {(!softModeActive || softExpanded) && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground transition-colors">
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{t("home.why_three")}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {cycle.dayMode === "planning" && hasAnyAnchorText && (
            <Button size="sm" onClick={cycle.attemptLockDay} className="gap-1.5 text-xs">
              <Lock className="h-3.5 w-3.5" />
              {t("home.start_my_day")}
            </Button>
          )}
          {cycle.dayMode === "tracking" && (
            <Button variant="ghost" size="sm" onClick={cycle.unlockDay} className="gap-1.5 text-xs text-muted-foreground">
              <Pencil className="h-3.5 w-3.5" />
              {t("home.edit")}
            </Button>
          )}
        </div>

        {cycle.dayMode === "planning" && (
          <div className="space-y-3">
            {softModeActive && !softExpanded ? (
              <SoftAnchorPicker
                defs={anchorDefs}
                selected={softCategory ?? anchorDefs.find((d) => d.task)?.key ?? null}
                onSelect={setSoftCategory}
                onExpand={() => setSoftExpanded(true)}
              />
            ) : (
              <>
                <PlanningAnchorCard
                  borderColor="var(--anchor-green)"
                  icon="anchor-mark"
                  title={t("anchors.future")}
                  subtitle={t("anchors.future_sub")}
                  task={cycle.anchor.future_task}
                  onTaskChange={(v) => cycle.saveAnchor({ future_task: v })}
                  onOpenSuggestions={() => setPickerAnchor("future")}
                />
                <PlanningAnchorCard
                  borderColor="var(--anchor-pink)"
                  icon="mindbody"
                  title={t("anchors.mindbody")}
                  subtitle={t("anchors.mindbody_sub")}
                  task={cycle.anchor.mindbody_task}
                  onTaskChange={(v) => cycle.saveAnchor({ mindbody_task: v })}
                  onOpenSuggestions={() => setPickerAnchor("mindbody")}
                />
                <PlanningAnchorCard
                  borderColor="var(--anchor-lavender)"
                  icon="life"
                  title={t("anchors.life")}
                  subtitle={t("anchors.life_sub")}
                  task={cycle.anchor.life_task}
                  onTaskChange={(v) => cycle.saveAnchor({ life_task: v })}
                  onOpenSuggestions={() => setPickerAnchor("life")}
                />
              </>
            )}

            {hasAnyAnchorText && (
              <Button onClick={cycle.attemptLockDay} className="w-full min-h-12 rounded-anchor-card-lg" size="lg">
                <Lock className="mr-2 h-4 w-4" />
                {t("home.lock_anchors_cta")}
              </Button>
            )}
          </div>
        )}

        {cycle.dayMode === "tracking" && (
          <div className="space-y-3">
            {(softModeActive ? filledAnchorDefs : anchorDefs).map((d) => (
              <TrackingAnchorCard
                key={d.key}
                borderColor={d.borderColor}
                icon={d.icon}
                title={d.title}
                subtitle={d.subtitle}
                task={d.task}
                completed={d.completed}
                onCheckChange={d.onCheckChange}
                lockedAt={cycle.anchor.anchors_locked_at}
              />
            ))}

            {(softModeActive ? softAllFilledDone : allAnchorsDone) && (
              <div className="rounded-anchor-card-lg bg-sage-light/60 p-4 text-center">
                <p className="text-sm font-medium text-primary">
                  🎉 {t("home.all_anchors_done")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Quick Actions — Journal + Gratitude Jar, side by side, secondary
          to the hero flow above (min-w-0 lets each card's own inner flex
          rows shrink instead of blowing out the grid track) ── */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("home.quick_actions_title")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <JournalCard />
          </div>
          <div className="min-w-0">
            <GratitudeDropCard />
          </div>
        </div>
      </div>

      {/* ── Affirmation / Companion — one voice, fused per Mission 6 ── */}
      <Card className="border-0 overflow-hidden rounded-anchor-card-lg bg-gradient-to-br from-sage-light/60 to-lavender/30 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              {cycle.loadingCompanion ? t("companion.loading") : t("companion.title")}
            </p>
            <p className="text-sm text-foreground/90 leading-snug font-medium">
              {cycle.companionMsg || t("companion.default_message")}
            </p>
          </div>
          {isSpeechSynthesisAvailable() && !cycle.loadingCompanion && (
            <button
              onClick={handleToggleCompanionSpeech}
              aria-label={t(isSpeakingCompanion ? "companion.stop" : "companion.listen")}
              className="min-h-11 min-w-11 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              {isSpeakingCompanion ? <Square className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          )}
        </CardContent>
      </Card>

      {/* Supportive Message — kept mounted per CARTOGRAPHIE.md (f) contract */}
      <Card className="border-0 rounded-anchor-card-lg bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]">
        <CardContent className="flex items-start gap-3 p-5">
          <Heart className="mt-0.5 h-5 w-5 shrink-0 text-rose-accent" />
          <p className="font-heading text-sm italic text-foreground/80">
            {t("home.supportive")} &#x1F338;
          </p>
        </CardContent>
      </Card>

      {/* ── Everything below keeps its existing conditional logic verbatim —
          only its position moved lower in the page per Mission 6's new
          hierarchy (Greeting → Intention → Mood → Anchors → Quick Actions →
          Affirmation → nudges/streaks/move/grace → SOS). ── */}
      <CircleInviteNudge />

      {activeNudge === "soft_enter" && (
        <SoftModeNudgeCard variant="enter" onAccept={acceptSoftMode} onDismiss={dismissSoftEnterNudge} />
      )}
      {activeNudge === "soft_exit" && (
        <SoftModeNudgeCard variant="exit" onAccept={exitSoftMode} onDismiss={dismissSoftExitNudge} />
      )}
      <GratitudeReminderCard
        todayMood={cycle.selectedMood}
        onVisibilityChange={setGratitudeNudgeWants}
        suppressed={activeNudge !== null && activeNudge !== "gratitude"}
      />
      <PushNudge
        active={cycleComplete}
        onVisibilityChange={setPushNudgeWants}
        suppressed={activeNudge !== null && activeNudge !== "push"}
      />
      {activeNudge === "wrapped_teaser" && (
        <p className="text-center text-xs italic text-muted-foreground">{t("wrapped.teaser")}</p>
      )}

      {featuredMoveTitle && !cycle.anchor.anchors_locked_at && (
        <MoveOfTheDayCard
          title={featuredMoveTitle}
          category={featuredMoveCategory}
          isAiGenerated={featuredMoveIsAi}
          correlationHint={moveCorrelationHint}
          ctaTarget={moveCtaTarget}
          onAdd={handleAddMoveToAnchor}
        />
      )}

      {/* Daily Cycle progress + Streaks — grouped into one lighter-weight "Today"
          section (tight internal space-y-3 instead of the page's usual
          space-y-6) rather than 2-3 separately shadowed Cards: the progress
          panel drops its own Card/shadow (flat tinted panel instead) so it
          reads as this section's header rather than another stacked card,
          while StreakCard below keeps its own Card — its background color is
          real state (active/celebrated), not just decoration. Pure container
          change: cycleComplete/moodDone/anchorsDone/checkInDone and every
          StreakCard prop are untouched. */}
      <div className="space-y-3">
      <div className={`rounded-anchor-card-lg p-4 transition-colors duration-500 ${cycleComplete ? "bg-sage-light/40" : "bg-muted/30"}`}>
          <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("daily_cycle.title")}
          </p>

          <div className="flex items-center justify-between">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-500 ${
                moodDone ? "bg-peach text-white dark:text-background shadow-md scale-110" : "bg-muted text-muted-foreground"
              }`}>
                <Sun className="h-4 w-4" />
              </div>
              <span className={`text-[10px] font-medium ${moodDone ? "text-peach" : "text-muted-foreground"}`}>
                {t("daily_cycle.mood")}
              </span>
            </div>

            <div className={`h-0.5 flex-1 mx-2 rounded-full transition-all duration-500 ${
              moodDone ? "bg-peach/60" : "bg-muted"
            }`} />

            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-500 ${
                anchorsDone ? "bg-primary text-primary-foreground shadow-md scale-110" : "bg-muted text-muted-foreground"
              }`}>
                <AppIcon icon="anchor-mark" decorative className="h-4 w-4" />
              </div>
              <span className={`text-[10px] font-medium ${anchorsDone ? "text-primary" : "text-muted-foreground"}`}>
                {t("daily_cycle.anchors")}
              </span>
            </div>

            <div className={`h-0.5 flex-1 mx-2 rounded-full transition-all duration-500 ${
              anchorsDone ? "bg-primary/60" : "bg-muted"
            }`} />

            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-500 ${
                cycle.checkInDone ? "bg-lavender text-white dark:text-background shadow-md scale-110" : "bg-muted text-muted-foreground"
              }`}>
                <Moon className="h-4 w-4" />
              </div>
              <span className={`text-[10px] font-medium ${cycle.checkInDone ? "text-lavender" : "text-muted-foreground"}`}>
                {t("daily_cycle.checkin")}
              </span>
            </div>
          </div>

          {cycleComplete && (
            <div className="mt-3 text-center">
              <p className="text-xs font-medium text-primary animate-pulse">
                ✨ {t("daily_cycle.complete")}
              </p>
            </div>
          )}
      </div>

      <div className={(cycle.streaks.currentMoodStreak >= MIN_STREAK_FOR_INTENTION || cycle.streaks.currentAnchorStreak >= MIN_STREAK_FOR_INTENTION) ? "space-y-3" : "flex gap-3"}>
        <StreakCard
          icon={<AppIcon icon="streak" decorative className="h-4 w-4" />}
          label={t("streaks.mood")}
          current={cycle.streaks.currentMoodStreak}
          best={cycle.streaks.bestMoodStreak}
          intention={cycle.streaks.moodStreakIntention}
          customIntentions={customIntentions}
          activeBg="bg-peach/30"
          activeText="text-peach"
          celebratedBg="bg-gradient-to-br from-peach/40 to-rose-accent/20"
        />
        <StreakCard
          icon={<AppIcon icon="anchor-mark" decorative className="h-4 w-4" />}
          label={t("streaks.anchors")}
          current={cycle.streaks.currentAnchorStreak}
          best={cycle.streaks.bestAnchorStreak}
          intention={cycle.streaks.anchorStreakIntention}
          customIntentions={customIntentions}
          activeBg="bg-sage-light/60"
          activeText="text-primary"
          celebratedBg="bg-gradient-to-br from-sage-light/70 to-lavender/25"
        />
      </div>
      </div>

      {cycle.graceGift && (
        <p className="text-center text-xs italic text-muted-foreground">
          &#x1F381; {t("circle.grace_gift_badge", { name: graceGiftSenderName || t("settings.circle_member_fallback") })}
        </p>
      )}

      <SosWidget />
    </div>
  )
}

// Selection ring uses scale + shadow for feedback — dropped when
// prefers-reduced-motion is on (Mission 7c), the ring/shadow themselves stay
// since they're static, not animated.
function prefersReducedMotionSafeScale(selected: boolean): string {
  return selected
    ? "ring-2 ring-anchor-orange ring-offset-2 shadow-md motion-safe:scale-110"
    : "hover:shadow-sm motion-safe:hover:scale-105"
}

/* ─── Intention Hero Card ─── */
interface IntentionHeroCardProps {
  intention: string
  loading: boolean
  language: "en" | "sw"
  customIntentions: CustomIntention[]
  onSave: (value: string) => void
}

function IntentionHeroCard({ intention, loading, language, customIntentions, onSave }: IntentionHeroCardProps) {
  const { t } = useTranslation()
  const prefersReducedMotion = usePrefersReducedMotion()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState("")
  const [justSaved, setJustSaved] = useState(false)
  const suppressSyncRef = useRef(false)

  // Syncs from the persisted value — covers both the initial load and the
  // Circle shared-intention one-shot prefill (see HomePage's own effect for
  // that), but is suppressed for the ~1.2s success flash right after this
  // card's own save so the confirmation isn't cut short by its own update.
  useEffect(() => {
    if (suppressSyncRef.current) return
    setPending(intention || "")
    setEditing(!intention)
  }, [intention])

  function handleConfirm() {
    if (!pending) return
    suppressSyncRef.current = true
    onSave(pending)
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
    setJustSaved(true)
    setTimeout(() => {
      setJustSaved(false)
      setEditing(false)
      suppressSyncRef.current = false
    }, 1200)
  }

  const activeLabel = intentionLabel(t, intention, language, customIntentions)
  const selectable = buildSelectableIntentions(t, language, customIntentions)

  return (
    <Card className="border-0 overflow-hidden rounded-anchor-card-lg bg-gradient-to-br from-card to-secondary dark:to-anchor-gradient-dark shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
      <CardContent className="space-y-4 p-anchor-3">
        <div className="flex items-center gap-1.5">
          <AppIcon icon="intention" size={20} className="text-primary" decorative />
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("home.intention_label")}</p>
        </div>

        {loading ? (
          <div className={`h-14 rounded-xl bg-muted/50 ${prefersReducedMotion ? "" : "animate-pulse"}`} />
        ) : !editing && intention ? (
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate font-heading text-xl font-semibold text-foreground">{activeLabel}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              className="min-h-11 shrink-0 text-xs text-muted-foreground"
            >
              {t("home.intention_change")}
            </Button>
          </div>
        ) : (
          <>
            <p className="font-heading text-lg font-semibold text-foreground">{t("home.intention_hero_prompt")}</p>
            <div className="flex flex-wrap gap-2">
              {selectable.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setPending(option.value)}
                  className={`min-h-11 rounded-full px-4 py-1.5 text-sm transition-all duration-200 ${
                    pending === option.value
                      ? "bg-anchor-green text-anchor-background shadow-md motion-safe:scale-105"
                      : "bg-muted text-foreground hover:bg-accent motion-safe:hover:scale-105"
                  }`}
                >
                  {option.isCustom ? `✨ ${option.label}` : option.label}
                </button>
              ))}
            </div>
            <Button
              onClick={handleConfirm}
              disabled={!pending || justSaved}
              className="min-h-12 w-full rounded-anchor-card-lg bg-anchor-green text-anchor-background hover:bg-anchor-green/90 disabled:opacity-40"
            >
              {justSaved ? (
                <span className="flex items-center gap-1.5">
                  <Check className="h-4 w-4" /> {t("home.intention_saved")}
                </span>
              ) : (
                t("home.intention_set_cta")
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ─── Streak Card ─── */
interface StreakCardProps {
  icon: ReactNode
  label: string
  current: number
  best: number
  intention: string | null
  customIntentions: CustomIntention[]
  activeBg: string
  activeText: string
  celebratedBg: string
}

function StreakCard({ icon, label, current, best, intention, customIntentions, activeBg, activeText, celebratedBg }: StreakCardProps) {
  const { t, i18n } = useTranslation()
  const celebrated = current >= MIN_STREAK_FOR_INTENTION
  // Un streak vient de se terminer : jamais culpabilisant, juste une phrase discrète en
  // option — visible uniquement si un streak a réellement existé avant (best > 0).
  const justEnded = current === 0 && best > 0

  const translatedIntention = intentionLabel(t, intention, i18n.language === "sw" ? "sw" : "en", customIntentions)
  const sentence = translatedIntention
    ? t("streaks.showing_up_with_intention", { count: current, intention: translatedIntention })
    : t("streaks.showing_up_for_yourself", { count: current })

  return (
    <Card
      className={`flex-1 border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all duration-500 ${
        celebrated ? celebratedBg : current > 0 ? activeBg : "bg-muted/30"
      }`}
    >
      <CardContent className={celebrated ? "p-4" : "flex items-center gap-2 p-3"}>
        {celebrated ? (
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className={activeText}>{icon}</span>
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
            </div>
            <p className="text-sm font-semibold leading-snug text-foreground">{sentence}</p>
          </div>
        ) : (
          <>
            <span className={current > 0 ? activeText : "text-muted-foreground"}>{icon}</span>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-semibold text-foreground">{current > 0 ? current : "—"}</p>
              {justEnded && (
                <p className="mt-0.5 text-[10px] italic text-muted-foreground">{t("streaks.rest_is_alignment")}</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ─── Planning Card ─── */
interface PlanningAnchorCardProps {
  borderColor: string
  icon: AppIconSource
  title: string
  subtitle: string
  task: string
  onTaskChange: (value: string) => void
  onOpenSuggestions: () => void
}

function PlanningAnchorCard({ borderColor, icon, title, subtitle, task, onTaskChange, onOpenSuggestions }: PlanningAnchorCardProps) {
  const { t } = useTranslation()
  return (
    <Card
      className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)]"
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AppIcon icon={icon} size={20} decorative style={{ color: borderColor }} />
            <div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onOpenSuggestions}
            className="flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("move.suggestions_button")}
          >
            <Lightbulb className="h-3.5 w-3.5" /> {t("move.suggestions_button")}
          </button>
        </div>
        <Input
          value={task}
          onChange={(e) => onTaskChange(e.target.value)}
          placeholder={t("home.anchor_placeholder")}
          className="border-0 rounded-anchor-input bg-muted/50 px-3 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
        />
      </CardContent>
    </Card>
  )
}

/* ─── Soft Mode: single-anchor picker ─── */
interface SoftAnchorDef {
  key: "future" | "mindbody" | "life"
  icon: AppIconSource
  borderColor: string
  title: string
  subtitle: string
  task: string
  onTaskChange: (value: string) => void
}

interface SoftAnchorPickerProps {
  defs: SoftAnchorDef[]
  selected: SoftAnchorDef["key"] | null
  onSelect: (key: SoftAnchorDef["key"]) => void
  onExpand: () => void
}

// Soft mode's lightweight planning view: chips to choose which ONE of the 3
// categories to fill today, plus a single input for it. "+ Add more anchors
// today" hands off to the normal 3-card view (see home.tsx's softExpanded
// state) — soft mode proposes doing less, it never locks out the full ritual.
function SoftAnchorPicker({ defs, selected, onSelect, onExpand }: SoftAnchorPickerProps) {
  const { t } = useTranslation()
  const chosen = defs.find((d) => d.key === selected) ?? null

  return (
    <Card className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="p-5 space-y-4">
        <div className="flex gap-2">
          {defs.map((d) => (
            <button
              key={d.key}
              onClick={() => onSelect(d.key)}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-all duration-200 ${
                selected === d.key
                  ? "bg-primary text-primary-foreground shadow-md motion-safe:scale-105"
                  : "bg-muted text-foreground hover:bg-accent motion-safe:hover:scale-105"
              }`}
            >
              <AppIcon icon={d.icon} size={20} decorative /> {d.title}
            </button>
          ))}
        </div>
        {chosen && (
          <Input
            value={chosen.task}
            onChange={(e) => chosen.onTaskChange(e.target.value)}
            placeholder={t("home.anchor_placeholder")}
            className="border-0 rounded-anchor-input bg-muted/50 px-3 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onExpand}
          className="min-h-11 px-0 text-xs text-primary hover:bg-transparent hover:underline"
        >
          {t("soft_mode.add_more")}
        </Button>
      </CardContent>
    </Card>
  )
}

/* ─── Tracking Card ─── */
interface TrackingAnchorCardProps {
  borderColor: string
  icon: AppIconSource
  title: string
  subtitle: string
  task: string
  completed: boolean
  onCheckChange: (value: boolean) => void
  lockedAt: string | null
}

function TrackingAnchorCard({
  borderColor,
  icon,
  title,
  subtitle,
  task,
  completed,
  onCheckChange,
  lockedAt,
}: TrackingAnchorCardProps) {
  const { t } = useTranslation()
  const canCheck = canCheckAnchors(lockedAt)
  const timeLeft = getTimeUntilAnchorCheck(lockedAt)
  const [showNudge, setShowNudge] = useState(false)

  const handleCheck = (v: boolean) => {
    if (!canCheck) {
      setShowNudge(true)
      setTimeout(() => setShowNudge(false), 3000)
      return
    }
    onCheckChange(v)
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
  }

  return (
    <Card
      className="border-0 rounded-anchor-card-lg shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all duration-300 hover:shadow-[0_4px_15px_rgba(0,0,0,0.06)] relative overflow-hidden"
      style={{
        borderLeft: `4px solid ${borderColor}`,
        backgroundColor: completed ? "var(--sage-light)" : undefined,
        opacity: !canCheck && !completed ? 0.85 : 1,
      }}
    >
      {!canCheck && !completed && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[1px] rounded-lg">
          <div className="rounded-full bg-secondary/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
            ⏳ {t("timegate.time_left", { time: timeLeft })}
          </div>
        </div>
      )}

      <CardContent className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <AppIcon icon={icon} size={20} decorative style={{ color: borderColor }} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <Checkbox
            checked={completed}
            onCheckedChange={(v) => handleCheck(v === true)}
            className="h-5 w-5 transition-all duration-200 data-[state=checked]:scale-110 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
          />
        </div>
        {task ? (
          <p className={`text-sm pl-1 ${completed ? "text-muted-foreground line-through" : "text-foreground"}`}>
            {task}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic pl-1">{t("home.no_task_set")}</p>
        )}
      </CardContent>

      {showNudge && (
        <div className="absolute bottom-2 left-2 right-2 z-20 rounded-lg bg-peach/90 px-3 py-2 text-center text-xs font-medium text-background shadow-md animate-in fade-in slide-in-from-bottom-2">
          {t("timegate.anchor_wait")}
        </div>
      )}
    </Card>
  )
}
