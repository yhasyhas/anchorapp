import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Heart, Loader2, Mail } from "lucide-react"
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
import { ENCOURAGEMENT_PRESET_KEYS } from "@/types"
import type {
  CircleMembership,
  ReceivedEncouragement,
  SentEncouragement,
  SharedLetter,
} from "@/types"

interface FeedItem {
  id: string
  createdAt: string
  isPreset: boolean
  message: string
  direction: "received" | "sent"
  otherId: string
}

const ERROR_KEY: Record<string, string> = {
  encouragement_limit_reached: "circle.send_love_error_limit",
  not_circle_member: "circle.send_love_error_not_member",
  invalid_message: "circle.send_love_error_invalid",
  invalid_preset: "circle.send_love_error_invalid",
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
  const [openLetter, setOpenLetter] = useState<SharedLetter | null>(null)

  const [composeFor, setComposeFor] = useState<{ id: string; name: string } | null>(null)
  const [customMessage, setCustomMessage] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (user) load()
  }, [user])

  async function load() {
    try {
      const [membershipRows, nameMap, presenceRows, received, sent, letters] = await Promise.all([
        listMemberships(),
        getMemberNames(),
        getPresenceToday(),
        listReceivedEncouragements(),
        listSentEncouragements(),
        getSharedLetters(),
      ])

      setMembers(membershipRows.filter((m) => m.status === "active"))
      setNames(nameMap)
      setPresence(Object.fromEntries(presenceRows.map((p) => [p.friend_id, p.present])))
      setSharedLetters(letters)

      const receivedItems: FeedItem[] = (received as ReceivedEncouragement[]).map((e) => ({
        id: e.id,
        createdAt: e.created_at,
        isPreset: e.is_preset,
        message: e.message,
        direction: "received",
        otherId: e.sender_id,
      }))
      const sentItems: FeedItem[] = (sent as SentEncouragement[]).map((e) => ({
        id: e.id,
        createdAt: e.created_at,
        isPreset: e.is_preset,
        message: e.message,
        direction: "sent",
        otherId: e.recipient_id,
      }))
      setFeed([...receivedItems, ...sentItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

      // Opening this page is "reading" a received encouragement — quiet,
      // no read receipt is ever shown to the sender (see the migration).
      const unread = (received as ReceivedEncouragement[]).filter((e) => !e.read_at)
      unread.forEach((e) => markEncouragementRead(e.id).catch(() => {}))
    } catch (err) {
      console.error("Failed to load circle:", err)
    } finally {
      setLoading(false)
    }
  }

  function friendName(id: string): string {
    return names[id] || t("settings.circle_member_fallback")
  }

  function renderMessage(item: { isPreset: boolean; message: string }): string {
    return item.isPreset ? t(`circle.presets.${item.message}`) : item.message
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setComposeFor({ id: m.friend_id, name: friendName(m.friend_id) })}
                  >
                    {t("circle.send_love_button")}
                  </Button>
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
                {feed.map((item) => (
                  <Card key={`${item.direction}-${item.id}`} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                    <CardContent className="p-3.5">
                      <p className="text-xs text-muted-foreground">
                        {item.direction === "received"
                          ? t("circle.feed_from", { name: friendName(item.otherId) })
                          : t("circle.feed_to", { name: friendName(item.otherId) })}
                      </p>
                      <p className="mt-0.5 text-sm text-foreground">{renderMessage(item)}</p>
                    </CardContent>
                  </Card>
                ))}
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
              {t("circle.send_love_sheet_title", { name: composeFor?.name ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
