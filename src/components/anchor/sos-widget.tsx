import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { format } from "date-fns"
import { HeartHandshake, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  sendSos,
  getOwnActiveSos,
  resolveStaleSos,
  listOwnSosHistory,
  type OwnActiveSos,
  type OwnSosHistoryEntry,
} from "@/lib/circle-sos"
import { CircleError, listMemberships } from "@/lib/circle"
import { generateReassuranceMessage } from "@/lib/ai-service"

// Self-contained, own data fetching — same pattern as CircleInviteNudge /
// PushNudge. Renders one of three states: a persistent "your circle knows"
// card, a discrete button, or (no active circle) a button that opens
// immediate AI reassurance instead of sending anything.
export function SosWidget() {
  const { t, i18n } = useTranslation()
  const { user, profile } = useAuth()

  const [loading, setLoading] = useState(true)
  const [ownActive, setOwnActive] = useState<OwnActiveSos | null>(null)
  const [hasActiveCircle, setHasActiveCircle] = useState(false)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)

  const [noCircleOpen, setNoCircleOpen] = useState(false)
  const [reassurance, setReassurance] = useState<string | null>(null)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<OwnSosHistoryEntry[] | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    resolveStaleSos()
      .catch(() => {})
      .then(() => Promise.all([getOwnActiveSos(), listMemberships()]))
      .then((result) => {
        if (cancelled || !result) return
        const [active, memberships] = result
        setOwnActive(active)
        setHasActiveCircle(memberships.some((m) => m.status === "active"))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  function handleTap() {
    if (!hasActiveCircle) {
      openNoCircle()
      return
    }
    setConfirmOpen(true)
  }

  function openNoCircle() {
    setNoCircleOpen(true)
    setReassurance(null)
    generateReassuranceMessage(profile?.ai_enabled ?? false, i18n.language as "en" | "sw", profile?.tone ?? "gentle")
      .then((msg) => setReassurance(msg))
      .catch(() => setReassurance(t("sos.error_generic")))
  }

  async function handleSend() {
    if (sending) return
    setSending(true)
    try {
      await sendSos()
      const active = await getOwnActiveSos()
      setOwnActive(active)
      setConfirmOpen(false)
      toast.success(t("sos.sent_toast"))
    } catch (err) {
      const code = err instanceof CircleError ? err.code : "unknown_error"
      if (code === "sos_already_sent_today") {
        toast(t("sos.already_sent_toast"))
        setConfirmOpen(false)
        getOwnActiveSos().then(setOwnActive).catch(() => {})
      } else if (code === "sos_no_circle") {
        setConfirmOpen(false)
        openNoCircle()
      } else {
        toast.error(t("sos.error_generic"))
      }
    } finally {
      setSending(false)
    }
  }

  function openHistory() {
    setHistoryOpen(true)
    if (history === null) {
      listOwnSosHistory()
        .then(setHistory)
        .catch(() => setHistory([]))
    }
  }

  if (loading) return null

  return (
    <>
      {ownActive ? (
        <Card className="border-0 bg-gradient-to-br from-lavender/30 to-peach/20 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <HeartHandshake className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t("sos.active_title")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("sos.active_body")}</p>
                <button
                  onClick={openHistory}
                  className="mt-2 text-xs text-muted-foreground underline underline-offset-4"
                >
                  {t("sos.history_link")}
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button
          variant="ghost"
          onClick={handleTap}
          className="w-full justify-center border-0 bg-gradient-to-br from-lavender/20 to-peach/20 text-foreground/80 hover:from-lavender/30 hover:to-peach/30"
        >
          {t("sos.button_label")}
        </Button>
      )}

      {/* Confirm sending */}
      <Dialog open={confirmOpen} onOpenChange={(open) => !sending && setConfirmOpen(open)}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">{t("sos.confirm_title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground leading-relaxed">{t("sos.confirm_body")}</p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 text-muted-foreground"
              onClick={() => setConfirmOpen(false)}
              disabled={sending}
            >
              {t("sos.confirm_cancel")}
            </Button>
            <Button className="flex-1" onClick={handleSend} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("sos.confirm_send")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* No active circle: immediate reassurance, no SOS sent */}
      <Dialog open={noCircleOpen} onOpenChange={setNoCircleOpen}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">{t("sos.no_circle_title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/90 leading-relaxed font-medium min-h-[2.5rem]">
            {reassurance ?? t("sos.no_circle_loading")}
          </p>
          <Link to="/settings">
            <Button className="mt-2 w-full" onClick={() => setNoCircleOpen(false)}>
              {t("sos.no_circle_invite_cta")}
            </Button>
          </Link>
        </DialogContent>
      </Dialog>

      {/* Personal history — never visible to a friend */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">{t("sos.history_title")}</DialogTitle>
          </DialogHeader>
          {history === null ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("sos.history_empty")}</p>
          ) : (
            <div className="space-y-2">
              {history.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <span className="text-sm text-foreground">{format(new Date(item.createdAt), "MMM d")}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.resolvedAt ? t("sos.history_resolved") : t("sos.history_open")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
