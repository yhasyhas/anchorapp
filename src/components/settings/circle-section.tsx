import { useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Heart, Loader2, UserPlus } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CircleShareExplainer } from "@/components/circle/circle-share-explainer"
import {
  MAX_CIRCLE_MEMBERS,
  CircleError,
  listMemberships,
  listSentEmailInvites,
  getMemberNames,
  inviteByEmail,
  acceptPending,
  declinePending,
  removeMember,
  notifyExistingUserInvite,
  sendInviteEmail,
} from "@/lib/circle"
import type { CircleInvite, CircleMembership } from "@/types"

const ERROR_KEY: Record<string, string> = {
  cannot_invite_self: "settings.circle_error_cannot_invite_self",
  already_member: "settings.circle_error_already_member",
  already_pending: "settings.circle_error_already_pending",
  circle_full: "settings.circle_error_circle_full",
}

export function CircleSection() {
  const { t } = useTranslation()
  const { user, profile, updateProfile } = useAuth()
  const [memberships, setMemberships] = useState<CircleMembership[]>([])
  const [emailInvites, setEmailInvites] = useState<CircleInvite[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState("")
  const [inviting, setInviting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (user) load()
  }, [user])

  async function load() {
    try {
      const [rows, invites, nameMap] = await Promise.all([
        listMemberships(),
        listSentEmailInvites(),
        getMemberNames(),
      ])
      setMemberships(rows)
      setEmailInvites(invites)
      setNames(nameMap)
    } catch (err) {
      console.error("Failed to load circle:", err)
    } finally {
      setLoading(false)
    }
  }

  const active = memberships.filter((m) => m.status === "active")
  const pendingSent = memberships.filter((m) => m.status === "pending" && m.invited_by === user?.id)
  const pendingReceived = memberships.filter((m) => m.status === "pending" && m.invited_by !== user?.id)
  const circleFull = active.length >= MAX_CIRCLE_MEMBERS

  function friendName(friendId: string): string {
    return names[friendId] || t("settings.circle_member_fallback")
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || inviting) return
    setInviting(true)
    try {
      const result = await inviteByEmail(email.trim())
      if (result.matched && result.friendId) {
        toast.success(t("settings.circle_invite_success_existing"))
        notifyExistingUserInvite(result.friendId)
      } else if (result.token) {
        toast.success(t("settings.circle_invite_success_email"))
        sendInviteEmail(result.token)
      }
      setEmail("")
      await load()
    } catch (err) {
      const code = err instanceof CircleError ? err.code : "unknown_error"
      toast.error(t(ERROR_KEY[code] ?? "settings.circle_error_generic"))
    } finally {
      setInviting(false)
    }
  }

  async function handleAccept(inviterId: string) {
    setBusyId(inviterId)
    try {
      await acceptPending(inviterId)
      toast.success(t("settings.circle_accept_success"))
      await load()
    } catch (err) {
      const code = err instanceof CircleError ? err.code : "unknown_error"
      toast.error(t(ERROR_KEY[code] ?? "settings.circle_error_generic"))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDecline(inviterId: string) {
    setBusyId(inviterId)
    try {
      await declinePending(inviterId)
      toast.success(t("settings.circle_decline_success"))
      await load()
    } catch {
      toast.error(t("settings.circle_error_generic"))
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove() {
    if (!removeTarget) return
    const friendId = removeTarget.id
    setBusyId(friendId)
    try {
      await removeMember(friendId)
      toast.success(t("settings.circle_remove_success"))
      await load()
    } catch {
      toast.error(t("settings.circle_error_generic"))
    } finally {
      setBusyId(null)
      setRemoveTarget(null)
    }
  }

  if (loading) return null

  return (
    <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">{t("settings.circle_title")}</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.circle_subtitle")}</p>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm text-foreground">{t("settings.circle_share_presence")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.circle_share_presence_desc")}</p>
          </div>
          <Switch
            checked={profile?.share_presence_enabled ?? true}
            onCheckedChange={(checked) => updateProfile({ share_presence_enabled: checked })}
          />
        </div>

        {pendingReceived.map((m) => (
          <div key={m.id} className="space-y-3 rounded-lg bg-sage-light/60 p-4">
            <p className="text-sm font-medium text-foreground">
              {t("settings.circle_received_title", { name: friendName(m.friend_id) })}
            </p>
            <CircleShareExplainer />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => handleAccept(m.friend_id)}
                disabled={busyId === m.friend_id}
              >
                {busyId === m.friend_id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("settings.circle_accept_button")
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => handleDecline(m.friend_id)}
                disabled={busyId === m.friend_id}
              >
                {t("settings.circle_decline_button")}
              </Button>
            </div>
          </div>
        ))}

        {circleFull ? (
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.circle_error_circle_full")}</p>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="space-y-2">
            <Label htmlFor="circle-invite-email" className="text-xs text-muted-foreground">
              {t("settings.circle_invite_label")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="circle-invite-email"
                type="email"
                placeholder={t("settings.circle_invite_placeholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" size="sm" disabled={inviting}>
                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {inviting ? t("settings.circle_inviting") : t("settings.circle_invite_button")}
              </Button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("settings.circle_members_title")}</p>
          {active.length === 0 && pendingSent.length === 0 && emailInvites.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("settings.circle_members_empty")}</p>
          ) : (
            <ul className="space-y-2">
              {active.map((m) => (
                <li key={m.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground">{friendName(m.friend_id)}</span>
                    <Badge variant="secondary">{t("settings.circle_status_active")}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRemoveTarget({ id: m.friend_id, name: friendName(m.friend_id) })}
                  >
                    {t("settings.circle_remove_button")}
                  </Button>
                </li>
              ))}
              {pendingSent.map((m) => (
                <li key={m.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                  <span className="text-sm text-foreground">{friendName(m.friend_id)}</span>
                  <Badge variant="outline">{t("settings.circle_status_pending_sent")}</Badge>
                </li>
              ))}
              {emailInvites.map((invite) => (
                <li key={invite.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                  <span className="text-sm text-foreground">{invite.invitee_email}</span>
                  <Badge variant="outline">{t("settings.circle_status_pending_email")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.circle_remove_confirm_title", { name: removeTarget?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("settings.circle_remove_confirm_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.circle_remove_cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} className="bg-destructive text-white hover:bg-destructive/90">
              {t("settings.circle_remove_confirm_action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
