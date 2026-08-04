import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { getSoftModeQuestion } from "@/lib/checkin-questions"
import { getQuickReplyChips } from "@/lib/checkin-chips"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Heart, Moon, Mic, Square, Play, Trash2, Sparkles } from "lucide-react"
import { moodConfig } from "@/lib/constants"
import { isCheckInTime } from "@/lib/utils"
import { EveningReleaseAnimation } from "@/components/anchor/evening-release-animation"
import { useCheckIn } from "@/hooks/use-checkin"

function moodNoteBucket(mood: string): "heavy" | "good" | "neutral" {
  if (mood === "low" || mood === "stressed") return "heavy"
  if (mood === "great" || mood === "okay") return "good"
  return "neutral"
}

export function CheckInPage() {
  const { t, i18n } = useTranslation()
  const { user, profile } = useAuth()
  const lang: "en" | "sw" = i18n.language === "sw" ? "sw" : "en"
  const cycle = useCheckIn(user, profile, lang)

  const softModeActive = profile?.soft_mode ?? false
  const [q1, q2] = cycle.dailyQuestions
  const q2Display = cycle.personalQuestion ?? q2
  const isEvening = isCheckInTime()
  const hoursUntilEvening = Math.max(0, 19 - new Date().getHours())
  // Soft mode: 1 question instead of 3 — the AI follow-up if one was
  // generated, otherwise a fixed gentle fallback (never the rotating pool,
  // which includes heavier prompts). Reuses the Reflection-1 card/field.
  const softQuestion = cycle.personalQuestion ?? getSoftModeQuestion(lang)
  const chipsWhatMatters = getQuickReplyChips(
    "what_matters",
    cycle.recentCheckIns.map((c) => c.what_matters).filter((t): t is string => !!t),
    lang
  )
  const chipsWhatAvoiding = getQuickReplyChips(
    "what_avoiding",
    cycle.recentCheckIns.map((c) => c.what_avoiding).filter((t): t is string => !!t),
    lang
  )
  const chipsWhatFeltReal = getQuickReplyChips(
    "what_felt_real",
    cycle.recentCheckIns.map((c) => c.what_felt_real).filter((t): t is string => !!t),
    lang
  )

  if (!isEvening) {
    return (
      <div className="mx-auto max-w-lg flex min-h-[60vh] flex-col items-center justify-center space-y-6 px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-lavender/30">
          <Moon className="h-10 w-10 text-lavender" />
        </div>
        <div>
          <h2 className="font-heading text-xl font-semibold text-foreground">
            {t("timegate.evening_title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {t("timegate.evening_message")}
          </p>
        </div>
        <div className="rounded-full bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground">
          {hoursUntilEvening > 0
            ? t("timegate.hours_until", { hours: hoursUntilEvening, plural: hoursUntilEvening > 1 ? 's' : '' })
            : t("timegate.soon")}
        </div>
        <p className="text-xs text-muted-foreground italic">
          {t("timegate.evening_sub")}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("checkin.title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("checkin.subtitle")}</p>
        {softModeActive && (
          <p className="mt-1 text-xs italic text-muted-foreground">{t("soft_mode.checkin_notice")}</p>
        )}
      </div>

      {/* Evening Mood Selector */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Moon className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-foreground">{t("checkin.evening_mood_label")}</p>
          </div>
          <div className="flex justify-between gap-2">
            {moodConfig.map(({ key, emoji, color }) => (
              <button
                key={key}
                onClick={() => cycle.updateField("evening_mood", key)}
                className={`flex flex-1 flex-col items-center gap-1 rounded-xl p-2.5 transition-all duration-300 ${
                  cycle.checkIn.evening_mood === key
                    ? "ring-2 ring-primary ring-offset-2 scale-110 shadow-md"
                    : "hover:scale-105 hover:shadow-sm"
                }`}
                style={{ backgroundColor: color }}
              >
                <span className="text-xl">{emoji}</span>
                <span className="text-[10px] font-medium text-foreground">{t(`mood.${key}`)}</span>
              </button>
            ))}
          </div>
          {cycle.checkIn.evening_mood && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs text-muted-foreground">
                {t(`checkin.evening_mood_note_${moodNoteBucket(cycle.checkIn.evening_mood)}`)}
              </p>
              <Input
                value={cycle.checkIn.evening_mood_note ?? ""}
                onChange={(e) => cycle.updateField("evening_mood_note", e.target.value)}
                placeholder="..."
                className="border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reflection 1 */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>{softModeActive && cycle.personalQuestion ? "✨" : "\u{1F33F}"}</span>
              <p className="text-sm font-medium text-foreground">{softModeActive ? softQuestion : q1}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {softModeActive && cycle.personalQuestion && (
                <Badge className="border-0 bg-primary/10 text-[10px] text-primary">
                  {t("checkin.personalized_badge")} ✨
                </Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">
                {t("checkin.reflection")} 1
              </Badge>
            </div>
          </div>
          <Textarea
            value={cycle.checkIn.what_matters ?? ""}
            onChange={(e) => cycle.updateField("what_matters", e.target.value)}
            placeholder="..."
            className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
          {chipsWhatMatters.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chipsWhatMatters.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => cycle.updateField("what_matters", chip)}
                  className="rounded-full bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-sage-light"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
          {(cycle.checkIn.what_matters ?? "").trim() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={cycle.handleAddToJar}
              disabled={cycle.jarAdded || cycle.addingToJar}
              className="mt-2 gap-1.5 px-0 text-xs text-primary hover:bg-transparent hover:underline disabled:opacity-60"
            >
              🫙 {cycle.jarAdded ? t("jar.added_from_checkin") : t("jar.add_from_checkin")}
            </Button>
          )}
        </CardContent>
      </Card>

      {!softModeActive && (
        <>
          {/* Reflection 2 */}
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="p-5">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>{cycle.personalQuestion ? "✨" : "☁️"}</span>
                  <p className="text-sm font-medium text-foreground">{q2Display}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {cycle.personalQuestion && (
                    <Badge className="border-0 bg-primary/10 text-[10px] text-primary">
                      {t("checkin.personalized_badge")} ✨
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {t("checkin.reflection")} 2
                  </Badge>
                </div>
              </div>
              <Textarea
                value={cycle.checkIn.what_avoiding ?? ""}
                onChange={(e) => cycle.updateField("what_avoiding", e.target.value)}
                placeholder="..."
                className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              />
              {chipsWhatAvoiding.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {chipsWhatAvoiding.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => cycle.updateField("what_avoiding", chip)}
                      className="rounded-full bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-sage-light"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reflection 3 */}
          <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="p-5">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>&#x1F338;</span>
                  <p className="text-sm font-medium text-foreground">{t("checkin.what_felt_real")}</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {t("checkin.reflection")} 3
                </Badge>
              </div>
              <Textarea
                value={cycle.checkIn.what_felt_real ?? ""}
                onChange={(e) => cycle.updateField("what_felt_real", e.target.value)}
                placeholder="..."
                className="min-h-[80px] border-0 bg-muted/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              />
              {chipsWhatFeltReal.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {chipsWhatFeltReal.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => cycle.updateField("what_felt_real", chip)}
                      className="rounded-full bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-sage-light"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Voice Note Section */}
      <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-foreground">{t("checkin.voice_note")}</p>
          </div>

          {!cycle.audioUrl ? (
            <div className="flex items-center gap-3">
              <button
                onClick={cycle.isRecording ? cycle.stopRecording : cycle.startRecording}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
                  cycle.isRecording
                    ? "bg-destructive text-white dark:text-background animate-pulse"
                    : "bg-primary text-primary-foreground hover:scale-105"
                }`}
              >
                {cycle.isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
              </button>
              <div className="flex-1">
                {cycle.isRecording ? (
                  <div className="space-y-1">
                    <p className="text-xs text-destructive font-medium">{t("checkin.recording", { seconds: cycle.recordingDuration })}</p>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-destructive transition-all"
                        style={{ width: `${(cycle.recordingDuration / 60) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("checkin.tap_to_record")}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
                <button
                  onClick={cycle.togglePlay}
                  aria-label={cycle.isPlaying ? t("checkin.pause_voice_note") : t("checkin.play_voice_note")}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:scale-105 transition-transform"
                >
                  {cycle.isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                </button>
                <div className="flex-1">
                  <p className="text-xs font-medium text-foreground">{t("checkin.voice_recorded")}</p>
                  <p className="text-xs text-muted-foreground">{cycle.isPlaying ? t("checkin.playing") : t("checkin.ready_to_play")}</p>
                </div>
                <button
                  onClick={cycle.deleteVoiceNote}
                  aria-label={t("checkin.delete_voice_note")}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {cycle.transcribing ? (
                <div className="flex items-center gap-2 px-1">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" />
                  <span className="text-xs italic text-muted-foreground">{t("checkin.transcribing")}</span>
                </div>
              ) : cycle.checkIn.voice_transcript ? (
                <div className="rounded-xl bg-secondary/60 p-3">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("checkin.transcript_label")}
                  </p>
                  <Textarea
                    value={cycle.checkIn.voice_transcript}
                    onChange={(e) => cycle.updateField("voice_transcript", e.target.value)}
                    className="min-h-[60px] border-0 bg-transparent p-0 text-sm italic leading-relaxed text-foreground/85 shadow-none focus-visible:ring-0"
                  />
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Evening Release */}
      <Card className="relative overflow-hidden border-0 bg-secondary shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <EveningReleaseAnimation active={cycle.released} />
        <CardContent className="relative p-5 text-center">
          <Moon className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="font-heading text-sm italic text-foreground/80">
            {t("checkin.evening_release")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={cycle.handleRelease}
            disabled={cycle.released}
            className="mt-3 border-primary/20 text-primary transition-all hover:bg-primary/5"
          >
            {cycle.released ? "✓ " : ""}{t("checkin.release_button")}
          </Button>
        </CardContent>
      </Card>

      {/* Save */}
      <Button onClick={cycle.handleSave} className="w-full" size="lg">
        {cycle.saved ? t("checkin.saved") : t("checkin.save")}
      </Button>
    </div>
  )
}
