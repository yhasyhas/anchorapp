import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { CircleShareExplainer } from "@/components/circle/circle-share-explainer"
import { listPendingReceivedInvites, getMemberNames, acceptPending, declinePending } from "@/lib/circle"
import type { CircleMembership } from "@/types"

// Surfaces a pending circle invite directly on the home screen, not just
// buried in Settings — the whole point of "invited you" is that it should be
// hard to miss the first time you open the app after it happens.
export function CircleInviteNudge() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [invites, setInvites] = useState<CircleMembership[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    Promise.all([listPendingReceivedInvites(user.id), getMemberNames()])
      .then(([invitesResult, namesResult]) => {
        if (cancelled) return
        setInvites(invitesResult)
        setNames(namesResult)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user])

  function friendName(friendId: string): string {
    return names[friendId] || t("settings.circle_member_fallback")
  }

  async function handleAccept(inviterId: string) {
    setBusyId(inviterId)
    try {
      await acceptPending(inviterId)
      toast.success(t("settings.circle_accept_success"))
      setInvites((prev) => prev.filter((i) => i.friend_id !== inviterId))
    } catch {
      toast.error(t("settings.circle_error_generic"))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDecline(inviterId: string) {
    setBusyId(inviterId)
    try {
      await declinePending(inviterId)
      toast.success(t("settings.circle_decline_success"))
      setInvites((prev) => prev.filter((i) => i.friend_id !== inviterId))
    } catch {
      toast.error(t("settings.circle_error_generic"))
    } finally {
      setBusyId(null)
    }
  }

  if (invites.length === 0) return null

  return (
    <div className="space-y-3">
      {invites.map((invite) => (
        <div
          key={invite.id}
          className="space-y-3 rounded-xl bg-sage-light/60 p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-top-2"
        >
          <p className="text-sm font-semibold text-foreground">
            {t("settings.circle_received_title", { name: friendName(invite.friend_id) })}
          </p>
          <CircleShareExplainer />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => handleAccept(invite.friend_id)}
              disabled={busyId === invite.friend_id}
            >
              {busyId === invite.friend_id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("settings.circle_accept_button")
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-muted-foreground"
              onClick={() => handleDecline(invite.friend_id)}
              disabled={busyId === invite.friend_id}
            >
              {t("settings.circle_decline_button")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
