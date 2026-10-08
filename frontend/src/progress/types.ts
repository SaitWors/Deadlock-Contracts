import type { MatchMode } from "../ModeSelector"

export type ProgressIntent = "PRACTICE" | "EXPERIMENT" | "RESULT" | "VARIETY"
export type ProgressSourceKind =
  | "INDEPENDENT_PROVIDER"
  | "CLIENT_ATTESTED_GEP"
  | "DEMO"
  | "LEGACY"
  | "UNKNOWN"
export type ProgressSource = { kind: ProgressSourceKind; count: number }
export type ProgressText = Partial<Record<"ru" | "en", string>>
export type ProgressGoal = {
  option_id: string
  title_i18n: ProgressText
  description_i18n: ProgressText
  reward_xp: number
  status: string
  conditions: { metric: string; operator: string; target: number }[]
  basis: { metric?: string; median?: number | null; n?: number; sample_size?: number }[]
  reason: ProgressText
  personalized: boolean
}
export type ProgressDebrief = {
  match_id: string
  hero_id: number | null
  played_at: string | null
  source: ProgressSourceKind
  baseline_sample_size: number
  baseline_scope: "SAME_HERO" | "SAME_MODE" | "NONE"
  comparisons: {
    metric: string
    current: number | null
    median: number | null
    delta: number | null
    n: number
    improved: boolean
  }[]
  contracts: {
    assignment_id: string
    title_i18n: ProgressText
    status: string
    reward_granted_xp: number
    explanation: string | null
  }[]
  xp_granted: number
}
export type ProgressHero = {
  hero_id: number
  matches: number
  contracts_completed: number
  records: { metric: string; value: number | null }[]
  sources: ProgressSource[]
}
export type PersonalProgressData = {
  version: "personal-progress-1"
  mode: MatchMode
  intent: ProgressIntent
  sample_size: number
  minimum_sample_size: number
  confidence: "COLD_START" | "LOW" | "MEDIUM" | "HIGH"
  sources: ProgressSource[]
  board: { id: string; status: string; generation: number } | null
  goal: ProgressGoal | null
  alternatives: ProgressGoal[]
  debrief: ProgressDebrief | null
  heroes: ProgressHero[]
}
export type ProgressBoard = {
  id: string
  generation: number
  game_match_mode: MatchMode
  status: string
  options: { id: string; status: string; selected: boolean }[]
}
export type GoalRecommendation = {
  mode: MatchMode
  boardId: string
  generation: number
  optionId: string
}
