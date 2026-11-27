import type { ReactNode } from "react"
import type { Language } from "../i18n"
import SvgIcon from "../icons/Icon"

type Operation = "history" | "metadata"
export type Latency = {
  observed_count: number
  median_seconds: number | null
  p90_seconds: number | null
}
export type PriorityCohort = {
  streamer: boolean | null
  sample_size: number
  confirmed_contracts: number
  discovery: Latency
  verification: Latency
}

type Quota = {
  used?: number
  limit?: number
  remaining?: number
  reserve?: number
  next_release_at?: number
  next_request_at?: number
  rate_limited_until?: number
}

type Reason =
  | "selected"
  | "paced"
  | "cooldown"
  | "quota"
  | "reserve"
  | "stale_input"
  | "no_friendship"
  | "api_hit"
  | "api_unavailable"
  | "duplicate"
  | "rate_limited"
  | "not_available"

export type SchedulerObservation = {
  mode: "legacy" | "shadow" | "active"
  status:
    | "ready"
    | "stale_input"
    | "blocked"
    | "no_tasks"
    | "api_unavailable"
    | "session_unavailable"
  observed_at: number
  history?: Quota
  metadata?: Quota
  queued_streamer?: number
  queued_regular?: number
  oldest_wait_seconds?: number
  decisions?: Array<{
    operation: Operation
    streamer: boolean
    score: number
    streamer_bonus: number
    wait_seconds: number
    next_request_at?: number
    reason: Reason
  }>
  totals?: {
    history_streamer?: number
    history_regular?: number
    metadata_streamer?: number
    metadata_regular?: number
    history_useful?: number
    history_empty?: number
    api_hits?: number
    duplicates?: number
    discovered_matches?: number
    metadata_posted?: number
  }
  simulated?: Partial<Record<Operation, number>>
}

function StreamerBadge() {
  return (
    <span className="dc-role-badge streamer">
      <SvgIcon name="video" className="dc-role-icon" />
      <span>STREAMER</span>
    </span>
  )
}

type CohortProps = {
  cohorts: PriorityCohort[]
  copy: (ru: string, en: string) => string
  latency: (summary: Latency) => ReactNode
}

