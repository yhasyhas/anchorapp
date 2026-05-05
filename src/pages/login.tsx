import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Anchor } from "lucide-react"

export function LoginPage() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) {
      setError(error)
    } else {
      // ✅ REDIRECTION APRÈS LOGIN RÉUSSI
      navigate("/", { replace: true })
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
            <Anchor className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-heading text-2xl font-semibold">
            {t("auth.login")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "..." : t("auth.login")}
            </Button>
          </form>
          <div className="mt-4 space-y-2 text-center">
            <Link
              to="/forgot-password"
              className="block text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              {t("auth.forgot_password")}
            </Link>
            <p className="text-sm text-muted-foreground">
              {t("auth.no_account")}{" "}
              <Link to="/register" className="text-primary underline">
                {t("auth.register")}
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}