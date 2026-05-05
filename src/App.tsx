import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "@/lib/auth-context"
import { LoginPage } from "@/pages/login"
import { RegisterPage } from "@/pages/register"
import { AppLayout } from "@/pages/app-layout"
import { HomePage } from "@/pages/home"
import { PatternsPage } from "@/pages/patterns"
import { CheckInPage } from "@/pages/checkin"
import { MovePage } from "@/pages/move"
import { SettingsPage } from "@/pages/settings"
import { Spinner } from "@/components/ui/spinner"
import { ForgotPasswordPage } from "@/pages/forgot-password"
import { ResetPasswordPage } from "@/pages/reset-password"

export default function App() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    )
  }

  return (
    <BrowserRouter>
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
        <Route
          path="/reset-password"
          element={session ? <Navigate to="/" replace /> : <ResetPasswordPage />}
        />

        {/* Routes protégées */}
        <Route
          path="/"
          element={session ? <AppLayout /> : <Navigate to="/login" replace />}
        >
          <Route index element={<HomePage />} />
          <Route path="patterns" element={<PatternsPage />} />
          <Route path="checkin" element={<CheckInPage />} />
          <Route path="move" element={<MovePage />} />
        </Route>
        <Route
          path="/settings"
          element={session ? <SettingsPage /> : <Navigate to="/login" replace />}
        />

        {/* Fallback */}
        <Route
          path="*"
          element={<Navigate to={session ? "/" : "/login"} replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}