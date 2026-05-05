import { useState, useEffect, useRef } from "react"
import { useNavigate, useSearchParams, Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Anchor, CheckCircle2, Mail, AlertTriangle } from "lucide-react"

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(true)
  const [canReset, setCanReset] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const hasProcessed = useRef(false)

  useEffect(() => {
    async function handleRecovery() {
      if (hasProcessed.current) return
      hasProcessed.current = true

      // ─── Étape 1 : Lire le HASH (#error=... ou #access_token=...) ───
      // ⚠️ React Router ne lit PAS le hash avec useSearchParams !
      const hash = window.location.hash.slice(1)
      const hashParams = new URLSearchParams(hash)
      const hashError = hashParams.get("error")
      const hashErrorCode = hashParams.get("error_code")
      const hashErrorDesc = hashParams.get("error_description")
      const accessToken = hashParams.get("access_token")
      const refreshToken = hashParams.get("refresh_token")

      // Si Supabase a renvoyé une erreur dans le hash (lien expiré, bot Gmail, etc.)
      if (hashError || hashErrorCode) {
        setUrlError(hashErrorDesc || hashError || hashErrorCode || "Invalid link")
        setValidating(false)
        return
      }

      // ─── Étape 2 : PKCE Flow (?code=...) ───
      const code = searchParams.get("code")
      if (code) {
        await supabase.auth.signOut()
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (!exchangeError) {
          setCanReset(true)
          setValidating(false)
          return
        }
        setUrlError(exchangeError.message)
        setValidating(false)
        return
      }

      // ─── Étape 3 : Ancien Implicit Flow (#access_token=...) ───
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (!sessionError) {
          // Nettoyer le hash pour ne pas exposer les tokens dans l'historique
          window.history.replaceState(null, "", window.location.pathname + window.location.search)
          setCanReset(true)
          setValidating(false)
          return
        }
        setUrlError(sessionError.message)
        setValidating(false)
        return
      }

      // ─── Étape 4 : Vérifier si une session recovery existe déjà ───
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setCanReset(true)
        setValidating(false)
        return
      }

      // ─── Étape 5 : Rien trouvé ───
      setValidating(false)
    }

    handleRecovery()
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (password.length < 6) {
      setError(t("auth.password_too_short"))
      return
    }
    if (password !== confirmPassword) {
      setError(t("auth.passwords_dont_match"))
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
    } else {
      setSuccess(true)
      await supabase.auth.signOut()
      setTimeout(() => navigate("/login"), 2000)
    }
  }

  // ─── Écran de chargement ───
  if (validating) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">{t("auth.validating")}</p>
        </div>
      </div>
    )
  }

  // ─── Erreur dans l'URL (lien expiré, bot Gmail, etc.) ───
  if (urlError) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-6">
        <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="font-heading text-xl font-semibold">
              {t("auth.reset_title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-destructive font-medium">
              {t("auth.expired_reset_link")}
            </p>
            <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
              {urlError}
            </p>
            <Link to="/forgot-password">
              <Button variant="outline" className="w-full">
                {t("auth.request_new_link")}
              </Button>
            </Link>
            <Link
              to="/login"
              className="block text-sm text-primary hover:underline"
            >
              {t("auth.back_to_login")}
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Pas de session recovery ───
  if (!canReset) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-6">
        <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="font-heading text-xl font-semibold">
              {t("auth.reset_title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              {t("auth.no_reset_link")}
            </p>
            <Link to="/forgot-password">
              <Button variant="outline" className="w-full">
                {t("auth.request_new_link")}
              </Button>
            </Link>
            <Link
              to="/login"
              className="block text-sm text-primary hover:underline"
            >
              {t("auth.back_to_login")}
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Succès ───
  if (success) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-6">
        <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
              <CheckCircle2 className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="font-heading text-xl font-semibold">
              {t("auth.success_title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">{t("auth.reset_success")}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Formulaire de reset ───
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
            <Anchor className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-heading text-2xl font-semibold">
            {t("auth.reset_title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.new_password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">{t("auth.confirm_password")}</Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("auth.updating") : t("auth.update_password")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// import { useState, useEffect, useRef } from "react"
// import { useNavigate, useSearchParams, Link } from "react-router-dom"
// import { useTranslation } from "react-i18next"
// import { supabase } from "@/lib/supabase"
// import { Button } from "@/components/ui/button"
// import { Input } from "@/components/ui/input"
// import { Label } from "@/components/ui/label"
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// import { Anchor, CheckCircle2, Mail } from "lucide-react"

// export function ResetPasswordPage() {
//   const { t } = useTranslation()
//   const navigate = useNavigate()
//   const [searchParams] = useSearchParams()

//   const [password, setPassword] = useState("")
//   const [confirmPassword, setConfirmPassword] = useState("")
//   const [error, setError] = useState("")
//   const [success, setSuccess] = useState(false)
//   const [loading, setLoading] = useState(false)
//   const [validating, setValidating] = useState(true)
//   const [canReset, setCanReset] = useState(false)
//   const hasExchanged = useRef(false)

//   useEffect(() => {
//     async function handleRecovery() {
//       // 🔒 PKCE Flow : code dans l'URL (?code=...)
//       const code = searchParams.get("code")
//       if (code && !hasExchanged.current) {
//         hasExchanged.current = true
//         await supabase.auth.signOut()
//         const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
//         if (!exchangeError) {
//           setCanReset(true)
//           setValidating(false)
//           return
//         }
//         console.error("Exchange error:", exchangeError)
//       }

//       // 🔓 Implicit Flow : Supabase a déjà consommé le hash et créé une session
//       const { data: { session } } = await supabase.auth.getSession()
//       if (session) {
//         setCanReset(true)
//         setValidating(false)
//         return
//       }

//       // Rien trouvé → lien invalide ou expiré
//       setValidating(false)
//     }

//     handleRecovery()
//   }, [searchParams])

//   async function handleSubmit(e: React.FormEvent) {
//     e.preventDefault()
//     setError("")

//     if (password.length < 6) {
//       setError(t("auth.password_too_short"))
//       return
//     }
//     if (password !== confirmPassword) {
//       setError(t("auth.passwords_dont_match"))
//       return
//     }

//     setLoading(true)
//     const { error: updateError } = await supabase.auth.updateUser({ password })

//     if (updateError) {
//       setError(updateError.message)
//       setLoading(false)
//     } else {
//       setSuccess(true)
//       await supabase.auth.signOut()
//       setTimeout(() => navigate("/login"), 2000)
//     }
//   }

//   // ─── Écran de chargement ───
//   if (validating) {
//     return (
//       <div className="flex min-h-svh items-center justify-center bg-background">
//         <div className="text-center">
//           <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
//           <p className="text-sm text-muted-foreground">{t("auth.validating")}</p>
//         </div>
//       </div>
//     )
//   }

//   // ─── Pas de session recovery → lien invalide ───
//   if (!canReset) {
//     return (
//       <div className="flex min-h-svh items-center justify-center bg-background px-6">
//         <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//           <CardHeader className="text-center">
//             <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
//               <Mail className="h-6 w-6 text-primary" />
//             </div>
//             <CardTitle className="font-heading text-xl font-semibold">
//               {t("auth.reset_title")}
//             </CardTitle>
//           </CardHeader>
//           <CardContent className="space-y-4 text-center">
//             <p className="text-sm text-muted-foreground">
//               {t("auth.no_reset_link")}
//             </p>
//             <Link to="/forgot-password">
//               <Button variant="outline" className="w-full">
//                 {t("auth.request_new_link")}
//               </Button>
//             </Link>
//             <Link
//               to="/login"
//               className="block text-sm text-primary hover:underline"
//             >
//               {t("auth.back_to_login")}
//             </Link>
//           </CardContent>
//         </Card>
//       </div>
//     )
//   }

//   // ─── Succès ───
//   if (success) {
//     return (
//       <div className="flex min-h-svh items-center justify-center bg-background px-6">
//         <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//           <CardHeader className="text-center">
//             <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
//               <CheckCircle2 className="h-6 w-6 text-primary" />
//             </div>
//             <CardTitle className="font-heading text-xl font-semibold">
//               {t("auth.success_title")}
//             </CardTitle>
//           </CardHeader>
//           <CardContent className="space-y-4 text-center">
//             <p className="text-sm text-muted-foreground">{t("auth.reset_success")}</p>
//           </CardContent>
//         </Card>
//       </div>
//     )
//   }

//   // ─── Formulaire de reset ───
//   return (
//     <div className="flex min-h-svh items-center justify-center bg-background px-6">
//       <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//         <CardHeader className="text-center">
//           <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
//             <Anchor className="h-6 w-6 text-primary" />
//           </div>
//           <CardTitle className="font-heading text-2xl font-semibold">
//             {t("auth.reset_title")}
//           </CardTitle>
//         </CardHeader>
//         <CardContent>
//           <form onSubmit={handleSubmit} className="space-y-4">
//             {error && (
//               <div className="rounded-lg bg-destructive/10 p-3">
//                 <p className="text-sm text-destructive">{error}</p>
//               </div>
//             )}

//             <div className="space-y-2">
//               <Label htmlFor="password">{t("auth.new_password")}</Label>
//               <Input
//                 id="password"
//                 type="password"
//                 value={password}
//                 onChange={(e) => setPassword(e.target.value)}
//                 placeholder="••••••"
//                 required
//                 minLength={6}
//               />
//             </div>
//             <div className="space-y-2">
//               <Label htmlFor="confirm">{t("auth.confirm_password")}</Label>
//               <Input
//                 id="confirm"
//                 type="password"
//                 value={confirmPassword}
//                 onChange={(e) => setConfirmPassword(e.target.value)}
//                 placeholder="••••••"
//                 required
//               />
//             </div>
//             <Button type="submit" className="w-full" disabled={loading}>
//               {loading ? t("auth.updating") : t("auth.update_password")}
//             </Button>
//           </form>
//         </CardContent>
//       </Card>
//     </div>
//   )
// }