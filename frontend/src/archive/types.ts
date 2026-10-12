export const RANKS = ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"] as const
export type HeroRank = (typeof RANKS)[number]
export type Rank = HeroRank | "EX"
export type EconomyScope = "REAL" | "SANDBOX"
export type WalletBalance = {
  scope: EconomyScope
  net_balance: number
  available_balance: number
  debt: number
}
export type CoinReward = {
  id?: string
  source_type: string
  source_id: string
  nominal_amount: number
  amount: number
  reason: string
  status: string
  created_at?: string
  delivered_at?: string | null
}
export type CoinRewardStatus = {
  policy_version: string
  enabled: boolean
  quotas: Record<
    "daily" | "weekly",
    { limit: number; used: number; remaining: number; reset_at: string }
  >
  receipts: CoinReward[]
  source_quotas?: Record<
    string,
    Partial<
      Record<
        "daily" | "weekly",
        { limit: number; used: number; remaining: number; reset_at: string }
      >
    >
  >
  regular_weekly_maximum?: number
  progress?: {
    confirmed_contracts: number
    eligible_pve_wins: number
    weekly_contracts: number
    weekly_pve_wins: number
  }
}
export type Card = {
  id: string
  hero: string
  hero_name: string
  rank: Rank
  category?: "HERO" | "BASE"
  battle_eligible?: boolean
  definition_key?: string
  ex_access?: { eligible: boolean; reasons: string[] }
  title: string
  description: string
  artist: string
  source_url: string
  image_url: string | null
  release_poster?: boolean
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
  bases?: { key: string; name: string }[]
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
export type PackGuarantees = {
  scope: EconomyScope
  revision: number
  without_a: number
  without_s: number
  without_sss: number
  thresholds: { a: number; s: number; sss: number }
  next_minimum_rank: Rank | null
  next_slot_odds: Odds[]
}
export type PackSlot = { kind: "ORDINARY" | "B_PLUS"; odds: Odds[] }
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
  kind?: "LEGACY" | "NIGHT_ENVELOPE" | "SPECIAL_FOLDER"
  rule_version?: string
  slots?: PackSlot[]
  guarantees?: PackGuarantees
  recommendation: Recommendation
  entries?: { card_id: string; weight: number; rank: Rank; percent: number; card: Card | null }[]
}
export type Receipt = {
  id: string
  kind: string
  delta: number
  balance_after: number
  scope?: EconomyScope
  net_balance?: number
  available_balance?: number
  debt?: number
  created_at: string
  pack?: {
    id: string
    title: string
    price: number
    revision: number
    draws: number
    odds: Odds[]
    rule_version?: string
    slots?: PackSlot[]
    guarantee_before?: PackGuarantees
    guarantee_after?: PackGuarantees
  }
  items: {
    id: string
    card: Card
    duplicate: boolean
    test_grant: boolean
    recycle_value: number
    slot_kind?: "ORDINARY" | "B_PLUS"
    natural_rank?: Rank
    guaranteed_minimum_rank?: Rank | null
    forced?: boolean
  }[]
}
export type Inventory = {
  scope?: EconomyScope
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
  scope?: EconomyScope
  net_balance?: number
  available_balance?: number
  debt?: number
  wallets?: Record<EconomyScope, WalletBalance>
  currency: string
  weekly_limit: number
  reward: number
  completed: number
  reset_at: string
  round: Round | null
  history: {
    id: string
    delta: number
    reason: string
    source?: string
    scope?: EconomyScope
    created_at: string
  }[]
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
