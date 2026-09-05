import { useEffect, useState } from "react"
import { useLanguage } from "../i18n"
import type { Announcement } from "./announcement-types"

const severityIcon: Record<Announcement["severity"], string> = {
  INFO: "i",
  SUCCESS: "✓",
  WARNING: "!",
  MAINTENANCE: "⚙",
  CRITICAL: "!",
  EVENT: "★",
}

const effectClass: Record<Announcement["effect"], string> = {
  NONE: "",
  FADE_SLIDE: "dc-announcement--fade-slide",
  STAMP_IN: "dc-announcement--stamp-in",
  SOFT_GLOW: "dc-announcement--soft-glow",
  SCANLINE_ONCE: "dc-announcement--scanline",
  CONFETTI_ONCE: "dc-announcement--confetti",
}

function useCountdown(item: Announcement, serverNow: () => number) {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    if (!item.show_countdown) return
    const timer = window.setInterval(() => setNow(serverNow()), 1000)
    return () => window.clearInterval(timer)
  }, [item.show_countdown, serverNow])
  if (!item.show_countdown) return null
  const remaining = Math.max(0, Date.parse(item.ends_at) - now)
  const totalSeconds = Math.floor(remaining / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":")
}

export default function AnnouncementContent({
  item,
  serverNow,
  onDismiss,
  onAcknowledge,
  quiet = false,
}: {
  item: Announcement
  serverNow: () => number
  onDismiss: () => void
  onAcknowledge: () => void
  quiet?: boolean
}) {
  const { language } = useLanguage()
  const countdown = useCountdown(item, serverNow)
  const urgent = ["WARNING", "MAINTENANCE", "CRITICAL"].includes(item.severity)
  const external = Boolean(item.cta?.url.startsWith("https://"))
  return (
    <article
      className={`dc-announcement dc-announcement--${item.severity.toLowerCase()} ${effectClass[item.effect]}`}
      role={quiet ? undefined : urgent ? "alert" : "status"}
      aria-live={quiet ? "off" : urgent ? "assertive" : "polite"}
      data-announcement={`${item.id}:${item.revision}`}
    >
      <span className="dc-announcement__icon" aria-hidden="true">
        {severityIcon[item.severity]}
      </span>
      <div className="dc-announcement__copy">
        <div className="dc-announcement__meta">
          <span>{item.severity}</span>
          {countdown && (
            <time dateTime={item.ends_at}>
              {language === "ru" ? "Осталось" : "Remaining"} {countdown}
            </time>
          )}
        </div>
        <h2>{item.title}</h2>
        <p>{item.body}</p>
        <div className="dc-announcement__actions">
          {item.cta && (
            <a
              href={item.cta.url}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
            >
              {item.cta.label}
            </a>
          )}
          {item.dismiss_policy === "ACK_REQUIRED" && (
            <button type="button" onClick={onAcknowledge}>
              {language === "ru" ? "Понятно" : "Got it"}
            </button>
          )}
        </div>
      </div>
      {item.dismiss_policy === "DISMISSIBLE" && (
        <button
          type="button"
          className="dc-announcement__close"
          onClick={onDismiss}
          aria-label={language === "ru" ? "Закрыть уведомление" : "Dismiss notification"}
        >
          ×
        </button>
      )}
    </article>
  )
}
