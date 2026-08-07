import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Heart, HeartHandshake, Loader2, Mail, Mic, Square, Play, Trash2, Gift, PartyPopper, Sparkles } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { formatWeekRange } from "@/lib/letters"
import {
  CircleError,
  listMemberships,
  getMemberNames,
  getPresenceToday,
  listReceivedEncouragements,
  listSentEncouragements,
  markEncouragementRead,
  sendEncouragement,
  getSharedLetters,
} from "@/lib/circle"
import { listActiveCircleSos, type CircleSosEntry } from "@/lib/circle-sos"
import {
  MAX_VOICE_ENCOURAGEMENT_SECONDS,
  sendVoiceEncouragement,
  listReceivedVoiceEncouragements,
  listSentVoiceEncouragements,
  markVoiceEncouragementRead,
  getVoiceEncouragementUrl,
} from "@/lib/circle-voice"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import { proposeSharedIntention, respondSharedIntention, getActiveSharedIntentions } from "@/lib/circle-intentions"
import { sendGraceGift, getStreakAlerts } from "@/lib/circle-grace"
import { getRecentCircleMilestones, filterUnseenMilestones, markMilestoneSeen } from "@/lib/circle-milestones"
import {
  reachedAnniversaryMonth,
  getEncouragementCount,
  hasSeenAnniversary,
  markAnniversarySeen,
} from "@/lib/circle-anniversary"
import { intentions } from "@/lib/constants"
import { ENCOURAGEMENT_PRESET_KEYS } from "@/types"
import type {
  CircleMembership,
  ReceivedEncouragement,
  SentEncouragement,
  SharedLetter,
  ReceivedVoiceEncouragement,
  SentVoiceEncouragement,
  CircleSharedIntention,
  CircleStreakAlert,
  CircleMilestone,
} from "@/types"

interface FeedItem {
  id: string
  createdAt: string
  direction: "received" | "sent"
  otherId: string
  kind: "text" | "voice"
  isPreset?: boolean
  message?: string
  storagePath?: string
  durationSeconds?: number
  replyToId?: string | null
}

interface AnniversaryCard {
  friendId: string
  months: number
  count: number
}

const ERROR_KEY: Record<string, string> = {
  encouragement_limit_reached: "circle.send_love_error_limit",
  not_circle_member: "circle.send_love_error_not_member",
  invalid_message: "circle.send_love_error_invalid",
  invalid_preset: "circle.send_love_error_invalid",
  invalid_duration: "circle.send_love_error_invalid",
  intention_already_proposed: "circle.intention_error_already_proposed",
  gift_already_active: "circle.gift_error_already_active",
  gift_already_sent_this_week: "circle.gift_error_already_sent",
}

