import type {
  AnnouncementDismissPolicy,
  AnnouncementEffect,
  AnnouncementPresentation,
  AnnouncementSeverity,
} from "../announcements/announcement-types"

export type AnnouncementSurface =
  | "SITE_PUBLIC"
  | "SITE_DASHBOARD"
  | "COMPANION_DESKTOP"
  | "COMPANION_OVERLAY"

export type AnnouncementAudience =
  | "ALL"
  | "ANONYMOUS"
  | "AUTHENTICATED"
  | "PLAYERS"
  | "TESTERS"
  | "STAFF"

export type AnnouncementPhase =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "EXPIRED"
  | "CANCELLED"
  | "ARCHIVED"

export type AnnouncementActor = {
  id: string
  display_name: string
}

export type AdminAnnouncementDraft = {
  severity: AnnouncementSeverity
  presentation: AnnouncementPresentation
  effect: AnnouncementEffect
  dismiss_policy: AnnouncementDismissPolicy
  title_ru: string
  body_ru: string
  title_en: string
  body_en: string
  cta_label_ru: string
  cta_label_en: string
  cta_url: string
  surfaces: AnnouncementSurface[]
  audiences: AnnouncementAudience[]
  priority: number
  show_countdown: boolean
}

export type AdminAnnouncement = AdminAnnouncementDraft & {
  id: string
  status: "DRAFT" | "PUBLISHED" | "CANCELLED" | "ARCHIVED"
  phase: AnnouncementPhase
  starts_at: string | null
  ends_at: string | null
  revision: number
  supersedes_id: string | null
  created_by: AnnouncementActor | null
  updated_by: AnnouncementActor | null
  published_by: AnnouncementActor | null
  cancelled_by: AnnouncementActor | null
  published_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export type AnnouncementListResponse = {
  items: AdminAnnouncement[]
  total: number
  offset: number
  limit: number
  phase_counts: Partial<Record<AnnouncementPhase, number>>
  server_time: string
  feature_flags: {
    enabled: boolean
    site: boolean
    companion: boolean
    telegram_mirror: boolean
  }
}

export type AnnouncementMetrics = {
  announcement_id: string
  revision: number
  totals: {
    seen_users: number
    dismissed_users: number
    acknowledged_users: number
    impressions: number
  }
  by_surface: Record<
    string,
    {
      seen_users: number
      dismissed_users: number
      acknowledged_users: number
      impressions: number
    }
  >
  acknowledgement_rate: number
}
