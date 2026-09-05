import { adminApi } from "./admin-api"
import type {
  AdminAnnouncement,
  AdminAnnouncementDraft,
  AnnouncementListResponse,
  AnnouncementMetrics,
} from "./announcement-types"

type ItemResponse = { ok: boolean; item: AdminAnnouncement }

export function getAnnouncement(csrf: string, id: string) {
  return adminApi<{ item: AdminAnnouncement }>(
    `/api/admin/announcements/${encodeURIComponent(id)}`,
    csrf,
  )
}

export function listAnnouncements(
  csrf: string,
  filters: { phase: string; severity: string; surface: string; author: string; query: string },
) {
  const params = new URLSearchParams({ ...filters, limit: "250" })
  return adminApi<AnnouncementListResponse>(`/api/admin/announcements?${params}`, csrf)
}

export function createAnnouncement(csrf: string, draft: AdminAnnouncementDraft) {
  return adminApi<ItemResponse>("/api/admin/announcements", csrf, {
    method: "POST",
    body: JSON.stringify(draft),
  })
}

export function updateAnnouncement(
  csrf: string,
  item: AdminAnnouncement,
  draft: AdminAnnouncementDraft,
) {
  return adminApi<ItemResponse>(`/api/admin/announcements/${item.id}`, csrf, {
    method: "PATCH",
    body: JSON.stringify({ ...draft, expected_revision: item.revision }),
  })
}

export function publishAnnouncement(
  csrf: string,
  item: AdminAnnouncement,
  input: { starts_at: string; ends_at: string; reason: string },
) {
  return adminApi<ItemResponse>(`/api/admin/announcements/${item.id}/publish`, csrf, {
    method: "POST",
    body: JSON.stringify({
      expected_revision: item.revision,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      reason: input.reason,
      confirm_text: "PUBLISH",
    }),
  })
}

export function cancelAnnouncement(csrf: string, item: AdminAnnouncement, reason: string) {
  return adminApi<ItemResponse>(`/api/admin/announcements/${item.id}/cancel`, csrf, {
    method: "POST",
    body: JSON.stringify({ expected_revision: item.revision, reason }),
  })
}

export function duplicateAnnouncement(csrf: string, item: AdminAnnouncement) {
  return adminApi<ItemResponse>(`/api/admin/announcements/${item.id}/duplicate`, csrf, {
    method: "POST",
  })
}

export function replaceAnnouncement(
  csrf: string,
  previous: AdminAnnouncement,
  replacement: AdminAnnouncement,
  input: { starts_at: string; ends_at: string; reason: string },
) {
  return adminApi<{
    ok: boolean
    previous: AdminAnnouncement
    replacement: AdminAnnouncement
  }>(`/api/admin/announcements/${previous.id}/replace`, csrf, {
    method: "POST",
    body: JSON.stringify({
      expected_revision: previous.revision,
      replacement_id: replacement.id,
      replacement_expected_revision: replacement.revision,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      reason: input.reason,
      confirm_text: "PUBLISH",
    }),
  })
}

export function changeAnnouncementEndTime(
  csrf: string,
  item: AdminAnnouncement,
  endsAt: string,
  reason: string,
) {
  return adminApi<ItemResponse>(`/api/admin/announcements/${item.id}/end-time`, csrf, {
    method: "POST",
    body: JSON.stringify({
      expected_revision: item.revision,
      ends_at: endsAt,
      reason,
    }),
  })
}

export function getAnnouncementMetrics(csrf: string, id: string) {
  return adminApi<AnnouncementMetrics>(
    `/api/admin/announcements/${encodeURIComponent(id)}/metrics`,
    csrf,
  )
}
