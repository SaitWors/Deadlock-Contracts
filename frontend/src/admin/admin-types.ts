export type AdminReviewReasonCode =
  | "NOT_COMPLETED"
  | "INSUFFICIENT_EVIDENCE"
  | "INVALID_MATCH"
  | "IDENTITY_MISMATCH"
  | "DATA_CONFLICT"
  | "POLICY_VIOLATION"
  | "OTHER"

export type AdminReviewVerdict = "COMPLETED" | "FAILED" | "VOID"

export type AdminReviewClaim = {
  active: boolean
  claimed_by: {
    id: string
    display_name: string
    access_role: string
  } | null
  claimed_by_user_id: string | null
  claimed_at: string | null
  expires_at: string | null
  seconds_remaining: number
  expired: boolean
  ttl_minutes: number
}

export type AdminReviewCondition = {
  metric: string
  operator: string
  target: number
  capabilities: string[]
  missing_capabilities: string[]
  actual: number | null
}

export type AdminReviewContract = {
  id: string
  title: string
  status: string
  reward_xp: number
  metric: string
  operator: string
  target: number
  progress_current: number | null
  progress_target: number | null
  explanation: string | null
  required_capabilities: string[]
  missing_capabilities: string[]
  actual: number | null
  conditions: AdminReviewCondition[]
  evaluations: Array<{
    id: string
    revision: number
    status: string
    evidence_level: string
    progress_current: number | null
    progress_target: number | null
    explanation: string | null
    created_at: string | null
  }>
}

export type AdminReview = {
  id: string
  board_id: string
  status: string
  priority: number
  mode: "STANDARD" | "RANKED" | "STREET_BRAWL"
  match_id: string | null
  player: {
    display_name: string
    account_id: number | null
  }
  match_summary: {
    provider: string | null
    duration_s: number | null
    mode: string | null
    mode_raw: string | null
    mode_confidence: string | null
    scoring_status: string | null
    settlement_source: string | null
    integrity_status: string | null
    audit_status: string | null
    audited_at: string | null
    capabilities: string[]
    kills: number | null
    deaths: number | null
    assists: number | null
    net_worth: number | null
    hero_damage: number | null
    object_damage: number | null
    healing: number | null
    won: boolean | null
    gep_evidence: Record<string, unknown> | null
  }
  reasons: Array<{
    option_id: string
    title: string
    reason: string
  }>
  context: Record<string, unknown>
  reviewer_note: string | null
  created_at: string
  reviewed_at: string | null
  claim: AdminReviewClaim
  contracts: AdminReviewContract[]
  history: Array<{
    action: string
    actor_user_id: string | null
    data: Record<string, unknown>
    created_at: string | null
  }>
}

export type AdminReviewListResponse = {
  items: AdminReview[]
  total: number
  offset: number
  limit: number
  status_counts: Record<string, number>
  claim_counts: {
    free: number
    claimed: number
    mine: number
  }
  oldest_open_seconds: number | null
  server_time: string
}

export type AdminReviewDecisionPreview = {
  review_id: string
  board_id: string
  match_id: string
  case_status: string
  source: string
  reason_code: AdminReviewReasonCode | null
  decision_key: string
  reward_xp_total: number
  board_status_after: string
  resume_discovery: boolean
  settled_options: Array<{
    option_id: string
    status: AdminReviewVerdict
    progress_current: number | null
    explanation: string
    reward_xp: number
  }>
  decided_at: string | null
  idempotent: boolean
  policy_version: string
}
