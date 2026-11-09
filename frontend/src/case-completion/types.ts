export type CompletionTask = {
  id: string
  title: string
  title_i18n?: Partial<Record<"ru" | "en", string>>
  status: string
  xp: number
}
export type LevelBand = { level: number; start_xp: number; end_xp: number }
export type CompletionProgress = {
  level: number
  total_xp: number
  level_xp: number
  next_level_xp: number
  progress_pct: number
  xp_to_next: number
  lifetime_spent_threshold: number
}
export type CompletionReceipt = {
  board_id: string
  ready: boolean
  reason: string | null
  user: { id: string; display_name: string; avatar_url: string | null }
  attempts_used: number
  max_attempts: number
  tasks: CompletionTask[]
  total_xp: number
  progression: { before: CompletionProgress; after: CompletionProgress; levels: LevelBand[] }
}
