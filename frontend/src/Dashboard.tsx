import BureauAtmosphere from "./BureauAtmosphere"
import { useAdminCopy } from "./admin/admin-copy"
import SvgIcon, { type IconName } from "./icons/Icon"
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import markImage from "@/imports/mark.svg"
import { NightshiftNav } from "./nightshift-layout"
import ProfileStudio from "./ProfileStudio"
import BureauHeader from "./BureauHeader"
import AccountMenu from "./AccountMenu"
import BureauBottomNav from "./BureauBottomNav"
import BureauGuide, { hasSeenGuide, rememberGuide } from "./BureauGuide"
import ModeSelector from "./ModeSelector"
import { useAnnouncements } from "./announcements/AnnouncementProvider"
import Leaderboard from "./community/Leaderboard"
import Achievements from "./community/Achievements"
import Bureaus from "./community/Bureaus"
import ContractSigning from "./ContractSigning"
import { PersonalizationContext, VerificationContext } from "./ContractContext"
import "./contract-board.css"
import { signSelection, selectionState, type SigningSelection } from "./contract-signing"
import { prefersReducedMotion, useRipple } from "./motion"
import AnnouncementCenter from "./admin/AnnouncementCenter"
import ReviewDesk from "./admin/ReviewDesk"
import type { AdminReview } from "./admin/admin-types"
import ArchiveNextStep from "./archive/ArchiveNextStep"
import { useHeroVotes } from "./hero-votes/useHeroVotes"
import PersonalProgress from "./progress/PersonalProgress"
import CompletionButton, {
  canShowCompletion,
  CompletionProvider,
} from "./case-completion/CompletionButton"
import type { GoalRecommendation } from "./progress/types"
import {
  MCGCredit,
  apiLanguage,
  conditionText,
  contractDescription,
  contractTitle,
  localizeServerText,
  t,
  useLanguage,
  type Language,
} from "./i18n"

const ArchivePage = lazy(() => import("./archive/ArchivePage"))
const CardReviewDesk = lazy(() => import("./admin/CardReviewDesk"))
const OwnerArchiveDesk = lazy(() => import("./admin/OwnerArchiveDesk"))
const HeroVotesPage = lazy(() => import("./hero-votes/HeroVotesPage"))
const HeroVotesDesk = lazy(() => import("./admin/HeroVotesDesk"))

const BureauModerationDesk = lazy(() => import("./admin/BureauModerationDesk"))

type Mode = "STANDARD" | "RANKED" | "STREET_BRAWL"
type AccessRole = "OWNER" | "ADMIN" | "MODERATOR" | "TESTER" | "PLAYER"
type BadgeId =
  | "CREATOR"
  | "ADMIN"
  | "DEVELOPER"
  | "STREAMER"
  | "EARLY_TESTER"
  | "TESTER"
  | "CONTRIBUTOR"
  | "PLAYER"
type User = {
  id: string
  display_name: string
  avatar_url: string | null
  xp: number
  status: string
  locale: "ru" | "en"
  timezone: string
  access_role: AccessRole
  badges: BadgeId[]
  created_at: string | null
  is_admin: boolean
  is_staff: boolean
  permissions: string[]
  can_manage_roles: boolean
}
type SessionPayload = {
  authenticated: boolean
  user: User
  csrf_token: string
  release: {
    version: string
    modes?: Mode[]
    companion_download_url?: string | null
  }
}
type ContractCondition = {
  metric: string
  operator: string
  target: number
  capabilities?: string[]
}
type Option = {
  id: string
  title: string
  title_i18n?: Partial<Record<"ru" | "en", string>>
  description: string
  description_i18n?: Partial<Record<"ru" | "en", string>>
  reward_xp: number
  selected: boolean
  status: string
  target: number
  metric: string
  operator?: string
  progress_current: number | null
  explanation: string | null
  bound_match_id: string | null
  difficulty: string
  rarity: string
  drop_chance_pct: number
  category: string
  conditions?: ContractCondition[]
  personalization?: Record<string, unknown>
}
type Board = {
  id: string
  date: string
  status: string
  game_match_mode: Mode
  generation: number
  generator_version?: string
  locked_at: string | null
  expires_at: string
  attempts_used: number
  max_attempts: number
  attempts_remaining: number
  options: Option[]
  provider_status?: {
    phase?: string
    message?: string
    match_id?: string | null
    active_match_ids?: string[]
    queued_count?: number
    attempts?: number
    next_check_at?: string
    delayed_by_provider?: boolean
  } | null

  daily_reset_at?: string
  case_expires_at?: string | null
  next_board_ready?: boolean
}
type BoardsPayload = {
  date: string
  server_time: string
  refresh: {
    free_per_day: number
    used: number
    remaining: number
    last_mode: Mode | null
    reset_at?: string
  }
  boards: Board[]
}
type HistoryItem = {
  assignment_id: string
  board_id: string
  game_match_mode: Mode
  attempts_used: number
  max_attempts: number
  title: string
  title_i18n?: Partial<Record<"ru" | "en", string>>
  status: string
  reward_xp: number
  reward_granted_xp: number
  reward_granted_at: string | null
  difficulty: string
  rarity: string
  explanation: string | null
  match_id: string | null
  last_attempt_match_id: string | null
  locked_at: string | null
  settled_at: string | null
  evaluations: Array<{
    id: string
    revision: number
    status: string
    match_id: string | null
    explanation: string | null
    created_at: string
  }>

  board_status?: string
  case_expires_at?: string | null
}
type HistoryCase = {
  board_id: string
  game_match_mode: Mode
  status: string
  locked_at: string | null
  settled_at: string | null
  case_expires_at: string | null
  attempts_used: number
  max_attempts: number
  items: HistoryItem[]
}
type Progression = {
  level: number
  total_xp: number
  level_xp: number
  next_level_xp: number
  xp_to_next: number
  progress_pct: number
  contracts_completed: number
  contracts_failed: number
  review_pending: number
  mode_stats: Record<
    Mode,
    {
      completed: number
      failed: number
      attempted: number
      xp: number
    }
  >
  hardest_completed: {
    title: string
    title_i18n?: Partial<Record<"ru" | "en", string>>
    difficulty: string
    reward_xp: number
  } | null
}
type ReviewMine = {
  id: string
  board_id: string
  status: string
  reasons: Array<{
    option_id: string
    title: string
    reason: string
  }>
  context: Record<string, unknown>
  created_at: string
  reviewed_at: string | null
  reviewer_note: string | null
}
type AdminAuthStatus = {
  configured: boolean
  elevated: boolean
  expires_at: string | null
  ttl_minutes: number
  can_manage_roles: boolean
  is_staff: boolean
  permissions: string[]
  admin: {
    id: string
    display_name: string
    steam_id64: string
    access_role: AccessRole
    badges: BadgeId[]
  }
}
type AdminOverview = {
  users: number
  active_boards: number
  pending_reviews: number
  failed_jobs: number
  pending_jobs: number
  companion_online: number
  latest_match_id: string | null
  server_time: string
  users_new_24h: number
  users_new_7d: number
  matches_24h: number
  matches_7d: number
  boards_24h: number
  xp_issued: number
  companion_paired: number
  board_statuses: Record<string, number>
  board_modes: Record<string, number>
  job_statuses: Record<string, number>
  review_statuses: Record<string, number>
  match_modes: Record<string, number>
  companion_versions: Record<string, number>
  verification_health: {
    verifying_options: number
    stuck_15m: number
    final_match_waiting: number
    missing_capabilities: Record<string, number>
    examples: Array<{
      board_id: string
      option_id: string
      title: string
      match_id: string
      mode: string
      missing_capabilities: string[]
      locked_at: string | null
    }>
  }
  timeline: Array<{
    date: string
    registrations: number
    matches: number
    boards: number
  }>
}
type AdaptiveMetric = {
  n: number
  median: number
  p25: number
  p60: number
  p75: number
  best: number
}
type AdaptiveProfile = {
  version: string
  mode: string
  sample_size: number
  confidence: string
  metrics: Record<string, AdaptiveMetric>
}
type AdminUserSummary = {
  id: string
  steam_id64: string
  account_id: number | null
  display_name: string
  avatar_url: string | null
  xp: number
  status: string
  access_role: AccessRole
  badges: BadgeId[]
  is_admin: boolean
  can_manage_roles: boolean
  created_at: string | null
  updated_at: string | null
  boards: number
  active_boards: number
  sessions: number
  companion: CompanionDeviceStatus
}
type AdminBoard = {
  id: string
  date: string
  mode: Mode
  status: string
  seed?: string
  generation?: number
  generator_version?: string
  attempts_used: number
  max_attempts: number
  baseline_match_id: string | null
  locked_at: string | null
  expires_at: string | null
  created_at?: string | null
  contracts: Array<{
    id: string
    title: string
    metric: string
    operator?: string
    target: number
    reward_xp?: number
    difficulty?: string
    rarity?: string
    category?: string
    required_capabilities?: string[]
    generator_meta?: Record<string, unknown>
    status: string
    progress_current: number | null
    explanation: string | null
    bound_match_id: string | null
  }>
}
type AdminUserDetail = {
  user: AdminUserSummary
  adaptive_profiles: Record<Mode, AdaptiveProfile>
  boards: AdminBoard[]
  devices: Array<
    CompanionDeviceStatus & {
      id: string
      device_id: string
      created_at: string | null
      revoked_at: string | null
    }
  >
  evidence: Array<{
    match_id: string
    mode: string | null
    hero_id: number | null
    kills: number | null
    deaths: number | null
    assists: number | null
    hero_damage: number | null
    object_damage?: number | null
    healing?: number | null
    souls: number | null
    captured_at: string | null
  }>
  events: Array<{
    event_type: string
    match_id: string | null
    mode: string | null
    phase: string | null
    created_at: string | null
  }>
  matches: Array<{
    match_id: string
    mode: string
    provider: string
    is_final: boolean
    started_at: string | null
    ended_at: string | null
    duration_s: number | null
    hero_id: number | null
    won?: boolean | null
    kills: number | null
    deaths: number | null
    assists: number | null
    souls: number | null
    hero_damage: number | null
    object_damage?: number | null
    healing?: number | null
  }>
  jobs: AdminJob[]
  sessions: Array<{
    created_at: string | null
    last_seen_at: string | null
    expires_at: string | null
    admin_elevated: boolean
  }>
  rewards: Array<{
    id: string
    source_type: string
    source_id: string
    delta: number
    balance_after: number
    policy_version: string
    created_at: string | null
  }>
  audit: Array<{
    id: string
    action: string
    entity_type: string
    entity_id: string
    data: Record<string, unknown>
    created_at: string | null
  }>
}
type AdminJob = {
  id: string
  type: string
  status: string
  attempts: number
  max_attempts: number
  run_after: string | null
  locked_at?: string | null
  locked_by?: string | null
  last_error: string | null
  idempotency_key?: string
  payload?: Record<string, unknown>
  created_at: string | null
}
type AdminAudit = {
  id: string
  actor: string | null
  actor_user_id: string | null
  action: string
  entity_type: string
  entity_id: string
  data: Record<string, unknown>
  created_at: string | null
}
type AdminOutboxEvent = {
  id: string
  event_type: string
  aggregate_id: string
  state: "PENDING" | "RETRYING" | "DEAD_LETTER" | "PUBLISHED"
  attempts: number
  run_after: string | null
  published_at: string | null
  dead_lettered_at: string | null
  last_error: string | null
  payload: Record<string, unknown>
  created_at: string | null
}
type AdminMatch = {
  id: string
  match_id: string
  provider: string
  started_at: string | null
  ended_at: string | null
  duration_s: number | null
  mode: string
  mode_raw: string | null
  mode_confidence: string
  scoring_status: string
  is_final: boolean
  capabilities: string[]
  participants: number
  bound_contracts: number
  reviews: number
  created_at: string | null
}
type AdminMatchDetail = {
  match: AdminMatch
  participants: Array<Record<string, unknown>>
  contracts: Array<Record<string, unknown>>
  reviews: Array<Record<string, unknown>>
  companion_evidence: Array<Record<string, unknown>>
}
type AdminBoardRow = {
  board: AdminBoard
  user: {
    id: string
    display_name: string
    steam_id64: string
  }
}
type AdminBoardDetail = {
  board: AdminBoard
  user: {
    id: string
    display_name: string
    steam_id64: string
    account_id: number | null
  } | null
  options: Array<Record<string, unknown>>
  evaluations: Array<Record<string, unknown>>
  jobs: AdminJob[]
  reviews: Array<Record<string, unknown>>
}
type AdminCompanion = {
  id: string
  device_id: string
  user: {
    id: string
    display_name: string
    steam_id64: string
  }
  status: CompanionDeviceStatus
  created_at: string | null
  revoked_at: string | null
}
type AdminMission = {
  id: string
  key: string
  version: number
  title: string
  description: string
  title_en: string | null
  description_en: string | null
  metric: string
  operator: string
  target: number
  reward_xp: number
  base_xp: number
  difficulty: string
  rarity: string
  drop_weight: number
  drop_chance_pct: number
  category: string
  required_capabilities: string[]
  game_match_mode: Mode
  ranked_policy: string
  status: string
  safety_classification: string
  conditions?: ContractCondition[]
  fingerprint?: string
  generator_meta?: Record<string, unknown>
  created_at: string | null
  published_at: string | null
}
type AdminGeneratorPreview = {
  mode: Mode
  generator_version?: string
  boards: Array<{
    seed: string
    fingerprint: string
    contracts: AdminMission[]
  }>
  stats: {
    templates_available: number
    metrics_available?: number
    boards_generated: number
    unique_boards: number
    duplicate_boards: number
    contract_frequency: Array<{
      key: string
      count: number
      slot_pct: number
    }>
    categories: Record<string, number>
    rarities: Record<string, number>
    difficulties: Record<string, number>
    condition_counts?: Record<string, number>
  }
}
type AdminSystem = {
  release: Record<string, unknown>
  database: Record<string, unknown>
  provider: Record<string, unknown>
  contracts: Record<string, unknown>
  companion: Record<string, unknown>
  security: Record<string, unknown>
  limits: Record<string, unknown>
  counts: Record<string, number>
  server_time: string
}
type AdminSection =
  | "hero_votes"
  | "overview"
  | "users"
  | "reviews"
  | "bureau_reports"
  | "cards"
  | "packs"
  | "announcements"
  | "matches"
  | "boards"
  | "companions"
  | "missions"
  | "generator"
  | "jobs"
  | "outbox"
  | "audit"
  | "system"

const ADMIN_SECTION_PERMISSIONS: Record<AdminSection, string> = {
  hero_votes: "hero_votes.read",
  overview: "admin.overview.read",
  users: "users.read",
  reviews: "reviews.read",
  bureau_reports: "bureaus.moderate",
  cards: "cards.publish",
  packs: "packs.manage",
  announcements: "announcements.read",
  matches: "matches.read",
  boards: "boards.read",
  companions: "companions.read",
  missions: "missions.read",
  generator: "generator.preview",
  jobs: "jobs.read",
  outbox: "outbox.read",
  audit: "audit.read",
  system: "system.read",
}

const ADMIN_SECTION_ORDER: Array<[AdminSection, string]> = [
  ["overview", "Обзор"],
  ["users", "Игроки"],
  ["reviews", "Проверки"],
  ["bureau_reports", "Бюро игроков"],
  ["cards", "Карточки"],
  ["packs", "Конверты · OWNER"],
  ["announcements", "Уведомления"],
  ["hero_votes", "Голосование"],
  ["matches", "Матчи"],
  ["boards", "Дела"],
  ["companions", "Companion"],
  ["missions", "Контракты"],
  ["generator", "Generator Lab"],
  ["jobs", "Jobs"],
  ["outbox", "Outbox"],
  ["audit", "Аудит"],
  ["system", "Система"],
]

function hasAdminPermission(permissions: string[], permission: string) {
  return permissions.includes("*") || permissions.includes(permission)
}

function firstAdminSectionForPermissions(permissions: string[]): AdminSection {
  return (
    ADMIN_SECTION_ORDER.find(([key]) =>
      hasAdminPermission(permissions, ADMIN_SECTION_PERMISSIONS[key]),
    )?.[0] || "reviews"
  )
}

type CompanionDeviceStatus = {
  paired: boolean
  online: boolean
  game_running: boolean
  phase: string | null
  game_match_mode: Mode | "UNKNOWN" | null
  current_match_id: string | null
  last_seen_at: string | null
  identity_ok: boolean | null
  version: string | null
  gep_version: string | null
  label?: string
}
type CompanionAccountDevice = CompanionDeviceStatus & {
  id: string
  created_at: string | null
  revoked_at: string | null
}
type CompanionStatus = {
  device: CompanionDeviceStatus
  devices: CompanionAccountDevice[]
}
type CompanionPairing = {
  code: string
  expires_at: string
  server_url: string
}
type Tab =
  | "hero-votes"
  | "home"
  | "quests"
  | "active"
  | "history"
  | "profile"
  | "admin"
  | "leaderboard"
  | "achievements"
  | "bureaus"
  | "packs"
  | "collection"
type QuestFilter = "ALL" | "COMBAT" | "SUPPORT" | "ECONOMY" | "SURVIVAL"

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function api<T>(url: string, csrf: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  headers.set("Accept-Language", apiLanguage())
  if (init.body) headers.set("Content-Type", "application/json")
  if (!["GET", "HEAD"].includes((init.method || "GET").toUpperCase()))
    headers.set("X-CSRF-Token", csrf)
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
  })
  const data = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }))
  if (!response.ok) throw new ApiError(data.detail || `HTTP ${response.status}`, response.status)
  return data
}

const MODES: Mode[] = ["STANDARD", "RANKED", "STREET_BRAWL"]

function localizedContractTitle(
  item: { title: string; title_i18n?: Partial<Record<"ru" | "en", string>> },
  language: "ru" | "en",
) {
  return item.title_i18n?.[language] || contractTitle(item.title, language)
}

function localizedContractDescription(option: Option, mode: Mode, language: "ru" | "en") {
  const fallback = option.description_i18n?.[language] || option.description
  return contractDescription(
    mode,
    option.conditions?.length
      ? option.conditions
      : [{ metric: option.metric, operator: option.operator, target: option.target }],
    fallback,
    language,
  )
}

const MODE_META: Record<
  Mode,
  {
    short: string
    title: string
    caption: string
    bonus: string
  }
> = {
  STANDARD: {
    short: "STANDARD",
    title: "Standard",
    caption: "Базовая доска без влияния на рейтинг Deadlock",
    bonus: "XP ×1.00",
  },
  RANKED: {
    short: "RANKED",
    title: "Ranked",
    caption: "Контракты без условий, которые мешают командной игре",
    bonus: "XP ×1.20",
  },
  STREET_BRAWL: {
    short: "STREET BRAWL",
    title: "Street Brawl",
    caption: "Короткие контракты, настроенные под быстрый режим",
    bonus: "XP ×0.78",
  },
}
const DIFFICULTY_LABEL: Record<string, string> = {
  LIGHT: "LIGHT",
  FOCUSED: "FOCUSED",
  HARD: "HARD",
  EXTREME: "EXTREME",
}
const RARITY_LABEL: Record<string, string> = {
  COMMON: "COMMON",
  UNCOMMON: "UNCOMMON",
  RARE: "RARE",
  EPIC: "EPIC",
}
const STATUS_LABELS: Record<string, string> = {
  OFFERED: "ДОСКА ОТКРЫТА",
  LOCKED: "ОЖИДАЕТ МАТЧ",
  VERIFYING: "ПОЛУЧАЕМ ДАННЫЕ",
  REVIEW_REQUIRED: "УТОЧНЯЕМ ДАННЫЕ",
  SETTLED: "ЗАКРЫТО",
  COMPLETED: "ВЫПОЛНЕНО",
  VOID: "АННУЛИРОВАНО",
  FAILED: "ПРОВАЛЕНО",
  EXPIRED: "СРОК ИСТЁК",
  SKIPPED: "НЕ ВЫБРАНО",
  PENDING: "ОЖИДАЕТ РЕШЕНИЯ",
  RESOLVED: "РЕШЕНО",
  REJECTED: "ОТКЛОНЕНО",
}
const statusLabel = (value: string, language: Language = "ru") =>
  t(language, STATUS_LABELS[value] || value)