// Inline playback for a received/sent voice encouragement — signs the URL
// lazily on first play (bucket is private), same "sign on demand" posture
// as check-in voice notes. `onReply` (received items only) reveals a
// "Reply with your voice" affordance once she's started listening — keyed
// off the audio element's own `play` event rather than `ended`, so it shows
// up for anyone replying after just the gist of a 20s note, not only after
// hearing every second of it.
function VoicePlayerInline({
  storagePath,
  durationSeconds,
  onReply,
}: {
  storagePath: string
  durationSeconds: number
  onReply?: () => void
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hasPlayed, setHasPlayed] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  async function toggle() {
    if (playing) {
      audioRef.current?.pause()
      setPlaying(false)
      return
    }
    let signedUrl = url
    if (!signedUrl) {
      setLoading(true)
      signedUrl = await getVoiceEncouragementUrl(storagePath)
      setLoading(false)
      if (!signedUrl) return
      setUrl(signedUrl)
    }
    const audio = new Audio(signedUrl)
    audioRef.current = audio
    audio.onplay = () => setHasPlayed(true)
    audio.onended = () => setPlaying(false)
    audio.play()
    setPlaying(true)
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button onClick={toggle} className="flex items-center gap-1.5 text-primary">
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : playing ? (
          <Square className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        <span className="text-xs">{t("circle.voice_duration", { seconds: durationSeconds })}</span>
      </button>
      {onReply && hasPlayed && (
        <button
          onClick={onReply}
          className="flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-primary"
        >
          <Mic className="h-3 w-3" />
          {t("circle.voice_reply_button")}
        </button>
      )}
    </div>
  )
}

// Record -> preview -> send, up to MAX_VOICE_ENCOURAGEMENT_SECONDS. Its own
// small component (not folded into the page) since it owns a full
// record/preview/send lifecycle independent of the text compose form.
function VoiceComposeForm({
  recipientId,
  replyToId,
  onSent,
}: {
  recipientId: string
  replyToId?: string
  onSent: () => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const recorder = useVoiceRecorder(MAX_VOICE_ENCOURAGEMENT_SECONDS)
  const [sending, setSending] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!recorder.blob) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(recorder.blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [recorder.blob])

  function togglePreviewPlay() {
    if (!previewUrl) return
    if (playing) {
      audioRef.current?.pause()
      setPlaying(false)
      return
    }
    const audio = new Audio(previewUrl)
    audioRef.current = audio
    audio.onended = () => setPlaying(false)
    audio.play()
    setPlaying(true)
  }

  async function handleSend() {
    if (!user || !recorder.blob || sending) return
    setSending(true)
    try {
      await sendVoiceEncouragement(user.id, recipientId, recorder.blob, recorder.durationSeconds, replyToId)
      toast.success(t("circle.send_love_success"))
      onSent()
    } catch (err) {
      const code = err instanceof CircleError ? err.code : "unknown_error"
      toast.error(t(ERROR_KEY[code] ?? "circle.send_love_error_generic"))
    } finally {
      setSending(false)
    }
  }

  async function handleStart() {
    try {
      await recorder.startRecording()
    } catch {
      toast.error(t("checkin.mic_permission_denied"))
    }
  }

  if (recorder.blob) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-muted/50 p-3">
        <Button type="button" variant="ghost" size="icon" onClick={togglePreviewPlay} className="h-9 w-9 shrink-0 text-primary">
          {playing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <span className="flex-1 text-xs text-muted-foreground">{t("circle.voice_duration", { seconds: recorder.durationSeconds })}</span>
        <Button type="button" variant="ghost" size="icon" onClick={recorder.reset} className="h-9 w-9 shrink-0 text-muted-foreground">
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" onClick={handleSend} disabled={sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("circle.send_love_send")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/50 p-4">
      <button
        type="button"
        onClick={recorder.isRecording ? recorder.stopRecording : handleStart}
        className={`flex h-14 w-14 items-center justify-center rounded-full transition-all ${
          recorder.isRecording
            ? "animate-pulse bg-rose-accent text-white dark:text-background"
            : "bg-primary text-primary-foreground"
        }`}
        aria-label={t("circle.voice_tap_to_record", { max: MAX_VOICE_ENCOURAGEMENT_SECONDS })}
      >
        {recorder.isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
      </button>
      <p className="text-xs text-muted-foreground">
        {recorder.isRecording
          ? t("circle.voice_recording", { seconds: recorder.durationSeconds, max: MAX_VOICE_ENCOURAGEMENT_SECONDS })
          : t("circle.voice_tap_to_record", { max: MAX_VOICE_ENCOURAGEMENT_SECONDS })}
      </p>
    </div>
  )
}

export function CirclePage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<CircleMembership[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [presence, setPresence] = useState<Record<string, boolean>>({})
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [sharedLetters, setSharedLetters] = useState<SharedLetter[]>([])
  const [activeSos, setActiveSos] = useState<CircleSosEntry[]>([])
  const [openLetter, setOpenLetter] = useState<SharedLetter | null>(null)

  const [composeFor, setComposeFor] = useState<{ id: string; name: string; replyToId?: string } | null>(null)
  const [composeMode, setComposeMode] = useState<"text" | "voice">("text")
  const [customMessage, setCustomMessage] = useState("")
  const [sending, setSending] = useState(false)

  // Mission 2 — shared weekly intentions
  const [sharedIntentions, setSharedIntentions] = useState<CircleSharedIntention[]>([])
  const [proposeFor, setProposeFor] = useState<{ id: string; name: string } | null>(null)
  const [proposing, setProposing] = useState(false)
  const [respondingId, setRespondingId] = useState<string | null>(null)

  // Mission 3 — grace gifts
  const [streakAlerts, setStreakAlerts] = useState<CircleStreakAlert[]>([])
  const [sendingGiftFor, setSendingGiftFor] = useState<string | null>(null)
  const [dismissedGiftPrompts, setDismissedGiftPrompts] = useState<Set<string>>(new Set())

  // Mission 4 — milestone celebrations
  const [milestones, setMilestones] = useState<CircleMilestone[]>([])

  // Mission 5 — circle anniversaries
  const [anniversaries, setAnniversaries] = useState<AnniversaryCard[]>([])

  useEffect(() => {
    if (user) load()
  }, [user])

  async function load() {
    if (!user) return
    try {
      const [membershipRows, nameMap, presenceRows, received, sent, receivedVoice, sentVoice, letters, sos, intentionRows, alerts, recentMilestones] =
        await Promise.all([
          listMemberships(),
          getMemberNames(),
          getPresenceToday(),
          listReceivedEncouragements(),
          listSentEncouragements(),
          listReceivedVoiceEncouragements(),
          listSentVoiceEncouragements(),
          getSharedLetters(),
          listActiveCircleSos(),
          getActiveSharedIntentions(),
          getStreakAlerts(),
          getRecentCircleMilestones(),
        ])

      const activeMembers = membershipRows.filter((m) => m.status === "active")
      setMembers(activeMembers)
      setNames(nameMap)
      setPresence(Object.fromEntries(presenceRows.map((p) => [p.friend_id, p.present])))
      setSharedLetters(letters)
      setActiveSos(sos)
      setSharedIntentions(intentionRows)
      setStreakAlerts(alerts)
      setMilestones(filterUnseenMilestones(user.id, recentMilestones))

      const receivedItems: FeedItem[] = (received as ReceivedEncouragement[]).map((e) => ({
        id: e.id,
        createdAt: e.created_at,
        isPreset: e.is_preset,
        message: e.message,
        direction: "received",
        otherId: e.sender_id,
        kind: "text",
      }))
      const sentItems: FeedItem[] = (sent as SentEncouragement[]).map((e) => ({
        id: e.id,
        createdAt: e.created_at,
        isPreset: e.is_preset,
        message: e.message,
        direction: "sent",
        otherId: e.recipient_id,
        kind: "text",
      }))
      const receivedVoiceItems: FeedItem[] = (receivedVoice as ReceivedVoiceEncouragement[]).map((v) => ({
        id: v.id,
        createdAt: v.created_at,
        direction: "received",
        otherId: v.sender_id,
        kind: "voice",
        storagePath: v.storage_path,
        durationSeconds: v.duration_seconds,
        replyToId: v.reply_to_id,
      }))
      const sentVoiceItems: FeedItem[] = (sentVoice as SentVoiceEncouragement[]).map((v) => ({
        id: v.id,
        createdAt: v.created_at,
        direction: "sent",
        otherId: v.recipient_id,
        kind: "voice",
        storagePath: v.storage_path,
        durationSeconds: v.duration_seconds,
        replyToId: v.reply_to_id,
      }))
      setFeed(
        [...receivedItems, ...sentItems, ...receivedVoiceItems, ...sentVoiceItems].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        )
      )

      // Opening this page is "reading" — quiet, no read receipt ever shown
      // to the sender, same as the existing text-encouragement behavior.
      const unread = (received as ReceivedEncouragement[]).filter((e) => !e.read_at)
      unread.forEach((e) => markEncouragementRead(e.id).catch(() => {}))
      const unreadVoice = (receivedVoice as ReceivedVoiceEncouragement[]).filter((v) => !v.read_at)
      unreadVoice.forEach((v) => markVoiceEncouragementRead(v.id).catch(() => {}))

      // Mission 5 — anniversaries: pure client computation off accepted_at,
      // deduped locally so it only surfaces around the actual month it
      // crosses, not every visit thereafter.
      const anniversaryCards: AnniversaryCard[] = []
      for (const m of activeMembers) {
        if (!m.accepted_at) continue
        const months = reachedAnniversaryMonth(m.accepted_at)
        if (!months || hasSeenAnniversary(user.id, m.friend_id, months)) continue
        const count = await getEncouragementCount(m.friend_id)
        anniversaryCards.push({ friendId: m.friend_id, months, count })
      }
      setAnniversaries(anniversaryCards)
    } catch (err) {
      console.error("Failed to load circle:", err)
    } finally {
      setLoading(false)
    }
  }

  function friendName(id: string): string {
    return names[id] || t("settings.circle_member_fallback")
  }

  function renderMessage(item: { isPreset?: boolean; message?: string }): string {
    if (!item.message) return ""
    return item.isPreset ? t(`circle.presets.${item.message}`) : item.message
  }

  function openCompose(id: string, name: string) {
    setComposeFor({ id, name })
    setComposeMode("text")
  }

  // Reply to a received voice note with a voice note of her own — same
  // recorder/compose flow, just pre-aimed at the sender and pre-linked via
  // replyToId so the RPC can validate and store the thread pointer.
  function openVoiceReply(item: FeedItem) {
    setComposeFor({ id: item.otherId, name: friendName(item.otherId), replyToId: item.id })
    setComposeMode("voice")
  }

  async function handleSendPreset(presetKey: string) {
    if (!composeFor || sending) return
    setSending(true)
    try {
      await sendEncouragement(composeFor.id, presetKey, true)
      toast.success(t("circle.send_love_success"))
      setComposeFor(null)
      setCustomMessage("")
      await load()
    } catch (err) {
      const code = err instanceof CircleError ? err.code : "unknown_error"
      toast.error(t(ERROR_KEY[code] ?? "circle.send_love_error_generic"))
    } finally {
      setSending(false)
    }
  }

  async function handleSendCustom(e: FormEvent) {
    e.preventDefault()
    if (!composeFor || sending || !customMessage.trim()) return
    setSending(true)
    try {
      await sendEncouragement(composeFor.id, customMessage.trim(), false)
      toast.success(t("circle.send_love_success"))
      setComposeFor(null)
      setCustomMessage("")
      await load()
    } catch (err) {
      const code = err instanceof CircleError ? err.code : "unknown_error"
      toast.error(t(ERROR_KEY[code] ?? "circle.send_love_error_generic"))
    } finally {
      setSending(false)
    }
  }

  async function handleVoiceSent() {
    setComposeFor(null)
    await load()
  }

  async function handleProposeIntention(intention: string) {
    if (!proposeFor || proposing) return
    setProposing(true)
    try {
      await proposeSharedIntention(proposeFor.id, intention)
      toast.success(t("circle.intention_proposed_success"))
      setProposeFor(null)
      await load()
    } catch (err) {
      const code = err instanceof CircleError ? err.code : "unknown_error"
      toast.error(t(ERROR_KEY[code] ?? "circle.intention_error_generic"))
    } finally {
      setProposing(false)
    }
  }

  async function handleRespondIntention(id: string, accept: boolean) {
    if (respondingId) return
    setRespondingId(id)
    try {
      await respondSharedIntention(id, accept)
      await load()
    } catch (err) {
      console.error("Failed to respond to shared intention:", err)
      toast.error(t("circle.intention_error_generic"))
    } finally {
      setRespondingId(null)
    }
  }

  async function handleSendGraceGift(friendId: string) {
    if (sendingGiftFor) return
    setSendingGiftFor(friendId)
    try {
      await sendGraceGift(friendId)
      toast.success(t("circle.gift_sent_success", { name: friendName(friendId) }))
      setDismissedGiftPrompts((prev) => new Set(prev).add(friendId))
    } catch (err) {
      const code = err instanceof CircleError ? err.code : "unknown_error"
      toast.error(t(ERROR_KEY[code] ?? "circle.gift_error_generic"))
    } finally {
      setSendingGiftFor(null)
    }
  }

  function dismissMilestone(milestone: CircleMilestone) {
    if (!user) return
    markMilestoneSeen(user.id, milestone)
    setMilestones((prev) => prev.filter((m) => !(m.friend_id === milestone.friend_id && m.milestone === milestone.milestone)))
  }

  function dismissAnniversary(card: AnniversaryCard) {
    if (!user) return
    markAnniversarySeen(user.id, card.friendId, card.months)
    setAnniversaries((prev) => prev.filter((a) => !(a.friendId === card.friendId && a.months === card.months)))
  }

  const pendingIntentionsForMe = sharedIntentions.filter((si) => si.recipient_id === user?.id && si.status === "pending")
  const visibleGiftPrompts = streakAlerts.filter((a) => a.absent && !dismissedGiftPrompts.has(a.friend_id))

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("circle.page_title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("circle.page_subtitle")}</p>
      </div>

      {members.length === 0 ? (
        <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5">
            <EmptyState icon="seedling" titleKey="circle.empty_title" descriptionKey="circle.empty_desc" />
            <Link to="/settings">
              <Button className="mt-4 w-full">{t("circle.empty_cta")}</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeSos.length > 0 && (
            <div className="space-y-2">
              {activeSos.map((sos) => (
                <Card
                  key={sos.senderId}
                  className="border-0 bg-gradient-to-br from-lavender/30 to-peach/20 shadow-[0_2px_10px_rgba(0,0,0,0.04)]"
                >
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <HeartHandshake className="h-4 w-4 shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t("sos.circle_card_title", { name: friendName(sos.senderId) })}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{t("sos.circle_card_subtitle")}</p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openCompose(sos.senderId, friendName(sos.senderId))}>
                      {t("circle.send_love_button")}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Mission 5 — anniversaries */}
          {anniversaries.length > 0 && (
            <div className="space-y-2">
              {anniversaries.map((card) => (
                <Card key={`${card.friendId}-${card.months}`} className="border-0 bg-sage-light/40 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                  <CardContent className="flex items-start justify-between gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-lg">&#x1F331;</span>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t(`circle.anniversary_title_${card.months}`, { name: friendName(card.friendId) })}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("circle.anniversary_count", { count: card.count })}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => dismissAnniversary(card)}>
                      {t("circle.dismiss")}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Mission 4 — milestone celebrations */}
          {milestones.length > 0 && (
            <div className="space-y-2">
              {milestones.map((m) => (
                <Card key={`${m.friend_id}-${m.milestone}`} className="border-0 bg-gradient-to-br from-peach/20 to-lavender/20 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <PartyPopper className="h-4 w-4 shrink-0 text-primary" />
                      <p className="text-sm font-medium text-foreground">
                        {t("circle.milestone_card", { name: friendName(m.friend_id), days: m.milestone })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => dismissMilestone(m)}>
                        {t("circle.dismiss")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          dismissMilestone(m)
                          openCompose(m.friend_id, friendName(m.friend_id))
                        }}
                      >
                        {t("circle.send_love_button")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Mission 2 — pending shared-intention proposals */}
          {pendingIntentionsForMe.length > 0 && (
            <div className="space-y-2">
              {pendingIntentionsForMe.map((si) => (
                <Card key={si.id} className="border-0 bg-lavender/20 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                      <p className="text-sm font-medium text-foreground">
                        {t("circle.intention_proposal_card", {
                          name: friendName(si.proposer_id),
                          intention: t(`intentions.${si.intention.toLowerCase()}`),
                        })}
                      </p>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={respondingId === si.id}
                        onClick={() => handleRespondIntention(si.id, true)}
                      >
                        {t("circle.intention_accept")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        disabled={respondingId === si.id}
                        onClick={() => handleRespondIntention(si.id, false)}
                      >
                        {t("circle.intention_decline")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Mission 3 — grace gift prompts */}
          {visibleGiftPrompts.length > 0 && (
            <div className="space-y-2">
              {visibleGiftPrompts.map((alert) => (
                <Card key={alert.friend_id} className="border-0 bg-peach/15 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <Gift className="h-4 w-4 shrink-0 text-primary" />
                      <p className="text-sm font-medium text-foreground">
                        {t("circle.grace_gift_prompt", { name: friendName(alert.friend_id) })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDismissedGiftPrompts((prev) => new Set(prev).add(alert.friend_id))}
                      >
                        {t("circle.dismiss")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={sendingGiftFor === alert.friend_id}
                        onClick={() => handleSendGraceGift(alert.friend_id)}
                      >
                        {sendingGiftFor === alert.friend_id ? <Loader2 className="h-4 w-4 animate-spin" /> : t("circle.grace_gift_send")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {members.map((m) => (
              <Card key={m.id} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{friendName(m.friend_id)}</p>
                    {presence[m.friend_id] && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("circle.presence_badge")}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-primary"
                      onClick={() => setProposeFor({ id: m.friend_id, name: friendName(m.friend_id) })}
                      aria-label={t("circle.intention_propose_button")}
                    >
                      &#x1F331;
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openCompose(m.friend_id, friendName(m.friend_id))}>
                      {t("circle.send_love_button")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {sharedLetters.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t("circle.shared_letters_title")}</p>
              <div className="space-y-2">
                {sharedLetters.map((letter) => (
                  <Card key={`${letter.friend_id}-${letter.week_start}`} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-primary" />
                        <div>
                          <p className="text-sm text-foreground">
                            {t("circle.shared_letters_from", { name: friendName(letter.friend_id) })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatWeekRange(letter.week_start, letter.week_end, i18n.language)}
                          </p>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setOpenLetter(letter)}>
                        {t("circle.shared_letters_read")}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("circle.feed_title")}</p>
            {feed.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("circle.feed_empty")}</p>
            ) : (
              <div className="space-y-2">
                {feed.map((item) => {
                  const isVoiceReply = item.kind === "voice" && !!item.replyToId
                  return (
                    <Card key={`${item.kind}-${item.direction}-${item.id}`} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                      <CardContent className={`p-3.5 ${isVoiceReply ? "ml-3 border-l-2 border-primary/20 pl-3" : ""}`}>
                        <p className="text-xs text-muted-foreground">
                          {isVoiceReply
                            ? item.direction === "received"
                              ? t("circle.voice_reply_received_badge", { name: friendName(item.otherId) })
                              : t("circle.voice_reply_sent_badge", { name: friendName(item.otherId) })
                            : item.direction === "received"
                              ? t("circle.feed_from", { name: friendName(item.otherId) })
                              : t("circle.feed_to", { name: friendName(item.otherId) })}
                        </p>
                        {item.kind === "voice" && item.storagePath && item.durationSeconds !== undefined ? (
                          <div className="mt-1">
                            <VoicePlayerInline
                              storagePath={item.storagePath}
                              durationSeconds={item.durationSeconds}
                              onReply={item.direction === "received" ? () => openVoiceReply(item) : undefined}
                            />
                          </div>
                        ) : (
                          <p className="mt-0.5 text-sm text-foreground">{renderMessage(item)}</p>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>

          <Link to="/settings" className="block text-center text-xs text-muted-foreground underline underline-offset-4">
            {t("circle.manage_link")}
          </Link>
        </>
      )}

      {/* Send love sheet */}
      <Dialog open={!!composeFor} onOpenChange={(open) => !open && setComposeFor(null)}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {composeFor?.replyToId
                ? t("circle.voice_reply_sheet_title", { name: composeFor?.name ?? "" })
                : t("circle.send_love_sheet_title", { name: composeFor?.name ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!composeFor?.replyToId && (
              <div className="flex gap-2">
                <button
                  onClick={() => setComposeMode("text")}
                  className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium ${
                    composeMode === "text" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {t("circle.compose_mode_text")}
                </button>
                <button
                  onClick={() => setComposeMode("voice")}
                  className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium ${
                    composeMode === "voice" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {t("circle.compose_mode_voice")}
                </button>
              </div>
            )}

            {composeMode === "voice" && composeFor ? (
              <VoiceComposeForm recipientId={composeFor.id} replyToId={composeFor.replyToId} onSent={handleVoiceSent} />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {ENCOURAGEMENT_PRESET_KEYS.map((key) => (
                    <button
                      key={key}
                      disabled={sending}
                      onClick={() => handleSendPreset(key)}
                      className="rounded-full bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-sage-light disabled:opacity-50"
                    >
                      {t(`circle.presets.${key}`)}
                    </button>
                  ))}
                </div>
                <form onSubmit={handleSendCustom} className="space-y-2">
                  <label className="block text-xs text-muted-foreground">{t("circle.send_love_custom_label")}</label>
                  <Textarea
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value.slice(0, 140))}
                    placeholder={t("circle.send_love_custom_placeholder")}
                    maxLength={140}
                    rows={3}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {t("circle.send_love_char_count", { count: customMessage.length })}
                    </span>
                    <Button type="submit" size="sm" disabled={sending || !customMessage.trim()}>
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("circle.send_love_send")}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Propose a shared weekly intention */}
      <Dialog open={!!proposeFor} onOpenChange={(open) => !open && setProposeFor(null)}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {t("circle.intention_propose_title", { name: proposeFor?.name ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {intentions.map((intention) => (
              <button
                key={intention}
                disabled={proposing}
                onClick={() => handleProposeIntention(intention)}
                className="rounded-full bg-muted px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-sage-light disabled:opacity-50"
              >
                {t(`intentions.${intention.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Read a shared letter */}
      <Dialog open={!!openLetter} onOpenChange={(open) => !open && setOpenLetter(null)}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {openLetter && t("circle.shared_letters_from", { name: friendName(openLetter.friend_id) })}
            </DialogTitle>
          </DialogHeader>
          {openLetter && (
            <div className="whitespace-pre-line font-heading text-base italic leading-relaxed text-foreground/90">
              {openLetter.letter_text}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
