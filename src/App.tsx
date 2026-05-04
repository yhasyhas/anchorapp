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
        {!session ? (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        ) : (
          <>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<HomePage />} />
              <Route path="patterns" element={<PatternsPage />} />
              <Route path="checkin" element={<CheckInPage />} />
              <Route path="move" element={<MovePage />} />
            </Route>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  )
}