const fmt = (value?: string | null, language: Language = "ru") =>
  value
    ? new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—"
const number = (value: number, language: Language = "ru") =>
  new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value)
const operatorSymbol = (value?: string) => (value === "lte" ? "≤" : value === "eq" ? "=" : "≥")
const targetLabel = (option: Option, language: Language = "ru") => {
  if ((option.conditions?.length || 0) > 1)
    return `${option.conditions!.length} ${language === "ru" ? "условия" : "conditions"}`
  return conditionText(
    {
      metric: option.metric,
      operator: option.operator,
      target: Number(option.target),
    },
    language,
  )
}
const expiryLabel = (value?: string, now = Date.now(), language: Language = "ru") => {
  if (!value) return t(language, "ОБНОВЛЕНИЕ УТОЧНЯЕТСЯ")
  const diff = new Date(value).getTime() - now
  if (diff <= 0) return t(language, "ДОСКА ОБНОВЛЯЕТСЯ")
  const mins = Math.ceil(diff / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const prefix = t(language, "ОБНОВЛЕНИЕ ЧЕРЕЗ")
  return h
    ? `${prefix} ${h}${
        language === "ru" ? "Ч" : "H"
      } ${String(m).padStart(2, "0")}${language === "ru" ? "М" : "M"}`
    : `${prefix} ${m}${language === "ru" ? "М" : "M"}`
}
const countdownHms = (value?: string | null, now = Date.now()) => {
  if (!value) return "—"

  const diff = new Date(value).getTime() - now

  if (diff <= 0) return "00:00:00"

  const seconds = Math.floor(diff / 1000)

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(secs).padStart(2, "0"),
  ].join(":")
}

const safeName = (value: string, language: Language = "ru") =>
  /^Steam \d{17,20}$/.test(value) ? (language === "ru" ? "Steam-профиль" : "Steam profile") : value
const categoryGlyph = (value: string) => (
  <SvgIcon
    name={
      (
        {
          COMBAT: "swords",
          SUPPORT: "heart-handshake",
          ECONOMY: "coins",
          SURVIVAL: "shield",
          ALL: "layers",
        } as Record<string, IconName>
      )[value] || "layers"
    }
  />
)
const categoryLabel = (value: string, language: Language = "ru") =>
  t(
    language,
    {
      COMBAT: "Бой",
      SUPPORT: "Поддержка",
      ECONOMY: "Экономика",
      SURVIVAL: "Выживание",
      ALL: "Все",
    }[value] || value,
  )
const BADGE_META: Record<
  BadgeId,
  {
    label: string
    className: string
    icon: "crown" | "shield" | "gear" | "stream" | "flask" | "star" | "player"
  }
> = {
  CREATOR: { label: "CREATOR", className: "creator", icon: "crown" },
  ADMIN: { label: "ADMIN", className: "admin", icon: "shield" },
  DEVELOPER: { label: "DEVELOPER", className: "developer", icon: "gear" },
  STREAMER: { label: "STREAMER", className: "streamer", icon: "stream" },
  EARLY_TESTER: {
    label: "EARLY TESTER",
    className: "early-tester",
    icon: "star",
  },
  TESTER: { label: "TESTER", className: "tester", icon: "flask" },
  CONTRIBUTOR: { label: "CONTRIBUTOR", className: "contributor", icon: "star" },
  PLAYER: { label: "PLAYER", className: "player", icon: "player" },
}

function RoleIcon({
  name,
}: {
  name: "crown" | "shield" | "gear" | "stream" | "flask" | "star" | "player"
}) {
  const icons = {
    crown: "crown",
    shield: "shield-check",
    gear: "settings",
    stream: "video",
    flask: "flask-conical",
    star: "star",
    player: "user-round",
  } as const
  return <SvgIcon name={icons[name]} className="dc-role-icon" />
}

function RoleBadge({ badge, compact = false }: { badge: BadgeId; compact?: boolean }) {
  const meta = BADGE_META[badge]
  return (
    <span className={`dc-role-badge ${meta.className} ${compact ? "compact" : ""}`}>
      <RoleIcon name={meta.icon} />
      <span>{meta.label}</span>
    </span>
  )
}

function RoleBadgeList({
  badges,
  compact = false,
}: {
  badges?: BadgeId[] | null
  compact?: boolean
}) {
  if (!badges?.length) return null
  return (
    <div className={`dc-role-badges ${compact ? "compact" : ""}`}>
      {badges.map((badge) => (
        <RoleBadge key={badge} badge={badge} compact={compact} />
      ))}
    </div>
  )
}

const joinLabel = (value?: string | null, language: Language = "ru") =>
  value
    ? new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
        month: "long",
        year: "numeric",
      }).format(new Date(value))
    : "—"

function Icon({ name }: { name: "hq" | "contract" | "case" | "profile" | "admin" }) {
  const icons = {
    hq: "house",
    contract: "file-text",
    case: "briefcase-business",
    profile: "user-round",
    admin: "shield-check",
  } as const
  return <SvgIcon name={icons[name]} className="dc-icon" />
}

function ModeTabs({
  value,
  onChange,
  boards,
  emptyLabel,
}: {
  value: Mode
  onChange: (mode: Mode) => void
  boards: Board[]
  emptyLabel: string
}) {
  const { language } = useLanguage()
  return (
    <ModeSelector
      value={value}
      onChange={onChange}
      statuses={Object.fromEntries(
        MODES.map((mode) => {
          const board = boards.find((item) => item.game_match_mode === mode)
          return [mode, board ? statusLabel(board.status, language) : emptyLabel]
        }),
      )}
    />
  )
}

