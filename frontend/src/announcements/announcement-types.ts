export type AnnouncementSeverity =
  | "INFO"
  | "SUCCESS"
  | "WARNING"
  | "MAINTENANCE"
  | "CRITICAL"
  | "EVENT"

export type AnnouncementPresentation = "BANNER" | "TOAST" | "MODAL"

export type AnnouncementEffect =
  | "NONE"
  | "FADE_SLIDE"
  | "STAMP_IN"
  | "SOFT_GLOW"
  | "SCANLINE_ONCE"
  | "CONFETTI_ONCE"

export type AnnouncementDismissPolicy = "DISMISSIBLE" | "ACK_REQUIRED" | "NON_DISMISSIBLE"

export type SiteAnnouncementSurface = "SITE_PUBLIC" | "SITE_DASHBOARD"

export type Announcement = {
  id: string
  revision: number
  phase: "ACTIVE"
  severity: AnnouncementSeverity
  presentation: AnnouncementPresentation
  effect: AnnouncementEffect
  dismiss_policy: AnnouncementDismissPolicy
  priority: number
  title: string
  body: string
  cta: { label: string; url: string } | null
  starts_at: string
  ends_at: string
  show_countdown: boolean
}

export type ActiveAnnouncementsResponse = {
  server_time: string
  poll_after_seconds: number
  items: Announcement[]
}

export type AnnouncementReceiptAction = "SEEN" | "DISMISSED" | "ACKNOWLEDGED"
