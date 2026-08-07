import { lazy, Suspense } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "@/lib/auth-context"
import { AppLayout } from "@/pages/app-layout"
import { Spinner } from "@/components/ui/spinner"

// Every route below is its own lazy chunk — previously all of them shipped
// in the initial bundle regardless of which screen loaded first (1.27 MB
// uncompressed pre-split). AppLayout itself stays eager: it's the shell
// every protected route mounts into, so it's needed immediately once
// logged in; only the pages nested inside it (and the two top-level
// standalone routes, Settings and the public/auth pages) are deferred.
const LandingPage = lazy(() => import("@/pages/landing").then((m) => ({ default: m.LandingPage })))
const PrivacyPage = lazy(() => import("@/pages/privacy").then((m) => ({ default: m.PrivacyPage })))
const LoginPage = lazy(() => import("@/pages/login").then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import("@/pages/register").then((m) => ({ default: m.RegisterPage })))
const ForgotPasswordPage = lazy(() => import("@/pages/forgot-password").then((m) => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import("@/pages/reset-password").then((m) => ({ default: m.ResetPasswordPage })))
const CircleInvitePage = lazy(() => import("@/pages/circle-invite").then((m) => ({ default: m.CircleInvitePage })))
const HomePage = lazy(() => import("@/pages/home").then((m) => ({ default: m.HomePage })))
const PatternsPage = lazy(() => import("@/pages/patterns").then((m) => ({ default: m.PatternsPage })))
const CheckInPage = lazy(() => import("@/pages/checkin").then((m) => ({ default: m.CheckInPage })))
const MovePage = lazy(() => import("@/pages/move").then((m) => ({ default: m.MovePage })))
const SettingsPage = lazy(() => import("@/pages/settings").then((m) => ({ default: m.SettingsPage })))
const LettersPage = lazy(() => import("@/pages/letters").then((m) => ({ default: m.LettersPage })))
const LetterDetailPage = lazy(() => import("@/pages/letter-detail").then((m) => ({ default: m.LetterDetailPage })))
const LetterFutureWritePage = lazy(() => import("@/pages/letter-future-write").then((m) => ({ default: m.LetterFutureWritePage })))
const LetterFutureDetailPage = lazy(() => import("@/pages/letter-future-detail").then((m) => ({ default: m.LetterFutureDetailPage })))
const CirclePage = lazy(() => import("@/pages/circle").then((m) => ({ default: m.CirclePage })))
const JarPage = lazy(() => import("@/pages/jar").then((m) => ({ default: m.JarPage })))
const WrappedHistoryPage = lazy(() => import("@/pages/wrapped-history").then((m) => ({ default: m.WrappedHistoryPage })))
const WrappedPage = lazy(() => import("@/pages/wrapped").then((m) => ({ default: m.WrappedPage })))

function FullScreenSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Spinner className="h-8 w-8 text-primary" />
    </div>
  )
}

export default function App() {
  const { session, loading } = useAuth()

  if (loading) {
    return <FullScreenSpinner />
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          {/* Routes publiques — redirige vers home si déjà connecté */}
          <Route
            path="/login"
            element={session ? <Navigate to="/" replace /> : <LoginPage />}
          />
          <Route
            path="/register"
            element={session ? <Navigate to="/" replace /> : <RegisterPage />}
          />
          <Route
            path="/forgot-password"
            element={session ? <Navigate to="/" replace /> : <ForgotPasswordPage />}
          />

          {/* ✅ RESET PASSWORD : toujours accessible, même connecté */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Circle invite landing page: reachable whether logged in or not —
              same reasoning as /reset-password above. A visitor may need to
              sign in/register before accepting, or may already be logged in. */}
          <Route path="/circle/invite/:token" element={<CircleInvitePage />} />

          {/* Privacy page: reachable whether logged in or not, same pattern
              as /reset-password and /circle/invite above. */}
          <Route path="/privacy" element={<PrivacyPage />} />

          {/* Plain alias — anyone linking the explicit marketing URL still
              lands on "/", which is the real (single) landing page route. */}
          <Route path="/welcome" element={<Navigate to="/" replace />} />

          {/* Root: public marketing landing page when logged out, the app
              shell when logged in — "/" is now a real public page, not just
              an auth gate. */}
          <Route
            path="/"
            element={session ? <AppLayout /> : <LandingPage />}
          >
            <Route index element={<HomePage />} />
            <Route path="patterns" element={<PatternsPage />} />
            <Route path="checkin" element={<CheckInPage />} />
            <Route path="move" element={<MovePage />} />
            <Route path="letters" element={<LettersPage />} />
            <Route path="letters/future/write" element={<LetterFutureWritePage />} />
            <Route path="letters/future/:id" element={<LetterFutureDetailPage />} />
            <Route path="letters/:weekStart" element={<LetterDetailPage />} />
            <Route path="circle" element={<CirclePage />} />
            <Route path="jar" element={<JarPage />} />
            <Route path="wrapped" element={<WrappedHistoryPage />} />
            <Route path="wrapped/:monthStart" element={<WrappedPage />} />
          </Route>
          <Route
            path="/settings"
            element={session ? <SettingsPage /> : <Navigate to="/login" replace />}
          />

          {/* Fallback — "/" is now a real public page (the landing page when
              logged out), so a stray unmatched URL lands there either way. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