function PriorityCohorts({ cohorts, copy, latency }: CohortProps) {
  const title = copy("Результаты по значку", "Outcomes by badge")
  const headings = [
    copy("Группа", "Cohort"),
    copy("Попытки", "Attempts"),
    copy("Проверенные контракты", "Verified contracts"),
    copy("До метаданных", "To metadata"),
    copy("До итога", "To decision"),
  ]
  return (
    <section className="dc-relay-priority-cohorts">
      <h4>{title}</h4>
      <p>
        {copy(
          "Автоматические итоги проверки контрактов участников с подтверждённой дружбой. Учитывается значок на момент привязки матча.",
          "Automatic verification results for participants with confirmed friendship. Streamer status comes from the badge at match binding.",
        )}
      </p>
      <div className="dc-relay-table-scroll" tabIndex={0} role="region" aria-label={title}>
        <table className="dc-relay-table dc-relay-priority-table">
          <thead>
            <tr>
              {headings.map((label) => (
                <th scope="col" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => (
              <tr key={String(cohort.streamer)}>
                <th scope="row">
                  {cohort.streamer === null ? (
                    copy("Значок неизвестен", "Badge unknown")
                  ) : cohort.streamer ? (
                    <StreamerBadge />
                  ) : (
                    copy("Обычные игроки", "Regular players")
                  )}
                </th>
                <td>{cohort.sample_size}</td>
                <td>{cohort.confirmed_contracts}</td>
                <td>{latency(cohort.discovery)}</td>
                <td>{latency(cohort.verification)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

type SchedulerProps = {
  observation: SchedulerObservation
  stale: boolean
  language: Language
}

function SchedulerPanel({ observation, stale, language }: SchedulerProps) {
  const copy = (ru: string, en: string) => (language === "ru" ? ru : en)
  const unknown = copy("Неизвестно", "Unknown")
  const numbers = new Intl.NumberFormat(language)
  const count = (value?: number) => (value == null ? unknown : numbers.format(value))
  const times = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" })
  const time = (epoch?: number) => {
    if (epoch == null) return unknown
    const parsed = new Date(epoch * 1000)
    return <time dateTime={parsed.toISOString()}>{times.format(parsed)}</time>
  }
  const minutes = new Intl.NumberFormat(language, {
    style: "unit",
    unit: "minute",
    maximumFractionDigits: 0,
  })
  const wait = (value?: number) =>
    value == null
      ? unknown
      : value > 0 && value < 60
        ? copy("Меньше минуты", "Under a minute")
        : minutes.format(value / 60)
  const modeLabels = {
    legacy: copy("Текущий Ingest", "Legacy Ingest"),
    shadow: copy("Наблюдение", "Shadow mode"),
    active: copy("Активный режим", "Active scheduler"),
  }
  const statuses = {
    ready: copy("Очередь доступна", "Queue available"),
    stale_input: copy(
      "Очередь или список участников устарели",
      "Queue or participant list expired",
    ),
    blocked: copy("Сбор приостановлен", "Collection paused"),
    no_tasks: copy("Нет ожидающих задач", "No pending tasks"),
    api_unavailable: copy("Deadlock API недоступен", "Deadlock API unavailable"),
    session_unavailable: copy("Сессия Steam недоступна", "Steam session unavailable"),
  }
  const reasons: Record<Reason, string> = {
    selected: copy("Выбрано для запроса", "Selected for request"),
    paced: copy("Ожидает следующего цикла", "Waiting for the next cycle"),
    cooldown: copy("Действует интервал повтора", "Retry interval in effect"),
    quota: copy("Квота исчерпана", "Quota exhausted"),
    reserve: copy("Сохранён резерв", "Reserve held"),
    stale_input: copy("Входные данные устарели", "Inputs expired"),
    no_friendship: copy("Дружба не подтверждена", "Friendship unconfirmed"),
    api_hit: copy("Данные есть в Deadlock API", "Available in Deadlock API"),
    api_unavailable: statuses.api_unavailable,
    duplicate: copy("Совпадает с другой задачей", "Duplicate task"),
    rate_limited: copy("Ограничение Steam", "Steam rate limit"),
    not_available: copy("Запрос сейчас недоступен", "Request currently unavailable"),
  }
  const operations = {
    history: copy("История матчей", "Match history"),
    metadata: copy("Метаданные", "Metadata"),
  }
  const ordinary = copy("Обычные игроки", "Regular players")
  const totals = observation.totals
  const metrics =
    totals &&
    ([
      [copy("Полезные запросы истории", "Useful history requests"), totals.history_useful],
      [
        copy("Запросы истории без новых матчей", "History requests without new matches"),
        totals.history_empty,
      ],
      [copy("Задачи с данными из API", "Tasks with data in the API"), totals.api_hits],
      [copy("Устранённые дубли", "Duplicates skipped"), totals.duplicates],
      [copy("Обнаруженные матчи", "Matches discovered"), totals.discovered_matches],
      [copy("Переданные метаданные", "Metadata posted"), totals.metadata_posted],
    ] as const)
  const tableLabel = copy("Скользящие квоты за 24 часа", "Rolling 24-hour quotas")

  return (
    <section
      className="dc-relay-scheduler"
      aria-label={copy("Планировщик матчей", "Match scheduler")}
    >
      <h4>{copy("Планировщик матчей", "Match scheduler")}</h4>
      <p>
        {modeLabels[observation.mode]} ·{" "}
        {stale ? copy("Наблюдение устарело", "Observation expired") : statuses[observation.status]}
        {" · "}
        {time(observation.observed_at)}
      </p>
      {!stale && (
        <>
          <div className="dc-relay-table-scroll" tabIndex={0} role="region" aria-label={tableLabel}>
            <table className="dc-relay-table dc-relay-quota-table">
              <caption>{tableLabel}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy("Запрос", "Request")}</th>
                  <th scope="col">{copy("Расход / лимит", "Used / limit")}</th>
                  <th scope="col">{copy("Остаток", "Remaining")}</th>
                  <th scope="col">{copy("Резерв", "Reserve")}</th>
                  <th scope="col">{copy("Ближайшее восстановление", "Next release")}</th>
                  <th scope="col">{copy("Следующий запрос", "Next request")}</th>
                  <th scope="col">{copy("Ограничение Steam до", "Steam rate limit until")}</th>
                </tr>
              </thead>
              <tbody>
                {(["history", "metadata"] as const).map((operation) => {
                  const quota = observation[operation]
                  return (
                    <tr key={operation}>
                      <th scope="row">{operations[operation]}</th>
                      <td>
                        {count(quota?.used)} / {count(quota?.limit)}
                      </td>
                      <td>{count(quota?.remaining)}</td>
                      <td>{count(quota?.reserve)}</td>
                      <td>{time(quota?.next_release_at)}</td>
                      <td>{time(quota?.next_request_at)}</td>
                      <td>{time(quota?.rate_limited_until)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {observation.mode === "shadow" && (
            <p>
              {copy("Смоделированные запросы", "Simulated requests")} · {operations.history}{" "}
              {count(observation.simulated?.history)} · {operations.metadata}{" "}
              {count(observation.simulated?.metadata)}
            </p>
          )}
          <details>
            <summary>{copy("Очередь и решения", "Queue and decisions")}</summary>
            <dl className="dc-relay-facts">
              <div className="dc-admin-kv">
                <dt>{copy("Участники с задачами", "Participants with tasks")}</dt>
                <dd>
                  {observation.queued_streamer == null || observation.queued_regular == null
                    ? unknown
                    : count(observation.queued_streamer + observation.queued_regular)}
                </dd>
              </div>
              <div className="dc-admin-kv">
                <dt>
                  <StreamerBadge />
                </dt>
                <dd>{count(observation.queued_streamer)}</dd>
              </div>
              <div className="dc-admin-kv">
                <dt>{ordinary}</dt>
                <dd>{count(observation.queued_regular)}</dd>
              </div>
              <div className="dc-admin-kv">
                <dt>{copy("Максимальное ожидание", "Longest wait")}</dt>
                <dd>{wait(observation.oldest_wait_seconds)}</dd>
              </div>
            </dl>
            {observation.decisions && observation.decisions.length > 0 && (
              <ul className="dc-relay-decisions">
                {observation.decisions.map((decision, index) => (
                  <li key={index}>
                    {operations[decision.operation]} ·{" "}
                    {decision.streamer ? <StreamerBadge /> : ordinary}
                    {" · "}
                    {copy("Приоритет", "Priority")} {count(decision.score)}
                    {decision.streamer && (
                      <>
                        {" "}
                        ({copy("Бонус", "Bonus")} +{count(decision.streamer_bonus)})
                      </>
                    )}
                    {" · "}
                    {copy("Ожидание", "Wait")} {wait(decision.wait_seconds)}
                    {" · "}
                    {reasons[decision.reason]}
                    {decision.next_request_at != null && (
                      <>
                        {" "}
                        · {copy("Следующий запрос", "Next request")}{" "}
                        {time(decision.next_request_at)}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </details>
          {metrics && (
            <details>
              <summary>{copy("Результаты планировщика", "Scheduler results")}</summary>
              <dl className="dc-relay-facts">
                <div className="dc-admin-kv">
                  <dt>
                    <StreamerBadge /> · {copy("История / метаданные", "History / metadata")}
                  </dt>
                  <dd>
                    {count(totals?.history_streamer)} / {count(totals?.metadata_streamer)}
                  </dd>
                </div>
                <div className="dc-admin-kv">
                  <dt>
                    {ordinary} · {copy("История / метаданные", "History / metadata")}
                  </dt>
                  <dd>
                    {count(totals?.history_regular)} / {count(totals?.metadata_regular)}
                  </dd>
                </div>
                {metrics.map(([label, value]) => (
                  <div className="dc-admin-kv" key={label}>
                    <dt>{label}</dt>
                    <dd>{count(value)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      )}
    </section>
  )
}

export default function RelayScheduler(props: SchedulerProps | CohortProps) {
  return "observation" in props ? <SchedulerPanel {...props} /> : <PriorityCohorts {...props} />
}
