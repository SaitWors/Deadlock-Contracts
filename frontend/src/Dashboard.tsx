import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import markImage from "@/imports/mark.svg"
import curatorImage from "@/imports/curator-optimized.webp"
import ProfileStudio from "./ProfileStudio"
import BureauHeader from "./BureauHeader"
import Leaderboard from "./community/Leaderboard"
import Achievements from "./community/Achievements"
import Bureaus from "./community/Bureaus"
import ContractSigning from "./ContractSigning"
import { signSelection, selectionState, type SigningSelection } from "./contract-signing"
import { prefersReducedMotion, useRipple, useTilt } from "./motion"
import AnnouncementCenter from "./admin/AnnouncementCenter"
import ReviewDesk from "./admin/ReviewDesk"
import type { AdminReview } from "./admin/admin-types"
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
  | "overview"
  | "users"
  | "reviews"
  | "bureau_reports"
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
  overview: "admin.overview.read",
  users: "users.read",
  reviews: "reviews.read",
  bureau_reports: "bureaus.moderate",
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
  ["announcements", "Уведомления"],
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
  | "home"
  | "quests"
  | "active"
  | "history"
  | "profile"
  | "admin"
  | "leaderboard"
  | "achievements"
  | "bureaus"
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
    return `${option.conditions!.length} ${language === "ru" ? "УСЛОВИЯ" : "CONDITIONS"}`
  return conditionText(
    {
      metric: option.metric,
      operator: option.operator,
      target: Number(option.target),
    },
    language,
  ).toUpperCase()
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
const categoryGlyph = (value: string) =>
  ({ COMBAT: "⌁", SUPPORT: "＋", ECONOMY: "◇", SURVIVAL: "◉", ALL: "◆" })[value] || "◆"
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
const phaseLabel = (value?: string | null, language: Language = "ru") =>
  t(
    language,
    {
      Init: "Инициализация",
      WaitingForPlayersToJoin: "Ожидание игроков",
      PreGameWait: "Подготовка к матчу",
      GameInProgress: "Матч идёт",
      PostGame: "Матч завершён",
      GameOver: "Матч завершён",
    }[value || ""] || (value ? "Неизвестная фаза" : "—"),
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
  const glyphs: Record<string, React.ReactNode> = {
    crown: (
      <>
        <path d="M3.5 8.5 7 12l5-7 5 7 3.5-3.5-1.6 9.5H5.1z" />
        <path d="M6 20h12" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 4.8 6v5.2c0 4.7 2.8 7.8 7.2 9.8 4.4-2 7.2-5.1 7.2-9.8V6z" />
        <path d="M12 8v7M8.5 11.5h7" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3.1" />
        <path d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4M18.5 18.5l-1.4-1.4M6.9 6.9 5.5 5.5" />
        <circle cx="12" cy="12" r="7.1" />
      </>
    ),
    stream: (
      <>
        <path d="M5 4h14v11l-4 4h-3l-2 2v-2H5z" />
        <path d="M10 8v5M14 8v5" />
      </>
    ),
    flask: (
      <>
        <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" />
        <path d="M8 15h8" />
      </>
    ),
    star: <path d="m12 3 2.2 5.3L20 9l-4.3 3.8 1.3 5.7-5-3-5 3 1.3-5.7L4 9l5.8-.7z" />,
    player: (
      <>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      </>
    ),
  }
  return (
    <svg
      className="dc-role-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyphs[name]}
    </svg>
  )
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
  const paths: Record<string, React.ReactNode> = {
    hq: (
      <>
        <path d="M4 19V9l8-5 8 5v10" />
        <path d="M8 19v-6h8v6" />
      </>
    ),
    contract: (
      <>
        <path d="M7 3h10l3 3v15H7z" />
        <path d="M17 3v4h4" />
        <path d="M10 11h7M10 15h7" />
      </>
    ),
    case: (
      <>
        <path d="M4 7h16v12H4z" />
        <path d="M8 7V5h8v2M9 12h6" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    admin: (
      <>
        <path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="dc-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function ModeTabs({
  value,
  onChange,
  boards,
}: {
  value: Mode
  onChange: (mode: Mode) => void
  boards: Board[]
}) {
  const ripple = useRipple()
  const { language } = useLanguage()
  return (
    <div className="dc-v3-mode-tabs">
      {MODES.map((mode) => {
        const board = boards.find((item) => item.game_match_mode === mode)
        return (
          <button
            key={mode}
            type="button"
            className={value === mode ? "active" : ""}
            onClick={(e) => {
              ripple(e)
              onChange(mode)
            }}
          >
            <span>{MODE_META[mode].short}</span>
            <small>{board ? statusLabel(board.status, language) : t(language, "ЗАГРУЗКА")}</small>
          </button>
        )
      })}
    </div>
  )
}

export default function Dashboard({ initialSession }: { initialSession: SessionPayload }) {
  const { language, locale } = useLanguage()
  const [user, setUser] = useState(initialSession.user)
  const [csrf] = useState(initialSession.csrf_token)
  const tabFromLocation = (): Tab => {
    const hash = window.location.hash.slice(1).split("/")[0]
    if (hash === "leaderboards") return "leaderboard"
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
      ].includes(hash)
    )
      return hash as Tab
    return window.location.pathname.startsWith("/admin/") ? "admin" : "home"
  }
  const [tab, setTabState] = useState<Tab>(tabFromLocation)
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
      setTabState(tabFromLocation())
      setBureauSlug(window.location.hash.match(/^#bureaus\/([a-z0-9-]{3,32})$/)?.[1] || "")
      window.scrollTo({ top: 0, behavior: "instant" })
    }
    window.addEventListener("hashchange", apply)
    return () => window.removeEventListener("hashchange", apply)
  }, [])
  const [mode, setMode] = useState<Mode>("STANDARD")
  const [filter, setFilter] = useState<QuestFilter>("ALL")
  const [boardsPayload, setBoardsPayload] = useState<BoardsPayload | null>(null)
  const [historyCases, setHistoryCases] = useState<HistoryCase[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [progression, setProgression] = useState<Progression | null>(null)
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
  const xpRef = useRef<HTMLSpanElement>(null)
  const ripple = useRipple()
  const cardTilt = useTilt(2)
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
    const data = await api<BoardsPayload>("/api/boards/today", csrf)
    if (request !== boardsRequest.current) return
    setBoardsPayload(data)
    setSelected((previous) => {
      const next = { ...previous }
      for (const board of data.boards) {
        const locked = board.options.filter((option) => option.selected).map((option) => option.id)
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
  }, [csrf])
  const loadHistory = useCallback(async () => {
    const data = await api<{ cases: HistoryCase[]; total: number }>(
      "/api/history?limit=100&offset=0",
      csrf,
    )
    setHistoryCases(data.cases)
    setHistoryTotal(data.total)
  }, [csrf])
  const loadMoreHistory = useCallback(async () => {
    const data = await api<{ cases: HistoryCase[]; total: number }>(
      `/api/history?limit=100&offset=${historyCases.length}`,
      csrf,
    )
    setHistoryCases((current) => [
      ...current,
      ...data.cases.filter(
        (next) => !current.some((existing) => existing.board_id === next.board_id),
      ),
    ])
    setHistoryTotal(data.total)
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
        items: historyCase.items,
        mode: historyCase.game_match_mode,
        matchId:
          historyCase.items.find((item) => item.match_id)?.match_id ||
          historyCase.items.find((item) => item.last_attempt_match_id)?.last_attempt_match_id ||
          null,
        attemptsUsed: historyCase.attempts_used || 0,
        maxAttempts: historyCase.max_attempts || 3,
        date: historyCase.settled_at || historyCase.locked_at,
      }))
  }, [historyCases, historyMode])

  const shownName = safeName(user.display_name, language)
  const level = progression?.level || 1
  const progressPct = progression?.progress_pct || 0
  const nav: Array<[Tab, string, "hq" | "contract" | "case" | "profile" | "admin"]> = [
    ["home", language === "ru" ? "ГЛАВНАЯ" : "HOME", "hq"],
    ["quests", language === "ru" ? "КОНТРАКТЫ" : "CONTRACTS", "contract"],
    ["active", language === "ru" ? "АКТИВНОЕ ДЕЛО" : "ACTIVE CASE", "case"],
    ["history", language === "ru" ? "АРХИВ" : "ARCHIVE", "case"],
    ["achievements", language === "ru" ? "ДОСТИЖЕНИЯ" : "ACHIEVEMENTS", "case"],
    ["bureaus", language === "ru" ? "БЮРО ИГРОКОВ" : "PLAYER BUREAUS", "hq"],
    ["leaderboard", language === "ru" ? "РЕЙТИНГ" : "LEADERBOARD", "case"],
    ["profile", language === "ru" ? "ПРОФИЛЬ" : "PROFILE", "profile"],
  ]
  if (user.is_staff) nav.push(["admin", "ADMIN", "admin"])

  return (
    <div className="dc-dashboard dc-redesign dc-v3 dc-vnext bureau-app min-h-screen community-dashboard">
      {signing && (
        <ContractSigning
          mode={MODE_META[signing.board.game_match_mode].title}
          operator={shownName}
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
        active={tab}
        items={nav
          .filter(([id]) => !["home", "profile", "active"].includes(id))
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
                    ? "IN GAME"
                    : "ONLINE"
                  : companion?.paired
                    ? "OFFLINE"
                    : "COMPANION"}
              </span>
            </button>
            <button
              className="dc-auth-account-button"
              type="button"
              onClick={() => setTab("profile")}
              title={language === "ru" ? "Открыть профиль" : "Open profile"}
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" />
              ) : (
                <span className="dc-auth-account-avatar">DC</span>
              )}
              <span className="dc-auth-account-copy">
                <b>{shownName}</b>
                <small>
                  {BADGE_META[user.badges?.[0] || "PLAYER"].label} · LVL {level} ·{" "}
                  {user.xp.toLocaleString(locale)} XP
                </small>
              </span>
            </button>
            <button
              className="dc-auth-logout"
              type="button"
              onClick={() =>
                api("/api/auth/logout", csrf, { method: "POST" }).finally(() =>
                  location.assign("/"),
                )
              }
            >
              {t(language, "Выйти")}
            </button>
          </>
        }
      />

      <nav
        className="dc-mobile-bottom-nav"
        aria-label={language === "ru" ? "Основная мобильная навигация" : "Main mobile navigation"}
      >
        {nav
          .filter(([key]) => ["quests", "active", "leaderboard", "profile"].includes(key))
          .map(([key, label, icon]) => (
            <button
              key={key}
              type="button"
              aria-current={tab === key ? "page" : undefined}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key)
                window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "instant" : "smooth" })
              }}
            >
              <Icon name={icon} />
              <span>{key === "active" ? (language === "ru" ? "ДЕЛО" : "CASE") : label}</span>
              {key === "quests" && boards.some((item) => item.status === "OFFERED") ? <i /> : null}
            </button>
          ))}
      </nav>

      <div className="dc-app-shell dc-app-shell-topnav">
        <main className="dc-workspace">
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

          {tab === "home" && (
            <>
              <section className="dc-command-hero dc-v3-hero">
                <div className="dc-command-copy">
                  <p className="dc-eyebrow">
                    DEADLOCK CONTRACTS / {language === "ru" ? "ВАШЕ БЮРО" : "YOUR HEADQUARTERS"}
                  </p>
                  <h1>
                    {language === "ru" ? "НОВОЕ ДЕЛО" : "A NEW CASE"}
                    <br />
                    <span>{language === "ru" ? "ЖДЁТ ВАС." : "AWAITS."}</span>
                  </h1>
                  <p className="dc-lead">
                    {t(
                      language,
                      "До 9 контрактов в день · Standard, Ranked, Street Brawl. Для каждого режима — отдельное дело",
                    )}
                  </p>
                  <div className="dc-command-actions">
                    <button className="dc-primary" onClick={() => setTab("quests")}>
                      {language === "ru" ? "ВЫБРАТЬ КОНТРАКТЫ" : "CHOOSE CONTRACTS"}
                    </button>
                    <button
                      className="dc-ghost"
                      onClick={() => setTab(activeBoards.length ? "active" : "history")}
                    >
                      {activeBoards.length
                        ? language === "ru"
                          ? "АКТИВНОЕ ДЕЛО"
                          : "ACTIVE CASE"
                        : language === "ru"
                          ? "АРХИВ ДЕЛ"
                          : "CASE ARCHIVE"}
                    </button>
                  </div>
                </div>
                <div className="dc-curator-stage">
                  <div className="dc-curator-grid" />
                  <img src={curatorImage} alt="Curator" />
                  <div className="dc-curator-dialog">
                    <span>{language === "ru" ? "КУРАТОР" : "CURATOR"}</span>
                    <p>
                      {companion?.online && companion.game_running
                        ? language === "ru"
                          ? `Связь установлена. ${
                              companion.current_match_id
                                ? `Матч #${companion.current_match_id} обнаружен`
                                : `Deadlock запущен · ${phaseLabel(companion.phase, language)}`
                            }.`
                          : `Link established. ${
                              companion.current_match_id
                                ? `Match #${companion.current_match_id} detected`
                                : `Deadlock running · ${phaseLabel(companion.phase, language)}`
                            }.`
                        : companion?.paired
                          ? language === "ru"
                            ? "Компаньон привязан, но сейчас не в сети. Сайт продолжит искать матч автоматически."
                            : "Companion is paired but currently offline. The site will keep looking for the match automatically."
                          : language === "ru"
                            ? "Подключи Компаньон в профиле — он ускорит обнаружение матча."
                            : "Pair the Companion from your profile to speed up match discovery."}
                    </p>
                  </div>
                  <img className="dc-curator-mark" src={markImage} alt="" />
                </div>
              </section>
              <section className="dc-v3-mode-overview">
                {MODES.map((item) => {
                  const b = boards.find((x) => x.game_match_mode === item)
                  const chosen = b?.options.filter((x) => x.selected).length || 0
                  const done =
                    b?.options.filter((x) => x.selected && x.status === "COMPLETED").length || 0
                  return (
                    <button
                      key={item}
                      onClick={() => {
                        setMode(item)
                        setTab("quests")
                      }}
                      className={`mode-${item.toLowerCase()}`}
                    >
                      <header>
                        <span>{MODE_META[item].short}</span>
                        <em>{b ? statusLabel(b.status, language) : t(language, "ЗАГРУЗКА")}</em>
                      </header>
                      <h3>{MODE_META[item].title}</h3>
                      <p>{t(language, MODE_META[item].caption)}</p>
                      <div>
                        <strong>
                          {b?.status === "SETTLED" ? done : chosen}
                          <i>/3</i>
                        </strong>
                        <small>
                          {b?.status === "OFFERED"
                            ? t(language, "можно выбрать")
                            : b?.status === "SETTLED"
                              ? t(language, "выполнено")
                              : t(language, "в деле")}
                        </small>
                        <b>{MODE_META[item].bonus}</b>
                      </div>
                    </button>
                  )
                })}
              </section>
              <section className="dc-kpi-grid">
                <article>
                  <span>LEVEL</span>
                  <strong>{level}</strong>
                  <small>
                    {progression?.xp_to_next ?? "—"} XP{" "}
                    {language === "ru" ? "до следующего уровня" : "to next level"}
                  </small>
                </article>
                <article>
                  <span>CLOSED</span>
                  <strong>{progression?.contracts_completed || 0}</strong>
                  <small>{t(language, "контрактов всего")}</small>
                </article>
                <article>
                  <span>TODAY</span>
                  <strong>
                    {boards.reduce((sum, b) => sum + b.options.filter((o) => o.selected).length, 0)}
                    <i>/9</i>
                  </strong>
                  <small>{t(language, "контрактов зафиксировано")}</small>
                </article>
                <article>
                  <span>REROLL</span>
                  <strong>
                    {boardsPayload?.refresh.remaining ?? 0}
                    <i>/1</i>
                  </strong>
                  <small>{t(language, "бесплатно сегодня")}</small>
                </article>
              </section>
            </>
          )}

          {tab === "quests" && (
            <div className="dc-motion-contract-scene">
              <div className="dc-motion-spotlight" aria-hidden="true" />
              <section className="dc-work-head dc-page-head dc-v3-quest-head dc-motion-contract-head">
                <div>
                  <p className="dc-eyebrow">
                    DAILY BOARD · {expiryLabel(board?.expires_at, clock, language)}
                  </p>
                  <h1>{t(language, "Соберите дело")}</h1>
                  <p>
                    {t(
                      language,
                      "Шесть контрактов на режим. Выберите до трёх. Каждый невыполненный контракт можно закрыть в одном из трёх подходящих матчей; прогресс между матчами не суммируется.",
                    )}
                  </p>
                </div>
                <div className="dc-motion-head-controls">
                  <ModeTabs
                    value={mode}
                    onChange={(next) => {
                      setMode(next)
                      setFilter("ALL")
                    }}
                    boards={boards}
                  />
                  <div className="dc-v3-reroll-box dc-motion-reroll">
                    <span>FREE REROLL</span>
                    <strong>{boardsPayload?.refresh.remaining ?? 0}/1</strong>
                    <button
                      className="dc-ghost btn-ghost"
                      disabled={
                        !board ||
                        board.status !== "OFFERED" ||
                        !boardsPayload?.refresh.remaining ||
                        busy
                      }
                      onClick={(e) => {
                        ripple(e)
                        void reroll()
                      }}
                    >
                      REROLL 6 CONTRACTS
                    </button>
                  </div>
                </div>
              </section>

              <section className="dc-deadline-strip">
                <div>
                  <span>BOARD RESET</span>
                  <strong>
                    {countdownHms(board?.daily_reset_at || boardsPayload?.refresh.reset_at, clock)}
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
                  <span>CASE TTL</span>
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
                  <span>ATTEMPTS</span>
                  <strong>
                    {board?.attempts_used ?? 0}/{board?.max_attempts ?? 3}
                  </strong>
                  <small>{t(language, "для невыполненных контрактов")}</small>
                </div>
              </section>

              {board && (
                <>
                  <section key={`${mode}-${board.generation}`} className="dc-motion-mode-note">
                    <div>
                      <span className="dc-live-dot" />
                      <b>{MODE_META[mode].title}</b>
                      <small>{t(language, MODE_META[mode].caption)}</small>
                    </div>
                    <em>{MODE_META[mode].bonus}</em>
                  </section>

                  {pendingReviewForBoard && (
                    <section className="dc-v3-auto-review-banner">
                      <span>◌</span>
                      <div>
                        <b>AUTO REVIEW / VERIFYING</b>
                        <p>
                          {t(
                            language,
                            "Система сама создала внутреннюю заявку. Ничего загружать или доказывать не нужно.",
                          )}
                        </p>
                      </div>
                    </section>
                  )}

                  <div className="dc-filter-row dc-motion-filter-row">
                    {(["ALL", "COMBAT", "SUPPORT", "ECONOMY", "SURVIVAL"] as QuestFilter[]).map(
                      (item) => (
                        <button
                          key={item}
                          className={filter === item ? "active" : ""}
                          onClick={(e) => {
                            ripple(e)
                            setFilter(item)
                          }}
                        >
                          <i>{categoryGlyph(item)}</i>
                          {categoryLabel(item, language)}
                          {item !== "ALL" && (
                            <span>{board.options.filter((x) => x.category === item).length}</span>
                          )}
                        </button>
                      ),
                    )}
                  </div>

                  <section className="dc-contract-grid dc-contract-board dc-v3-contract-grid dc-motion-contract-grid">
                    {visibleOptions.map((option, index) => {
                      const chosen = selectedSet.has(option.id) || option.selected
                      const state =
                        board.status === "OFFERED"
                          ? chosen
                            ? t(language, "ВЫБРАНО")
                            : t(language, "ДОСТУПНО")
                          : chosen
                            ? statusLabel(option.status, language)
                            : t(language, "НЕ ВЫБРАНО")
                      return (
                        <button
                          key={`${mode}-${board.generation}-${option.id}`}
                          className={`contract-card dc-contract dc-v3-contract dc-motion-contract-card ${
                            chosen ? "selected" : ""
                          } rarity-${option.rarity.toLowerCase()} diff-${option.difficulty.toLowerCase()} cat-${option.category.toLowerCase()}`}
                          style={{ "--card-index": index } as React.CSSProperties}
                          aria-pressed={chosen}
                          disabled={board.status !== "OFFERED" || busy}
                          onClick={(e) => {
                            ripple(e)
                            toggle(option.id)
                          }}
                          onMouseMove={cardTilt.onMouseMove}
                          onMouseLeave={cardTilt.onMouseLeave}
                        >
                          <div className="holo-overlay" />
                          <div className="dc-motion-card-sheen" />
                          {chosen && <div className="dc-check dc-motion-check">✓</div>}
                          <div className="dc-contract-top">
                            <span>
                              <i>{categoryGlyph(option.category)}</i>
                              {categoryLabel(option.category, language).toUpperCase()}
                            </span>
                            <em>
                              {language === "ru" ? "ШАНС" : "DROP"} ~
                              {number(option.drop_chance_pct, language)}%
                            </em>
                          </div>
                          <div className="dc-v3-tags">
                            <span>{DIFFICULTY_LABEL[option.difficulty] || option.difficulty}</span>
                            <span>{RARITY_LABEL[option.rarity] || option.rarity}</span>
                            {(option.conditions?.length || 0) > 1 && (
                              <span>
                                {option.conditions!.length}{" "}
                                {language === "ru" ? "УСЛОВИЯ" : "CONDITIONS"}
                              </span>
                            )}
                          </div>
                          <h3>{localizedContractTitle(option, language)}</h3>
                          <p>{localizedContractDescription(option, mode, language)}</p>
                          <div className="dc-motion-card-bottom">
                            <div className="dc-motion-card-meta">
                              <span>
                                {language === "ru" ? "ЦЕЛЬ" : "TARGET"}
                                <b>{targetLabel(option, language)}</b>
                              </span>
                              <span>
                                {language === "ru" ? "НАГРАДА" : "REWARD"}
                                <b className={chosen ? "neon-text" : ""}>+{option.reward_xp} XP</b>
                              </span>
                            </div>
                            <div className="dc-contract-foot">
                              <span>
                                {MODE_META[mode].short} ·{" "}
                                {language === "ru"
                                  ? "ДО 3 ПОПЫТОК · АВТОПРОВЕРКА"
                                  : "UP TO 3 ATTEMPTS · AUTO VERIFY"}
                              </span>
                              <strong className={chosen ? "chosen" : ""}>{state}</strong>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </section>

                  <section
                    className={`dc-motion-selection-tray ${
                      selectedSet.size ? "has-selection" : ""
                    }`}
                  >
                    <div className="dc-motion-selection-copy">
                      <strong>
                        {selectedSet.size} / 3 {t(language, "выбрано")}
                      </strong>
                      {selectedOptions.length ? (
                        <div className="dc-motion-selected-pills">
                          {selectedOptions.map((option) => (
                            <span key={option.id}>
                              {localizedContractTitle(option, language)}{" "}
                              <b>+{option.reward_xp} XP</b>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p>
                          {language === "ru"
                            ? `Выберите до трёх контрактов для дела режима «${MODE_META[mode].title}».`
                            : `Choose up to three contracts for the ${MODE_META[mode].title} case.`}
                        </p>
                      )}
                    </div>
                    <div className="dc-motion-selection-actions">
                      {selectedSet.size > 0 && (
                        <span ref={xpRef} className="xp-pop dc-motion-total-xp">
                          +{totalXp} XP
                        </span>
                      )}
                      {board.status === "OFFERED" ? (
                        <>
                          <button
                            className="dc-ghost btn-ghost dc-motion-reset"
                            disabled={!selectedSet.size || busy}
                            onClick={(e) => {
                              ripple(e)
                              setSelected((previous) => ({
                                ...previous,
                                [mode]: new Set(),
                              }))
                            }}
                          >
                            {language === "ru" ? "Сбросить" : "Reset"}
                          </button>
                          <button
                            className="dc-primary btn-primary dc-motion-lock"
                            disabled={!selectedSet.size || busy}
                            onClick={(e) => {
                              ripple(e)
                              openSigning()
                            }}
                          >
                            {selectedSet.size
                              ? language === "ru"
                                ? "Подписать контракт"
                                : "Sign contract"
                              : language === "ru"
                                ? "Выберите контракты"
                                : "Select contracts"}
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

                  {board.provider_status?.message && (
                    <section
                      className={`dc-policy dc-provider-phase-${(board.provider_status.phase || "searching").toLowerCase()}`}
                    >
                      <h2>
                        {board.provider_status.phase === "MATCH_DETECTED"
                          ? t(language, "Матч обнаружен")
                          : board.provider_status.phase === "VERIFYING"
                            ? t(language, "Автоматическая проверка")
                            : board.provider_status.phase === "REVIEW_REQUIRED"
                              ? t(language, "Данные уточняются")
                              : board.provider_status.phase === "SETTLED"
                                ? t(language, "Проверка завершена")
                                : t(language, "Автоматический поиск матча")}
                      </h2>
                      <div>
                        <p>{localizeServerText(board.provider_status.message, language)}</p>
                        {board.provider_status.phase === "SEARCHING" && (
                          <p>
                            {t(
                              language,
                              "Ничего нажимать не нужно — проверка продолжится автоматически.",
                            )}
                          </p>
                        )}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "active" && (
            <>
              <section className="dc-work-head dc-page-head">
                <div>
                  <p className="dc-eyebrow">ACTIVE CASE / SERVER STATE</p>
                  <h1>{language === "ru" ? "Активное дело" : "Active case"}</h1>
                  <p>
                    {language === "ru"
                      ? "Здесь показаны только зафиксированные сервером условия. Live-сигналы Компаньона предварительны; окончательный вердикт появляется после проверки итоговых данных."
                      : "Only server-locked conditions appear here. Companion live signals are provisional; the final verdict follows authoritative post-match verification."}
                  </p>
                </div>
              </section>
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
                          <span>
                            {language === "ru" ? "ФАЗА" : "PHASE"}
                            <b>{activeBoard.provider_status?.phase || "SEARCHING"}</b>
                          </span>
                          <span>
                            {language === "ru" ? "МАТЧ" : "MATCH"}
                            <b>
                              {activeBoard.provider_status?.match_id
                                ? `#${activeBoard.provider_status.match_id}`
                                : "—"}
                            </b>
                          </span>
                          <span>
                            {language === "ru" ? "ИСТОЧНИК" : "SOURCE"}
                            <b>SERVER</b>
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
                  <p className="dc-eyebrow">CASE ARCHIVE / DECISION LOG</p>
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
                    <b>{historyStats.completed}</b> COMPLETED
                  </span>
                  <span>
                    <b>{historyStats.failed}</b> FAILED
                  </span>
                  <span>
                    <b>{historyStats.earned}</b> XP EARNED
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
                  const hasReview = group.items.some((x) => x.status === "REVIEW_REQUIRED")
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
                              ATTEMPTS {group.attemptsUsed}/{group.maxAttempts}
                              {group.matchId ? ` · LAST #${group.matchId}` : ""}
                            </p>
                            <h2>
                              {hasReview
                                ? t(language, "Данные уточняются")
                                : done === group.items.length
                                  ? t(language, "Дело закрыто успешно")
                                  : group.items.some((x) => x.status === "LOCKED")
                                    ? t(language, "Дело продолжается")
                                    : t(language, "Решение по делу")}
                            </h2>
                          </div>
                          <span
                            className={`dc-badge ${
                              hasReview ? "review_required" : done ? "completed" : "failed"
                            }`}
                          >
                            {done}/{group.items.length} COMPLETED
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
                                  {item.status === "COMPLETED"
                                    ? "✓"
                                    : item.status === "FAILED"
                                      ? "×"
                                      : "•"}
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
                              {(item.evaluations?.length || 0) > 1 && (
                                <details className="dc-attempt-log">
                                  <summary>
                                    {language === "ru" ? "ЖУРНАЛ ПОПЫТОК" : "ATTEMPT LOG"} ·{" "}
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
                                        <time>{fmt(evaluation.created_at, language)}</time>
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
                            {fmt(group.date)}
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

          {tab === "leaderboard" && (
            <Leaderboard authenticated onProfile={() => setTab("profile")} />
          )}
          {tab === "achievements" && <Achievements onProfile={() => setTab("profile")} />}
          {tab === "bureaus" && <Bureaus csrf={csrf} slug={bureauSlug} onSelect={openBureau} />}
          {tab === "profile" && (
            <>
              <ProfileStudio
                csrf={csrf}
                onNotice={setNotice}
                onError={setError}
                onBureau={openBureau}
                onRefresh={async () => {
                  const data = await api<{ user: User }>("/api/profile/refresh", csrf, {
                    method: "POST",
                  })
                  setUser(data.user)
                  await loadProgression()
                }}
              />
              <details className="profile-account-settings">
                <summary>
                  {language === "ru"
                    ? "Настройки аккаунта · Компаньон и данные"
                    : "Account settings · Companion and data"}
                </summary>
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
                          INSTALL COMPANION
                        </a>
                      ) : (
                        <button className="dc-primary" disabled>
                          PUBLIC BUILD SOON
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
                    <p className="dc-eyebrow">PRIVACY</p>
                    <h2>Data controls</h2>
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
                      DELETE MY DATA
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
    </div>
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

function adaptiveValue(metric: string, value: number | undefined) {
  if (value === undefined || value === null) return "—"
  if (metric === "match.duration_s") return `${Math.round(value / 60)}m`
  return number(Math.round(value))
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
      setError("Введите одноразовый код из приложения-аутентификатора.")
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
      setNotice(`Staff-доступ подтверждён на ${data.ttl_minutes} минут.`)
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
      setNotice("Административная сессия заблокирована.")
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
    if (!confirm(`Сохранить роль и публичные бейджи для ${detail.user.display_name}?`)) return
    setBusy(true)
    try {
      await api(`/api/admin/users/${detail.user.id}/identity`, csrf, {
        method: "POST",
        body: JSON.stringify({
          access_role: identityRole,
          badges: identityBadges,
        }),
      })
      setNotice("Роль и публичные бейджи обновлены. Изменение записано в аудит.")
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
    if (!confirm(`Отозвать все токены Companion у ${item.display_name}?`)) return
    try {
      await api(`/api/admin/users/${item.id}/revoke-companion`, csrf, {
        method: "POST",
      })
      setNotice("Companion пользователя отозван.")
      await openUser(item.id)
      await loadSection("users")
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const terminateSessionsFor = async (item: AdminUserSummary) => {
    if (!confirm(`Завершить все веб-сессии пользователя ${item.display_name}?`)) return
    try {
      await api(`/api/admin/users/${item.id}/terminate-sessions`, csrf, {
        method: "POST",
      })
      setNotice("Веб-сессии пользователя завершены.")
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
      `Причина изменения статуса ${item.display_name} → ${next}:`,
      next === "SUSPENDED" ? "Временная блокировка администратором" : "Разблокировка владельцем",
    )?.trim()
    if (!reason) return
    try {
      await api(`/api/admin/users/${item.id}/status`, csrf, {
        method: "POST",
        body: JSON.stringify({ status: next, reason }),
      })
      setNotice(`Статус пользователя: ${next}`)
      await openUser(item.id)
      await loadSection("users")
    } catch (reasonValue) {
      setError((reasonValue as Error).message)
    }
  }

  const adjustXp = async (item: AdminUserSummary) => {
    if (!auth?.can_manage_roles) return
    const raw = prompt(
      `Изменение XP для ${item.display_name}. Допустимо от -100000 до 100000:`,
      "100",
    )?.trim()
    if (!raw) return
    const delta = Number(raw)
    if (!Number.isInteger(delta) || delta === 0) {
      setError("Введите ненулевое целое изменение XP.")
      return
    }
    const reason = prompt("Причина корректировки XP:", "Ручная корректировка владельцем")?.trim()
    if (!reason) return
    try {
      await api(`/api/admin/users/${item.id}/xp-adjust`, csrf, {
        method: "POST",
        body: JSON.stringify({ delta, reason }),
      })
      setNotice("XP скорректирован с записью в ledger и audit.")
      await openUser(item.id)
      await loadSection("users")
      await reloadAll()
    } catch (reasonValue) {
      setError((reasonValue as Error).message)
    }
  }

  const retryJob = async (job: AdminJob) => {
    const reason = prompt(
      "Причина повторного запуска задачи:",
      "Повтор после проверки администратора",
    )?.trim()
    if (!reason) return
    try {
      await api(`/api/admin/jobs/${job.id}/retry`, csrf, {
        method: "POST",
        body: JSON.stringify({ reason }),
      })
      setNotice("FAILED-задача возвращена в очередь.")
      await loadSection("jobs")
    } catch (reasonValue) {
      setError((reasonValue as Error).message)
    }
  }

  const replayOutbox = async (event: AdminOutboxEvent) => {
    const reason = prompt(
      `Причина replay ${event.event_type} / ${event.id.slice(0, 8)}:`,
      "Причина устранена; повторная доставка подтверждена администратором",
    )?.trim()
    if (!reason) return
    if (!confirm("Вернуть dead-letter событие в очередь? Доставка останется идемпотентной.")) return
    try {
      await api(`/api/admin/outbox/${event.id}/replay`, csrf, {
        method: "POST",
        body: JSON.stringify({ reason }),
      })
      setNotice("Outbox event возвращён в очередь; причина записана в аудит.")
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
        "Поставить это VERIFYING-дело на повторную автоматическую проверку? XP и статусы по-прежнему определяет серверный evaluator.",
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
          ? `Проверка матча #${result.match_id} уже находится в очереди.`
          : `Матч #${result.match_id} поставлен на повторную проверку.`,
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
    if (!confirm(`Отозвать устройство ${item.device_id} пользователя ${item.user.display_name}?`))
      return
    try {
      await api(`/api/admin/companions/${item.id}/revoke`, csrf, {
        method: "POST",
      })
      setNotice("Устройство отозвано.")
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
      setNotice("Изменений шаблона нет.")
      return
    }
    if (
      !confirm(
        `Сохранить изменения шаблона ${selectedMission.key}? Новые доски будут использовать обновлённые параметры.`,
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
          ? "Создана новая DRAFT-версия. Опубликуйте её после RU/EN preview; текущая PUBLISHED-версия не изменена."
          : "Версия обновлена. Существующие уже выданные карточки не переписаны.",
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
      setError("Количество preview-досок: от 1 до 40.")
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
          <h2>Проверяем административную сессию…</h2>
        </article>
      </section>
    )
  if (!auth.elevated)
    return (
      <section className="dc-admin-shell">
        <article className="dc-admin-unlock">
          <p className="dc-eyebrow">SECURE ZONE / TOTP</p>
          <h1>Admin console</h1>
          <p>
            SteamID уже проверен. Для доступа к данным игроков требуется отдельное
            TOTP-подтверждение. Код не сохраняется и не передаётся клиентам.
          </p>
          <div className="dc-admin-unlock-form">
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter") void unlock()
              }}
            />
            <button className="dc-primary" disabled={busy} onClick={() => void unlock()}>
              {busy ? "Проверяем…" : "Разблокировать"}
            </button>
          </div>
          <small>
            {auth.configured
              ? "TOTP настроен."
              : "TOTP на сервере не настроен — выполните scripts/init-admin-totp.sh."}
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
          <p className="dc-eyebrow">OPERATIONS CONSOLE / ADMIN MAX</p>
          <h1>Operations console</h1>
          <p>
            Control plane для пользователей, матчей, дел, Companion, очередей и каталога контрактов.
            Прямого SQL, shell-доступа и отображения секретов нет. Опасные изменения доступны только
            OWNER и всегда попадают в audit.
          </p>
        </div>
        <div className="dc-admin-session">
          <span>SESSION UNTIL</span>
          <b>{auth.expires_at ? fmt(auth.expires_at) : "—"}</b>
          <small>
            {auth.admin.access_role} · {auth.admin.steam_id64}
          </small>
          <button className="dc-ghost" onClick={() => void lockAdmin()}>
            LOCK SESSION
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
            {label}
          </button>
        ))}
      </nav>
      <label className="dc-admin-mobile-section">
        <span>РАЗДЕЛ КОНСОЛИ</span>
        <select
          value={section}
          onChange={(event) => setSection(event.target.value as AdminSection)}
        >
          {sections.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
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
                  <span>ИГРОКИ</span>
                  <b>{overview.users}</b>
                  <small>
                    +{overview.users_new_24h} за 24ч · +{overview.users_new_7d} за 7д
                  </small>
                </article>
                <article>
                  <span>АКТИВНЫЕ ДЕЛА</span>
                  <b>{overview.active_boards}</b>
                  <small>{overview.boards_24h} новых за 24ч</small>
                </article>
                <article>
                  <span>МАТЧИ / 24Ч</span>
                  <b>{overview.matches_24h}</b>
                  <small>{overview.matches_7d} за 7 дней</small>
                </article>
                <article>
                  <span>COMPANION ONLINE</span>
                  <b>{overview.companion_online}</b>
                  <small>{overview.companion_paired} активных привязок</small>
                </article>
                <article className={overview.pending_reviews ? "warn" : ""}>
                  <span>REVIEW</span>
                  <b>{overview.pending_reviews}</b>
                  <small>требуют внимания</small>
                </article>
                <article className={overview.failed_jobs ? "warn" : ""}>
                  <span>FAILED JOBS</span>
                  <b>{overview.failed_jobs}</b>
                  <small>{overview.pending_jobs} pending</small>
                </article>
                <article className={overview.verification_health.stuck_15m ? "warn" : ""}>
                  <span>VERIFYING</span>
                  <b>{overview.verification_health.verifying_options}</b>
                  <small>
                    {overview.verification_health.stuck_15m} ждут &gt;15 мин ·{" "}
                    {overview.verification_health.final_match_waiting} уже final
                  </small>
                </article>
                <article>
                  <span>XP ВЫДАНО</span>
                  <b>{number(overview.xp_issued)}</b>
                  <small>положительные ledger entries</small>
                </article>
                <article>
                  <span>ПОСЛЕДНИЙ MATCH</span>
                  <b>{overview.latest_match_id || "—"}</b>
                  <small>{fmt(overview.server_time)}</small>
                </article>
              </div>
              <div className="dc-admin-panel-grid">
                <article className="dc-panel">
                  <h3>Статусы дел</h3>
                  {kv(overview.board_statuses)}
                </article>
                <article className="dc-panel">
                  <h3>Режимы матчей</h3>
                  {kv(overview.match_modes)}
                </article>
                <article className="dc-panel">
                  <h3>Очередь</h3>
                  {kv(overview.job_statuses)}
                </article>
                <article className="dc-panel">
                  <h3>Версии Companion</h3>
                  {kv(overview.companion_versions)}
                </article>
                <article
                  className={`dc-panel ${
                    overview.verification_health.stuck_15m ? "dc-admin-health-warn" : ""
                  }`}
                >
                  <h3>Verification health</h3>
                  <div className="dc-admin-kv">
                    <span>VERIFYING</span>
                    <b>{overview.verification_health.verifying_options}</b>
                  </div>
                  <div className="dc-admin-kv">
                    <span>FINAL MATCH WAITING</span>
                    <b>{overview.verification_health.final_match_waiting}</b>
                  </div>
                  <div className="dc-admin-kv">
                    <span>STUCK &gt; 15M</span>
                    <b>{overview.verification_health.stuck_15m}</b>
                  </div>
                  {Object.keys(overview.verification_health.missing_capabilities).length > 0 && (
                    <details>
                      <summary>Missing capabilities</summary>
                      {kv(overview.verification_health.missing_capabilities)}
                    </details>
                  )}
                  {overview.verification_health.examples.length > 0 && (
                    <details>
                      <summary>Последние VERIFYING на final-матчах</summary>
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
                                "facts present / ожидает evaluator"}
                            </small>
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </article>
              </div>
              <article className="dc-panel dc-admin-timeline">
                <h3>14 дней</h3>
                <div>
                  {overview.timeline.map((day) => (
                    <span key={day.date}>
                      <b>{day.date.slice(5)}</b>
                      <small>
                        U {day.registrations} · M {day.matches} · B {day.boards}
                      </small>
                    </span>
                  ))}
                </div>
              </article>
            </>
          ) : (
            <article className="dc-panel">
              <h2>Загрузка…</h2>
            </article>
          )}
        </>
      )}

      {section === "users" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              placeholder="Ник, SteamID64 или Account ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select value={userRole} onChange={(event) => setUserRole(event.target.value)}>
              <option value="ALL">Все роли</option>
              <option>OWNER</option>
              <option>ADMIN</option>
              <option>MODERATOR</option>
              <option>TESTER</option>
              <option>PLAYER</option>
            </select>
            <select value={userStatus} onChange={(event) => setUserStatus(event.target.value)}>
              <option value="ALL">Все статусы</option>
              <option>ACTIVE</option>
              <option>SUSPENDED</option>
            </select>
            <select
              value={userCompanion}
              onChange={(event) => setUserCompanion(event.target.value)}
            >
              <option value="ALL">Любой Companion</option>
              <option value="ONLINE">Online</option>
              <option value="PAIRED">Paired</option>
              <option value="NONE">Нет</option>
            </select>
            <select value={userSort} onChange={(event) => setUserSort(event.target.value)}>
              <option value="NEWEST">Новые</option>
              <option value="XP">По XP</option>
              <option value="NAME">По имени</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("users")}>
              Применить
            </button>
            <small>{userTotal} найдено</small>
          </div>
          <div className={`dc-admin-users-layout ${detail ? "has-detail" : ""}`}>
            <div className="dc-admin-users-list">
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
                      {item.steam_id64} · XP {item.xp} · {item.status}
                    </small>
                  </div>
                  <div>
                    <span className={item.companion.online ? "ok" : ""}>
                      {item.companion.online
                        ? "COMPANION ONLINE"
                        : item.companion.paired
                          ? "PAIRED"
                          : "NO COMPANION"}
                    </span>
                    <small>
                      {item.active_boards} активных дел · {item.sessions} сессий
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
                    ← К списку игроков
                  </button>
                  <header>
                    <div>
                      <p className="dc-eyebrow">
                        {detail.user.access_role} / {detail.user.steam_id64}
                      </p>
                      <h2>{detail.user.display_name}</h2>
                      <RoleBadgeList badges={detail.user.badges} />
                      <small>
                        Account ID {detail.user.account_id ?? "—"} · XP {detail.user.xp} ·{" "}
                        {detail.user.status} · с нами с {joinLabel(detail.user.created_at)}
                      </small>
                    </div>
                    <div className="dc-admin-user-actions">
                      <button
                        className="dc-ghost"
                        onClick={() => void revokeCompanionFor(detail.user)}
                      >
                        Отозвать Companion
                      </button>
                      {detail.user.id !== auth.admin.id && (
                        <button
                          className="dc-ghost"
                          onClick={() => void terminateSessionsFor(detail.user)}
                        >
                          Завершить сессии
                        </button>
                      )}
                      {auth.can_manage_roles && detail.user.access_role !== "OWNER" && (
                        <button
                          className="dc-ghost"
                          onClick={() => void changeUserStatus(detail.user)}
                        >
                          {detail.user.status === "ACTIVE" ? "Приостановить" : "Активировать"}
                        </button>
                      )}
                      {auth.can_manage_roles && (
                        <button className="dc-ghost" onClick={() => void adjustXp(detail.user)}>
                          Корректировать XP
                        </button>
                      )}
                    </div>
                  </header>
                  {auth.can_manage_roles && (
                    <section className="dc-admin-identity-editor">
                      <div className="dc-admin-identity-title">
                        <div>
                          <span>ДОСТУП И ПУБЛИЧНЫЕ БЕЙДЖИ</span>
                          <p>
                            Права проверяются сервером. Бейджи меняют только отображение профиля.
                          </p>
                        </div>
                        {detail.user.access_role === "OWNER" ? (
                          <b>OWNER защищён server allowlist</b>
                        ) : (
                          <button
                            className="dc-primary"
                            disabled={busy}
                            onClick={() => void saveIdentity()}
                          >
                            {busy ? "Сохраняем…" : "Сохранить"}
                          </button>
                        )}
                      </div>
                      {detail.user.access_role !== "OWNER" && (
                        <>
                          <label>
                            ACCESS ROLE
                            <select
                              value={identityRole}
                              onChange={(event) =>
                                setIdentityRole(
                                  event.target.value as "PLAYER" | "TESTER" | "MODERATOR" | "ADMIN",
                                )
                              }
                            >
                              <option value="PLAYER">PLAYER — обычный игрок</option>
                              <option value="TESTER">TESTER — участник тестирования</option>
                              <option value="MODERATOR">MODERATOR — только Review + TOTP</option>
                              <option value="ADMIN">ADMIN — административный доступ + TOTP</option>
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
                            OWNER через веб назначить нельзя. Снятие ADMIN автоматически сбрасывает
                            MFA elevation его сессий.
                          </small>
                        </>
                      )}
                    </section>
                  )}
                  <div className="dc-admin-mini-grid">
                    <div>
                      <span>COMPANION</span>
                      <b>
                        {detail.user.companion.online
                          ? "ONLINE"
                          : detail.user.companion.paired
                            ? "OFFLINE"
                            : "—"}
                      </b>
                    </div>
                    <div>
                      <span>DEADLOCK</span>
                      <b>{detail.user.companion.game_running ? "RUNNING" : "—"}</b>
                    </div>
                    <div>
                      <span>PHASE</span>
                      <b>{detail.user.companion.phase || "—"}</b>
                    </div>
                    <div>
                      <span>MATCH ID</span>
                      <b>{detail.user.companion.current_match_id || "—"}</b>
                    </div>
                  </div>
                  <h3>Adaptive Contracts profile</h3>
                  <div className="dc-admin-adaptive-grid">
                    {(["STANDARD", "RANKED", "STREET_BRAWL"] as Mode[]).map((mode) => {
                      const profile = detail.adaptive_profiles[mode]
                      return (
                        <article className="dc-panel" key={mode}>
                          <header>
                            <div>
                              <b>{mode}</b>
                              <small>{profile.sample_size} verified matches</small>
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
                                  <span>{label}</span>
                                  <b>{adaptiveValue(metric, row.median)}</b>
                                  <small>
                                    P75 {adaptiveValue(metric, row.p75)} · best{" "}
                                    {adaptiveValue(metric, row.best)}
                                  </small>
                                </div>
                              )
                            })}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                  <h3>Последние дела</h3>
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
                            .join(" · ") || "Без выбранных контрактов"}
                        </span>
                      </button>
                    ))}
                  </div>
                  <h3>Последние матчи</h3>
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
                          {match.duration_s ? `${Math.round(match.duration_s / 60)} мин` : "—"}
                        </span>
                        <span>
                          K/D/A {match.kills ?? "—"}/{match.deaths ?? "—"}/{match.assists ?? "—"} ·
                          dmg {match.hero_damage ?? "—"} · souls {match.souls ?? "—"}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="dc-admin-two-col">
                    <div>
                      <h3>Reward ledger</h3>
                      <div className="dc-admin-compact-list">
                        {detail.rewards.slice(0, 12).map((item) => (
                          <div key={item.id}>
                            <b>
                              {item.delta > 0 ? "+" : ""}
                              {item.delta} XP
                            </b>
                            <span>
                              {item.source_type} · balance {item.balance_after}
                            </span>
                            <small>{fmt(item.created_at)}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3>Сессии</h3>
                      <div className="dc-admin-compact-list">
                        {detail.sessions.map((item, index) => (
                          <div key={index}>
                            <b>{item.admin_elevated ? "ADMIN ELEVATED" : "WEB SESSION"}</b>
                            <span>last {fmt(item.last_seen_at)}</span>
                            <small>expires {fmt(item.expires_at)}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="dc-admin-two-col">
                    <div>
                      <h3>Companion events</h3>
                      <div className="dc-admin-compact-list">
                        {detail.events.slice(0, 12).map((item, index) => (
                          <div key={index}>
                            <b>{item.event_type}</b>
                            <span>
                              #{item.match_id || "—"} · {item.mode || "—"} · {item.phase || "—"}
                            </span>
                            <small>{fmt(item.created_at)}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3>Audit пользователя</h3>
                      <div className="dc-admin-compact-list">
                        {detail.audit.slice(0, 12).map((item) => (
                          <div key={item.id}>
                            <b>{item.action}</b>
                            <span>
                              {item.entity_type}:{item.entity_id}
                            </span>
                            <small>{fmt(item.created_at)}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="dc-admin-empty">Выберите игрока слева.</div>
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

      {section === "bureau_reports" && (
        <Suspense fallback={<p role="status">Открываем обращения…</p>}>
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
              placeholder="Match ID"
              value={matchQuery}
              onChange={(event) => setMatchQuery(event.target.value.replace(/\D/g, ""))}
            />
            <select value={matchMode} onChange={(event) => setMatchMode(event.target.value)}>
              <option value="ALL">Все режимы</option>
              <option>STANDARD</option>
              <option>RANKED</option>
              <option>STREET_BRAWL</option>
              <option>UNKNOWN</option>
            </select>
            <select value={matchScoring} onChange={(event) => setMatchScoring(event.target.value)}>
              <option value="ALL">Любой scoring</option>
              <option>SCORED</option>
              <option>NOT_SCORED</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("matches")}>
              Найти
            </button>
          </div>
          <div className={`dc-admin-master-detail ${matchDetail ? "has-detail" : ""}`}>
            <div className="dc-admin-master-list">
              {matches.map((item) => (
                <button key={item.match_id} onClick={() => void openMatch(item.match_id)}>
                  <b>#{item.match_id}</b>
                  <span>
                    {item.mode} · {item.scoring_status}
                  </span>
                  <small>
                    {fmt(item.started_at)} · {item.participants} игроков · {item.bound_contracts}{" "}
                    contracts · {item.reviews} review
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
                    ← К списку матчей
                  </button>
                  <h2>Матч #{matchDetail.match.match_id}</h2>
                  <div className="dc-admin-mini-grid">
                    <div>
                      <span>MODE</span>
                      <b>{matchDetail.match.mode}</b>
                    </div>
                    <div>
                      <span>PROVIDER</span>
                      <b>{matchDetail.match.provider}</b>
                    </div>
                    <div>
                      <span>CONFIDENCE</span>
                      <b>{matchDetail.match.mode_confidence}</b>
                    </div>
                    <div>
                      <span>FINAL</span>
                      <b>{matchDetail.match.is_final ? "YES" : "NO"}</b>
                    </div>
                  </div>
                  <h3>Capabilities</h3>
                  <p className="dc-admin-code-line">
                    {matchDetail.match.capabilities.join(" · ") || "—"}
                  </p>
                  <h3>Участники</h3>
                  <pre>{JSON.stringify(matchDetail.participants, null, 2)}</pre>
                  <h3>Привязанные контракты</h3>
                  <pre>{JSON.stringify(matchDetail.contracts, null, 2)}</pre>
                  <h3>Review / Companion evidence</h3>
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
                <div className="dc-admin-empty">Выберите матч.</div>
              )}
            </div>
          </div>
        </>
      )}

      {section === "boards" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              placeholder="Board ID, игрок, SteamID, baseline"
              value={boardQuery}
              onChange={(event) => setBoardQuery(event.target.value)}
            />
            <select value={boardMode} onChange={(event) => setBoardMode(event.target.value)}>
              <option value="ALL">Все режимы</option>
              <option>STANDARD</option>
              <option>RANKED</option>
              <option>STREET_BRAWL</option>
            </select>
            <select value={boardStatus} onChange={(event) => setBoardStatus(event.target.value)}>
              <option value="ALL">Все статусы</option>
              <option>OFFERED</option>
              <option>LOCKED</option>
              <option>VERIFYING</option>
              <option>REVIEW_REQUIRED</option>
              <option>SETTLED</option>
              <option>EXPIRED</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("boards")}>
              Найти
            </button>
          </div>
          <div className={`dc-admin-master-detail ${boardDetail ? "has-detail" : ""}`}>
            <div className="dc-admin-master-list">
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
                    ← К списку дел
                  </button>
                  <div className="dc-admin-detail-head">
                    <div>
                      <p className="dc-eyebrow">
                        {boardDetail.board.generator_version || "LEGACY GENERATOR"}
                      </p>
                      <h2>Дело {boardDetail.board.id.slice(0, 8)}</h2>
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
                        {busy ? "Ставим в очередь…" : "RECHECK VERIFYING"}
                      </button>
                    )}
                  </div>
                  <div className="dc-admin-mini-grid">
                    <div>
                      <span>MODE</span>
                      <b>{boardDetail.board.mode}</b>
                    </div>
                    <div>
                      <span>STATUS</span>
                      <b>{boardDetail.board.status}</b>
                    </div>
                    <div>
                      <span>BASELINE MATCH</span>
                      <b>{boardDetail.board.baseline_match_id || "—"}</b>
                    </div>
                    <div>
                      <span>ATTEMPTS</span>
                      <b>
                        {boardDetail.board.attempts_used}/{boardDetail.board.max_attempts}
                      </b>
                    </div>
                  </div>
                  <h3>Контракты / Adaptive trace</h3>
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
                              <b>{String(row.title || "Contract")}</b>
                              <small>
                                {String(row.metric)} · target {String(row.target)} ·{" "}
                                {String(row.reward_xp)} XP
                              </small>
                            </div>
                            <span>{String(row.status)}</span>
                          </header>
                          <div className="dc-admin-mini-grid">
                            <div>
                              <span>ADAPTIVE</span>
                              <b>{adaptive.enabled ? adaptive.kind : "WILDCARD / OFF"}</b>
                            </div>
                            <div>
                              <span>CONFIDENCE</span>
                              <b>{adaptive.confidence}</b>
                            </div>
                            <div>
                              <span>SAMPLE</span>
                              <b>{adaptive.sample}</b>
                            </div>
                            <div>
                              <span>BOUND MATCH</span>
                              <b>{String(row.bound_match_id || "—")}</b>
                            </div>
                          </div>
                          {adaptive.weakest && (
                            <p className="dc-admin-code-line">weakest: {adaptive.weakest}</p>
                          )}
                          {adaptive.basis.length > 0 && (
                            <details>
                              <summary>Why this contract / basis</summary>
                              <pre>{JSON.stringify(adaptive.basis, null, 2)}</pre>
                            </details>
                          )}
                          <small>{String(row.explanation || "")}</small>
                        </article>
                      )
                    })}
                  </div>
                  <details>
                    <summary>Raw board payload</summary>
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
                  <h3>Evaluations</h3>
                  <pre>{JSON.stringify(boardDetail.evaluations, null, 2)}</pre>
                  <h3>Jobs / Reviews</h3>
                  <pre>
                    {JSON.stringify(
                      { jobs: boardDetail.jobs, reviews: boardDetail.reviews },
                      null,
                      2,
                    )}
                  </pre>
                </>
              ) : (
                <div className="dc-admin-empty">Выберите дело.</div>
              )}
            </div>
          </div>
        </>
      )}

      {section === "companions" && (
        <>
          <div className="dc-admin-filterbar">
            <input
              placeholder="Игрок, device ID, SteamID, Match ID"
              value={companionQuery}
              onChange={(event) => setCompanionQuery(event.target.value)}
            />
            <select
              value={companionState}
              onChange={(event) => setCompanionState(event.target.value)}
            >
              <option value="ALL">Все устройства</option>
              <option value="ONLINE">Online</option>
              <option value="ACTIVE">Активные</option>
              <option value="REVOKED">Отозванные</option>
            </select>
            <select
              value={companionVersion}
              onChange={(event) => setCompanionVersion(event.target.value)}
            >
              <option value="ALL">Все версии</option>
              {Object.keys(companionVersions)
                .sort()
                .map((value) => (
                  <option key={value}>{value}</option>
                ))}
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("companions")}>
              Применить
            </button>
          </div>
          <div className="dc-admin-companion-grid">
            {companions.map((item) => (
              <article key={item.id} className={`dc-panel ${item.status.online ? "online" : ""}`}>
                <header>
                  <div>
                    <b>{item.user.display_name}</b>
                    <small>{item.user.steam_id64}</small>
                  </div>
                  <span>
                    {item.status.online ? "ONLINE" : item.revoked_at ? "REVOKED" : "OFFLINE"}
                  </span>
                </header>
                <p className="dc-admin-code-line">{item.device_id}</p>
                <div className="dc-admin-mini-grid">
                  <div>
                    <span>VERSION</span>
                    <b>{item.status.version || "—"}</b>
                  </div>
                  <div>
                    <span>GEP</span>
                    <b>{item.status.gep_version || "—"}</b>
                  </div>
                  <div>
                    <span>MODE</span>
                    <b>{item.status.game_match_mode || "—"}</b>
                  </div>
                  <div>
                    <span>MATCH</span>
                    <b>{item.status.current_match_id || "—"}</b>
                  </div>
                </div>
                <small>
                  last seen {fmt(item.status.last_seen_at)} · identity{" "}
                  {String(item.status.identity_ok ?? "—")}
                </small>
                {!item.revoked_at && (
                  <button className="dc-ghost" onClick={() => void revokeDevice(item)}>
                    Отозвать устройство
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
              placeholder="Key, название или metric"
              value={missionQuery}
              onChange={(event) => setMissionQuery(event.target.value)}
            />
            <select value={missionMode} onChange={(event) => setMissionMode(event.target.value)}>
              <option value="ALL">Все режимы</option>
              <option>STANDARD</option>
              <option>RANKED</option>
              <option>STREET_BRAWL</option>
            </select>
            <select
              value={missionStatus}
              onChange={(event) => setMissionStatus(event.target.value)}
            >
              <option value="ALL">Все статусы</option>
              <option>PUBLISHED</option>
              <option>DISABLED</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("missions")}>
              Найти
            </button>
          </div>
          <div className={`dc-admin-master-detail ${missionDraft ? "has-detail" : ""}`}>
            <div className="dc-admin-master-list">
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
                    {item.key} v{item.version} · {item.metric} {item.operator} {item.target} ·{" "}
                    {item.reward_xp} XP
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
                    ← К каталогу контрактов
                  </button>
                  <div className="dc-admin-detail-head">
                    <div>
                      <p className="dc-eyebrow">
                        {missionDraft.key} / V{missionDraft.version}
                      </p>
                      <h2>{missionDraft.title}</h2>
                    </div>
                    {auth.can_manage_roles && (
                      <button
                        className="dc-primary"
                        disabled={busy}
                        onClick={() => void saveMission()}
                      >
                        Сохранить
                      </button>
                    )}
                  </div>
                  <div className="dc-admin-form-grid">
                    <label>
                      Название (RU)
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
                      Title (EN)
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
                      Status
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
                        <option>PUBLISHED</option>
                        <option>DRAFT</option>
                        <option>DISABLED</option>
                      </select>
                    </label>
                    <label>
                      Target
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
                      Reward XP
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
                      Base XP
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
                      Difficulty
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
                        <option>LIGHT</option>
                        <option>FOCUSED</option>
                        <option>HARD</option>
                        <option>EXTREME</option>
                      </select>
                    </label>
                    <label>
                      Rarity
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
                        <option>COMMON</option>
                        <option>UNCOMMON</option>
                        <option>RARE</option>
                        <option>EPIC</option>
                      </select>
                    </label>
                    <label>
                      Category
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
                        <option>COMBAT</option>
                        <option>SUPPORT</option>
                        <option>ECONOMY</option>
                        <option>SURVIVAL</option>
                      </select>
                    </label>
                    <label>
                      Drop weight
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
                      Chance %
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
                    Описание (RU)
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
                    Description (EN)
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
                    <span>METRIC</span>
                    <b>
                      {missionDraft.metric} {missionDraft.operator} {missionDraft.target}
                    </b>
                  </div>
                  <div className="dc-admin-kv">
                    <span>CAPABILITIES</span>
                    <b>{missionDraft.required_capabilities.join(", ") || "—"}</b>
                  </div>
                  <small>
                    Изменение PUBLISHED создаёт новую DRAFT-версию: проверьте RU/EN preview и только
                    потом переключите её в PUBLISHED. Предыдущая версия автоматически отключается,
                    но остаётся доступной для rollback. Contracts 2.0 использует Status, Drop
                    weight, Category, Metric и Capabilities как атомы генерации. Target / Reward XP
                    / Base XP остаются reference/legacy-полями: цели и награда новых динамических
                    контрактов рассчитываются генератором. Уже выданные BoardOption хранят
                    собственные snapshot-поля.
                  </small>
                </>
              ) : (
                <div className="dc-admin-empty">Выберите шаблон контракта.</div>
              )}
            </div>
          </div>
        </>
      )}

      {section === "generator" && (
        <>
          <article className="dc-panel dc-admin-generator-head">
            <div>
              <p className="dc-eyebrow">CONTRACT FACTORY / DRY RUN</p>
              <h2>Generator Lab</h2>
              <p>
                Contracts 2.0 собирает новые цели и составные условия детерминированно. Preview
                ничего не пишет в БД и показывает реальное разнообразие будущих досок.
              </p>
            </div>
            <div className="dc-admin-filterbar">
              <select
                value={generatorMode}
                onChange={(event) => setGeneratorMode(event.target.value as Mode)}
              >
                <option>STANDARD</option>
                <option>RANKED</option>
                <option>STREET_BRAWL</option>
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
                {busy ? "Генерируем…" : "Сгенерировать preview"}
              </button>
            </div>
          </article>
          {generator && (
            <>
              <div className="dc-admin-grid">
                <article>
                  <span>ШАБЛОНОВ / МЕТРИК</span>
                  <b>
                    {generator.stats.templates_available} /{" "}
                    {generator.stats.metrics_available ?? "—"}
                  </b>
                </article>
                <article>
                  <span>ДОСОК</span>
                  <b>{generator.stats.boards_generated}</b>
                </article>
                <article>
                  <span>УНИКАЛЬНЫХ</span>
                  <b>{generator.stats.unique_boards}</b>
                </article>
                <article className={generator.stats.duplicate_boards ? "warn" : ""}>
                  <span>ДУБЛЕЙ</span>
                  <b>{generator.stats.duplicate_boards}</b>
                </article>
              </div>
              <div className="dc-admin-panel-grid">
                <article className="dc-panel">
                  <h3>Категории</h3>
                  {kv(generator.stats.categories)}
                </article>
                <article className="dc-panel">
                  <h3>Редкости</h3>
                  {kv(generator.stats.rarities)}
                </article>
                <article className="dc-panel">
                  <h3>Сложность</h3>
                  {kv(generator.stats.difficulties)}
                </article>
                <article className="dc-panel">
                  <h3>Число условий</h3>
                  {kv(generator.stats.condition_counts || {})}
                </article>
                <article className="dc-panel">
                  <h3>Частые базовые атомы</h3>
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
                          {item.conditions?.length || 1} усл. · {item.reward_xp} XP
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
              placeholder="type, idempotency key, error"
              value={jobQuery}
              onChange={(event) => setJobQuery(event.target.value)}
            />
            <select value={jobStatus} onChange={(event) => setJobStatus(event.target.value)}>
              <option value="ALL">Все статусы</option>
              <option>PENDING</option>
              <option>RUNNING</option>
              <option>DONE</option>
              <option>FAILED</option>
            </select>
            <select value={jobType} onChange={(event) => setJobType(event.target.value)}>
              <option value="ALL">Все типы</option>
              <option>discover_match</option>
              <option>resolve_companion_match</option>
              <option>resolve_companion_match_auto</option>
              <option>evaluate_match</option>
              <option>refresh_review_match</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("jobs")}>
              Применить
            </button>
          </div>
          <div className="dc-admin-list">
            {jobs.map((job) => (
              <article
                key={job.id}
                className={`dc-admin-job ${job.status === "FAILED" ? "failed" : ""}`}
              >
                <header>
                  <div>
                    <b>{job.type}</b>
                    <small>
                      {job.id.slice(0, 8)} · {fmt(job.created_at)}
                    </small>
                  </div>
                  <span>
                    {job.status} · {job.attempts}/{job.max_attempts}
                  </span>
                </header>
                {job.last_error && <pre>{job.last_error}</pre>}
                <small>{job.idempotency_key}</small>
                <details>
                  <summary>Payload</summary>
                  <pre>{JSON.stringify(job.payload || {}, null, 2)}</pre>
                </details>
                {job.status === "FAILED" && (
                  <button className="dc-ghost" onClick={() => void retryJob(job)}>
                    Повторить безопасно
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
              placeholder="event id, aggregate, type, error"
              value={outboxQuery}
              onChange={(event) => setOutboxQuery(event.target.value)}
            />
            <select value={outboxState} onChange={(event) => setOutboxState(event.target.value)}>
              <option value="ALL">Все состояния</option>
              <option>PENDING</option>
              <option>RETRYING</option>
              <option>DEAD_LETTER</option>
              <option>PUBLISHED</option>
            </select>
            <button className="dc-ghost" onClick={() => void loadSection("outbox")}>
              Применить
            </button>
            <small>{outboxTotal} событий</small>
          </div>
          <div className="dc-admin-list">
            {outbox.map((event) => (
              <article
                key={event.id}
                className={`dc-admin-job ${event.state === "DEAD_LETTER" ? "failed" : ""}`}
              >
                <header>
                  <div>
                    <b>{event.event_type}</b>
                    <small>
                      {event.id.slice(0, 8)} · aggregate {event.aggregate_id} ·{" "}
                      {fmt(event.created_at)}
                    </small>
                  </div>
                  <span>
                    {event.state} · attempts {event.attempts}
                  </span>
                </header>
                {event.last_error && <pre>{event.last_error}</pre>}
                <small>next: {fmt(event.run_after)}</small>
                <details>
                  <summary>Immutable payload</summary>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </details>
                {event.state === "DEAD_LETTER" && (
                  <button className="dc-ghost" onClick={() => void replayOutbox(event)}>
                    Replay с audit reason
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
              placeholder="action, entity type, entity id"
              value={auditQuery}
              onChange={(event) => setAuditQuery(event.target.value)}
            />
            <button className="dc-ghost" onClick={() => void loadSection("audit")}>
              Найти
            </button>
            <small>{auditTotal} событий</small>
          </div>
          <div className="dc-admin-list">
            {audit.map((item) => (
              <article key={item.id} className="dc-admin-audit">
                <header>
                  <b>{item.action}</b>
                  <span>{fmt(item.created_at)}</span>
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
                  <h3>Release</h3>
                  {kv(system.release)}
                </article>
                <article className="dc-panel">
                  <h3>Provider</h3>
                  {kv(system.provider)}
                </article>
                <article className="dc-panel">
                  <h3>Contracts</h3>
                  {kv(system.contracts)}
                </article>
                <article className="dc-panel">
                  <h3>Companion</h3>
                  {kv(system.companion)}
                </article>
                <article className="dc-panel">
                  <h3>Security</h3>
                  {kv(system.security)}
                </article>
                <article className="dc-panel">
                  <h3>Rate limits</h3>
                  {kv(system.limits)}
                </article>
                <article className="dc-panel">
                  <h3>Database</h3>
                  {kv(system.database)}
                </article>
                <article className="dc-panel">
                  <h3>Counts</h3>
                  {kv(system.counts)}
                </article>
              </div>
              <article className="dc-panel">
                <small>
                  Секреты, токены, пароли и значения Docker secrets намеренно не доступны через этот
                  endpoint.
                </small>
              </article>
            </>
          ) : (
            <article className="dc-panel">
              <h2>Загрузка…</h2>
            </article>
          )}
        </>
      )}
    </section>
  )
}
