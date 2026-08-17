import { useRef } from "react"

// Radix's Dialog/AlertDialog/Sheet only restore focus to a trigger
// automatically when opened via <DialogTrigger>/<AlertDialogTrigger> —
// confirmed by comparing settings.tsx's delete-account AlertDialog (uses
// AlertDialogTrigger, restores correctly on Escape) against every other
// dialog in this app, all driven by external state (`open={x !== null}`,
// no Trigger component), which silently drop focus to <body> instead.
//
// `restoreTrigger` must run from the Content's own `onCloseAutoFocus`, not
// from whatever state-setter closes the dialog: while the exit animation
// plays, Radix's FocusScope is still trapping focus *inside* the closing
// dialog, so a `.focus()` call fired any earlier (e.g. synchronously in an
// onOpenChange handler) is silently swallowed by the trap. onCloseAutoFocus
// fires at the one moment the trap has just released — `dialogContentProps`
// bundles that up (`e.preventDefault()` to cancel Radix's own default,
// which would otherwise land on <body> since there's no Trigger): spread it
// directly onto <DialogContent>/<SheetContent>.
export function useDialogFocusRestore() {
  const triggerRef = useRef<Element | null>(null)

  function captureTrigger() {
    triggerRef.current = document.activeElement
  }

  function restoreTrigger() {
    if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
  }

  const dialogContentProps = {
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault()
      restoreTrigger()
    },
  }

  return { captureTrigger, restoreTrigger, dialogContentProps }
}
