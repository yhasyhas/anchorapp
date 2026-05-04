import { useState, useEffect, useRef } from "react"
import { useNavigate, useSearchParams, Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Anchor, CheckCircle2, Mail } from "lucide-react"

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
  const hasExchanged = useRef(false)

  useEffect(() => {
    async function handleRecovery() {
      const code = searchParams.get("code")

      // Pas de code ? On arrête là, pas d'erreur agressive
      if (!code) {
        setValidating(false)
        return
      }

      if (hasExchanged.current) return
      hasExchanged.current = true

      // Déconnecter proprement pour éviter les conflits de session
      await supabase.auth.signOut()

      const { error } = await supabase.auth.exchangeCodeForSession(code)

      if (error) {
        console.error("Exchange error:", error)
        setError(t("auth.expired_reset_link"))
      }

      setValidating(false)
    }

    handleRecovery()
  }, [searchParams, t])

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
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSuccess(true)
      await supabase.auth.signOut()
      setTimeout(() => navigate("/login"), 2000)
    }
  }

  // Écran de chargement
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

  // PAS DE CODE dans l'URL → écran friendly, pas de formulaire cassé
  const code = searchParams.get("code")
  if (!code) {
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

  // CODE PRÉSENT → formulaire de reset
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
            <Anchor className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-heading text-2xl font-semibold">
            {success ? t("auth.success_title") : t("auth.reset_title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
              <p className="text-sm text-muted-foreground">{t("auth.reset_success")}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Erreur affichée seulement si le code était invalide/expiré */}
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
              <Button type="submit" className="w-full" disabled={loading || !!error}>
                {loading ? t("auth.updating") : t("auth.update_password")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// import { useState, useEffect, useRef } from "react"
// import { useNavigate, useSearchParams } from "react-router-dom"
// import { useTranslation } from "react-i18next"
// import { supabase } from "@/lib/supabase"
// import { Button } from "@/components/ui/button"
// import { Input } from "@/components/ui/input"
// import { Label } from "@/components/ui/label"
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// import { Anchor, CheckCircle2 } from "lucide-react"

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

//   // CRITIQUE : éviter que React StrictMode n'appelle exchangeCodeForSession 2 fois
//   const hasExchanged = useRef(false)

//   useEffect(() => {
//     const code = searchParams.get("code")

//     if (!code) {
//       setError(t("auth.invalid_reset_link"))
//       setValidating(false)
//       return
//     }

//     if (hasExchanged.current) return
//     hasExchanged.current = true

//     supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
//       if (error) {
//         console.error("Exchange error:", error)
//         setError(t("auth.expired_reset_link"))
//       } else if (data.session) {
//         // Le code a fonctionné, l'utilisateur a une session temporaire de recovery
//         setError("")
//       }
//       setValidating(false)
//     })
//   }, [searchParams, t])

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
//     const { error } = await supabase.auth.updateUser({ password })

//     if (error) {
//       setError(error.message)
//       setLoading(false)
//     } else {
//       setSuccess(true)
//       // Déconnecter proprement et rediriger vers login
//       await supabase.auth.signOut()
//       setTimeout(() => navigate("/login"), 2000)
//     }
//   }

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

//   return (
//     <div className="flex min-h-svh items-center justify-center bg-background px-6">
//       <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//         <CardHeader className="text-center">
//           <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
//             <Anchor className="h-6 w-6 text-primary" />
//           </div>
//           <CardTitle className="font-heading text-2xl font-semibold">
//             {success ? t("auth.success_title") : t("auth.reset_title")}
//           </CardTitle>
//         </CardHeader>
//         <CardContent>
//           {success ? (
//             <div className="space-y-4 text-center">
//               <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
//               <p className="text-sm text-muted-foreground">{t("auth.reset_success")}</p>
//             </div>
//           ) : (
//             <form onSubmit={handleSubmit} className="space-y-4">
//               <div className="space-y-2">
//                 <Label htmlFor="password">{t("auth.new_password")}</Label>
//                 <Input
//                   id="password"
//                   type="password"
//                   value={password}
//                   onChange={(e) => setPassword(e.target.value)}
//                   placeholder="••••••"
//                   required
//                   minLength={6}
//                 />
//               </div>
//               <div className="space-y-2">
//                 <Label htmlFor="confirm">{t("auth.confirm_password")}</Label>
//                 <Input
//                   id="confirm"
//                   type="password"
//                   value={confirmPassword}
//                   onChange={(e) => setConfirmPassword(e.target.value)}
//                   placeholder="••••••"
//                   required
//                 />
//               </div>
//               {error && <p className="text-sm text-destructive">{error}</p>}
//               <Button type="submit" className="w-full" disabled={loading}>
//                 {loading ? t("auth.updating") : t("auth.update_password")}
//               </Button>
//             </form>
//           )}
//         </CardContent>
//       </Card>
//     </div>
//   )
// }

// import { useState, useEffect } from "react"
// import { useNavigate, useSearchParams } from "react-router-dom"
// import { useTranslation } from "react-i18next"
// import { supabase } from "@/lib/supabase"
// import { Button } from "@/components/ui/button"
// import { Input } from "@/components/ui/input"
// import { Label } from "@/components/ui/label"
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// import { Anchor, CheckCircle2 } from "lucide-react"

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

//   // Capture le code de l'URL et échange contre une session
//   useEffect(() => {
//     const code = searchParams.get("code")
//     if (!code) {
//       setError(t("auth.invalid_reset_link"))
//       setValidating(false)
//       return
//     }

//     supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
//       if (error) {
//         setError(t("auth.expired_reset_link"))
//       }
//       setValidating(false)
//     })
//   }, [searchParams, t])

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
//     const { error } = await supabase.auth.updateUser({ password })

//     if (error) {
//       setError(error.message)
//     } else {
//       setSuccess(true)
//       setTimeout(() => navigate("/login"), 2500)
//     }
//     setLoading(false)
//   }

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

//   return (
//     <div className="flex min-h-svh items-center justify-center bg-background px-6">
//       <Card className="w-full max-w-sm border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
//         <CardHeader className="text-center">
//           <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
//             <Anchor className="h-6 w-6 text-primary" />
//           </div>
//           <CardTitle className="font-heading text-2xl font-semibold">
//             {success ? t("auth.success_title") : t("auth.reset_title")}
//           </CardTitle>
//         </CardHeader>
//         <CardContent>
//           {success ? (
//             <div className="space-y-4 text-center">
//               <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
//               <p className="text-sm text-muted-foreground">{t("auth.reset_success")}</p>
//             </div>
//           ) : (
//             <form onSubmit={handleSubmit} className="space-y-4">
//               <div className="space-y-2">
//                 <Label htmlFor="password">{t("auth.new_password")}</Label>
//                 <Input
//                   id="password"
//                   type="password"
//                   value={password}
//                   onChange={(e) => setPassword(e.target.value)}
//                   placeholder="••••••"
//                   required
//                   minLength={6}
//                 />
//               </div>
//               <div className="space-y-2">
//                 <Label htmlFor="confirm">{t("auth.confirm_password")}</Label>
//                 <Input
//                   id="confirm"
//                   type="password"
//                   value={confirmPassword}
//                   onChange={(e) => setConfirmPassword(e.target.value)}
//                   placeholder="••••••"
//                   required
//                 />
//               </div>
//               {error && <p className="text-sm text-destructive">{error}</p>}
//               <Button type="submit" className="w-full" disabled={loading}>
//                 {loading ? t("auth.updating") : t("auth.update_password")}
//               </Button>
//             </form>
//           )}
//         </CardContent>
//       </Card>
//     </div>
//   )
// }