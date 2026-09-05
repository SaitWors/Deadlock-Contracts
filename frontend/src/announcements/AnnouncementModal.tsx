import { useEffect, useRef } from "react"
import type { Announcement } from "./announcement-types"
import AnnouncementContent from "./AnnouncementContent"

export default function AnnouncementModal({
  item,
  serverNow,
  onDismiss,
  onAcknowledge,
}: {
  item: Announcement
  serverNow: () => number
  onDismiss: () => void
  onAcknowledge: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusable = dialog?.querySelector<HTMLElement>("button, a[href]")
    if (focusable) focusable.focus()
    else dialog?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && item.dismiss_policy === "DISMISSIBLE") {
        event.preventDefault()
        onDismiss()
        return
      }
      if (event.key !== "Tab" || !dialog) return
      const nodes = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (!nodes.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [item.dismiss_policy, onDismiss])

  return (
    <div className="dc-announcement-modal-backdrop">
      <div
        ref={dialogRef}
        className="dc-announcement-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={item.title}
        tabIndex={-1}
      >
        <AnnouncementContent
          item={item}
          serverNow={serverNow}
          onDismiss={onDismiss}
          onAcknowledge={onAcknowledge}
          quiet
        />
      </div>
    </div>
  )
}
