import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import "@/lib/i18n"
import App from "./App.tsx"
import { AuthProvider } from "@/lib/auth-context"
import { ThemeProvider } from "@/components/theme-provider"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
)