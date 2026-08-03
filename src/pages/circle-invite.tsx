import { useEffect, useState } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Heart, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CircleShareExplainer } from "@/components/circle/circle-share-explainer"
import { CircleError, getInvitePreview, acceptInviteByToken, type InvitePreview } from "@/lib/circle"

const JOIN_ERROR_KEY: Record<string, string> = {
  email_mismatch: "circle.landing_email_mismatch",
  invite_expired: "circle.landing_expired_desc",
  invite_invalid: "circle.landing_invalid_desc",
  invite_already_used: "circle.landing_accepted_desc",
  circle_full: "settings.circle_error_circle_full",
  inviter_circle_full: "settings.circle_error_circle_full",
}

export function CircleInvitePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { token } = useParams<{ token: string }>()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (token) load(token)
  }, [token])

  async function load(t: string) {
    try {
      const result = await getInvitePreview(t)
      setPreview(result)
    } catch (err) {
      console.error("Failed to load invite preview:", err)
      setPreview({ status: "invalid" })
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin() {
    if (!token || joining) return
    setJoining(true)
    try {
      await acceptInviteByToken(token)
      toast.success(t("circle.landing_join_success"))
      navigate("/", { replace: true })
    } catch (err) {
      const code = err instanceof CircleError ? err.code : "unknown_error"
      toast.error(t(JOIN_ERROR_KEY[code] ?? "circle.landing_join_error"))
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const redirectParam = encodeURIComponent(`/circle/invite/${token}`)

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardContent className="space-y-5 p-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
            <Heart className="h-6 w-6 text-primary" />
          </div>

          {preview?.status === "expired" && (
            <div className="space-y-2 text-center">
              <h1 className="font-heading text-lg font-semibold">{t("circle.landing_expired_title")}</h1>
              <p className="text-sm text-muted-foreground">{t("circle.landing_expired_desc")}</p>
            </div>
          )}

          {preview?.status === "invalid" && (
            <div className="space-y-2 text-center">
              <h1 className="font-heading text-lg font-semibold">{t("circle.landing_invalid_title")}</h1>
              <p className="text-sm text-muted-foreground">{t("circle.landing_invalid_desc")}</p>
            </div>
          )}

          {preview?.status === "accepted" && (
            <div className="space-y-2 text-center">
              <h1 className="font-heading text-lg font-semibold">{t("circle.landing_accepted_title")}</h1>
              <p className="text-sm text-muted-foreground">{t("circle.landing_accepted_desc")}</p>
            </div>
          )}

          {preview?.status === "pending" && (
            <>
              <div className="space-y-1 text-center">
                <h1 className="font-heading text-lg font-semibold">
                  {t("settings.circle_received_title", { name: preview.inviterName || t("settings.circle_member_fallback") })}
                </h1>
              </div>

              <CircleShareExplainer />

              {user ? (
                <Button className="w-full" onClick={handleJoin} disabled={joining}>
                  {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : t("circle.landing_join_button")}
                </Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-center text-xs text-muted-foreground">
                    {t("circle.landing_need_account", { email: preview.inviteeEmail })}
                  </p>
                  <div className="flex gap-2">
                    <Button asChild className="flex-1" size="sm">
                      <Link to={`/login?redirect=${redirectParam}`}>{t("circle.landing_sign_in")}</Link>
                    </Button>
                    <Button asChild variant="outline" className="flex-1" size="sm">
                      <Link to={`/register?redirect=${redirectParam}`}>{t("circle.landing_create_account")}</Link>
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
