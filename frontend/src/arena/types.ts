import type { Card, CoinReward, EconomyScope, Rank } from "../archive/types"
export type Text = string | { ru: string; en: string }
export type Patron = "ORDINARY" | "HIDDEN_KING" | "ARCHMOTHER"
export type Mode =
  | "TUTORIAL"
  | "TRAINING"
  | "ASSIGNED"
  | "HARD"
  | "TRIAL"
  | "WEEKLY"
  | "COPY"
  | "FRIENDLY"
  | "RANKED"
export type Slot = { item_id: string; line: number; position: "FRONT" | "BACK" }
export type Squad = {
  revision: number
  scope: EconomyScope
  base_item_id: string | null
  slots: Slot[]
}
export type Ability = {
  name: Text
  description: Text
  cost: number
  target?: "SELF" | "ALLY" | "OTHER_ALLY" | "ENEMY" | "FIRST" | "ALL_ENEMIES" | "NONE"
}
export type Definition = {
  image_url?: string
  key?: string
  name: Text
  role?: Text
  cost?: number
  passive?: Text
  description?: Text
  ability?: Ability
  hp?: number
  max_hp?: number
}
export type RosterItem = {
  definition?: {
    id: string
    key: string
    category: "HERO" | "BASE"
    version: number
    rules: Definition
  }
  item_id: string
  card: Card
  hero_key: string
  category: "HERO" | "BASE"
  definition_key: string
  scope: EconomyScope
  reserved: boolean
  stats: { max_hp: number; attack: number; armor: number; cost: number }
}
export type Bootstrap = {
  account_key?: string
  rules: {
    version: string
    ranks: Partial<Record<Rank, { coefficient_milli: number; cost: number }>>
    budget: number
    max_rounds: number
    heroes: Record<string, Definition>
    bases: Record<Patron, Definition>
  }
  squad: Squad
  inventory: RosterItem[]
  starter?: { claimed: boolean; available: boolean; missing_heroes: string[] }
  unavailable_inventory?: {
    item_id: string
    card: Card
    reason: "UNSUPPORTED_HERO" | "BATTLE_APPROVAL"
  }[]
  assignments: {
    id: string
    mode: Mode
    period_day?: string
    slot: number
    status: string
    opponent: Text
  }[]
  active_matches: {
    id: string
    mode: Mode
    status: string
    revision: number
    round: number
    expired?: boolean
  }[]
  progression: {
    account_days: number
    confirmed_contracts: number
    eligible_pve_wins: number
    trials: Partial<Record<Patron, boolean>>
    ex_access: Partial<Record<Patron, { eligible: boolean; reasons: string[] }>>
  }
  season: null | {
    id: string
    title: Text
    starts_at: string
    ends_at: string
    rating: number
    games: number
    earned_title?: string
  }
  showcase: { revision: number; is_public: boolean; base_item_id: string | null; slots: Slot[] }
}
export type Hero = {
  image_url?: string
  card?: Card
  id: string
  item_id: string
  hero_key: string
  name: Text
  rank: Rank
  line: number
  position: "FRONT" | "BACK"
  hp: number
  max_hp: number
  attack: number
  armor: number
  shield: number
  shield_expires_round?: number
  ready_round: number
  deaths: number
  respawn_round: number | null
  ability: Ability
}
export type Base = {
  image_url?: string
  id: string
  key: Patron
  hp: number
  max_hp: number
  ready_round: number
  ability: Ability
}
export type Side = {
  side: "A" | "B"
  energy: number
  base: Base
  guardians: { id: string; line: number; hp: number; max_hp: number; attack: number }[]
  heroes: Hero[]
}
export type Action =
  | { type: "SWAP"; first_id: string; second_id: string }
  | { type: "HERO_ABILITY"; actor_id: string; target_id?: string }
  | { type: "BASE_ABILITY"; target_id?: string; line?: number }
export type Match = {
  expired?: boolean
  id: string
  mode: Mode
  scope: EconomyScope
  status: "ACTIVE" | "FINISHED" | "WAITING"
  round: number
  revision: number
  player_side: "A" | "B"
  state: { round: number; status: string; sides: Side[]; rules?: Bootstrap["rules"] }
  last_events: { type?: string; text?: Text; [key: string]: unknown }[]
  submitted: boolean
  opponent_submitted: boolean
  result: null | { winner_side: "A" | "B" | null; reason: string }
  reward: CoinReward | null
}
export type Room = {
  code: string
  scope?: EconomyScope
  status: string
  match_id: string | null
  own_confirmed: boolean
  opponent_confirmed: boolean
}
export type ArenaReply = { match?: Match | null; squad?: Squad; room?: Room; queued?: boolean }
export const localized = (value: Text | undefined, language: "ru" | "en") =>
  typeof value === "string" ? value : value?.[language] || ""
export const seasonTitle = (value: string | undefined, language: "ru" | "en") =>
  (({
    RECRUIT: ["Новобранец", "Recruit"],
    PARTICIPANT: ["Участник", "Participant"],
    TACTICIAN: ["Тактик", "Tactician"],
    VETERAN: ["Ветеран", "Veteran"],
  })[value || "RECRUIT"] || [value, value])[language === "ru" ? 0 : 1]
export const modes: Record<Mode, [string, string]> = {
  TUTORIAL: ["Обучение", "Tutorial"],
  TRAINING: ["Тренировка", "Training"],
  ASSIGNED: ["Назначенный PvE", "Assigned PvE"],
  HARD: ["Сложный бот", "Hard bot"],
  TRIAL: ["Испытание покровителя", "Patron trial"],
  WEEKLY: ["Недельное испытание", "Weekly challenge"],
  COPY: ["Бот с копией состава", "Bot using a squad copy"],
  FRIENDLY: ["Дружеский PvP", "Friendly PvP"],
  RANKED: ["Сезонный PvP", "Season PvP"],
}
