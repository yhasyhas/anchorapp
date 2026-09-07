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
// racing against React's first paint. render() above only schedules React's
// work though, it doesn't guarantee a frame has actually painted yet -- a
// double rAF (the standard "wait for one real paint" trick) closes that gap,
// so the native splash isn't dismissed a frame early into a flash of
// unstyled/blank content underneath.
if (isNative) {
  requestAnimationFrame(() => requestAnimationFrame(() => SplashScreen.hide()))
}