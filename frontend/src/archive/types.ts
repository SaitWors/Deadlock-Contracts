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
export type Meta = {
  heroes: { key: string; name: string }[]
  ranks: Rank[]
  can_publish: boolean
  can_manage_packs: boolean
  account_key: string
  direct_costs: Record<Rank, number>
  default_weights: Record<Rank, number>
}

export type Odds = { rank: Rank; weight: number; total_weight: number; percent: number }
export type Recommendation = {
  price: number
  model: number
  discount_percent: number
  expected_direct_cost: number
  weeks_at_150: number
}
export type Pack = {
  id: string
  revision: number
  title: string
  description: string
  price: number
  draws: number
  active: boolean
  starter: boolean
  ready: boolean
  card_count: number
  cover: Card | null
  odds: Odds[]
  recommendation: Recommendation
  entries?: { card_id: string; weight: number; rank: Rank; percent: number; card: Card | null }[]
}
export type Receipt = {
  id: string
  kind: string
  delta: number
  balance_after: number
  created_at: string
  pack?: { id: string; title: string; price: number; revision: number; draws: number; odds: Odds[] }
  items: {
    id: string
    card: Card
    duplicate: boolean
    test_grant: boolean
    recycle_value: number
  }[]
}
export type Inventory = {
  items: {
    favorite: boolean
    card: Card
    quantity: number
    test_count: number
    recycle: { id: string; value: number } | null
  }[]
  total: number
}
export type Showcase = {
  card_ids: string[]
  is_public: boolean
  revision: number
  profile_public: boolean
}
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
