export type Candidate = { hero_id: number; name_ru: string; name_en: string; released: boolean }
export type VoteRow = Candidate & { votes: number; percent: number }
export type VoteSource = {
  provider: string
  name: string
  kind: "COMMUNITY_POLL" | "RELEASE_PREDICTIONS"
  url: string
  enabled: boolean
  status: string
  stale: boolean
  updated_at: string | null
  last_attempt_at: string | null
  next_refresh_at: string
  result: {
    total_votes: number
    rows: VoteRow[]
    leader_ids: number[]
    gap_votes: number | null
    gap_percent: number | null
  } | null
  change: {
    since: string
    leader_changed: boolean
    previous_leader_ids: number[]
    votes_delta: number
    gap_delta: number | null
  } | null
}
export type Campaign = {
  id: string
  title_ru: string
  title_en: string
  candidates: Candidate[]
  starts_at: string | null
  ends_at: string | null
  sources: VoteSource[]
}
export type PublicVotes = { enabled: boolean; campaign: Campaign | null; server_time: string }
export type AdminCampaign = Campaign & {
  revision: number
  visible: boolean
  active: boolean
  live: boolean
  ended_at: string | null
}
export type CampaignDraft = Pick<
  Campaign,
  "title_ru" | "title_en" | "candidates" | "starts_at" | "ends_at"
> & {
  providers: string[]
}
