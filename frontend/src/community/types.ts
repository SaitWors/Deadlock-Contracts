export type Theme = "DOSSIER" | "NOIR" | "SIGNAL"
export type Achievement = {
  id: string
  title: Record<"ru" | "en", string>
  description: Record<"ru" | "en", string>
  current: number
  target: number
  earned: boolean
  earned_at: string | null
}
export type Collection = { items: Achievement[]; earned: number; total: number }
export type BureauSummary = {
  slug: string
  name: string
  tagline: string
  theme: Theme
  language: "ru" | "en" | "any"
  recruitment: "OPEN" | "APPLICATION" | "CLOSED"
  member_count: number
  capacity: number
}
export type Showcase = {
  id: string
  title: string
  title_i18n?: Partial<Record<"ru" | "en", string>>
  mode: string
  difficulty: string
  rarity: string
  reward_xp: number
}
export type Module = "contracts" | "achievements" | "bureau"
export type Profile = {
  slug: string
  headline: string
  bio: string
  theme: Theme
  is_public: boolean
  show_stats: boolean
  show_showcase: boolean
  show_links: boolean
  show_achievements: boolean
  show_bureau: boolean
  links: Record<string, string>
  public_url: string | null
  showcase_order: Module[]
  pinned_contract_ids?: string[]
  available_contracts?: Showcase[]
  featured_achievement: string | null
  player: {
    display_name: string
    avatar_url: string | null
    level: number
    xp: number | null
    badges: string[]
  }
  stats: {
    contracts_completed: number
    contracts_failed: number
    mode_stats: Record<string, { completed: number; xp: number }>
  } | null
  showcase: Showcase[]
  achievements: Achievement[]
  bureau: BureauSummary | null
}
