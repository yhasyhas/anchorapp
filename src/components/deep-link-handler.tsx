import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Capacitor } from "@capacitor/core"
import { App } from "@capacitor/app"

// Android App Links hand the tapped https:// URL to the native app instead
// of a browser (see the intent-filters in AndroidManifest.xml). react-router's
// BrowserRouter doesn't observe raw window.history changes made outside its
// own history instance, so routing the incoming URL has to go through
// useNavigate() from inside the router tree, not a plain history.pushState.
export function DeepLinkHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const listener = App.addListener("appUrlOpen", ({ url }) => {
      try {
        const { pathname, search, hash } = new URL(url)
        navigate(`${pathname}${search}${hash}`)
      } catch {
        // Malformed URL — nothing sensible to navigate to.
      }
    })

    return () => {
      listener.then((handle) => handle.remove())
    }
  }, [navigate])

  return null
}