export default function Dashboard({ initialSession }: { initialSession: SessionPayload }) {
  const { language, locale } = useLanguage()
  const heroVotes = useHeroVotes()
  const [user, setUser] = useState(initialSession.user)
  const [archiveRevision, setArchiveRevision] = useState(0)
  const [csrf] = useState(initialSession.csrf_token)
  const tabFromLocation = (): Tab => {
    const hash = window.location.hash.slice(1).split("/")[0]
    if (hash === "leaderboards") return "leaderboard"
    if (["archive", "studio", "wallet", "cipher", "catalog", "catalogue"].includes(hash))
      return "collection"
    if (hash === "arena") return "quests"
    if (
      [
        "home",
        "quests",
        "active",
        "history",
        "profile",
        "achievements",
        "bureaus",
        "leaderboard",
        "hero-votes",
        "packs",
        "collection",
        "admin",
      ].includes(hash)
    )
      return hash as Tab
    return window.location.pathname.startsWith("/admin/") ? "admin" : "home"
  }
  const [tab, setTabState] = useState<Tab>(tabFromLocation)
  const { items: announcements } = useAnnouncements()
  const [guideOpen, setGuideOpen] = useState(
    () => tabFromLocation() === "home" && !hasSeenGuide(initialSession.user.id),
  )
  const closeGuide = () => {
    rememberGuide(user.id)
    setGuideOpen(false)
  }
  const [bureauSlug, setBureauSlug] = useState(
    () => window.location.hash.match(/^#bureaus\/([a-z0-9-]{3,32})$/)?.[1] || "",
  )
  const setTab = useCallback((next: Tab) => {
    setTabState(next)
    window.location.hash = next === "leaderboard" ? "leaderboards" : next
    window.scrollTo({ top: 0, behavior: "instant" })
  }, [])
  const openBureau = (slug: string) => {
    setTabState("bureaus")
    setBureauSlug(slug)
    window.location.hash = slug ? `bureaus/${slug}` : "bureaus"
    window.scrollTo({ top: 0, behavior: "instant" })
  }
  useEffect(() => {
    const apply = () => {
      const next = tabFromLocation()
      setTabState(next)
      if (
        ["archive", "studio", "wallet", "cipher", "catalog", "catalogue", "arena"].includes(
          window.location.hash.slice(1).split("/")[0],
        )
      )
        window.history.replaceState(null, "", `#${next}`)
      setBureauSlug(window.location.hash.match(/^#bureaus\/([a-z0-9-]{3,32})$/)?.[1] || "")
      window.scrollTo({ top: 0, behavior: "instant" })
    }
    apply()
    window.addEventListener("hashchange", apply)
    return () => window.removeEventListener("hashchange", apply)
  }, [])
  const [mode, setMode] = useState<Mode>("STANDARD")
  const [filter, setFilter] = useState<QuestFilter>("ALL")
  const [boardsPayload, setBoardsPayload] = useState<BoardsPayload | null>(null)
  const [boardsLoading, setBoardsLoading] = useState(true)
  const [boardsError, setBoardsError] = useState(false)
  const [historyCases, setHistoryCases] = useState<HistoryCase[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [progression, setProgression] = useState<Progression | null>(null)
  const [refreshingSteam, setRefreshingSteam] = useState(false)
  const [progressRevision, setProgressRevision] = useState(0)
  const [reviews, setReviews] = useState<ReviewMine[]>([])
  const [selected, setSelected] = useState<Record<Mode, Set<string>>>({
    STANDARD: new Set(),
    RANKED: new Set(),
    STREET_BRAWL: new Set(),
  })
  const [historyMode, setHistoryMode] = useState<"ALL" | Mode>("ALL")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [clock, setClock] = useState(Date.now())
  const [signing, setSigning] = useState<{ board: Board; selection: SigningSelection } | null>(null)
  const [companion, setCompanion] = useState<CompanionDeviceStatus | null>(null)
  const [companionDevices, setCompanionDevices] = useState<CompanionAccountDevice[]>([])
  const [pairing, setPairing] = useState<CompanionPairing | null>(null)
  const boardsRequest = useRef(0)
  const historyRequest = useRef(0)
  const historyPages = useRef(1)
  const historyMorePending = useRef(false)
  const xpRef = useRef<HTMLSpanElement>(null)
  const ripple = useRipple()
  const history = useMemo(
    () => historyCases.flatMap((historyCase) => historyCase.items),
    [historyCases],
  )
  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    if (user.locale === language && user.timezone === timezone) return
    void api<{ user: User }>("/api/preferences", csrf, {
      method: "PATCH",
      body: JSON.stringify({ locale: language, timezone }),
    })
      .then((payload) => setUser(payload.user))
      .catch(() => undefined)
  }, [csrf, language, user.locale, user.timezone])

  const loadBoards = useCallback(async () => {
    const request = ++boardsRequest.current
    setBoardsLoading(true)
    try {
      const data = await api<BoardsPayload>("/api/boards/today", csrf)
      if (request !== boardsRequest.current) return
      setBoardsPayload(data)
      setBoardsError(false)
      setSelected((previous) => {
        const next = { ...previous }
        for (const board of data.boards) {
          const locked = board.options
            .filter((option) => option.selected)
            .map((option) => option.id)
          if (locked.length || board.status !== "OFFERED") {
            next[board.game_match_mode] = new Set(locked)
          } else {
            const currentOptionIds = new Set(board.options.map((option) => option.id))
            next[board.game_match_mode] = new Set(
              [...previous[board.game_match_mode]].filter((id) => currentOptionIds.has(id)),
            )
          }
        }
        return next
      })
    } catch {
      // A stale response must not overwrite a newer board or its feedback.
      if (request === boardsRequest.current) setBoardsError(true)
    } finally {
      if (request === boardsRequest.current) setBoardsLoading(false)
    }
  }, [csrf])
  const loadHistory = useCallback(async () => {
    if (historyMorePending.current) return
    const request = ++historyRequest.current
    const pages = await Promise.all(
      Array.from({ length: historyPages.current }, (_, page) =>
        api<{ cases: HistoryCase[]; total: number }>(
          `/api/history?limit=100&offset=${page * 100}`,
          csrf,
        ),
      ),
    )
    if (request !== historyRequest.current) return
    setHistoryCases([
      ...new Map(pages.flatMap((page) => page.cases).map((item) => [item.board_id, item])).values(),
    ])
    setHistoryTotal(pages[0].total)
  }, [csrf])
  const loadMoreHistory = useCallback(async () => {
    if (historyMorePending.current) return
    historyMorePending.current = true
    const request = ++historyRequest.current
    try {
      const data = await api<{ cases: HistoryCase[]; total: number }>(
        `/api/history?limit=100&offset=${historyCases.length}`,
        csrf,
      )
      if (request !== historyRequest.current) return
      historyPages.current = Math.max(
        historyPages.current,
        Math.ceil((historyCases.length + data.cases.length) / 100),
      )
      setHistoryCases((current) => [
        ...current,
        ...data.cases.filter(
          (next) => !current.some((existing) => existing.board_id === next.board_id),
        ),
      ])
      setHistoryTotal(data.total)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      historyMorePending.current = false
    }
  }, [csrf, historyCases.length])
  const loadProgression = useCallback(
    async () => setProgression(await api<Progression>("/api/progression", csrf)),
    [csrf],
  )
  const loadReviews = useCallback(
    async () => setReviews((await api<{ items: ReviewMine[] }>("/api/reviews/mine", csrf)).items),
    [csrf],
  )
  const loadCompanion = useCallback(async () => {
    const status = await api<CompanionStatus>("/api/companion/status", csrf)
    setCompanion(status.device)
    setCompanionDevices(status.devices.filter((device) => !device.revoked_at))
  }, [csrf])
  const reloadAll = useCallback(async () => {
    try {
      await Promise.all([
        loadBoards(),
        loadHistory(),
        loadProgression(),
        loadReviews(),
        loadCompanion(),
      ])
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setProgressRevision((value) => value + 1)
    }
  }, [loadBoards, loadHistory, loadProgression, loadReviews, loadCompanion])

  useEffect(() => {
    void reloadAll()
  }, [reloadAll])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadCompanion()
    }, 15000)
    return () => clearInterval(timer)
  }, [loadCompanion])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void reloadAll()
    }
    const timer = window.setInterval(refresh, 20_000)
    window.addEventListener("online", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("online", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [reloadAll])
  useEffect(() => {
    const resetAt = Date.parse(boardsPayload?.refresh.reset_at || "")
    if (!Number.isFinite(resetAt)) return
    const delay = Math.max(250, Math.min(resetAt - Date.now() + 1_000, 2_147_000_000))
    const timer = window.setTimeout(() => void reloadAll(), delay)
    return () => window.clearTimeout(timer)
  }, [boardsPayload?.refresh.reset_at, reloadAll])

  const boards = boardsPayload?.boards || []
  const board = boards.find((item) => item.game_match_mode === mode) || null
  const selectedSet = selected[mode]
  const selectedOptions =
    board?.options.filter((option) => selectedSet.has(option.id) || option.selected) || []
  const totalXp = selectedOptions.reduce((sum, option) => sum + option.reward_xp, 0)
  const visibleOptions =
    board?.options.filter((option) => filter === "ALL" || option.category === filter) || []
  const pendingReviewForBoard = reviews.find(
    (item) => item.board_id === board?.id && item.status === "PENDING",
  )
  const activeBoards = boards.filter(
    (item) =>
      ["LOCKED", "VERIFYING", "REVIEW_REQUIRED"].includes(item.status) &&
      item.options.some((option) => option.selected),
  )
  const readyCases = historyCases.filter(canShowCompletion).slice(0, 6)

  useEffect(() => {
    if (!xpRef.current) return
    xpRef.current.classList.remove("xp-pop")
    void xpRef.current.offsetWidth
    xpRef.current.classList.add("xp-pop")
  }, [totalXp, mode])

  const toggle = (id: string) => {
    if (!board || board.status !== "OFFERED") return
    setSelected((previous) => {
      const current = new Set(previous[mode])
      if (current.has(id)) current.delete(id)
      else if (current.size >= 3) {
        setNotice(t(language, "В одно дело можно выбрать максимум три контракта."))
        return previous
      } else current.add(id)
      return { ...previous, [mode]: current }
    })
  }
  const openSigning = () => {
    if (!board || board.status !== "OFFERED" || selectedSet.size < 1 || busy) return
    setSigning({
      board,
      selection: {
        boardId: board.id,
        generation: board.generation,
        mode,
        optionIds: [...selectedSet],
      },
    })
  }
  const openGoalSigning = (recommendation: GoalRecommendation) => {
    const offered = boards.find((item) => item.game_match_mode === recommendation.mode)
    if (
      busy ||
      signing ||
      !offered ||
      offered.status !== "OFFERED" ||
      offered.id !== recommendation.boardId ||
      offered.generation !== recommendation.generation ||
      !offered.options.some(
        (option) =>
          option.id === recommendation.optionId && option.status === "OFFERED" && !option.selected,
      )
    ) {
      setNotice(
        language === "ru"
          ? "Предложение изменилось. Обновите данные перед выбором цели."
          : "The offer changed. Refresh the data before choosing a goal.",
      )
      return false
    }
    setSigning({
      board: offered,
      selection: {
        boardId: offered.id,
        generation: offered.generation,
        mode: recommendation.mode,
        optionIds: [recommendation.optionId],
      },
    })
    return true
  }
  const lock = async () => {
    if (!signing) throw new Error("No signing selection")
    const { selection } = signing
    const result = await signSelection<Board>(
      selection,
      async () => {
        const data = await api<BoardsPayload>("/api/boards/today", csrf, {
          signal: AbortSignal.timeout(15_000),
        })
        const current = data.boards.find((item) => item.game_match_mode === selection.mode)
        return current && { ...current, server_time: data.server_time }
      },
      () =>
        api<Board>("/api/board/today/lock", csrf, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({ option_ids: selection.optionIds, mode: selection.mode }),
        }),
    )
    boardsRequest.current++
    setBoardsLoading(false)
    setBoardsError(false)
    // Update directly from the authoritative response. A failed background refresh
    // must never turn a successful signature into a failed one.
    setBoardsPayload(
      (current) =>
        current && {
          ...current,
          boards: current.boards.map((item) =>
            item.game_match_mode === result.game_match_mode ? result : item,
          ),
        },
    )
    setSelected((current) => ({
      ...current,
      [result.game_match_mode]: new Set(
        result.options.filter((option) => option.selected).map((option) => option.id),
      ),
    }))
    return result
  }
  const reroll = async () => {
    if (!board || board.status !== "OFFERED" || !boardsPayload?.refresh.remaining) return
    if (
      !confirm(
        language === "ru"
          ? `Пересобрать все 6 контрактов режима «${MODE_META[mode].title}»? Бесплатная пересборка одна на весь день.`
          : `Reroll all 6 ${MODE_META[mode].title} contracts? You get one free reroll per day.`,
      )
    )
      return
    setBusy(true)
    setError("")
    try {
      await api(`/api/boards/${mode}/reroll`, csrf, { method: "POST" })
      setSelected((previous) => ({ ...previous, [mode]: new Set() }))
      setNotice(t(language, "Доска пересобрана. Бесплатная пересборка на сегодня использована."))
      await reloadAll()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const refreshSteamProfile = async () => {
    if (refreshingSteam) return
    setRefreshingSteam(true)
    setError("")
    try {
      const data = await api<{ user: User }>("/api/profile/refresh", csrf, { method: "POST" })
      setUser(data.user)
      await loadProgression()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setRefreshingSteam(false)
    }
  }

  const startCompanionPairing = async () => {
    try {
      const data = await api<CompanionPairing>("/api/companion/pairing/start", csrf, {
        method: "POST",
      })
      setPairing(data)
      setNotice(t(language, "Код привязки создан. Введите его в Компаньоне Deadlock Contracts."))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  const revokeCompanion = async () => {
    if (!confirm(t(language, "Отключить все привязанные устройства Компаньона?"))) return
    try {
      await api("/api/companion/revoke", csrf, { method: "POST" })
      setPairing(null)
      await loadCompanion()
      setNotice(t(language, "Компаньон отключён от аккаунта."))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  const revokeCompanionDevice = async (device: CompanionAccountDevice) => {
    if (
      !confirm(
        language === "ru"
          ? `Отключить устройство «${device.label || "Companion"}»?`
          : `Disconnect “${device.label || "Companion"}”?`,
      )
    )
      return
    try {
      await api(`/api/companion/devices/${device.id}/revoke`, csrf, { method: "POST" })
      await loadCompanion()
      setNotice(language === "ru" ? "Устройство отключено." : "Device disconnected.")
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const historyStats = useMemo(
    () => ({
      completed: history.filter((item) => item.status === "COMPLETED").length,
      failed: history.filter((item) => item.status === "FAILED").length,
      earned: history
        .filter((item) => item.status === "COMPLETED")
        .reduce((sum, item) => sum + Number(item.reward_granted_xp || 0), 0),
    }),
    [history],
  )
  const caseGroups = useMemo(() => {
    return historyCases
      .filter((historyCase) => historyMode === "ALL" || historyCase.game_match_mode === historyMode)
      .map((historyCase) => ({
        boardId: historyCase.board_id,
        completionReady: canShowCompletion(historyCase),
        status: historyCase.status,
        items: historyCase.items,
        mode: historyCase.game_match_mode,
        matchId:
          historyCase.items.find((item) => item.match_id)?.match_id ||
          historyCase.items.find((item) => item.last_attempt_match_id)?.last_attempt_match_id ||
          null,
        attemptsUsed: historyCase.attempts_used || 0,
        maxAttempts: historyCase.max_attempts,
        date: historyCase.settled_at || historyCase.locked_at,
      }))
  }, [historyCases, historyMode])

  const shownName = safeName(user.display_name, language)
  const level = progression?.level || 1
  const pageLabels: Record<string, string> =
    language === "ru"
      ? {
          home: "Обзор",
          quests: "Контракты",
          active: "Активное дело",
          history: "История дел",
          collection: "Моя коллекция",
          packs: "Ежедневный конверт",
          bureaus: "Сообщества",
          achievements: "Достижения",
          leaderboard: "Рейтинг",
          "hero-votes": "Голосование",
          profile: "Профиль",
          admin: "Управление",
        }
      : {
          home: "Overview",
          quests: "Contracts",
          active: "Active case",
          history: "Case history",
          collection: "My collection",
          packs: "Daily pack",
          bureaus: "Communities",
          achievements: "Achievements",
          leaderboard: "Leaderboard",
          "hero-votes": "Hero votes",
          profile: "Profile",
          admin: "Staff console",
        }
  const nav: Array<[Tab, string, "hq" | "contract" | "case" | "profile" | "admin"]> = [
    ["home", language === "ru" ? "ГЛАВНАЯ" : "HOME", "hq"],
    ["quests", language === "ru" ? "КОНТРАКТЫ" : "CONTRACTS", "contract"],
    ["active", language === "ru" ? "АКТИВНОЕ ДЕЛО" : "ACTIVE CASE", "case"],
    ["history", language === "ru" ? "ИСТОРИЯ ДЕЛ" : "CASE HISTORY", "case"],
    ["collection", language === "ru" ? "КОЛЛЕКЦИЯ" : "COLLECTION", "case"],
    ["packs", language === "ru" ? "ЕЖЕДНЕВНЫЙ КОНВЕРТ" : "DAILY PACK", "case"],
    ["achievements", language === "ru" ? "ДОСТИЖЕНИЯ" : "ACHIEVEMENTS", "case"],
    ["bureaus", language === "ru" ? "СООБЩЕСТВА" : "COMMUNITIES", "hq"],
    ["leaderboard", language === "ru" ? "РЕЙТИНГ" : "LEADERBOARD", "case"],
    ["profile", language === "ru" ? "ПРОФИЛЬ" : "PROFILE", "profile"],
  ]
  if (user.is_staff) nav.push(["admin", "ADMIN", "admin"])
  if (heroVotes.data?.enabled)
    nav.splice(nav.length - (user.is_staff ? 1 : 0), 0, [
      "hero-votes",
      language === "ru" ? "ГОЛОСОВАНИЕ" : "HERO VOTES",
      "hq",
    ])

  return (
    <CompletionProvider
      key={user.id}
      className="dc-dashboard dc-redesign dc-v3 dc-vnext bureau-app ns-private ritual-workspace min-h-screen community-dashboard"
    >
      <BureauAtmosphere />
      {guideOpen && !signing && !announcements.some((item) => item.presentation === "MODAL") && (
        <BureauGuide
          onClose={closeGuide}
          onNavigate={(next) => {
            closeGuide()
            setTab(next)
          }}
        />
      )}
      {signing && (
        <ContractSigning
          key={user.id}
          mode={MODE_META[signing.board.game_match_mode].title}
          operator={shownName}
          accountId={user.id}
          options={signing.board.options
            .filter((option) => signing.selection.optionIds.includes(option.id))
            .map((option) => ({
              id: option.id,
              title: localizedContractTitle(option, language),
              description: localizedContractDescription(
                option,
                signing.board.game_match_mode,
                language,
              ),
              reward: option.reward_xp,
            }))}
          changed={
            selectionState(
              signing.selection,
              boards.find((item) => item.game_match_mode === signing.selection.mode),
              boardsPayload?.server_time,
            ) === "changed"
          }
          onSign={lock}
          onClose={() => {
            setSigning(null)
            void reloadAll()
          }}
          onOpenCase={() => {
            setSigning(null)
            setTab("active")
            void reloadAll()
          }}
        />
      )}
      <BureauHeader
        breadcrumb={pageLabels[tab]}
        onHelp={() => setGuideOpen(true)}
        active={tab}
        mobileItems={Object.entries(pageLabels)
          .filter(([id]) => id !== "admin" || user.is_staff)
          .filter(([id]) => id !== "hero-votes" || heroVotes.data?.enabled)
          .map(([id, label]) => ({ id, label }))}
        items={nav
          .filter(([id]) => !["profile", "active", "history", "achievements"].includes(id))
          .map(([id, label]) => ({ id, label }))}
        onNavigate={(id) => setTab(id as Tab)}
        mobileActions={
          <button
            type="button"
            onClick={() =>
              api("/api/auth/logout", csrf, { method: "POST" }).finally(() => location.assign("/"))
            }
          >
            {t(language, "Выйти из аккаунта")}
          </button>
        }
        actions={
          <>
            <button
              className={`dc-companion-chip ${
                companion?.online ? "online" : companion?.paired ? "paired" : ""
              }`}
              type="button"
              onClick={() => setTab("profile")}
              title={language === "ru" ? "Состояние Компаньона" : "Companion status"}
            >
              <i />
              <span>
                {companion?.online
                  ? companion.game_running
                    ? language === "ru"
                      ? "В ИГРЕ"
                      : "IN GAME"
                    : language === "ru"
                      ? "В СЕТИ"
                      : "ONLINE"
                  : companion?.paired
                    ? language === "ru"
                      ? "НЕ В СЕТИ"
                      : "OFFLINE"
                    : language === "ru"
                      ? "КОМПАНЬОН"
                      : "COMPANION"}
              </span>
            </button>
            <AccountMenu
              user={{ ...user, xp: progression?.total_xp ?? user.xp }}
              level={level}
              csrf={csrf}
              revision={archiveRevision}
              onOpenGuide={() => setGuideOpen(true)}
              onNavigate={(next) => setTab(next as Tab)}
            />
          </>
        }
      />

      <NightshiftNav
        active={tab}
        staff={user.is_staff}
        votesEnabled={Boolean(heroVotes.data?.enabled)}
        user={user}
        level={level}
        onNavigate={(next) => setTab(next as Tab)}
      />
      <BureauBottomNav active={tab} onNavigate={(next) => setTab(next as Tab)} />

      <div className="dc-app-shell dc-app-shell-topnav">
        <main className="dc-workspace">
          <div className="bureau-location">
            <span>
              {language === "ru" ? "КАБИНЕТ ИГРОКА" : "PLAYER WORKSPACE"} / <b>{pageLabels[tab]}</b>
            </span>
            <button type="button" onClick={() => setGuideOpen(true)}>
              {language === "ru" ? "Как это работает?" : "How does it work?"}
            </button>
          </div>
          {notice && (
            <button type="button" className="dc-toast" onClick={() => setNotice("")}>
              {notice}
            </button>
          )}
          {error && (
            <button type="button" className="dc-error" onClick={() => setError("")}>
              {localizeServerText(error, language)}
            </button>
          )}

          {boardsError && tab !== "quests" && (
            <button type="button" className="dc-error" onClick={() => void loadBoards()}>
              {language === "ru"
                ? "Не удалось загрузить доску. Повторить загрузку"
                : "Could not load the board. Retry loading"}
            </button>
          )}

          {tab === "home" && (
            <>
              <section className="ns-home-heading">
                <div>
                  <p className="ns-eyebrow">
                    {language === "ru"
                      ? "DEADLOCK CONTRACTS / ЛИЧНЫЙ КАБИНЕТ"
                      : "DEADLOCK CONTRACTS / YOUR WORKSPACE"}
                  </p>
                  <h1>
                    {language === "ru" ? "На связи, " : "Welcome back, "}
                    {shownName}
                  </h1>
                  <p>
                    {language === "ru"
                      ? "Выбирай контракты. Играй матчи. Собирай карточки."
                      : "Choose contracts. Play matches. Collect cards."}
                  </p>
                </div>
                <button className="dc-ghost" onClick={() => setTab("profile")}>
                  <SvgIcon name="video" size={18} /> Companion{" "}
                  <SvgIcon name="arrow-up-right" size={16} />
                </button>
              </section>
              <PersonalProgress
                accountId={user.id}
                mode={mode}
                currentBoard={board}
                reloadKey={`${progressRevision}:${board?.id || ""}:${board?.generation ?? ""}:${board?.status || ""}`}
                onModeChange={(next) => {
                  setMode(next)
                  setFilter("ALL")
                }}
                onRecommend={openGoalSigning}
                onRefresh={reloadAll}
                onOpenCase={() => setTab("active")}
                activeCaseCount={activeBoards.length}
                modeStatuses={Object.fromEntries(
                  boards.map((item) => [item.game_match_mode, statusLabel(item.status, language)]),
                )}
              />
              <section className="ritual-account-summary">
                <div>
                  <small>{language === "ru" ? "ТВОЙ ПРОГРЕСС" : "YOUR PROGRESS"}</small>
                  <strong>
                    {language === "ru" ? "Уровень" : "Level"} {level}
                  </strong>
                  <span>
                    {(progression?.total_xp ?? user.xp).toLocaleString(locale)} XP ·{" "}
                    {language === "ru" ? "всего" : "total"}
                  </span>
                </div>
                <div>
                  <small>{language === "ru" ? "ДО СЛЕДУЮЩЕГО УРОВНЯ" : "TO NEXT LEVEL"}</small>
                  <strong>{progression?.xp_to_next ?? "—"} XP</strong>
                  <progress
                    value={progression?.progress_pct ?? 0}
                    max="100"
                    aria-label={language === "ru" ? "Прогресс уровня" : "Level progress"}
                  />
                </div>
                <button className="dc-ghost" onClick={() => setTab("profile")}>
                  {language === "ru" ? "Открыть профиль" : "Open profile"}
                  <SvgIcon name="arrow-up-right" size={18} />
                </button>
              </section>
              <ArchiveNextStep revision={archiveRevision} onNavigate={(next) => setTab(next)} />
            </>
          )}

          {tab === "quests" && (
            <div className="dc-motion-contract-scene dc-contract-dossier">
              <section className="dc-work-head dc-page-head dc-v3-quest-head dc-motion-contract-head">
                <div>
                  <h1>{language === "ru" ? "Доска контрактов" : "Contract board"}</h1>
                  <p className="dc-board-intro">
                    {language === "ru"
                      ? "Выберите до трёх контрактов и подпишите дело перед матчем."
                      : "Choose up to three contracts and sign your case before a match."}
                  </p>
                  <details className="dc-board-rules">
                    <summary>
                      {language === "ru" ? "Правила выполнения" : "How contracts work"}
                    </summary>
                    <p>
                      {language === "ru"
                        ? "Шесть контрактов на режим. Выберите до трёх. Каждый контракт выполняется целиком в одном подходящем матче; прогресс между матчами не суммируется."
                        : "Six contracts per mode. Choose up to three. Each contract must be completed within one eligible match; progress does not add up across matches."}
                      {board &&
                        (language === "ru"
                          ? ` Лимит матчей для этого дела: ${board.max_attempts}.`
                          : ` Match limit for this case: ${board.max_attempts}.`)}
                    </p>
                  </details>
                </div>
                <div className="dc-motion-head-controls">
                  <ModeTabs
                    value={mode}
                    onChange={(next) => {
                      setMode(next)
                      setFilter("ALL")
                    }}
                    boards={boards}
                    emptyLabel={
                      boardsLoading && !boardsPayload
                        ? t(language, "ЗАГРУЗКА")
                        : language === "ru"
                          ? "Нет доски"
                          : "No board"
                    }
                  />
                  <div className="dc-v3-reroll-box dc-motion-reroll">
                    <span>{language === "ru" ? "Обновление доски" : "Board refresh"}</span>
                    <strong>
                      {boardsPayload
                        ? `${boardsPayload.refresh.remaining}/${boardsPayload.refresh.free_per_day}`
                        : "—"}
                    </strong>
                    <button
                      type="button"
                      className="dc-ghost btn-ghost"
                      disabled={
                        !board ||
                        board.status !== "OFFERED" ||
                        !boardsPayload?.refresh.remaining ||
                        busy
                      }
                      onClick={() => void reroll()}
                    >
                      {language === "ru" ? "Обновить 6 контрактов" : "Refresh 6 contracts"}
                    </button>
                  </div>
                </div>
              </section>

              {boardsError && (
                <section className="dc-board-feedback dc-board-feedback-error" role="alert">
                  <SvgIcon name="triangle-alert" />
                  <div>
                    <strong>
                      {language === "ru"
                        ? "Не удалось загрузить доску"
                        : "Could not load the board"}
                    </strong>
                    <p>
                      {boardsPayload
                        ? language === "ru"
                          ? "Показаны последние полученные данные. Ваш выбор сохранён."
                          : "Showing the last loaded board. Your selection is preserved."
                        : language === "ru"
                          ? "Проверьте соединение и повторите загрузку."
                          : "Check your connection and try again."}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="dc-ghost"
                    disabled={boardsLoading}
                    onClick={() => void loadBoards()}
                  >
                    {language === "ru" ? "Повторить загрузку" : "Retry loading"}
                  </button>
                </section>
              )}
              {!boardsPayload && boardsLoading && !boardsError && (
                <section className="dc-board-feedback" role="status">
                  <SvgIcon name="hourglass" />
                  <div>
                    <strong>
                      {language === "ru" ? "Загружаем контракты…" : "Loading contracts…"}
                    </strong>
                    <p>
                      {language === "ru"
                        ? "Получаем актуальную доску и доступные обновления."
                        : "Fetching your current board and available refreshes."}
                    </p>
                  </div>
                </section>
              )}
              {boardsPayload && !board && (
                <section className="dc-board-feedback" role="status">
                  <SvgIcon name="layers" />
                  <div>
                    <strong>
                      {language === "ru"
                        ? "Для этого режима пока нет доски"
                        : "No board for this mode yet"}
                    </strong>
                    <p>
                      {language === "ru"
                        ? "Выберите другой режим или загрузите данные повторно."
                        : "Choose another mode or reload the board."}
                    </p>
                  </div>
                  {!boardsError && (
                    <button
                      type="button"
                      className="dc-ghost"
                      disabled={boardsLoading}
                      onClick={() => void loadBoards()}
                    >
                      {language === "ru" ? "Повторить загрузку" : "Retry loading"}
                    </button>
                  )}
                </section>
              )}

              {board && (
                <>
                  <section key={`${mode}-${board.generation}`} className="dc-motion-mode-note">
                    <small>{t(language, MODE_META[mode].caption)}</small>
                    <em>{MODE_META[mode].bonus}</em>
                  </section>

                  <VerificationContext
                    board={board}
                    language={language}
                    pendingReview={Boolean(pendingReviewForBoard)}
                  />
                  <PersonalizationContext
                    key={`personalization-${board.id}`}
                    options={board.options}
                    language={language}
                  />

                  <div
                    className="dc-filter-row dc-motion-filter-row"
                    role="group"
                    aria-label={language === "ru" ? "Категория контракта" : "Contract category"}
                  >
                    {(["ALL", "COMBAT", "SUPPORT", "ECONOMY", "SURVIVAL"] as QuestFilter[]).map(
                      (item) => (
                        <button
                          key={item}
                          className={filter === item ? "active" : ""}
                          aria-pressed={filter === item}
                          onClick={() => setFilter(item)}
                        >
                          <i>{categoryGlyph(item)}</i>
                          {categoryLabel(item, language)}
                          <span>
                            {item === "ALL"
                              ? board.options.length
                              : board.options.filter((x) => x.category === item).length}
                          </span>
                        </button>
                      ),
                    )}
                  </div>

                  {visibleOptions.length === 0 && (
                    <section className="dc-board-feedback" role="status">
                      <SvgIcon name="layers" />
                      <div>
                        <strong>
                          {language === "ru"
                            ? "В этой категории нет контрактов"
                            : "No contracts in this category"}
                        </strong>
                        <p>
                          {language === "ru"
                            ? "В остальных категориях могут быть подходящие задания."
                            : "Other categories may have a suitable contract."}
                        </p>
                      </div>
                      {filter !== "ALL" && (
                        <button type="button" className="dc-ghost" onClick={() => setFilter("ALL")}>
                          {language === "ru" ? "Показать все контракты" : "Show all contracts"}
                        </button>
                      )}
                    </section>
                  )}

                  <section className="dc-contract-grid dc-contract-board dc-v3-contract-grid dc-motion-contract-grid">
                    {visibleOptions.map((option) => {
                      const chosen = selectedSet.has(option.id) || option.selected
                      const state =
                        board.status === "OFFERED"
                          ? chosen
                            ? language === "ru"
                              ? "Выбрано"
                              : "Selected"
                            : language === "ru"
                              ? "Доступно"
                              : "Available"
                          : chosen
                            ? statusLabel(option.status, language)
                            : t(language, "НЕ ВЫБРАНО")
                      return (
                        <button
                          type="button"
                          key={`${mode}-${board.generation}-${option.id}`}
                          className={`contract-card dc-contract dc-v3-contract dc-motion-contract-card ${
                            chosen ? "selected" : ""
                          } rarity-${option.rarity.toLowerCase()} diff-${option.difficulty.toLowerCase()} cat-${option.category.toLowerCase()}`}
                          aria-pressed={chosen}
                          data-status={option.status}
                          disabled={board.status !== "OFFERED" || busy}
                          onClick={() => toggle(option.id)}
                        >
                          <span className="dc-contract-top">
                            <span>
                              <i aria-hidden="true">{categoryGlyph(option.category)}</i>
                              {categoryLabel(option.category, language)}
                            </span>
                            <strong className="dc-contract-state">
                              {chosen && (
                                <SvgIcon
                                  name="check"
                                  size={15}
                                  className="contract-selected-mark"
                                />
                              )}
                              {state}
                            </strong>
                          </span>
                          <span className="dc-contract-name">
                            {localizedContractTitle(option, language)}
                          </span>
                          <span className="dc-contract-description">
                            {localizedContractDescription(option, mode, language)}
                          </span>
                          <span className="dc-motion-card-details">
                            <span>{DIFFICULTY_LABEL[option.difficulty] || option.difficulty}</span>
                            <span>{RARITY_LABEL[option.rarity] || option.rarity}</span>
                            {(option.conditions?.length || 0) > 1 && (
                              <span>
                                {option.conditions!.length}{" "}
                                {language === "ru" ? "УСЛОВИЯ" : "CONDITIONS"}
                              </span>
                            )}
                            <span>
                              {language === "ru" ? "Шанс" : "Drop chance"} ~
                              {number(option.drop_chance_pct, language)}%
                            </span>
                          </span>
                          <span className="dc-contract-foot">
                            <span>
                              {language === "ru" ? "Цель" : "Target"}{" "}
                              <b>{targetLabel(option, language)}</b>
                            </span>
                            <strong>+{option.reward_xp.toLocaleString(locale)} XP</strong>
                          </span>
                        </button>
                      )
                    })}
                  </section>

                  {selectedOptions.length > 0 && (
                    <ul
                      className="dc-motion-selected-pills"
                      aria-label={language === "ru" ? "Выбранные контракты" : "Selected contracts"}
                    >
                      {selectedOptions.map((option) => (
                        <li key={option.id}>{localizedContractTitle(option, language)}</li>
                      ))}
                    </ul>
                  )}

                  <section
                    className={`dc-motion-selection-tray ${
                      board.status === "OFFERED" && selectedSet.size ? "has-selection" : ""
                    }`}
                  >
                    <div className="dc-motion-selection-copy">
                      <div className="dc-motion-selection-summary" role="status" aria-atomic="true">
                        <span>
                          <strong>
                            {board.status === "OFFERED" ? selectedSet.size : selectedOptions.length}{" "}
                            / 3
                          </strong>{" "}
                          {language === "ru" ? "выбрано" : "selected"}
                        </span>
                        {selectedOptions.length > 0 && (
                          <span ref={xpRef} className="dc-motion-total-xp">
                            +{totalXp.toLocaleString(locale)} XP
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="dc-motion-selection-actions">
                      {board.status === "OFFERED" ? (
                        <>
                          <button
                            type="button"
                            className="dc-ghost btn-ghost dc-motion-reset"
                            disabled={!selectedSet.size || busy}
                            onClick={() => {
                              setSelected((previous) => ({
                                ...previous,
                                [mode]: new Set(),
                              }))
                            }}
                          >
                            {language === "ru" ? "Сбросить" : "Reset"}
                          </button>
                          <button
                            type="button"
                            className="dc-primary btn-primary dc-motion-lock"
                            disabled={!selectedSet.size || busy}
                            onClick={openSigning}
                          >
                            {language === "ru" ? "Подписать дело" : "Sign case"}
                          </button>
                        </>
                      ) : (
                        <span className="dc-board-locked">
                          {statusLabel(board.status, language)} ·{" "}
                          {language === "ru" ? "МАТЧЕЙ" : "MATCHES"} {board.attempts_used}/
                          {board.max_attempts}
                        </span>
                      )}
                    </div>
                  </section>

                  {canShowCompletion(board) && (
                    <CompletionButton key={board.id} boardId={board.id} />
                  )}
                </>
              )}
              {board && (
                <section className="dc-deadline-strip">
                  <div>
                    <span>{language === "ru" ? "Новая доска через" : "Board resets in"}</span>
                    <strong>
                      {countdownHms(
                        board?.daily_reset_at || boardsPayload?.refresh.reset_at,
                        clock,
                      )}
                    </strong>
                    <small>{t(language, "Каждый день в 06:00 МСК")}</small>
                  </div>

                  <div
                    className={
                      board && ["LOCKED", "VERIFYING", "REVIEW_REQUIRED"].includes(board.status)
                        ? "active"
                        : ""
                    }
                  >
                    <span>{language === "ru" ? "Время на дело" : "Case time remaining"}</span>
                    <strong>
                      {board && ["LOCKED", "VERIFYING", "REVIEW_REQUIRED"].includes(board.status)
                        ? countdownHms(board.case_expires_at || board.expires_at, clock)
                        : board?.status === "OFFERED"
                          ? t(language, "НЕ ПРИНЯТО")
                          : statusLabel(board?.status || "", language)}
                    </strong>
                    <small>{t(language, "24 часа с момента фиксации")}</small>
                  </div>

                  <div>
                    <span>{language === "ru" ? "Попытки" : "Attempts"}</span>
                    <strong>
                      {board.attempts_used}/{board.max_attempts}
                    </strong>
                    <small>{t(language, "для невыполненных контрактов")}</small>
                  </div>
                </section>
              )}
            </div>
          )}

          {tab === "active" && (
            <>
              <section className="dc-work-head dc-page-head">
                <div>
                  <p className="dc-eyebrow">
                    {language === "ru"
                      ? "В работе / Подписанные контракты"
                      : "In progress / Signed contracts"}
                  </p>
                  <h1>{language === "ru" ? "Активное дело" : "Active case"}</h1>
                  <p>
                    {language === "ru"
                      ? "Здесь показаны только зафиксированные сервером условия. Live-сигналы Компаньона предварительны; окончательный вердикт появляется после проверки итоговых данных."
                      : "Only server-locked conditions appear here. Companion live signals are provisional; the final verdict follows authoritative post-match verification."}
                  </p>
                </div>
              </section>
              {readyCases.length > 0 && (
                <section className="case-ready-list" aria-labelledby="case-ready-heading">
                  <h2 id="case-ready-heading">
                    {language === "ru" ? "Завершённые дела" : "Completed cases"}
                  </h2>
                  {readyCases.map((readyCase) => (
                    <article key={readyCase.board_id}>
                      <div>
                        <p className="dc-eyebrow">{MODE_META[readyCase.game_match_mode].short}</p>
                        <h3>
                          {readyCase.items
                            .map((item) => localizedContractTitle(item, language))
                            .join(" · ")}
                        </h3>
                        <p>
                          {language === "ru" ? "Попытки" : "Attempts"} {readyCase.attempts_used}/
                          {readyCase.max_attempts} · {fmt(readyCase.settled_at, language)}
                        </p>
                      </div>
                      <CompletionButton boardId={readyCase.board_id} />
                    </article>
                  ))}
                </section>
              )}
              {activeBoards.length ? (
                <section className="dc-active-case-grid">
                  {activeBoards.map((activeBoard) => {
                    const lockedOptions = activeBoard.options.filter((option) => option.selected)
                    const expiry = activeBoard.case_expires_at || activeBoard.expires_at
                    return (
                      <article className="dc-active-case-card" key={activeBoard.id}>
                        <header>
                          <div>
                            <p className="dc-eyebrow">
                              {MODE_META[activeBoard.game_match_mode].short} / CASE
                            </p>
                            <h2>{language === "ru" ? "ДЕЛО ЗАФИКСИРОВАНО" : "CASE LOCKED"}</h2>
                          </div>
                          <span className={`dc-badge ${activeBoard.status.toLowerCase()}`}>
                            {statusLabel(activeBoard.status, language)}
                          </span>
                        </header>
                        <VerificationContext
                          board={activeBoard}
                          language={language}
                          pendingReview={reviews.some(
                            (item) => item.board_id === activeBoard.id && item.status === "PENDING",
                          )}
                        />
                        <div className="dc-active-case-list">
                          {lockedOptions.map((option) => (
                            <div className="dc-active-contract" key={option.id}>
                              <div>
                                <h3>{localizedContractTitle(option, language)}</h3>
                                <p>
                                  {localizedContractDescription(
                                    option,
                                    activeBoard.game_match_mode,
                                    language,
                                  )}
                                </p>
                              </div>
                              <strong>+{option.reward_xp} XP</strong>
                            </div>
                          ))}
                        </div>
                        <div className="dc-active-meta">
                          <span>
                            {language === "ru" ? "ПОПЫТКИ" : "ATTEMPTS"}
                            <b>
                              {activeBoard.attempts_used}/{activeBoard.max_attempts}
                            </b>
                          </span>
                          <span>
                            {language === "ru" ? "ДО ЗАКРЫТИЯ" : "EXPIRES IN"}
                            <b>{countdownHms(expiry, clock)}</b>
                          </span>
                          <span>
                            {language === "ru" ? "КОМПАНЬОН" : "COMPANION"}
                            <b>
                              {companion?.online
                                ? "ONLINE"
                                : companion?.paired
                                  ? "OFFLINE"
                                  : "NOT PAIRED"}
                            </b>
                          </span>
                        </div>
                        <button
                          className="dc-ghost"
                          type="button"
                          onClick={() => {
                            setMode(activeBoard.game_match_mode)
                            setTab("quests")
                          }}
                        >
                          {language === "ru" ? "ОТКРЫТЬ ДОСКУ" : "OPEN BOARD"}
                        </button>
                      </article>
                    )
                  })}
                </section>
              ) : (
                <section className="dc-active-empty">
                  <img src={markImage} alt="" />
                  <h2>{language === "ru" ? "Активного дела пока нет" : "No active case yet"}</h2>
                  <p>
                    {language === "ru"
                      ? "Выберите от одного до трёх контрактов на доске и зафиксируйте их до начала матча."
                      : "Choose one to three board contracts and lock them before the match begins."}
                  </p>
                  <button className="dc-primary" type="button" onClick={() => setTab("quests")}>
                    {language === "ru" ? "ОТКРЫТЬ КОНТРАКТЫ" : "OPEN CONTRACTS"}
                  </button>
                </section>
              )}
            </>
          )}

          {tab === "history" && (
            <>
              <section className="dc-work-head dc-page-head">
                <div>
                  <p className="dc-eyebrow">
                    {language === "ru" ? "Архив / История решений" : "Archive / Decision history"}
                  </p>
                  <h1>{t(language, "Дела")}</h1>
                  <p>
                    {t(
                      language,
                      "Каждый режим ведёт отдельную цепочку дел. Здесь хранятся Match ID, решения и полученный XP.",
                    )}
                  </p>
                </div>
                <div className="dc-history-summary">
                  <span>
                    <b>{historyStats.completed}</b> {language === "ru" ? "выполнено" : "completed"}
                  </span>
                  <span>
                    <b>{historyStats.failed}</b> {language === "ru" ? "не выполнено" : "failed"}
                  </span>
                  <span>
                    <b>{historyStats.earned}</b> {language === "ru" ? "XP получено" : "XP earned"}
                  </span>
                </div>
              </section>
              <div className="dc-v3-history-filter">
                <button
                  className={historyMode === "ALL" ? "active" : ""}
                  onClick={() => setHistoryMode("ALL")}
                >
                  {t(language, "ВСЕ")}
                </button>
                {MODES.map((item) => (
                  <button
                    key={item}
                    className={historyMode === item ? "active" : ""}
                    onClick={() => setHistoryMode(item)}
                  >
                    {MODE_META[item].short}
                  </button>
                ))}
              </div>
              <div className="dc-case-archive">
                {caseGroups.length === 0 && (
                  <article className="dc-case-file empty">
                    <img src={markImage} alt="" />
                    <h2>{t(language, "Архив пока пуст")}</h2>
                    <p>{t(language, "Зафиксируйте дело и сыграйте соответствующий матч.")}</p>
                  </article>
                )}
                {caseGroups.map((group, index) => {
                  const done = group.items.filter((x) => x.status === "COMPLETED").length
                  const reward = group.items
                    .filter((x) => x.status === "COMPLETED")
                    .reduce((sum, x) => sum + Number(x.reward_granted_xp || 0), 0)
                  const hasReview = group.status === "REVIEW_REQUIRED"
                  const isVerifying = group.status === "VERIFYING"
                  const isWaiting = group.status === "LOCKED"
                  const pendingStatus = hasReview
                    ? "review_required"
                    : isVerifying
                      ? "verifying"
                      : isWaiting
                        ? "locked"
                        : null
                  return (
                    <article className="dc-case-file" key={group.boardId}>
                      <div className="dc-case-file-no">
                        <span>{MODE_META[group.mode].short}</span>
                        <b>{String(index + 1).padStart(3, "0")}</b>
                      </div>
                      <div className="dc-case-file-main">
                        <header>
                          <div>
                            <p className="dc-eyebrow">
                              {language === "ru" ? "Попытки" : "Attempts"} {group.attemptsUsed}/
                              {group.maxAttempts}
                              {group.matchId ? ` · LAST #${group.matchId}` : ""}
                            </p>
                            <h2>
                              {hasReview
                                ? t(language, "Данные уточняются")
                                : isVerifying
                                  ? language === "ru"
                                    ? "Проверяем результат матча"
                                    : "Verifying the match result"
                                  : done === group.items.length
                                    ? t(language, "Дело закрыто успешно")
                                    : isWaiting
                                      ? t(language, "Дело продолжается")
                                      : t(language, "Решение по делу")}
                            </h2>
                          </div>
                          <span
                            className={`dc-badge ${
                              pendingStatus ||
                              (done
                                ? "completed"
                                : group.items.some((item) => item.status === "FAILED")
                                  ? "failed"
                                  : "")
                            }`}
                          >
                            {done}/{group.items.length}{" "}
                            {language === "ru" ? "выполнено" : "completed"}
                          </span>
                        </header>
                        <div className="dc-case-file-results">
                          {group.items.map((item) => (
                            <div className="dc-case-result-block" key={item.assignment_id}>
                              <div className="dc-case-result-row">
                                <span
                                  className={
                                    item.status === "COMPLETED"
                                      ? "ok"
                                      : item.status === "FAILED"
                                        ? "bad"
                                        : ""
                                  }
                                >
                                  <SvgIcon
                                    name={
                                      item.status === "COMPLETED"
                                        ? "circle-check"
                                        : item.status === "FAILED"
                                          ? "x"
                                          : "hourglass"
                                    }
                                    size={18}
                                  />
                                </span>
                                <p>
                                  <b>{localizedContractTitle(item, language)}</b>
                                  <small>
                                    {localizeServerText(item.explanation, language) ||
                                      statusLabel(item.status, language)}{" "}
                                    · {DIFFICULTY_LABEL[item.difficulty] || item.difficulty}
                                  </small>
                                </p>
                                <em>
                                  {item.status === "COMPLETED"
                                    ? item.reward_granted_xp > 0
                                      ? `+${item.reward_granted_xp} XP`
                                      : language === "ru"
                                        ? "XP В ОЧЕРЕДИ"
                                        : "XP PENDING"
                                    : statusLabel(item.status, language)}
                                </em>
                              </div>
                              {(item.evaluations?.length || 0) > 0 && (
                                <details className="dc-attempt-log">
                                  <summary>
                                    {language === "ru" ? "ЖУРНАЛ ПРОВЕРОК" : "VERIFICATION LOG"} ·{" "}
                                    {item.evaluations.length}
                                  </summary>
                                  <ol>
                                    {item.evaluations.map((evaluation) => (
                                      <li key={evaluation.id}>
                                        <b>
                                          #{evaluation.revision} ·{" "}
                                          {statusLabel(evaluation.status, language)}
                                          {evaluation.match_id
                                            ? ` · MATCH #${evaluation.match_id}`
                                            : ""}
                                        </b>
                                        <span>
                                          {localizeServerText(evaluation.explanation, language) ||
                                            "—"}
                                        </span>
                                        <time dateTime={evaluation.created_at}>
                                          {fmt(evaluation.created_at, language)}
                                        </time>
                                      </li>
                                    ))}
                                  </ol>
                                </details>
                              )}
                            </div>
                          ))}
                        </div>
                        <footer>
                          <span>
                            {fmt(group.date, language)}
                            {group.items[0].case_expires_at &&
                            ["LOCKED", "VERIFYING", "REVIEW_REQUIRED"].includes(
                              group.items[0].board_status || "",
                            )
                              ? ` · ${
                                  language === "ru" ? "ДО ЗАКРЫТИЯ" : "EXPIRES IN"
                                } ${countdownHms(group.items[0].case_expires_at, clock)}`
                              : ""}
                          </span>
                          <strong>
                            {MODE_META[group.mode].short} · +{reward} XP
                          </strong>
                          {group.completionReady && <CompletionButton boardId={group.boardId} />}
                        </footer>
                      </div>
                    </article>
                  )
                })}
              </div>
              {historyCases.length < historyTotal && (
                <button className="dc-ghost dc-history-more" onClick={() => void loadMoreHistory()}>
                  {language === "ru" ? "ЗАГРУЗИТЬ ЕЩЁ" : "LOAD MORE"} · {historyCases.length}/
                  {historyTotal}
                </button>
              )}
            </>
          )}

          {["packs", "collection"].includes(tab) && (
            <Suspense
              fallback={
                <p role="status">
                  {language === "ru" ? "Загрузка коллекции…" : "Loading collection…"}
                </p>
              }
            >
              <ArchivePage
                key={`${user.id}:${tab}`}
                accountKey={user.id}
                csrf={csrf}
                mode={tab as "packs" | "collection"}
                onCollectionChange={() => setArchiveRevision((value) => value + 1)}
              />
            </Suspense>
          )}
          {tab === "leaderboard" && (
            <Leaderboard authenticated onProfile={() => setTab("profile")} />
          )}
          {tab === "hero-votes" && (
            <Suspense
              fallback={
                <p role="status">{language === "ru" ? "Загрузка опроса…" : "Loading poll…"}</p>
              }
            >
              <HeroVotesPage
                data={heroVotes.data}
                error={heroVotes.error}
                onReload={heroVotes.reload}
              />
            </Suspense>
          )}
          {tab === "achievements" && <Achievements onProfile={() => setTab("profile")} />}
          {tab === "bureaus" && <Bureaus csrf={csrf} slug={bureauSlug} onSelect={openBureau} />}
          {tab === "profile" && (
            <>
              <ProfileStudio
                csrf={csrf}
                onNotice={setNotice}
                onBureau={openBureau}
                onCollection={() => setTab("collection")}
                identity={{
                  display_name: user.display_name,
                  avatar_url: user.avatar_url,
                  badges: user.badges,
                }}
                progression={progression}
              />
              <details className="profile-account-settings">
                <summary>
                  {language === "ru"
                    ? "Настройки аккаунта · Компаньон и данные"
                    : "Account settings · Companion and data"}
                </summary>
                <button
                  type="button"
                  className="dc-ghost"
                  disabled={refreshingSteam}
                  onClick={() => void refreshSteamProfile()}
                >
                  {refreshingSteam
                    ? language === "ru"
                      ? "Обновляем…"
                      : "Refreshing…"
                    : language === "ru"
                      ? "Обновить данные Steam"
                      : "Refresh Steam data"}
                </button>
                <section className="dc-profile-page-grid dc-v3-profile-grid">
                  <article className="dc-system-card dc-companion-card">
                    <p className="dc-eyebrow">COMPANION / OVERWOLF</p>
                    <div className="dc-companion-card-head">
                      <div>
                        <h2>Deadlock Contracts Companion</h2>
                        <p>
                          {t(
                            language,
                            "Основное приложение рядом с игрой. Показывает доски, активное дело и доступные игровые сигналы. Вердикт и XP всегда остаются на сервере.",
                          )}
                        </p>
                      </div>
                      <span
                        className={`dc-companion-state ${
                          companion?.online ? "online" : companion?.paired ? "paired" : ""
                        }`}
                      >
                        <i />
                        {companion?.online
                          ? t(language, "В СЕТИ")
                          : companion?.paired
                            ? t(language, "ПРИВЯЗАН · НЕ В СЕТИ")
                            : t(language, "НЕ ПОДКЛЮЧЕН")}
                      </span>
                    </div>

                    {companion?.paired ? (
                      <div className="dc-companion-telemetry">
                        <div>
                          <span>DEADLOCK</span>
                          <b>
                            {companion.game_running
                              ? t(language, "ЗАПУЩЕН")
                              : t(language, "НЕ ЗАПУЩЕН")}
                          </b>
                        </div>
                        <div>
                          <span>{t(language, "ФАЗА")}</span>
                          <b>{companion.phase || "—"}</b>
                        </div>
                        <div>
                          <span>{t(language, "РЕЖИМ")}</span>
                          <b>
                            {companion.game_match_mode
                              ? MODE_META[companion.game_match_mode as Mode]?.short ||
                                companion.game_match_mode
                              : "—"}
                          </b>
                        </div>
                        <div>
                          <span>{t(language, "ID МАТЧА")}</span>
                          <b>{companion.current_match_id || "—"}</b>
                        </div>
                      </div>
                    ) : null}

                    {companionDevices.length ? (
                      <div className="dc-companion-devices">
                        <span>
                          {language === "ru" ? "ПРИВЯЗАННЫЕ УСТРОЙСТВА" : "PAIRED DEVICES"}
                        </span>
                        {companionDevices.map((device) => (
                          <div key={device.id}>
                            <p>
                              <b>{device.label || "Deadlock Contracts Companion"}</b>
                              <small>
                                {device.version || "—"} ·{" "}
                                {device.last_seen_at ? fmt(device.last_seen_at, language) : "—"}
                              </small>
                            </p>
                            {device.revoked_at ? (
                              <em>{language === "ru" ? "ОТКЛЮЧЕНО" : "REVOKED"}</em>
                            ) : (
                              <button
                                className="dc-ghost"
                                onClick={() => void revokeCompanionDevice(device)}
                              >
                                {language === "ru" ? "Отключить" : "Disconnect"}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {pairing ? (
                      <div className="dc-pairing-code">
                        <span>{t(language, "КОД ПРИВЯЗКИ")}</span>
                        <strong>{pairing.code}</strong>
                        <small>
                          {language === "ru" ? (
                            <>
                              Введите этот код в установленном Компаньоне. Действует до{" "}
                              {fmt(pairing.expires_at, language)}.
                            </>
                          ) : (
                            <>
                              Enter this code in the installed Companion. Valid until{" "}
                              {fmt(pairing.expires_at, language)}.
                            </>
                          )}
                        </small>
                        <code>{pairing.server_url}</code>
                      </div>
                    ) : null}

                    <div className="dc-companion-actions">
                      {initialSession.release.companion_download_url ? (
                        <a
                          className="dc-primary"
                          href={initialSession.release.companion_download_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {language === "ru" ? "Установить Компаньон" : "Install Companion"}
                        </a>
                      ) : (
                        <button className="dc-primary" disabled>
                          {language === "ru"
                            ? "Публичная сборка скоро"
                            : "Public build coming soon"}
                        </button>
                      )}

                      {!companion?.online && (
                        <button className="dc-ghost" onClick={startCompanionPairing}>
                          {companion?.paired
                            ? t(language, "Перепривязать")
                            : t(language, "У меня уже установлен")}
                        </button>
                      )}

                      {companion?.paired && (
                        <button className="dc-ghost" onClick={revokeCompanion}>
                          {t(language, "Отключить")}
                        </button>
                      )}

                      <button className="dc-ghost" onClick={() => void loadCompanion()}>
                        {t(language, "Обновить статус")}
                      </button>
                    </div>

                    <p className="dc-companion-footnote">
                      {t(
                        language,
                        "Установите Компаньон, затем создайте одноразовый код привязки. Сайт сохраняет резервный доступ к доскам и архиву.",
                      )}
                    </p>
                  </article>
                  <article className="dc-danger-zone">
                    <p className="dc-eyebrow">
                      {language === "ru" ? "Конфиденциальность" : "Privacy"}
                    </p>
                    <h2>{language === "ru" ? "Управление данными" : "Data controls"}</h2>
                    <p>
                      {t(
                        language,
                        "Удаление профиля уничтожит аккаунт, контрактные доски и опыт без возможности восстановления.",
                      )}
                    </p>
                    <button
                      onClick={() =>
                        confirm(t(language, "Удалить аккаунт и все данные?")) &&
                        api("/api/account/delete", csrf, {
                          method: "POST",
                          body: JSON.stringify({ confirmation: "DELETE" }),
                        }).then(() => location.assign("/"))
                      }
                    >
                      {language === "ru" ? "Удалить мои данные" : "Delete my data"}
                    </button>
                  </article>
                </section>
              </details>
            </>
          )}

          {tab === "admin" && user.is_staff && (
            <AdminConsole
              csrf={csrf}
              reloadAll={reloadAll}
              setError={setError}
              setNotice={setNotice}
            />
          )}
        </main>
        <footer className="dc-app-credit">
          <MCGCredit language={language} compact />
        </footer>
      </div>
    </CompletionProvider>
  )
}

const ADAPTIVE_METRICS: Array<[string, string]> = [
  ["player.kills", "KILLS"],
  ["player.deaths", "DEATHS"],
  ["player.assists", "ASSISTS"],
  ["player.hero_damage", "HERO DMG"],
  ["player.object_damage", "OBJECT DMG"],
  ["player.healing", "HEALING"],
  ["player.net_worth.final", "SOULS"],
  ["match.duration_s", "DURATION"],
]

function adaptiveValue(metric: string, value: number | undefined, language: Language = "ru") {
  if (value === undefined || value === null) return "—"
  if (metric === "match.duration_s")
    return `${Math.round(value / 60)}${language === "ru" ? "м" : "m"}`
  return number(Math.round(value), language)
}

function adaptiveMeta(option: Record<string, unknown>) {
  const meta = (option.generator_meta || {}) as Record<string, unknown>
  const adaptive = (meta.adaptive || {}) as Record<string, unknown>
  return {
    enabled: Boolean(adaptive.enabled),
    kind: String(adaptive.kind || "WILDCARD"),
    confidence: String(adaptive.confidence || "COLD_START"),
    sample: Number(adaptive.sample_size || 0),
    weakest: adaptive.weakest_metric ? String(adaptive.weakest_metric) : "",
    basis: Array.isArray(adaptive.basis) ? (adaptive.basis as Array<Record<string, unknown>>) : [],
  }
}

function AdminConsole({
  csrf,
  reloadAll,
  setError,
  setNotice,
}: {
  csrf: string
  reloadAll: () => Promise<void>
  setError: (value: string) => void
  setNotice: (value: string) => void
}) {
  const { copy, language } = useAdminCopy()

  const [auth, setAuth] = useState<AdminAuthStatus | null>(null)
  const [code, setCode] = useState("")
  const [section, setSection] = useState<AdminSection>(() =>
    window.location.pathname.startsWith("/admin/announcements")
      ? "announcements"
      : window.location.pathname.startsWith("/admin/reviews")
        ? "reviews"
        : "overview",
  )
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [userTotal, setUserTotal] = useState(0)
  const [query, setQuery] = useState("")
  const [userRole, setUserRole] = useState("ALL")
  const [userStatus, setUserStatus] = useState("ALL")
  const [userCompanion, setUserCompanion] = useState("ALL")
  const [userSort, setUserSort] = useState("NEWEST")
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [reviews, setReviews] = useState<AdminReview[]>([])
  const [jobs, setJobs] = useState<AdminJob[]>([])
  const [jobStatus, setJobStatus] = useState("ALL")
  const [jobType, setJobType] = useState("ALL")
  const [jobQuery, setJobQuery] = useState("")
  const [outbox, setOutbox] = useState<AdminOutboxEvent[]>([])
  const [outboxTotal, setOutboxTotal] = useState(0)
  const [outboxState, setOutboxState] = useState("ALL")
  const [outboxQuery, setOutboxQuery] = useState("")
  const [audit, setAudit] = useState<AdminAudit[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditQuery, setAuditQuery] = useState("")
  const [matches, setMatches] = useState<AdminMatch[]>([])
  const [matchQuery, setMatchQuery] = useState("")
  const [matchMode, setMatchMode] = useState("ALL")
  const [matchScoring, setMatchScoring] = useState("ALL")
  const [matchDetail, setMatchDetail] = useState<AdminMatchDetail | null>(null)
  const [boards, setBoards] = useState<AdminBoardRow[]>([])
  const [boardQuery, setBoardQuery] = useState("")
  const [boardMode, setBoardMode] = useState("ALL")
  const [boardStatus, setBoardStatus] = useState("ALL")
  const [boardDetail, setBoardDetail] = useState<AdminBoardDetail | null>(null)
  const [companions, setCompanions] = useState<AdminCompanion[]>([])
  const [companionQuery, setCompanionQuery] = useState("")
  const [companionState, setCompanionState] = useState("ALL")
  const [companionVersion, setCompanionVersion] = useState("ALL")
  const [companionVersions, setCompanionVersions] = useState<Record<string, number>>({})
  const [missions, setMissions] = useState<AdminMission[]>([])
  const [missionQuery, setMissionQuery] = useState("")
  const [missionMode, setMissionMode] = useState("ALL")
  const [missionStatus, setMissionStatus] = useState("ALL")
  const [selectedMission, setSelectedMission] = useState<AdminMission | null>(null)
  const [missionDraft, setMissionDraft] = useState<AdminMission | null>(null)
  const [generatorMode, setGeneratorMode] = useState<Mode>("STANDARD")
  const [generatorBoards, setGeneratorBoards] = useState("12")
  const [generatorSeed, setGeneratorSeed] = useState("admin-preview")
  const [generator, setGenerator] = useState<AdminGeneratorPreview | null>(null)
  const [system, setSystem] = useState<AdminSystem | null>(null)
  const [busy, setBusy] = useState(false)
  const [identityRole, setIdentityRole] = useState<"PLAYER" | "TESTER" | "MODERATOR" | "ADMIN">(
    "PLAYER",
  )
  const [identityBadges, setIdentityBadges] = useState<
    Array<"DEVELOPER" | "STREAMER" | "EARLY_TESTER" | "CONTRIBUTOR">
  >([])

  const loadAuth = useCallback(async () => {
    const data = await api<AdminAuthStatus>("/api/admin/auth/status", csrf)
    setAuth(data)
    setSection((current) =>
      hasAdminPermission(data.permissions, ADMIN_SECTION_PERMISSIONS[current])
        ? current
        : firstAdminSectionForPermissions(data.permissions),
    )
    return data
  }, [csrf])

  const loadSection = useCallback(
    async (target: AdminSection) => {
      if (!auth?.elevated) return
      if (!hasAdminPermission(auth.permissions, ADMIN_SECTION_PERMISSIONS[target])) return
      try {
        if (target === "overview")
          setOverview(await api<AdminOverview>("/api/admin/overview", csrf))
        if (target === "users") {
          const params = new URLSearchParams({
            query,
            role: userRole,
            status: userStatus,
            companion: userCompanion,
            sort: userSort,
            limit: "100",
          })
          const data = await api<{
            items: AdminUserSummary[]
            total: number
          }>(`/api/admin/users?${params}`, csrf)
          setUsers(data.items)
          setUserTotal(data.total)
        }
        if (target === "reviews")
          setReviews(
            (await api<{ items: AdminReview[] }>("/api/admin/auto-reviews?status=OPEN", csrf))
              .items,
          )
        if (target === "jobs") {
          const params = new URLSearchParams({
            status: jobStatus,
            type: jobType,
            query: jobQuery,
            limit: "200",
          })
          setJobs((await api<{ items: AdminJob[] }>(`/api/admin/jobs?${params}`, csrf)).items)
        }
        if (target === "outbox") {
          const params = new URLSearchParams({
            state: outboxState,
            query: outboxQuery,
            limit: "200",
          })
          const data = await api<{ items: AdminOutboxEvent[]; total: number }>(
            `/api/admin/outbox?${params}`,
            csrf,
          )
          setOutbox(data.items)
          setOutboxTotal(data.total)
        }
        if (target === "audit") {
          const params = new URLSearchParams({
            query: auditQuery,
            limit: "200",
          })
          const data = await api<{
            items: AdminAudit[]
            total: number
          }>(`/api/admin/audit?${params}`, csrf)
          setAudit(data.items)
          setAuditTotal(data.total)
        }
        if (target === "matches") {
          const params = new URLSearchParams({
            match_id: matchQuery,
            mode: matchMode,
            scoring_status: matchScoring,
            limit: "150",
          })
          setMatches(
            (await api<{ items: AdminMatch[] }>(`/api/admin/matches?${params}`, csrf)).items,
          )
        }
        if (target === "boards") {
          const params = new URLSearchParams({
            query: boardQuery,
            mode: boardMode,
            status: boardStatus,
            limit: "150",
          })
          setBoards(
            (await api<{ items: AdminBoardRow[] }>(`/api/admin/boards?${params}`, csrf)).items,
          )
        }
        if (target === "companions") {
          const params = new URLSearchParams({
            query: companionQuery,
            state: companionState,
            version: companionVersion,
            limit: "200",
          })
          const data = await api<{
            items: AdminCompanion[]
            version_counts: Record<string, number>
          }>(`/api/admin/companions?${params}`, csrf)
          setCompanions(data.items)
          setCompanionVersions(data.version_counts)
        }
        if (target === "missions") {
          const params = new URLSearchParams({
            query: missionQuery,
            mode: missionMode,
            status: missionStatus,
            limit: "500",
          })
          setMissions(
            (await api<{ items: AdminMission[] }>(`/api/admin/missions?${params}`, csrf)).items,
          )
        }
        if (target === "system") setSystem(await api<AdminSystem>("/api/admin/system", csrf))
      } catch (reason) {
        const error = reason as ApiError
        if (error.status === 403)
          setAuth((previous) =>
            previous ? { ...previous, elevated: false, expires_at: null } : previous,
          )
        setError(error.message)
      }
    },
    [
      auth?.elevated,
      csrf,
      query,
      userRole,
      userStatus,
      userCompanion,
      userSort,
      jobStatus,
      jobType,
      jobQuery,
      outboxState,
      outboxQuery,
      auditQuery,
      matchQuery,
      matchMode,
      matchScoring,
      boardQuery,
      boardMode,
      boardStatus,
      companionQuery,
      companionState,
      companionVersion,
      missionQuery,
      missionMode,
      missionStatus,
      setError,
    ],
  )

  useEffect(() => {
    void loadAuth().catch((reason) => setError((reason as Error).message))
  }, [loadAuth, setError])
  useEffect(() => {
    if (auth?.elevated) void loadSection(section)
  }, [auth?.elevated, section, loadSection])

  const unlock = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError(copy("Введите одноразовый код из приложения-аутентификатора."))
      return
    }
    setBusy(true)
    try {
      const data = await api<AdminAuthStatus>("/api/admin/auth/totp", csrf, {
        method: "POST",
        body: JSON.stringify({ code }),
      })
      setAuth(data)
      setSection((current) =>
        hasAdminPermission(data.permissions, ADMIN_SECTION_PERMISSIONS[current])
          ? current
          : firstAdminSectionForPermissions(data.permissions),
      )
      setCode("")
      setNotice(copy("Staff-доступ подтверждён на {0} минут.", { 0: data.ttl_minutes }))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const lockAdmin = async () => {
    try {
      await api("/api/admin/auth/lock", csrf, { method: "POST" })
      setAuth((previous) =>
        previous ? { ...previous, elevated: false, expires_at: null } : previous,
      )
      setDetail(null)
      setNotice(copy("Административная сессия заблокирована."))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const openUser = async (id: string) => {
    setSelectedUserId(id)
    setDetail(null)
    try {
      const data = await api<AdminUserDetail>(`/api/admin/users/${id}`, csrf)
      setDetail(data)
      if (data.user.access_role !== "OWNER")
        setIdentityRole(data.user.access_role as "PLAYER" | "TESTER" | "MODERATOR" | "ADMIN")
      setIdentityBadges(
        data.user.badges.filter(
          (item): item is "DEVELOPER" | "STREAMER" | "EARLY_TESTER" | "CONTRIBUTOR" =>
            ["DEVELOPER", "STREAMER", "EARLY_TESTER", "CONTRIBUTOR"].includes(item),
        ),
      )
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const toggleIdentityBadge = (badge: "DEVELOPER" | "STREAMER" | "EARLY_TESTER" | "CONTRIBUTOR") =>
    setIdentityBadges((current) =>
      current.includes(badge) ? current.filter((item) => item !== badge) : [...current, badge],
    )

  const saveIdentity = async () => {
    if (!detail || !auth?.can_manage_roles || detail.user.access_role === "OWNER") return
    if (
      !confirm(copy("Сохранить роль и публичные бейджи для {0}?", { 0: detail.user.display_name }))
    )
      return
    setBusy(true)
    try {
      await api(`/api/admin/users/${detail.user.id}/identity`, csrf, {
        method: "POST",
        body: JSON.stringify({
          access_role: identityRole,
          badges: identityBadges,
        }),
      })
      setNotice(copy("Роль и публичные бейджи обновлены. Изменение записано в аудит."))
      await openUser(detail.user.id)
      await loadSection("users")
      await reloadAll()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const revokeCompanionFor = async (item: AdminUserSummary) => {
    if (!confirm(copy("Отозвать все токены Companion у {0}?", { 0: item.display_name }))) return
    try {
      await api(`/api/admin/users/${item.id}/revoke-companion`, csrf, {
        method: "POST",
      })
      setNotice(copy("Companion пользователя отозван."))
      await openUser(item.id)
      await loadSection("users")
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const terminateSessionsFor = async (item: AdminUserSummary) => {
    if (!confirm(copy("Завершить все веб-сессии пользователя {0}?", { 0: item.display_name })))
      return
    try {
      await api(`/api/admin/users/${item.id}/terminate-sessions`, csrf, {
        method: "POST",
      })
      setNotice(copy("Веб-сессии пользователя завершены."))
      await openUser(item.id)
      await loadSection("users")
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const changeUserStatus = async (item: AdminUserSummary) => {
    if (!auth?.can_manage_roles || item.access_role === "OWNER") return
    const next = item.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"
    const reason = prompt(
      copy("Причина изменения статуса {0} → {1}:", { 0: item.display_name, 1: next }),
      next === "SUSPENDED"
        ? copy("Временная блокировка администратором")
        : copy("Разблокировка владельцем"),
    )?.trim()
    if (!reason) return
    try {
      await api(`/api/admin/users/${item.id}/status`, csrf, {
        method: "POST",
        body: JSON.stringify({ status: next, reason }),
      })
      setNotice(copy("Статус пользователя: {0}", { 0: next }))
      await openUser(item.id)
      await loadSection("users")
    } catch (reasonValue) {
      setError((reasonValue as Error).message)
    }
  }

  const adjustXp = async (item: AdminUserSummary) => {
    if (!auth?.can_manage_roles) return
    const raw = prompt(
      copy("Изменение XP для {0}. Допустимо от -100000 до 100000:", { 0: item.display_name }),
      "100",
    )?.trim()
    if (!raw) return
    const delta = Number(raw)
    if (!Number.isInteger(delta) || delta === 0) {
      setError(copy("Введите ненулевое целое изменение XP."))
      return
    }
    const reason = prompt(
      copy("Причина корректировки XP:"),
      copy("Ручная корректировка владельцем"),
    )?.trim()
    if (!reason) return
    try {
      await api(`/api/admin/users/${item.id}/xp-adjust`, csrf, {
        method: "POST",
        body: JSON.stringify({ delta, reason }),
      })
      setNotice(copy("XP скорректирован с записью в ledger и audit."))
      await openUser(item.id)
      await loadSection("users")
      await reloadAll()
    } catch (reasonValue) {
      setError((reasonValue as Error).message)
    }
  }

  const retryJob = async (job: AdminJob) => {
    const reason = prompt(
      copy("Причина повторного запуска задачи:"),
      copy("Повтор после проверки администратора"),
    )?.trim()
    if (!reason) return
    try {
      await api(`/api/admin/jobs/${job.id}/retry`, csrf, {
        method: "POST",
        body: JSON.stringify({ reason }),
      })
      setNotice(copy("FAILED-задача возвращена в очередь."))
      await loadSection("jobs")
    } catch (reasonValue) {
      setError((reasonValue as Error).message)
    }
  }

  const replayOutbox = async (event: AdminOutboxEvent) => {
    const reason = prompt(
      copy("Причина replay {0} / {1}:", { 0: event.event_type, 1: event.id.slice(0, 8) }),
      copy("Причина устранена; повторная доставка подтверждена администратором"),
    )?.trim()
    if (!reason) return
    if (!confirm(copy("Вернуть dead-letter событие в очередь? Доставка останется идемпотентной.")))
      return
    try {
      await api(`/api/admin/outbox/${event.id}/replay`, csrf, {
        method: "POST",
        body: JSON.stringify({ reason }),
      })
      setNotice(copy("Outbox event возвращён в очередь; причина записана в аудит."))
      await loadSection("outbox")
      await loadSection("system")
    } catch (reasonValue) {
      setError((reasonValue as Error).message)
    }
  }

  const openMatch = async (matchId: string) => {
    try {
      setMatchDetail(await api<AdminMatchDetail>(`/api/admin/matches/${matchId}`, csrf))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  const openBoard = async (boardId: string) => {
    try {
      setBoardDetail(await api<AdminBoardDetail>(`/api/admin/boards/${boardId}`, csrf))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  const retryBoardVerification = async (boardId: string) => {
    if (
      !confirm(
        copy(
          "Поставить это VERIFYING-дело на повторную автоматическую проверку? XP и статусы по-прежнему определяет серверный evaluator.",
        ),
      )
    )
      return
    setBusy(true)
    try {
      const result = await api<{
        already_queued: boolean
        match_id: string
      }>(`/api/admin/boards/${boardId}/retry-verification`, csrf, { method: "POST" })
      setNotice(
        result.already_queued
          ? copy("Проверка матча #{0} уже находится в очереди.", { 0: result.match_id })
          : copy("Матч #{0} поставлен на повторную проверку.", { 0: result.match_id }),
      )
      await openBoard(boardId)
      await loadSection("overview")
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const revokeDevice = async (item: AdminCompanion) => {
    if (
      !confirm(
        copy("Отозвать устройство {0} пользователя {1}?", {
          0: item.device_id,
          1: item.user.display_name,
        }),
      )
    )
      return
    try {
      await api(`/api/admin/companions/${item.id}/revoke`, csrf, {
        method: "POST",
      })
      setNotice(copy("Устройство отозвано."))
      await loadSection("companions")
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const chooseMission = (item: AdminMission) => {
    setSelectedMission(item)
    setMissionDraft({ ...item })
  }
  const saveMission = async () => {
    if (!auth?.can_manage_roles || !selectedMission || !missionDraft) return
    const fields = [
      "title",
      "description",
      "title_en",
      "description_en",
      "target",
      "reward_xp",
      "base_xp",
      "difficulty",
      "rarity",
      "drop_weight",
      "drop_chance_pct",
      "category",
      "status",
    ] as const
    const body: Record<string, unknown> = {}
    for (const field of fields)
      if (missionDraft[field] !== selectedMission[field]) body[field] = missionDraft[field]
    if (!Object.keys(body).length) {
      setNotice(copy("Изменений шаблона нет."))
      return
    }
    if (
      !confirm(
        copy(
          "Сохранить изменения шаблона {0}? Новые доски будут использовать обновлённые параметры.",
          { 0: selectedMission.key },
        ),
      )
    )
      return
    setBusy(true)
    try {
      const data = await api<{ mission: AdminMission; created_as_draft?: boolean }>(
        `/api/admin/missions/${selectedMission.id}`,
        csrf,
        { method: "PATCH", body: JSON.stringify(body) },
      )
      setSelectedMission(data.mission)
      setMissionDraft({ ...data.mission })
      setNotice(
        data.created_as_draft
          ? copy(
              "Создана новая DRAFT-версия. Опубликуйте её после RU/EN preview; текущая PUBLISHED-версия не изменена.",
            )
          : copy("Версия обновлена. Существующие уже выданные карточки не переписаны."),
      )
      await loadSection("missions")
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const runGenerator = async () => {
    const count = Number(generatorBoards)
    if (!Number.isInteger(count) || count < 1 || count > 40) {
      setError(copy("Количество preview-досок: от 1 до 40."))
      return
    }
    setBusy(true)
    try {
      setGenerator(
        await api<AdminGeneratorPreview>("/api/admin/generator/preview", csrf, {
          method: "POST",
          body: JSON.stringify({
            mode: generatorMode,
            boards: count,
            seed_prefix: generatorSeed,
          }),
        }),
      )
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!auth)
    return (
      <section className="dc-admin-shell">
        <article className="dc-panel">
          <h2>{copy("Проверяем административную сессию…")}</h2>
        </article>
      </section>
    )
  if (!auth.elevated)
    return (
      <section className="dc-admin-shell">
        <article className="dc-admin-unlock">
          <p className="dc-eyebrow">{copy("SECURE ZONE / TOTP")}</p>
          <h1>{copy("Admin console")}</h1>
          <p>
            {copy(
              "SteamID уже проверен. Для доступа к данным игроков требуется отдельное TOTP-подтверждение. Код не сохраняется и не передаётся клиентам.",
            )}
          </p>
          <div className="dc-admin-unlock-form">
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder={copy("000000")}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter") void unlock()
              }}
            />
            <button className="dc-primary" disabled={busy} onClick={() => void unlock()}>
              {busy ? copy("Проверяем…") : copy("Разблокировать")}
            </button>
          </div>
          <small>
            {auth.configured
              ? copy("TOTP настроен.")
              : copy("TOTP на сервере не настроен — выполните scripts/init-admin-totp.sh.")}
          </small>
        </article>
      </section>
    )

  const sections = ADMIN_SECTION_ORDER.filter(([key]) =>
    hasAdminPermission(auth.permissions, ADMIN_SECTION_PERMISSIONS[key]),
  )
  const kv = (data: Record<string, unknown>) =>
    Object.entries(data).map(([key, value]) => (
      <div className="dc-admin-kv" key={key}>
        <span>{key}</span>
        <b>{typeof value === "object" ? JSON.stringify(value) : String(value)}</b>
      </div>
    ))

  return (
    <section className="dc-admin-shell">
      <div className="dc-admin-head">
        <div>
          <p className="dc-eyebrow">{copy("OPERATIONS CONSOLE / ADMIN MAX")}</p>
          <h1>{copy("Operations console")}</h1>
          <p>
            {copy(
              "Control plane для пользователей, матчей, дел, Companion, очередей и каталога контрактов. Прямого SQL, shell-доступа и отображения секретов нет. Опасные изменения доступны только OWNER и всегда попадают в audit.",
            )}
          </p>
        </div>
        <div className="dc-admin-session">
          <span>{copy("SESSION UNTIL")}</span>
          <b>{auth.expires_at ? fmt(auth.expires_at, language) : "—"}</b>
          <small>
            {auth.admin.access_role} · {auth.admin.steam_id64}
          </small>
          <button className="dc-ghost" onClick={() => void lockAdmin()}>
            {copy("LOCK SESSION")}
          </button>
        </div>
      </div>
      <nav className="dc-admin-tabs">
        {sections.map(([key, label]) => (
          <button
            key={key}
            className={section === key ? "active" : ""}
            onClick={() => setSection(key)}
          >
            {copy(label)}
          </button>
        ))}
      </nav>
      <label className="dc-admin-mobile-section">
        <span>{copy("РАЗДЕЛ КОНСОЛИ")}</span>
        <select
          value={section}
          onChange={(event) => setSection(event.target.value as AdminSection)}
        >
          {sections.map(([key, label]) => (
            <option key={key} value={key}>
              {copy(label)}
            </option>
          ))}
        </select>
      </label>

      {section === "overview" && (
        <>
          {overview ? (
            <>
              <div className="dc-admin-grid dc-admin-grid-max">
                <article>
                  <span>{copy("ИГРОКИ")}</span>
                  <b>{overview.users}</b>
                  <small>
                    +{overview.users_new_24h} {copy(" за 24ч · +")}
                    {overview.users_new_7d} {copy(" за 7д")}
                  </small>
                </article>
                <article>
                  <span>{copy("АКТИВНЫЕ ДЕЛА")}</span>
                  <b>{overview.active_boards}</b>
                  <small>
                    {overview.boards_24h} {copy(" новых за 24ч")}
                  </small>
                </article>
                <article>
                  <span>{copy("МАТЧИ / 24Ч")}</span>
                  <b>{overview.matches_24h}</b>
                  <small>
                    {overview.matches_7d} {copy(" за 7 дней")}
                  </small>
                </article>
                <article>
                  <span>{copy("COMPANION ONLINE")}</span>
                  <b>{overview.companion_online}</b>
                  <small>
                    {overview.companion_paired} {copy(" активных привязок")}
                  </small>
                </article>
                <article className={overview.pending_reviews ? "warn" : ""}>
                  <span>{copy("REVIEW")}</span>
                  <b>{overview.pending_reviews}</b>
                  <small>{copy("требуют внимания")}</small>
                </article>
                <article className={overview.failed_jobs ? "warn" : ""}>
                  <span>{copy("FAILED JOBS")}</span>
                  <b>{overview.failed_jobs}</b>
                  <small>
                    {overview.pending_jobs} {copy(" pending")}
                  </small>
                </article>
                <article className={overview.verification_health.stuck_15m ? "warn" : ""}>
                  <span>{copy("VERIFYING")}</span>
                  <b>{overview.verification_health.verifying_options}</b>
                  <small>
                    {overview.verification_health.stuck_15m} {copy(" ждут >15 мин ·")}{" "}
                    {overview.verification_health.final_match_waiting} {copy(" уже final")}
                  </small>
                </article>
                <article>
                  <span>{copy("XP ВЫДАНО")}</span>
                  <b>{number(overview.xp_issued, language)}</b>
                  <small>{copy("положительные ledger entries")}</small>
                </article>
                <article>
                  <span>{copy("ПОСЛЕДНИЙ MATCH")}</span>
                  <b>{overview.latest_match_id || "—"}</b>
                  <small>{fmt(overview.server_time, language)}</small>
                </article>
              </div>
              <div className="dc-admin-panel-grid">
                <article className="dc-panel">
                  <h3>{copy("Статусы дел")}</h3>
                  {kv(overview.board_statuses)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Режимы матчей")}</h3>
                  {kv(overview.match_modes)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Очередь")}</h3>
                  {kv(overview.job_statuses)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Версии Companion")}</h3>
                  {kv(overview.companion_versions)}
                </article>
                <article
                  className={`dc-panel ${
                    overview.verification_health.stuck_15m ? "dc-admin-health-warn" : ""
                  }`}
                >
                  <h3>{copy("Verification health")}</h3>
                  <div className="dc-admin-kv">
                    <span>{copy("VERIFYING")}</span>
                    <b>{overview.verification_health.verifying_options}</b>
                  </div>
                  <div className="dc-admin-kv">
                    <span>{copy("FINAL MATCH WAITING")}</span>
                    <b>{overview.verification_health.final_match_waiting}</b>
                  </div>
                  <div className="dc-admin-kv">
                    <span>{copy("STUCK > 15M")}</span>
                    <b>{overview.verification_health.stuck_15m}</b>
                  </div>
                  {Object.keys(overview.verification_health.missing_capabilities).length > 0 && (
                    <details>
                      <summary>{copy("Missing capabilities")}</summary>
                      {kv(overview.verification_health.missing_capabilities)}
                    </details>
                  )}
                  {overview.verification_health.examples.length > 0 && (
                    <details>
                      <summary>{copy("Последние VERIFYING на final-матчах")}</summary>
                      <div className="dc-admin-health-list">
                        {overview.verification_health.examples.map((item) => (
                          <button
                            key={item.option_id}
                            onClick={() => {
                              setSection("boards")
                              void openBoard(item.board_id)
                            }}
                          >
                            <b>
                              #{item.match_id} · {item.title}
                            </b>
                            <small>
                              {item.missing_capabilities.join(", ") ||
                                copy("facts present / ожидает evaluator")}
                            </small>
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </article>
              </div>
              <article className="dc-panel dc-admin-timeline">
                <h3>{copy("14 дней")}</h3>
                <div>
                  {overview.timeline.map((day) => (
                    <span key={day.date}>
                      <b>{day.date.slice(5)}</b>
                      <small>
                        {copy("U ")}
                        {day.registrations} {copy(" · M ")}
                        {day.matches} {copy(" · B ")}
                        {day.boards}
                      </small>
                    </span>
                  ))}
                </div>
              </article>
            </>
          ) : (
            <article className="dc-panel">
              <h2>{copy("Загрузка…")}</h2>
            </article>
          )}
        </>
      )}

      {section === "users" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              placeholder={copy("Ник, SteamID64 или Account ID")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select value={userRole} onChange={(event) => setUserRole(event.target.value)}>
              <option value="ALL">{copy("Все роли")}</option>
              <option value="OWNER">{copy("OWNER")}</option>
              <option value="ADMIN">{copy("ADMIN")}</option>
              <option value="MODERATOR">{copy("MODERATOR")}</option>
              <option value="TESTER">{copy("TESTER")}</option>
              <option value="PLAYER">{copy("PLAYER")}</option>
            </select>
            <select value={userStatus} onChange={(event) => setUserStatus(event.target.value)}>
              <option value="ALL">{copy("Все статусы")}</option>
              <option value="ACTIVE">{copy("ACTIVE")}</option>
              <option value="SUSPENDED">{copy("SUSPENDED")}</option>
            </select>
            <select
              value={userCompanion}
              onChange={(event) => setUserCompanion(event.target.value)}
            >
              <option value="ALL">{copy("Любой Companion")}</option>
              <option value="ONLINE">{copy("Online")}</option>
              <option value="PAIRED">{copy("Paired")}</option>
              <option value="NONE">{copy("Нет")}</option>
            </select>
            <select value={userSort} onChange={(event) => setUserSort(event.target.value)}>
              <option value="NEWEST">{copy("Новые")}</option>
              <option value="XP">{copy("По XP")}</option>
              <option value="NAME">{copy("По имени")}</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("users")}>
              {copy("Применить")}
            </button>
            <small>
              {userTotal} {copy(" найдено")}
            </small>
          </div>
          <div className={`dc-admin-users-layout ${detail ? "has-detail" : ""}`}>
            <div className="dc-admin-users-list">
              {!users.length && (
                <div className="dc-admin-empty">{copy("Нет записей по выбранным фильтрам.")}</div>
              )}
              {users.map((item) => (
                <button
                  key={item.id}
                  className={`dc-admin-user-row ${selectedUserId === item.id ? "active" : ""}`}
                  onClick={() => void openUser(item.id)}
                >
                  <div>
                    <b>{item.display_name}</b>
                    <RoleBadgeList badges={item.badges} compact />
                    <small>
                      {item.steam_id64} {copy(" · XP ")}
                      {item.xp} · {item.status}
                    </small>
                  </div>
                  <div>
                    <span className={item.companion.online ? "ok" : ""}>
                      {item.companion.online
                        ? copy("COMPANION ONLINE")
                        : item.companion.paired
                          ? copy("PAIRED")
                          : copy("NO COMPANION")}
                    </span>
                    <small>
                      {item.active_boards} {copy(" активных дел · ")}
                      {item.sessions} {copy(" сессий")}
                    </small>
                  </div>
                </button>
              ))}
            </div>
            <div className="dc-admin-user-detail">
              {detail ? (
                <>
                  <button
                    type="button"
                    className="dc-admin-mobile-back"
                    onClick={() => {
                      setDetail(null)
                      setSelectedUserId(null)
                    }}
                  >
                    {copy("← К списку игроков")}
                  </button>
                  <header>
                    <div>
                      <p className="dc-eyebrow">
                        {detail.user.access_role} / {detail.user.steam_id64}
                      </p>
                      <h2>{detail.user.display_name}</h2>
                      <RoleBadgeList badges={detail.user.badges} />
                      <small>
                        {copy("Account ID ")}
                        {detail.user.account_id ?? "—"} {copy(" · XP ")}
                        {detail.user.xp} · {detail.user.status} {copy(" · с нами с ")}
                        {joinLabel(detail.user.created_at, language)}
                      </small>
                    </div>
                    <div className="dc-admin-user-actions">
                      <button
                        className="dc-ghost"
                        onClick={() => void revokeCompanionFor(detail.user)}
                      >
                        {copy("Отозвать Companion")}
                      </button>
                      {detail.user.id !== auth.admin.id && (
                        <button
                          className="dc-ghost"
                          onClick={() => void terminateSessionsFor(detail.user)}
                        >
                          {copy("Завершить сессии")}
                        </button>
                      )}
                      {auth.can_manage_roles && detail.user.access_role !== "OWNER" && (
                        <button
                          className="dc-ghost"
                          onClick={() => void changeUserStatus(detail.user)}
                        >
                          {detail.user.status === "ACTIVE"
                            ? copy("Приостановить")
                            : copy("Активировать")}
                        </button>
                      )}
                      {auth.can_manage_roles && (
                        <button className="dc-ghost" onClick={() => void adjustXp(detail.user)}>
                          {copy("Корректировать XP")}
                        </button>
                      )}
                    </div>
                  </header>
                  {auth.can_manage_roles && (
                    <section className="dc-admin-identity-editor">
                      <div className="dc-admin-identity-title">
                        <div>
                          <span>{copy("ДОСТУП И ПУБЛИЧНЫЕ БЕЙДЖИ")}</span>
                          <p>
                            {copy(
                              "Права проверяются сервером. Бейджи меняют только отображение профиля.",
                            )}
                          </p>
                        </div>
                        {detail.user.access_role === "OWNER" ? (
                          <b>{copy("OWNER защищён server allowlist")}</b>
                        ) : (
                          <button
                            className="dc-primary"
                            disabled={busy}
                            onClick={() => void saveIdentity()}
                          >
                            {busy ? copy("Сохраняем…") : copy("Сохранить")}
                          </button>
                        )}
                      </div>
                      {detail.user.access_role !== "OWNER" && (
                        <>
                          <label>
                            {copy("ACCESS ROLE")}
                            <select
                              value={identityRole}
                              onChange={(event) =>
                                setIdentityRole(
                                  event.target.value as "PLAYER" | "TESTER" | "MODERATOR" | "ADMIN",
                                )
                              }
                            >
                              <option value="PLAYER">{copy("PLAYER — обычный игрок")}</option>
                              <option value="TESTER">
                                {copy("TESTER — участник тестирования")}
                              </option>
                              <option value="MODERATOR">
                                {copy("MODERATOR — только Review + TOTP")}
                              </option>
                              <option value="ADMIN">
                                {copy("ADMIN — административный доступ + TOTP")}
                              </option>
                            </select>
                          </label>
                          <div className="dc-admin-badge-picker">
                            {(
                              ["DEVELOPER", "STREAMER", "EARLY_TESTER", "CONTRIBUTOR"] as const
                            ).map((badge) => (
                              <button
                                key={badge}
                                type="button"
                                className={identityBadges.includes(badge) ? "selected" : ""}
                                aria-pressed={identityBadges.includes(badge)}
                                onClick={() => toggleIdentityBadge(badge)}
                              >
                                <RoleBadge badge={badge} />
                              </button>
                            ))}
                          </div>
                          <small className="dc-admin-identity-warning">
                            {copy(
                              "OWNER через веб назначить нельзя. Снятие ADMIN автоматически сбрасывает MFA elevation его сессий.",
                            )}
                          </small>
                        </>
                      )}
                    </section>
                  )}
                  <div className="dc-admin-mini-grid">
                    <div>
                      <span>{copy("COMPANION")}</span>
                      <b>
                        {detail.user.companion.online
                          ? copy("ONLINE")
                          : detail.user.companion.paired
                            ? copy("OFFLINE")
                            : "—"}
                      </b>
                    </div>
                    <div>
                      <span>{copy("DEADLOCK")}</span>
                      <b>{detail.user.companion.game_running ? copy("RUNNING") : "—"}</b>
                    </div>
                    <div>
                      <span>{copy("PHASE")}</span>
                      <b>{detail.user.companion.phase || "—"}</b>
                    </div>
                    <div>
                      <span>{copy("MATCH ID")}</span>
                      <b>{detail.user.companion.current_match_id || "—"}</b>
                    </div>
                  </div>
                  <h3>{copy("Adaptive Contracts profile")}</h3>
                  <div className="dc-admin-adaptive-grid">
                    {(["STANDARD", "RANKED", "STREET_BRAWL"] as Mode[]).map((mode) => {
                      const profile = detail.adaptive_profiles[mode]
                      return (
                        <article className="dc-panel" key={mode}>
                          <header>
                            <div>
                              <b>{mode}</b>
                              <small>
                                {profile.sample_size} {copy(" verified matches")}
                              </small>
                            </div>
                            <span
                              className={`dc-admin-confidence ${profile.confidence.toLowerCase()}`}
                            >
                              {profile.confidence}
                            </span>
                          </header>
                          <div className="dc-admin-adaptive-metrics">
                            {ADAPTIVE_METRICS.map(([metric, label]) => {
                              const row = profile.metrics[metric]
                              if (!row) return null
                              return (
                                <div key={metric}>
                                  <span>{copy(label)}</span>
                                  <b>{adaptiveValue(metric, row.median, language)}</b>
                                  <small>
                                    {copy("P75 ")}
                                    {adaptiveValue(metric, row.p75, language)} {copy(" · best")}{" "}
                                    {adaptiveValue(metric, row.best, language)}
                                  </small>
                                </div>
                              )
                            })}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                  <h3>{copy("Последние дела")}</h3>
                  <div className="dc-admin-table">
                    {detail.boards.slice(0, 12).map((board) => (
                      <button
                        key={board.id}
                        className="dc-admin-table-row dc-admin-row-button"
                        onClick={() => {
                          setSection("boards")
                          void openBoard(board.id)
                        }}
                      >
                        <span>{board.mode}</span>
                        <span>{board.status}</span>
                        <span>
                          {board.attempts_used}/{board.max_attempts}
                        </span>
                        <span>
                          {board.contracts
                            .map((item) => `${item.title}: ${item.status}`)
                            .join(" · ") || copy("Без выбранных контрактов")}
                        </span>
                      </button>
                    ))}
                  </div>
                  <h3>{copy("Последние матчи")}</h3>
                  <div className="dc-admin-table">
                    {detail.matches.slice(0, 12).map((match) => (
                      <button
                        key={match.match_id}
                        className="dc-admin-table-row dc-admin-row-button"
                        onClick={() => {
                          setSection("matches")
                          void openMatch(match.match_id)
                        }}
                      >
                        <span>#{match.match_id}</span>
                        <span>{match.mode}</span>
                        <span>
                          {match.duration_s
                            ? copy("{0} мин", { 0: Math.round(match.duration_s / 60) })
                            : "—"}
                        </span>
                        <span>
                          {copy("K/D/A ")}
                          {match.kills ?? "—"}/{match.deaths ?? "—"}/{match.assists ?? "—"}{" "}
                          {copy(" · dmg ")}
                          {match.hero_damage ?? "—"} {copy(" · souls ")}
                          {match.souls ?? "—"}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="dc-admin-two-col">
                    <div>
                      <h3>{copy("Reward ledger")}</h3>
                      <div className="dc-admin-compact-list">
                        {detail.rewards.slice(0, 12).map((item) => (
                          <div key={item.id}>
                            <b>
                              {item.delta > 0 ? "+" : ""}
                              {item.delta} {copy(" XP")}
                            </b>
                            <span>
                              {item.source_type} {copy(" · balance ")}
                              {item.balance_after}
                            </span>
                            <small>{fmt(item.created_at, language)}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3>{copy("Сессии")}</h3>
                      <div className="dc-admin-compact-list">
                        {detail.sessions.map((item, index) => (
                          <div key={index}>
                            <b>
                              {item.admin_elevated ? copy("ADMIN ELEVATED") : copy("WEB SESSION")}
                            </b>
                            <span>
                              {copy("last ")}
                              {fmt(item.last_seen_at, language)}
                            </span>
                            <small>
                              {copy("expires ")}
                              {fmt(item.expires_at, language)}
                            </small>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="dc-admin-two-col">
                    <div>
                      <h3>{copy("Companion events")}</h3>
                      <div className="dc-admin-compact-list">
                        {detail.events.slice(0, 12).map((item, index) => (
                          <div key={index}>
                            <b>{item.event_type}</b>
                            <span>
                              #{item.match_id || "—"} · {item.mode || "—"} · {item.phase || "—"}
                            </span>
                            <small>{fmt(item.created_at, language)}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3>{copy("Audit пользователя")}</h3>
                      <div className="dc-admin-compact-list">
                        {detail.audit.slice(0, 12).map((item) => (
                          <div key={item.id}>
                            <b>{item.action}</b>
                            <span>
                              {item.entity_type}:{item.entity_id}
                            </span>
                            <small>{fmt(item.created_at, language)}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="dc-admin-empty">{copy("Выберите игрока слева.")}</div>
              )}
            </div>
          </div>
        </>
      )}

      {section === "reviews" && (
        <ReviewDesk
          initialItems={reviews}
          csrf={csrf}
          currentUserId={auth.admin.id}
          canForceClaim={["OWNER", "ADMIN"].includes(auth.admin.access_role)}
          reloadAll={reloadAll}
          setError={setError}
          setNotice={setNotice}
        />
      )}

      {section === "packs" && (
        <Suspense fallback={<p role="status">{copy("Конверты / Packs…")}</p>}>
          <OwnerArchiveDesk
            csrf={csrf}
            permissions={auth.permissions}
            isOwner={auth.admin.access_role === "OWNER"}
          />
        </Suspense>
      )}
      {section === "hero_votes" && (
        <Suspense fallback={<p role="status">{copy("Голосование / Hero polls…")}</p>}>
          <HeroVotesDesk csrf={csrf} permissions={auth.permissions} />
        </Suspense>
      )}
      {section === "cards" && (
        <Suspense fallback={<p role="status">{copy("Карточки / Cards…")}</p>}>
          <CardReviewDesk csrf={csrf} />
        </Suspense>
      )}
      {section === "bureau_reports" && (
        <Suspense fallback={<p role="status">{copy("Открываем обращения…")}</p>}>
          <BureauModerationDesk csrf={csrf} />
        </Suspense>
      )}

      {section === "announcements" && (
        <AnnouncementCenter
          csrf={csrf}
          permissions={auth.permissions}
          setError={setError}
          setNotice={setNotice}
        />
      )}

      {section === "matches" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              inputMode="numeric"
              placeholder={copy("Match ID")}
              value={matchQuery}
              onChange={(event) => setMatchQuery(event.target.value.replace(/\D/g, ""))}
            />
            <select value={matchMode} onChange={(event) => setMatchMode(event.target.value)}>
              <option value="ALL">{copy("Все режимы")}</option>
              <option value="STANDARD">{copy("STANDARD")}</option>
              <option value="RANKED">{copy("RANKED")}</option>
              <option value="STREET_BRAWL">{copy("STREET_BRAWL")}</option>
              <option value="UNKNOWN">{copy("UNKNOWN")}</option>
            </select>
            <select value={matchScoring} onChange={(event) => setMatchScoring(event.target.value)}>
              <option value="ALL">{copy("Любой scoring")}</option>
              <option value="SCORED">{copy("SCORED")}</option>
              <option value="NOT_SCORED">{copy("NOT_SCORED")}</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("matches")}>
              {copy("Найти")}
            </button>
          </div>
          <div className={`dc-admin-master-detail ${matchDetail ? "has-detail" : ""}`}>
            <div className="dc-admin-master-list">
              {!matches.length && (
                <div className="dc-admin-empty">{copy("Нет записей по выбранным фильтрам.")}</div>
              )}
              {matches.map((item) => (
                <button key={item.match_id} onClick={() => void openMatch(item.match_id)}>
                  <b>#{item.match_id}</b>
                  <span>
                    {item.mode} · {item.scoring_status}
                  </span>
                  <small>
                    {fmt(item.started_at, language)} · {item.participants} {copy(" игроков · ")}
                    {item.bound_contracts} {copy("contracts · ")}
                    {item.reviews} {copy(" review")}
                  </small>
                </button>
              ))}
            </div>
            <div className="dc-admin-detail-pane">
              {matchDetail ? (
                <>
                  <button
                    type="button"
                    className="dc-admin-mobile-back"
                    onClick={() => setMatchDetail(null)}
                  >
                    {copy("← К списку матчей")}
                  </button>
                  <h2>
                    {copy("Матч #")}
                    {matchDetail.match.match_id}
                  </h2>
                  <div className="dc-admin-mini-grid">
                    <div>
                      <span>{copy("MODE")}</span>
                      <b>{matchDetail.match.mode}</b>
                    </div>
                    <div>
                      <span>{copy("PROVIDER")}</span>
                      <b>{matchDetail.match.provider}</b>
                    </div>
                    <div>
                      <span>{copy("CONFIDENCE")}</span>
                      <b>{matchDetail.match.mode_confidence}</b>
                    </div>
                    <div>
                      <span>{copy("FINAL")}</span>
                      <b>{matchDetail.match.is_final ? copy("YES") : copy("NO")}</b>
                    </div>
                  </div>
                  <h3>{copy("Capabilities")}</h3>
                  <p className="dc-admin-code-line">
                    {matchDetail.match.capabilities.join(" · ") || "—"}
                  </p>
                  <h3>{copy("Участники")}</h3>
                  <pre>{JSON.stringify(matchDetail.participants, null, 2)}</pre>
                  <h3>{copy("Привязанные контракты")}</h3>
                  <pre>{JSON.stringify(matchDetail.contracts, null, 2)}</pre>
                  <h3>{copy("Review / Companion evidence")}</h3>
                  <pre>
                    {JSON.stringify(
                      {
                        reviews: matchDetail.reviews,
                        companion_evidence: matchDetail.companion_evidence,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </>
              ) : (
                <div className="dc-admin-empty">{copy("Выберите матч.")}</div>
              )}
            </div>
          </div>
        </>
      )}

      {section === "boards" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              placeholder={copy("Board ID, игрок, SteamID, baseline")}
              value={boardQuery}
              onChange={(event) => setBoardQuery(event.target.value)}
            />
            <select value={boardMode} onChange={(event) => setBoardMode(event.target.value)}>
              <option value="ALL">{copy("Все режимы")}</option>
              <option value="STANDARD">{copy("STANDARD")}</option>
              <option value="RANKED">{copy("RANKED")}</option>
              <option value="STREET_BRAWL">{copy("STREET_BRAWL")}</option>
            </select>
            <select value={boardStatus} onChange={(event) => setBoardStatus(event.target.value)}>
              <option value="ALL">{copy("Все статусы")}</option>
              <option value="OFFERED">{copy("OFFERED")}</option>
              <option value="LOCKED">{copy("LOCKED")}</option>
              <option value="VERIFYING">{copy("VERIFYING")}</option>
              <option value="REVIEW_REQUIRED">{copy("REVIEW_REQUIRED")}</option>
              <option value="SETTLED">{copy("SETTLED")}</option>
              <option value="EXPIRED">{copy("EXPIRED")}</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("boards")}>
              {copy("Найти")}
            </button>
          </div>
          <div className={`dc-admin-master-detail ${boardDetail ? "has-detail" : ""}`}>
            <div className="dc-admin-master-list">
              {!boards.length && (
                <div className="dc-admin-empty">{copy("Нет записей по выбранным фильтрам.")}</div>
              )}
              {boards.map((item) => (
                <button key={item.board.id} onClick={() => void openBoard(item.board.id)}>
                  <b>{item.user.display_name}</b>
                  <span>
                    {item.board.mode} · {item.board.status}
                  </span>
                  <small>
                    {item.board.id.slice(0, 8)} · {item.board.generator_version || "legacy"} ·{" "}
                    {item.board.attempts_used}/{item.board.max_attempts}
                  </small>
                </button>
              ))}
            </div>
            <div className="dc-admin-detail-pane">
              {boardDetail ? (
                <>
                  <button
                    type="button"
                    className="dc-admin-mobile-back"
                    onClick={() => setBoardDetail(null)}
                  >
                    {copy("← К списку дел")}
                  </button>
                  <div className="dc-admin-detail-head">
                    <div>
                      <p className="dc-eyebrow">
                        {boardDetail.board.generator_version || copy("LEGACY GENERATOR")}
                      </p>
                      <h2>
                        {copy("Дело ")}
                        {boardDetail.board.id.slice(0, 8)}
                      </h2>
                      <p>
                        {boardDetail.user?.display_name} · {boardDetail.user?.steam_id64}
                      </p>
                    </div>
                    {boardDetail.board.status === "VERIFYING" && (
                      <button
                        className="dc-primary"
                        disabled={busy}
                        onClick={() => void retryBoardVerification(boardDetail.board.id)}
                      >
                        {busy ? copy("Ставим в очередь…") : copy("RECHECK VERIFYING")}
                      </button>
                    )}
                  </div>
                  <div className="dc-admin-mini-grid">
                    <div>
                      <span>{copy("MODE")}</span>
                      <b>{boardDetail.board.mode}</b>
                    </div>
                    <div>
                      <span>{copy("STATUS")}</span>
                      <b>{boardDetail.board.status}</b>
                    </div>
                    <div>
                      <span>{copy("BASELINE MATCH")}</span>
                      <b>{boardDetail.board.baseline_match_id || "—"}</b>
                    </div>
                    <div>
                      <span>{copy("ATTEMPTS")}</span>
                      <b>
                        {boardDetail.board.attempts_used}/{boardDetail.board.max_attempts}
                      </b>
                    </div>
                  </div>
                  <h3>{copy("Контракты / Adaptive trace")}</h3>
                  <div className="dc-admin-option-stack">
                    {boardDetail.options.map((option) => {
                      const row = option as Record<string, unknown>
                      const adaptive = adaptiveMeta(row)
                      return (
                        <article
                          className={`dc-panel ${
                            String(row.status) === "VERIFYING" ? "dc-admin-health-warn" : ""
                          }`}
                          key={String(row.id)}
                        >
                          <header>
                            <div>
                              <b>{String(row.title || copy("Contract"))}</b>
                              <small>
                                {String(row.metric)} {copy(" · target ")}
                                {String(row.target)} · {String(row.reward_xp)} {copy(" XP")}
                              </small>
                            </div>
                            <span>{String(row.status)}</span>
                          </header>
                          <div className="dc-admin-mini-grid">
                            <div>
                              <span>{copy("ADAPTIVE")}</span>
                              <b>{adaptive.enabled ? adaptive.kind : copy("WILDCARD / OFF")}</b>
                            </div>
                            <div>
                              <span>{copy("CONFIDENCE")}</span>
                              <b>{adaptive.confidence}</b>
                            </div>
                            <div>
                              <span>{copy("SAMPLE")}</span>
                              <b>{adaptive.sample}</b>
                            </div>
                            <div>
                              <span>{copy("BOUND MATCH")}</span>
                              <b>{String(row.bound_match_id || "—")}</b>
                            </div>
                          </div>
                          {adaptive.weakest && (
                            <p className="dc-admin-code-line">
                              {copy("weakest: ")}
                              {adaptive.weakest}
                            </p>
                          )}
                          {adaptive.basis.length > 0 && (
                            <details>
                              <summary>{copy("Why this contract / basis")}</summary>
                              <pre>{JSON.stringify(adaptive.basis, null, 2)}</pre>
                            </details>
                          )}
                          <small>{String(row.explanation || "")}</small>
                        </article>
                      )
                    })}
                  </div>
                  <details>
                    <summary>{copy("Raw board payload")}</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          seed: boardDetail.board.seed,
                          options: boardDetail.options,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  <h3>{copy("Evaluations")}</h3>
                  <pre>{JSON.stringify(boardDetail.evaluations, null, 2)}</pre>
                  <h3>{copy("Jobs / Reviews")}</h3>
                  <pre>
                    {JSON.stringify(
                      { jobs: boardDetail.jobs, reviews: boardDetail.reviews },
                      null,
                      2,
                    )}
                  </pre>
                </>
              ) : (
                <div className="dc-admin-empty">{copy("Выберите дело.")}</div>
              )}
            </div>
          </div>
        </>
      )}

      {section === "companions" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              placeholder={copy("Игрок, device ID, SteamID, Match ID")}
              value={companionQuery}
              onChange={(event) => setCompanionQuery(event.target.value)}
            />
            <select
              value={companionState}
              onChange={(event) => setCompanionState(event.target.value)}
            >
              <option value="ALL">{copy("Все устройства")}</option>
              <option value="ONLINE">{copy("Online")}</option>
              <option value="ACTIVE">{copy("Активные")}</option>
              <option value="REVOKED">{copy("Отозванные")}</option>
            </select>
            <select
              value={companionVersion}
              onChange={(event) => setCompanionVersion(event.target.value)}
            >
              <option value="ALL">{copy("Все версии")}</option>
              {Object.keys(companionVersions)
                .sort()
                .map((value) => (
                  <option key={value}>{value}</option>
                ))}
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("companions")}>
              {copy("Применить")}
            </button>
          </div>
          <div className="dc-admin-companion-grid">
            {!companions.length && (
              <div className="dc-admin-empty">{copy("Нет записей по выбранным фильтрам.")}</div>
            )}
            {companions.map((item) => (
              <article key={item.id} className={`dc-panel ${item.status.online ? "online" : ""}`}>
                <header>
                  <div>
                    <b>{item.user.display_name}</b>
                    <small>{item.user.steam_id64}</small>
                  </div>
                  <span>
                    {item.status.online
                      ? copy("ONLINE")
                      : item.revoked_at
                        ? copy("REVOKED")
                        : copy("OFFLINE")}
                  </span>
                </header>
                <p className="dc-admin-code-line">{item.device_id}</p>
                <div className="dc-admin-mini-grid">
                  <div>
                    <span>{copy("VERSION")}</span>
                    <b>{item.status.version || "—"}</b>
                  </div>
                  <div>
                    <span>{copy("GEP")}</span>
                    <b>{item.status.gep_version || "—"}</b>
                  </div>
                  <div>
                    <span>{copy("MODE")}</span>
                    <b>{item.status.game_match_mode || "—"}</b>
                  </div>
                  <div>
                    <span>{copy("MATCH")}</span>
                    <b>{item.status.current_match_id || "—"}</b>
                  </div>
                </div>
                <small>
                  {copy("last seen ")}
                  {fmt(item.status.last_seen_at, language)} {copy(" · identity")}{" "}
                  {String(item.status.identity_ok ?? "—")}
                </small>
                {!item.revoked_at && (
                  <button className="dc-ghost" onClick={() => void revokeDevice(item)}>
                    {copy("Отозвать устройство")}
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {section === "missions" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              placeholder={copy("Key, название или metric")}
              value={missionQuery}
              onChange={(event) => setMissionQuery(event.target.value)}
            />
            <select value={missionMode} onChange={(event) => setMissionMode(event.target.value)}>
              <option value="ALL">{copy("Все режимы")}</option>
              <option value="STANDARD">{copy("STANDARD")}</option>
              <option value="RANKED">{copy("RANKED")}</option>
              <option value="STREET_BRAWL">{copy("STREET_BRAWL")}</option>
            </select>
            <select
              value={missionStatus}
              onChange={(event) => setMissionStatus(event.target.value)}
            >
              <option value="ALL">{copy("Все статусы")}</option>
              <option value="PUBLISHED">{copy("PUBLISHED")}</option>
              <option value="DISABLED">{copy("DISABLED")}</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("missions")}>
              {copy("Найти")}
            </button>
          </div>
          <div className={`dc-admin-master-detail ${missionDraft ? "has-detail" : ""}`}>
            <div className="dc-admin-master-list">
              {!missions.length && (
                <div className="dc-admin-empty">{copy("Нет записей по выбранным фильтрам.")}</div>
              )}
              {missions.map((item) => (
                <button
                  key={item.id}
                  className={selectedMission?.id === item.id ? "active" : ""}
                  onClick={() => chooseMission(item)}
                >
                  <b>{item.title}</b>
                  <span>
                    {item.game_match_mode} · {item.rarity} · {item.difficulty}
                  </span>
                  <small>
                    {item.key} {copy(" v")}
                    {item.version} · {item.metric} {item.operator} {item.target} · {item.reward_xp}{" "}
                    {copy(" XP")}
                  </small>
                </button>
              ))}
            </div>
            <div className="dc-admin-detail-pane">
              {missionDraft ? (
                <>
                  <button
                    type="button"
                    className="dc-admin-mobile-back"
                    onClick={() => {
                      setSelectedMission(null)
                      setMissionDraft(null)
                    }}
                  >
                    {copy("← К каталогу контрактов")}
                  </button>
                  <div className="dc-admin-detail-head">
                    <div>
                      <p className="dc-eyebrow">
                        {missionDraft.key} {copy(" / V")}
                        {missionDraft.version}
                      </p>
                      <h2>{missionDraft.title}</h2>
                    </div>
                    {auth.can_manage_roles && (
                      <button
                        className="dc-primary"
                        disabled={busy}
                        onClick={() => void saveMission()}
                      >
                        {copy("Сохранить")}
                      </button>
                    )}
                  </div>
                  <div className="dc-admin-form-grid">
                    <label>
                      {copy("Название (RU)")}
                      <input
                        disabled={!auth.can_manage_roles}
                        value={missionDraft.title}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            title: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      {copy("Title (EN)")}
                      <input
                        disabled={!auth.can_manage_roles}
                        value={missionDraft.title_en || ""}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            title_en: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      {copy("Status")}
                      <select
                        disabled={!auth.can_manage_roles}
                        value={missionDraft.status}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            status: event.target.value,
                          })
                        }
                      >
                        <option value="PUBLISHED">{copy("PUBLISHED")}</option>
                        <option value="DRAFT">{copy("DRAFT")}</option>
                        <option value="DISABLED">{copy("DISABLED")}</option>
                      </select>
                    </label>
                    <label>
                      {copy("Target")}
                      <input
                        disabled={!auth.can_manage_roles}
                        type="number"
                        value={missionDraft.target}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            target: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      {copy("Reward XP")}
                      <input
                        disabled={!auth.can_manage_roles}
                        type="number"
                        value={missionDraft.reward_xp}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            reward_xp: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      {copy("Base XP")}
                      <input
                        disabled={!auth.can_manage_roles}
                        type="number"
                        value={missionDraft.base_xp}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            base_xp: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      {copy("Difficulty")}
                      <select
                        disabled={!auth.can_manage_roles}
                        value={missionDraft.difficulty}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            difficulty: event.target.value,
                          })
                        }
                      >
                        <option value="LIGHT">{copy("LIGHT")}</option>
                        <option value="FOCUSED">{copy("FOCUSED")}</option>
                        <option value="HARD">{copy("HARD")}</option>
                        <option value="EXTREME">{copy("EXTREME")}</option>
                      </select>
                    </label>
                    <label>
                      {copy("Rarity")}
                      <select
                        disabled={!auth.can_manage_roles}
                        value={missionDraft.rarity}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            rarity: event.target.value,
                          })
                        }
                      >
                        <option value="COMMON">{copy("COMMON")}</option>
                        <option value="UNCOMMON">{copy("UNCOMMON")}</option>
                        <option value="RARE">{copy("RARE")}</option>
                        <option value="EPIC">{copy("EPIC")}</option>
                      </select>
                    </label>
                    <label>
                      {copy("Category")}
                      <select
                        disabled={!auth.can_manage_roles}
                        value={missionDraft.category}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            category: event.target.value,
                          })
                        }
                      >
                        <option value="COMBAT">{copy("COMBAT")}</option>
                        <option value="SUPPORT">{copy("SUPPORT")}</option>
                        <option value="ECONOMY">{copy("ECONOMY")}</option>
                        <option value="SURVIVAL">{copy("SURVIVAL")}</option>
                      </select>
                    </label>
                    <label>
                      {copy("Drop weight")}
                      <input
                        disabled={!auth.can_manage_roles}
                        type="number"
                        step="0.01"
                        value={missionDraft.drop_weight}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            drop_weight: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      {copy("Chance %")}
                      <input
                        disabled={!auth.can_manage_roles}
                        type="number"
                        step="0.1"
                        value={missionDraft.drop_chance_pct}
                        onChange={(event) =>
                          setMissionDraft({
                            ...missionDraft,
                            drop_chance_pct: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="dc-admin-full-field">
                    {copy("Описание (RU)")}
                    <textarea
                      disabled={!auth.can_manage_roles}
                      rows={4}
                      value={missionDraft.description}
                      onChange={(event) =>
                        setMissionDraft({
                          ...missionDraft,
                          description: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="dc-admin-full-field">
                    {copy("Description (EN)")}
                    <textarea
                      disabled={!auth.can_manage_roles}
                      rows={4}
                      value={missionDraft.description_en || ""}
                      onChange={(event) =>
                        setMissionDraft({
                          ...missionDraft,
                          description_en: event.target.value,
                        })
                      }
                    />
                  </label>
                  <div className="dc-admin-kv">
                    <span>{copy("METRIC")}</span>
                    <b>
                      {missionDraft.metric} {missionDraft.operator} {missionDraft.target}
                    </b>
                  </div>
                  <div className="dc-admin-kv">
                    <span>{copy("CAPABILITIES")}</span>
                    <b>{missionDraft.required_capabilities.join(", ") || "—"}</b>
                  </div>
                  <small>
                    {copy(
                      "Изменение PUBLISHED создаёт новую DRAFT-версию: проверьте RU/EN preview и только потом переключите её в PUBLISHED. Предыдущая версия автоматически отключается, но остаётся доступной для rollback. Contracts 2.0 использует Status, Drop weight, Category, Metric и Capabilities как атомы генерации. Target / Reward XP / Base XP остаются reference/legacy-полями: цели и награда новых динамических контрактов рассчитываются генератором. Уже выданные BoardOption хранят собственные snapshot-поля.",
                    )}
                  </small>
                </>
              ) : (
                <div className="dc-admin-empty">{copy("Выберите шаблон контракта.")}</div>
              )}
            </div>
          </div>
        </>
      )}

      {section === "generator" && (
        <>
          <article className="dc-panel dc-admin-generator-head">
            <div>
              <p className="dc-eyebrow">{copy("CONTRACT FACTORY / DRY RUN")}</p>
              <h2>{copy("Generator Lab")}</h2>
              <p>
                {copy(
                  "Contracts 2.0 собирает новые цели и составные условия детерминированно. Preview ничего не пишет в БД и показывает реальное разнообразие будущих досок.",
                )}
              </p>
            </div>
            <div className="dc-admin-filterbar">
              <select
                value={generatorMode}
                onChange={(event) => setGeneratorMode(event.target.value as Mode)}
              >
                <option value="STANDARD">{copy("STANDARD")}</option>
                <option value="RANKED">{copy("RANKED")}</option>
                <option value="STREET_BRAWL">{copy("STREET_BRAWL")}</option>
              </select>
              <input
                type="number"
                min="1"
                max="40"
                value={generatorBoards}
                onChange={(event) => setGeneratorBoards(event.target.value)}
              />
              <input
                value={generatorSeed}
                onChange={(event) =>
                  setGeneratorSeed(event.target.value.replace(/[^A-Za-z0-9._:-]/g, ""))
                }
              />
              <button className="dc-primary" disabled={busy} onClick={() => void runGenerator()}>
                {busy ? copy("Генерируем…") : copy("Сгенерировать preview")}
              </button>
            </div>
          </article>
          {generator && (
            <>
              <div className="dc-admin-grid">
                <article>
                  <span>{copy("ШАБЛОНОВ / МЕТРИК")}</span>
                  <b>
                    {generator.stats.templates_available} /{" "}
                    {generator.stats.metrics_available ?? "—"}
                  </b>
                </article>
                <article>
                  <span>{copy("ДОСОК")}</span>
                  <b>{generator.stats.boards_generated}</b>
                </article>
                <article>
                  <span>{copy("УНИКАЛЬНЫХ")}</span>
                  <b>{generator.stats.unique_boards}</b>
                </article>
                <article className={generator.stats.duplicate_boards ? "warn" : ""}>
                  <span>{copy("ДУБЛЕЙ")}</span>
                  <b>{generator.stats.duplicate_boards}</b>
                </article>
              </div>
              <div className="dc-admin-panel-grid">
                <article className="dc-panel">
                  <h3>{copy("Категории")}</h3>
                  {kv(generator.stats.categories)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Редкости")}</h3>
                  {kv(generator.stats.rarities)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Сложность")}</h3>
                  {kv(generator.stats.difficulties)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Число условий")}</h3>
                  {kv(generator.stats.condition_counts || {})}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Частые базовые атомы")}</h3>
                  {generator.stats.contract_frequency.slice(0, 8).map((item) => (
                    <div className="dc-admin-kv" key={item.key}>
                      <span>{item.key}</span>
                      <b>{item.slot_pct}%</b>
                    </div>
                  ))}
                </article>
              </div>
              <div className="dc-admin-generator-boards">
                {generator.boards.slice(0, 12).map((board) => (
                  <article className="dc-panel" key={board.seed}>
                    <header>
                      <b>{board.seed}</b>
                      <small>{board.fingerprint}</small>
                    </header>
                    {board.contracts.map((item) => (
                      <div key={item.id}>
                        <span>{item.title}</span>
                        <small>
                          {item.rarity} · {item.difficulty} · {item.category} ·{" "}
                          {item.conditions?.length || 1} {copy(" усл. · ")}
                          {item.reward_xp} {copy(" XP")}
                        </small>
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {section === "jobs" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              placeholder={copy("type, idempotency key, error")}
              value={jobQuery}
              onChange={(event) => setJobQuery(event.target.value)}
            />
            <select value={jobStatus} onChange={(event) => setJobStatus(event.target.value)}>
              <option value="ALL">{copy("Все статусы")}</option>
              <option value="PENDING">{copy("PENDING")}</option>
              <option value="RUNNING">{copy("RUNNING")}</option>
              <option value="DONE">{copy("DONE")}</option>
              <option value="FAILED">{copy("FAILED")}</option>
            </select>
            <select value={jobType} onChange={(event) => setJobType(event.target.value)}>
              <option value="ALL">{copy("Все типы")}</option>
              <option value="discover_match">{copy("discover_match")}</option>
              <option value="resolve_companion_match">{copy("resolve_companion_match")}</option>
              <option value="resolve_companion_match_auto">
                {copy("resolve_companion_match_auto")}
              </option>
              <option value="evaluate_match">{copy("evaluate_match")}</option>
              <option value="refresh_review_match">{copy("refresh_review_match")}</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("jobs")}>
              {copy("Применить")}
            </button>
          </div>
          <div className="dc-admin-list">
            {!jobs.length && (
              <div className="dc-admin-empty">{copy("Нет записей по выбранным фильтрам.")}</div>
            )}
            {jobs.map((job) => (
              <article
                key={job.id}
                className={`dc-admin-job ${job.status === "FAILED" ? "failed" : ""}`}
              >
                <header>
                  <div>
                    <b>{job.type}</b>
                    <small>
                      {job.id.slice(0, 8)} · {fmt(job.created_at, language)}
                    </small>
                  </div>
                  <span>
                    {job.status} · {job.attempts}/{job.max_attempts}
                  </span>
                </header>
                {job.last_error && <pre>{job.last_error}</pre>}
                <small>{job.idempotency_key}</small>
                <details>
                  <summary>{copy("Payload")}</summary>
                  <pre>{JSON.stringify(job.payload || {}, null, 2)}</pre>
                </details>
                {job.status === "FAILED" && (
                  <button className="dc-ghost" onClick={() => void retryJob(job)}>
                    {copy("Повторить безопасно")}
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {section === "outbox" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              placeholder={copy("event id, aggregate, type, error")}
              value={outboxQuery}
              onChange={(event) => setOutboxQuery(event.target.value)}
            />
            <select value={outboxState} onChange={(event) => setOutboxState(event.target.value)}>
              <option value="ALL">{copy("Все состояния")}</option>
              <option value="PENDING">{copy("PENDING")}</option>
              <option value="RETRYING">{copy("RETRYING")}</option>
              <option value="DEAD_LETTER">{copy("DEAD_LETTER")}</option>
              <option value="PUBLISHED">{copy("PUBLISHED")}</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("outbox")}>
              {copy("Применить")}
            </button>
            <small>
              {outboxTotal} {copy(" событий")}
            </small>
          </div>
          <div className="dc-admin-list">
            {!outbox.length && (
              <div className="dc-admin-empty">{copy("Нет записей по выбранным фильтрам.")}</div>
            )}
            {outbox.map((event) => (
              <article
                key={event.id}
                className={`dc-admin-job ${event.state === "DEAD_LETTER" ? "failed" : ""}`}
              >
                <header>
                  <div>
                    <b>{event.event_type}</b>
                    <small>
                      {event.id.slice(0, 8)} {copy(" · aggregate ")}
                      {event.aggregate_id} · {fmt(event.created_at, language)}
                    </small>
                  </div>
                  <span>
                    {event.state} {copy(" · attempts ")}
                    {event.attempts}
                  </span>
                </header>
                {event.last_error && <pre>{event.last_error}</pre>}
                <small>
                  {copy("next: ")}
                  {fmt(event.run_after, language)}
                </small>
                <details>
                  <summary>{copy("Immutable payload")}</summary>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </details>
                {event.state === "DEAD_LETTER" && (
                  <button className="dc-ghost" onClick={() => void replayOutbox(event)}>
                    {copy("Replay с audit reason")}
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {section === "audit" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              placeholder={copy("action, entity type, entity id")}
              value={auditQuery}
              onChange={(event) => setAuditQuery(event.target.value)}
            />
            <button className="dc-ghost" onClick={() => void loadSection("audit")}>
              {copy("Найти")}
            </button>
            <small>
              {auditTotal} {copy(" событий")}
            </small>
          </div>
          <div className="dc-admin-list">
            {!audit.length && (
              <div className="dc-admin-empty">{copy("Нет записей по выбранным фильтрам.")}</div>
            )}
            {audit.map((item) => (
              <article key={item.id} className="dc-admin-audit">
                <header>
                  <b>{item.action}</b>
                  <span>{fmt(item.created_at, language)}</span>
                </header>
                <p>
                  {item.actor || "system"} → {item.entity_type}:{item.entity_id}
                </p>
                <pre>{JSON.stringify(item.data, null, 2)}</pre>
              </article>
            ))}
          </div>
        </>
      )}

      {section === "system" && (
        <>
          {system ? (
            <>
              <div className="dc-admin-system-grid">
                <article className="dc-panel">
                  <h3>{copy("Release")}</h3>
                  {kv(system.release)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Provider")}</h3>
                  {kv(system.provider)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Contracts")}</h3>
                  {kv(system.contracts)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Companion")}</h3>
                  {kv(system.companion)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Security")}</h3>
                  {kv(system.security)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Rate limits")}</h3>
                  {kv(system.limits)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Database")}</h3>
                  {kv(system.database)}
                </article>
                <article className="dc-panel">
                  <h3>{copy("Counts")}</h3>
                  {kv(system.counts)}
                </article>
              </div>
              <article className="dc-panel">
                <small>
                  {copy(
                    "Секреты, токены, пароли и значения Docker secrets намеренно не доступны через этот endpoint.",
                  )}
                </small>
              </article>
            </>
          ) : (
            <article className="dc-panel">
              <h2>{copy("Загрузка…")}</h2>
            </article>
          )}
        </>
      )}
    </section>
  )
}
