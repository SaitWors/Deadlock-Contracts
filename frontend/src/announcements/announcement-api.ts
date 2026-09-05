import { apiLanguage } from "../i18n"
import type {
  ActiveAnnouncementsResponse,
  AnnouncementReceiptAction,
  SiteAnnouncementSurface,
} from "./announcement-types"

export async function fetchActiveAnnouncements(
  surface: SiteAnnouncementSurface,
  signal?: AbortSignal,
): Promise<ActiveAnnouncementsResponse> {
  const params = new URLSearchParams({ surface })
  const response = await fetch(`/api/announcements/active?${params}`, {
    credentials: "same-origin",
    signal,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Accept-Language": apiLanguage(),
    },
  })
  if (!response.ok) throw new Error(`Announcements HTTP ${response.status}`)
  return response.json() as Promise<ActiveAnnouncementsResponse>
}

export async function postAnnouncementReceipt(
  announcementId: string,
  revision: number,
  surface: SiteAnnouncementSurface,
  action: AnnouncementReceiptAction,
  csrf: string,
): Promise<void> {
  const response = await fetch(`/api/announcements/${encodeURIComponent(announcementId)}/receipt`, {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: {
      Accept: "application/json",
      "Accept-Language": apiLanguage(),
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({ revision, surface, action }),
  })
  if (!response.ok && response.status !== 409 && response.status !== 404) {
    throw new Error(`Announcement receipt HTTP ${response.status}`)
  }
}
