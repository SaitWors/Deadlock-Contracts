import Icon from "../icons/Icon"
import { useEffect, useMemo, useState } from "react"
import { useLanguage } from "../i18n"
import AnnouncementBanner from "./AnnouncementBanner"
import AnnouncementContent from "./AnnouncementContent"
import AnnouncementModal from "./AnnouncementModal"
import AnnouncementToast from "./AnnouncementToast"
import { useAnnouncements } from "./AnnouncementProvider"

export default function AnnouncementLayer() {
  const { language } = useLanguage()
  const { items, centerOpen, setCenterOpen, dismiss, acknowledge, serverNow } = useAnnouncements()
  const [hiddenToast, setHiddenToast] = useState<string | null>(null)
  const sorted = useMemo(
    () => [...items].sort((left, right) => right.priority - left.priority),
    [items],
  )
  const modal = sorted.find((item) => item.presentation === "MODAL") || null
  const banners = sorted.filter((item) => item.presentation === "BANNER").slice(0, 2)
  const toast = sorted.find((item) => item.presentation === "TOAST") || null
  const toastKey = toast ? `${toast.id}:${toast.revision}` : null

  useEffect(() => {
    if (!toastKey || toast?.severity === "CRITICAL" || toast?.dismiss_policy !== "DISMISSIBLE") {
      return
    }
    setHiddenToast(null)
    const timer = window.setTimeout(() => setHiddenToast(toastKey), 12_000)
    return () => window.clearTimeout(timer)
  }, [toast?.dismiss_policy, toast?.severity, toastKey])

  useEffect(() => {
    if (!sorted.length && centerOpen) setCenterOpen(false)
  }, [centerOpen, setCenterOpen, sorted.length])

  if (!sorted.length) return null
  return (
    <>
      {banners.length > 0 && (
        <aside className="dc-announcement-banners" aria-label="System announcements">
          {banners.map((item) => (
            <AnnouncementBanner
              key={`${item.id}:${item.revision}`}
              item={item}
              serverNow={serverNow}
              onDismiss={() => dismiss(item)}
              onAcknowledge={() => acknowledge(item)}
            />
          ))}
        </aside>
      )}
      {toast && toastKey !== hiddenToast && (
        <AnnouncementToast
          key={toastKey}
          item={toast}
          serverNow={serverNow}
          onDismiss={() => dismiss(toast)}
          onAcknowledge={() => acknowledge(toast)}
        />
      )}
      {modal && (
        <AnnouncementModal
          key={`${modal.id}:${modal.revision}`}
          item={modal}
          serverNow={serverNow}
          onDismiss={() => dismiss(modal)}
          onAcknowledge={() => acknowledge(modal)}
        />
      )}
      <button
        type="button"
        className="dc-announcement-center-toggle"
        onClick={() => setCenterOpen(!centerOpen)}
        aria-expanded={centerOpen}
        aria-controls="dc-announcement-center"
      >
        <Icon name="bell" />
        {language === "ru" ? "Уведомления" : "Notifications"}
        <b>{sorted.length}</b>
      </button>
      {centerOpen && (
        <aside
          id="dc-announcement-center"
          className="dc-announcement-center"
          aria-label={language === "ru" ? "Центр уведомлений" : "Notification center"}
        >
          <header>
            <div>
              <span>{language === "ru" ? "СИСТЕМНЫЕ СООБЩЕНИЯ" : "SYSTEM MESSAGES"}</span>
              <h2>{language === "ru" ? "Уведомления" : "Notifications"}</h2>
            </div>
            <button
              type="button"
              onClick={() => setCenterOpen(false)}
              aria-label={language === "ru" ? "Закрыть центр" : "Close center"}
            >
              ×
            </button>
          </header>
          <div className="dc-announcement-center__list">
            {sorted.map((item) => (
              <AnnouncementContent
                key={`${item.id}:${item.revision}`}
                item={item}
                serverNow={serverNow}
                onDismiss={() => dismiss(item)}
                onAcknowledge={() => acknowledge(item)}
                quiet
              />
            ))}
          </div>
        </aside>
      )}
    </>
  )
}
