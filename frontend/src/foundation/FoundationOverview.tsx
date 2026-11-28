import { useState, type CSSProperties, type ReactNode } from "react"
import { savedKey } from "../archive/daily-pack-storage"
import CompletionButton from "../case-completion/CompletionButton"
import { useLanguage } from "../i18n"
import Icon, { type IconName } from "../icons/Icon"
import city from "../imports/city/header_city.webp"
import uptown from "../imports/city/uptown_02.webp"
import type { DailyOverview, OverviewSummary } from "./overview-resource"
import { casePhase, nextOverviewStep, type CaseSignal } from "./overview-state"
import "./foundation-overview.css"

type Destination =
  | "quests"
  | "active"
  | "history"
  | "packs"
  | "collection"
  | "bureaus"
  | "progress"
  | "profile"
  | "help"
type Resource<T> = { data: T | null; loading: boolean; error: boolean; retry: () => void }
type HeroArt = { image_url: string; artist: string; crop_x: number; crop_y: number }
type Profile = { avatar_url: string | null; xp: number }
type Level = {
  level: number
  level_xp: number
  next_level_xp: number
  total_xp: number
  xp_to_next: number
}
type CurrentCase = CaseSignal & { title: string; mode: string }

function Illustration({ card }: { card: HeroArt }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <div className="foundation-hero-art">
      <img
        src={card.image_url}
        alt=""
        decoding="async"
        style={{ objectPosition: card.crop_x + "% " + card.crop_y + "%" }}
        onError={() => setFailed(true)}
      />
      {card.artist && <span>{card.artist}</span>}
    </div>
  )
}

function Tile({
  icon,
  label,
  title,
  description,
  action,
  onClick,
  art,
  highlight = false,
}: {
  icon: IconName
  label: string
  title: string
  description: string
  action: string
  onClick: () => void
  art?: string
  highlight?: boolean
}) {
  return (
    <button className="foundation-tile" type="button" onClick={onClick} data-highlight={highlight}>
      {art && <img src={art} className="foundation-tile-art" alt="" loading="lazy" />}
      <span className="foundation-tile-label">
        <Icon name={icon} size={17} /> {label}
      </span>
      <strong>{title}</strong>
      <span className="foundation-tile-description">{description}</span>
      <span className="foundation-tile-action">
        {action} <Icon name="arrow-up-right" size={15} />
      </span>
    </button>
  )
}

function WeeklyActivity({
  summary,
  onHistory,
}: {
  summary: Resource<OverviewSummary>
  onHistory: () => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const values = summary.data?.weekly
  const totals = values?.reduce(
    (total, day) => ({
      cases: total.cases + day.cases,
      contracts: total.contracts + day.contracts,
      xp: total.xp + day.xp,
    }),
    { cases: 0, contracts: 0, xp: 0 },
  )
  const maximum = Math.max(1, ...(values?.map((day) => day.contracts) ?? []))
  const dateFormat = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })
  return (
    <section className="foundation-panel foundation-week" aria-labelledby="foundation-week-title">
      <header>
        <h2 id="foundation-week-title">{ru ? "Активность за неделю" : "Weekly activity"}</h2>
        <button className="foundation-link" type="button" onClick={onHistory}>
          {ru ? "История" : "History"} <Icon name="arrow-up-right" size={14} />
        </button>
      </header>
      {summary.error && <ResourceNotice stale={!!summary.data} retry={summary.retry} />}
      {summary.loading && <p role="status">{ru ? "Загружаем активность…" : "Loading activity…"}</p>}
      {totals && values && (
        <>
          {totals.cases + totals.contracts + totals.xp === 0 ? (
            <p>
              {ru
                ? "За последние семь дней нет подтверждённой активности."
                : "No verified activity in the last seven days."}
            </p>
          ) : (
            <div className="foundation-week-content">
              <ul
                className="foundation-week-bars"
                aria-label={
                  ru ? "Выполненные задания по дням, UTC" : "Contracts completed by day, UTC"
                }
              >
                {values.map((day) => (
                  <li key={day.date} aria-label={day.date + " · " + day.contracts}>
                    <span
                      aria-hidden="true"
                      style={{ "--bar": (day.contracts / maximum) * 100 + "%" } as CSSProperties}
                    />
                    <time dateTime={day.date}>{dateFormat.format(new Date(day.date))}</time>
                  </li>
                ))}
              </ul>
              <dl>
                <div>
                  <dt>{ru ? "Завершено дел" : "Cases resolved"}</dt>
                  <dd>{totals.cases.toLocaleString(locale)}</dd>
                </div>
                <div>
                  <dt>{ru ? "Выполнено заданий" : "Contracts completed"}</dt>
                  <dd>{totals.contracts.toLocaleString(locale)}</dd>
                </div>
                <div>
                  <dt>{ru ? "XP за контракты" : "Contract XP"}</dt>
                  <dd>{totals.xp.toLocaleString(locale)}</dd>
                </div>
              </dl>
            </div>
          )}
          <small>
            {ru ? "Сегодня и шесть предыдущих дней · UTC" : "Today and the previous six days · UTC"}
          </small>
        </>
      )}
    </section>
  )
}

