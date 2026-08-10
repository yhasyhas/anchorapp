import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Capacitor } from "@capacitor/core"
import { SplashScreen } from "@capacitor/splash-screen"
import "./index.css"
import "@/lib/i18n"
import App from "./App.tsx"
import { AuthProvider } from "@/lib/auth-context"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { PwaUpdateToast } from "@/components/pwa/pwa-update-toast"

// There's no Workbox service worker to update in a native shell, so
// registering for update checks (which useRegisterSW does internally) has
// nothing to register against.
const isNative = Capacitor.isNativePlatform()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
        <Toaster />
        {!isNative && <PwaUpdateToast />}
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
)

// capacitor.config.ts sets SplashScreen.launchAutoHide to false so the splash
// stays up until this fires, instead of the plugin's own duration-based timer
// racing against React's first paint.
if (isNative) {
  SplashScreen.hide()
}