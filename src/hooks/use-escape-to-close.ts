import { useEffect, useRef } from "react"

interface UseEscapeToCloseOptions {
  // Off for overlays reached by replacing another, already-closing
  // trigger (e.g. picking an option in the Pause menu unmounts that Radix
  // Dialog and mounts one of these in the same commit) — Radix's own
  // focus-restoration for the closing dialog races with a capture done
  // here, and reliably wins, leaving `document.activeElement` on <body>
  // instead of the real origin. Those call sites restore focus themselves
  // (see app-layout.tsx's closePauseFlow) instead of relying on this hook
  // to guess. Default true: fine for overlays opened directly from a plain
  // click, where `document.activeElement` at mount time is simply correct.
  restoreFocus?: boolean
}

// Escape-to-close (+ optional focus-restore) for the handful of full-screen
// overlays that predate the Dialog/Sheet primitives (pause-breathing.tsx,
// pause-recenter.tsx, pause-focus-session.tsx, streak-milestone-modal.tsx)
// — Radix's Dialog/AlertDialog/Sheet already do both for free, this exists
// only for the ones built as plain fixed-position divs. `onClose` is read
// through a ref rather than listed as a dependency so a new inline closure
// on every parent render doesn't re-run the effect (which would re-capture
// the "trigger" element and fire a premature refocus).
export function useEscapeToClose(isOpen: boolean, onClose: () => void, { restoreFocus = true }: UseEscapeToCloseOptions = {}) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const triggerRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!isOpen) return

    if (restoreFocus) triggerRef.current = document.activeElement

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current()
    }
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      if (restoreFocus && triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus()
      }
    }
  }, [isOpen, restoreFocus])
}