function ResourceNotice({ stale, retry }: { stale: boolean; retry: () => void }) {
  const { language } = useLanguage()
  const ru = language === "ru"
  return (
    <div className="foundation-resource-note" role="status">
      <span>
        {stale
          ? ru
            ? "Показаны последние загруженные данные."
            : "Showing the last loaded data."
          : ru
            ? "Данные пока недоступны."
            : "Data is currently unavailable."}
      </span>
      <button type="button" className="foundation-link" onClick={retry}>
        {ru ? "Повторить" : "Retry"}
      </button>
    </div>
  )
}

export default function FoundationOverview({
  accountId,
  name,
  profile,
  progression,
  progressionError,
  retryProgression,
  summary,
  pack,
  banner,
  activeCases,
  recentResult,
  isNew,
  returning,
  boardsPending,
  boardsError,
  retryBoards,
  companion,
  onNavigate,
  onBureau,
  onCompanion,
  onboarding,
  recommendation,
}: {
  accountId: string
  name: string
  profile: Profile
  progression: Level | null
  progressionError: boolean
  retryProgression: () => void
  summary: Resource<OverviewSummary>
  pack: Resource<DailyOverview>
  banner: { card: HeroArt | null; loading: boolean; error: unknown; retry: () => void }
  activeCases: CurrentCase[]
  recentResult: string | null
  isNew: boolean
  returning: boolean
  boardsPending: boolean
  boardsError: boolean
  retryBoards: () => void
  companion: { online: boolean; paired?: boolean } | null
  onNavigate: (to: Destination) => void
  onBureau: (slug: string) => void
  onCompanion: () => void
  onboarding: ReactNode
  recommendation: ReactNode
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const active = activeCases[0]
  const xpKnown =
    !!progression &&
    Number.isFinite(progression.level_xp) &&
    Number.isFinite(progression.next_level_xp)
  const packStatus = pack.data
  const pendingPack = Boolean(savedKey(accountId))
  const packAvailable = !!packStatus?.available && !pack.error
  const step = nextOverviewStep(active, !!recentResult, isNew, packAvailable, returning)
  const stepActions = {
    active: { to: "active", text: ru ? "Продолжить дело" : "Continue case" },
    review: {
      to: "active",
      text: ru ? "Посмотреть дополнительную проверку" : "View additional review",
    },
    verifying: { to: "active", text: ru ? "Открыть проверку" : "View verification" },
    provider: { to: "active", text: ru ? "Посмотреть состояние" : "Check status" },
    detected: { to: "active", text: ru ? "Посмотреть состояние" : "Check status" },
    result: { to: "history", text: ru ? "Посмотреть результат" : "View result" },
    first: { to: "quests", text: ru ? "Выбрать первый контракт" : "Choose your first contract" },
    pack: { to: "packs", text: ru ? "Открыть конверт" : "Open daily pack" },
    returning: { to: "quests", text: ru ? "Продолжить прогресс" : "Continue your progress" },
    board: { to: "quests", text: ru ? "Выбрать контракты" : "Choose contracts" },
  } as const
  const next = stepActions[step]
  const phaseLabels = {
    active: ru ? "Ожидание матча" : "Waiting for a match",
    detected: ru ? "Матч найден · получаем данные" : "Match detected · collecting data",
    verifying: ru ? "Проверяем результат" : "Verifying the result",
    provider: ru ? "Ожидаем данные провайдера или очередь" : "Waiting for provider data or queue",
    review: ru ? "Дополнительная проверка" : "Additional review",
  }
  const status = active ? phaseLabels[casePhase(active)] : null
  const confirmedPackTitle = packStatus?.pack?.title
  const packTitle = pendingPack
    ? ru
      ? "Получение сохранено"
      : "Saved claim"
    : packStatus?.claimed_at
      ? ru
        ? "Конверт получен"
        : "Pack claimed"
      : packAvailable
        ? confirmedPackTitle || (ru ? "Доступен" : "Available")
        : pack.error
          ? ru
            ? "Доступность неизвестна"
            : "Availability unknown"
          : pack.loading
            ? ru
              ? "Проверяем доступность…"
              : "Checking availability…"
            : ru
              ? "Сейчас недоступен"
              : "Currently unavailable"
  const packAction = pendingPack
    ? ru
      ? "Продолжить получение"
      : "Resume claim"
    : packStatus?.operation_id
      ? ru
        ? "Открыть квитанцию"
        : "Open receipt"
      : packAvailable
        ? ru
          ? "Открыть конверт"
          : "Open daily pack"
        : ru
          ? "К конверту"
          : "Go to daily pack"
  const reset = Date.parse(packStatus?.next_reset_at ?? "")
  const resetMessage = Number.isFinite(reset)
    ? (ru ? "Обновление " : "Resets ") +
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }).format(reset) +
      " UTC"
    : ru
      ? "Бесплатные карточки героев."
      : "Free hero cards."
  const bureau = summary.data?.bureau
  const collection = summary.data?.collection
  const card = banner.card
  return (
    <div className="foundation-overview">
      <section className="foundation-hero">
        {card && <Illustration key={card.image_url} card={card} />}
        <div className="foundation-hero-copy">
          <p className="ns-eyebrow">
            {ru ? "DEADLOCK CONTRACTS / ЛИЧНЫЙ КАБИНЕТ" : "DEADLOCK CONTRACTS / YOUR WORKSPACE"}
          </p>
          <h1>
            {ru ? "На связи, " : "Welcome, "}
            {name}
          </h1>
          <p>
            {returning
              ? ru
                ? "С возвращением. Продолжайте с сохранённым прогрессом."
                : "Welcome back. Pick up with your saved progress."
              : ru
                ? "Выбирайте контракты. Играйте матчи. Собирайте карточки."
                : "Choose contracts. Play matches. Collect cards."}
          </p>
          <div className="foundation-hero-actions">
            {boardsPending && !active && !recentResult ? (
              <button className="dc-primary" type="button" disabled>
                {ru ? "Проверяем дела…" : "Checking cases…"}
              </button>
            ) : step === "result" && recentResult ? (
              <CompletionButton boardId={recentResult} primary />
            ) : (
              <button className="dc-primary" type="button" onClick={() => onNavigate(next.to)}>
                <Icon name={next.to === "packs" ? "mail" : "briefcase-business"} size={18} />{" "}
                {next.text}
              </button>
            )}
            <button className="dc-ghost" type="button" onClick={() => onNavigate("help")}>
              <Icon name="book-open" size={18} /> {ru ? "Как это работает" : "How it works"}
            </button>
          </div>
        </div>
      </section>
      {Boolean(banner.error) && <ResourceNotice stale={!!card} retry={banner.retry} />}
      <section
        className="foundation-panel foundation-profile"
        aria-label={ru ? "Сводка профиля" : "Profile summary"}
      >
        <button className="foundation-level" type="button" onClick={() => onNavigate("profile")}>
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" width="56" height="56" />
          ) : (
            <span className="foundation-avatar" aria-hidden="true">
              {name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span>
            <span>
              {ru ? "Уровень" : "Level"} <strong>{progression?.level ?? "—"}</strong>
            </span>
            {xpKnown && (
              <progress
                max={progression.next_level_xp}
                value={progression.level_xp}
                aria-label={ru ? "XP в текущем уровне" : "XP in current level"}
              />
            )}
            <small>
              {xpKnown
                ? progression.level_xp.toLocaleString(locale) +
                  " / " +
                  progression.next_level_xp.toLocaleString(locale) +
                  " XP"
                : progressionError
                  ? "—"
                  : ru
                    ? "Загружаем прогресс…"
                    : "Loading progress…"}
            </small>
          </span>
        </button>
        <dl>
          <div>
            <Icon name="clipboard-check" />
            <dt>{ru ? "Завершено дел" : "Cases resolved"}</dt>
            <dd>{summary.data?.completed_cases.toLocaleString(locale) ?? "—"}</dd>
          </div>
          <div>
            <Icon name="layers" />
            <dt>{ru ? "Всего опыта" : "Total XP"}</dt>
            <dd>{(progression?.total_xp ?? profile.xp).toLocaleString(locale)} XP</dd>
          </div>
          <div>
            <Icon name="target" />
            <dt>{ru ? "До следующего уровня" : "To next level"}</dt>
            <dd>{progression ? progression.xp_to_next.toLocaleString(locale) + " XP" : "—"}</dd>
          </div>
        </dl>
      </section>
      {progressionError && <ResourceNotice stale={!!progression} retry={retryProgression} />}
      <div className="foundation-tiles">
        <Tile
          icon="briefcase-business"
          label={ru ? "Активное дело" : "Active case"}
          title={
            active?.title ||
            (boardsPending
              ? ru
                ? "Загружаем дела…"
                : "Loading cases…"
              : boardsError
                ? ru
                  ? "Дело не загружено"
                  : "Case unavailable"
                : ru
                  ? "Нет активного дела"
                  : "No active case")
          }
          description={
            active
              ? [
                  active.mode,
                  status,
                  activeCases.length > 1 ? "+" + (activeCases.length - 1) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : ru
                ? "Выберите цель перед матчем."
                : "Choose a goal before your match."
          }
          action={
            active
              ? stepActions.active.text
              : boardsError
                ? ru
                  ? "Повторить"
                  : "Retry"
                : stepActions.board.text
          }
          onClick={() =>
            active ? onNavigate("active") : boardsError ? retryBoards() : onNavigate("quests")
          }
          art={city}
          highlight={!!active}
        />
        <Tile
          icon="mail"
          label={ru ? "Ежедневный конверт" : "Daily pack"}
          title={packTitle}
          description={resetMessage}
          action={packAction}
          onClick={() => onNavigate("packs")}
          art="/static/assets/ritual/sealed-scroll.webp"
          highlight={packAvailable || pendingPack}
        />
        <Tile
          icon="layers"
          label={ru ? "Моя коллекция" : "My collection"}
          title={
            collection
              ? collection.items.toLocaleString(locale) + (ru ? " экз." : " cards")
              : summary.loading
                ? ru
                  ? "Загружаем…"
                  : "Loading…"
                : ru
                  ? "Коллекция"
                  : "Collection"
          }
          description={
            collection
              ? collection.designs.toLocaleString(locale) +
                (ru ? " уникальных дизайнов" : " unique designs")
              : ru
                ? "Карточки и избранное"
                : "Cards and favorites"
          }
          action={ru ? "К коллекции" : "View collection"}
          onClick={() => onNavigate("collection")}
        />
        <Tile
          icon="building-2"
          label={ru ? "Сообщества" : "Communities"}
          title={
            bureau?.name ||
            (summary.loading
              ? ru
                ? "Загружаем…"
                : "Loading…"
              : ru
                ? "Сообщества Бюро"
                : "Player bureaus")
          }
          description={
            bureau?.operation
              ? bureau.operation.title[language] +
                " · " +
                bureau.operation.progress +
                "/" +
                bureau.operation.target
              : bureau?.status === "FROZEN"
                ? ru
                  ? "Бюро временно заморожено"
                  : "Bureau is frozen"
                : bureau
                  ? ru
                    ? "Нет активной операции"
                    : "No active operation"
                  : summary.data
                    ? ru
                      ? "Найдите или создайте бюро."
                      : "Find or create a bureau."
                    : ru
                      ? "Откройте список сообществ."
                      : "Browse player communities."
          }
          action={
            bureau
              ? ru
                ? "К своему бюро"
                : "View your bureau"
              : ru
                ? "К сообществам"
                : "View communities"
          }
          onClick={() => (bureau ? onBureau(bureau.slug) : onNavigate("bureaus"))}
          art={uptown}
        />
      </div>
      {pack.error && (
        <div className="foundation-pack-note">
          <span>
            {ru ? "Не удалось проверить конверт." : "Daily pack availability could not be checked."}
          </span>
          <button className="foundation-link" type="button" onClick={pack.retry}>
            {ru ? "Повторить" : "Retry"}
          </button>
        </div>
      )}
      {onboarding}
      <div className="foundation-details">
        {recommendation}
        <div className="foundation-side">
          <WeeklyActivity summary={summary} onHistory={() => onNavigate("history")} />
          <button
            className="foundation-panel foundation-companion"
            type="button"
            onClick={onCompanion}
          >
            <Icon name="video" size={22} />
            <span>
              <strong>{ru ? "Компаньон" : "Companion"}</strong>
              <small>
                {companion?.online
                  ? ru
                    ? "В сети"
                    : "Online"
                  : companion?.paired
                    ? ru
                      ? "Не в сети"
                      : "Offline"
                    : ru
                      ? "Состояние и подключение"
                      : "Status and connection"}
              </small>
            </span>
            <Icon name="arrow-up-right" size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}
