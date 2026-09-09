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
  appearance?: BureauAppearance
  avatar_url?: string | null
  cover_url?: string | null
  slug: string
  name: string
  tagline: string
  theme: Theme
  language: "ru" | "en" | "any"
  recruitment: "OPEN" | "APPLICATION" | "CLOSED"
  member_count: number
  status?: "ACTIVE" | "FROZEN"
  moderation_note?: string
  capacity: number
}
export type BureauAppearance = {
  accent: "SAGE" | "BRASS" | "OCEAN" | "PLUM" | "EMBER"
  cover: "AURORA" | "GRID" | "ARCHIVE" | "PLAIN"
  emblem:
    | "compass"
    | "swords"
    | "shield"
    | "crown"
    | "eye"
    | "moon"
    | "feather"
    | "flask-conical"
    | "book-open"
    | "handshake"
    | "gem"
    | "building-2"
  avatar_shape: "ROUNDED" | "CIRCLE" | "SHIELD"
  roster_layout: "CARDS" | "LIST"
  cover_position: number
}
export type BureauSettings = Pick<
  BureauSummary,
  "name" | "tagline" | "language" | "theme" | "recruitment"
> & {
  slug?: string
  description: string
  rules: string
  appearance?: BureauAppearance
  role_titles?: Record<"DIRECTOR" | "MODERATOR" | "OPERATIVE", string>
  welcome?: string
  listed?: boolean
  expected_revision?: number
  avatar_image?: string | null
  cover_image?: string | null
  avatar_url?: string | null
  cover_url?: string | null
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
  show_cards?: boolean
  cards?: import("../archive/types").Card[]
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
