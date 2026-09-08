export const RANKS = ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"] as const
export type Rank = (typeof RANKS)[number]
export type Card = {
  id: string
  hero: string
  hero_name: string
  rank: Rank
  title: string
  description: string
  artist: string
  source_url: string
  image_url: string | null
  crop_x: number
  crop_y: number
  zoom: number
  frame_version: number
  status: "DRAFT" | "PENDING" | "PUBLISHED" | "REJECTED" | "ARCHIVED" | "REMOVED"
  revision: number
  rights_confirmed?: boolean
  review_note?: string
}
export type Meta = { heroes: { key: string; name: string }[]; ranks: Rank[]; can_publish: boolean }
export type Round = {
  id: string
  slot: number
  status: "OPEN" | "SOLVED" | "ASSISTED"
  revision: number
  guesses: { symbols: number[]; exact: number; misplaced: number }[]
  solution: number[] | null
}
export type Wallet = {
  balance: number
  currency: string
  weekly_limit: number
  reward: number
  completed: number
  reset_at: string
  round: Round | null
  history: { id: string; delta: number; reason: string; created_at: string }[]
  history_total: number
}
export const STATUS = {
  DRAFT: ["Черновик", "Draft"],
  PENDING: ["На проверке", "In review"],
  PUBLISHED: ["В каталоге", "Published"],
  REJECTED: ["Нужны правки", "Changes requested"],
  ARCHIVED: ["Снята с публикации", "Unpublished"],
  REMOVED: ["Удалена", "Removed"],
}
