import { lazy, Suspense, useEffect, useState } from "react"
import { ApiError, request, useResource } from "../community/api"
import { LoadState } from "../community/Shared"
import { useLanguage, type Language } from "../i18n"
import type { Latency, PriorityCohort, SchedulerObservation } from "./RelayScheduler"
import "./contract-relay-admin.css"

const endpoint = "/api/admin/contract-relay"
const isAdminAccessDenied = (status: number | null) => status === 401 || status === 403
const RelayScheduler = lazy(() => import("./RelayScheduler"))

type NodeAction = "enable" | "disable" | "revoke"

type IngestObservation = {
  container_status: string
  gc_logs: string
  observed_at?: string | null
  last_gc_event_at?: string | null
  ingest_version?: string | null
  steam_session?: string | null
  last_metadata_quota_signal_at?: string | null
  last_history_rate_limit_at?: string | null
  last_salt_upload?: { at: string; count: number } | null
  metrics?: {
    metadata_used?: number | null
    metadata_available?: number | null
    history_used?: number | null
    history_available?: number | null
    cpu_percent?: number | null
    ram_bytes?: number | null
  } | null
  error?: string | null
  scheduler?: SchedulerObservation
}

type RelayNode = {
  id: string
  enabled: boolean
  has_token: boolean
  friendship_writes: boolean
  status: "online" | "stale" | "unknown" | "disabled"
  last_heartbeat_at: string | null
  last_observed_at: string | null
  agent_version: string | null
  last_successful_cycle_at: string | null
  ingest_status?: "fresh" | "stale" | "unknown"
  scheduler_freshness?: "fresh" | "stale" | "unknown"
  ingest: IngestObservation | null
  history: Array<{
    observed_at: string
    received_at: string
    events: string[]
    container_status: string
  }>
}

type RelayOverview = {
  integration_enabled?: boolean
  nodes: RelayNode[]
  participants: Record<"connected" | "pending" | "disconnected" | "error", number>
}

type RelayEffectiveness = {
  window_start: string
  window_end: string
  observed_until: string
  sample_size: number
  unknown_match_end_count?: number
  truncated: boolean
  quota_at_match_time: string
  priority_cohorts?: PriorityCohort[]
  cohorts: Array<{
    relay: "eligible" | "baseline" | "unknown"
    companion: "observed" | "unobserved"
    mode: string
    sample_size: number
    metadata_unobserved_count: number
    unresolved_count: number
    confirmed_share: number | null
    discovery: Latency
    verification: Latency
    after_discovery: Latency
  }>
}

function makeCopy(language: Language) {
  const ru = language === "ru"
  return (russian: string, english: string) => (ru ? russian : english)
}

type Copy = ReturnType<typeof makeCopy>

function localTime(value: string | null | undefined, language: Language) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed)
}

function ObservationTime({
  value,
  language,
  unknown,
}: {
  value?: string | null
  language: Language
  unknown: string
}) {
  const text = localTime(value, language)
  return text ? <time dateTime={value ?? undefined}>{text}</time> : unknown
}

function adminActionLabel(action: NodeAction, copy: Copy) {
  const labels = {
    enable: copy("Включить узел", "Enable node"),
    disable: copy("Отключить узел", "Disable node"),
    revoke: copy("Отозвать ключ", "Revoke key"),
  }
  return labels[action]
}

function NodePanel({
  node,
  language,
  copy,
  canManage,
  busy,
  onAction,
}: {
  node: RelayNode
  language: Language
  copy: Copy
  canManage: boolean
  busy: boolean
  onAction: (node: RelayNode, action: NodeAction) => Promise<void>
}) {
  const unknown = copy("Неизвестно", "Unknown")
  const date = (value?: string | null) => (
    <ObservationTime value={value} language={language} unknown={unknown} />
  )
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 })
  const nodeStatuses = {
    online: copy("На связи", "Online"),
    stale: copy("Давно без сигнала", "Stale"),
    unknown,
    disabled: copy("Отключён", "Disabled"),
  }
  const ingestStatuses = {
    fresh: copy("Свежий отчёт", "Fresh report"),
    stale: copy("Устаревший отчёт", "Stale report"),
    unknown,
  }
  const states: Record<string, string> = {
    running: copy("Работает", "Running"),
    created: copy("Создан", "Created"),
    removing: copy("Удаляется", "Removing"),
    dead: copy("Не работает", "Dead"),
    expired: copy("Истекла", "Expired"),
    exited: copy("Завершён", "Exited"),
    restarting: copy("Перезапускается", "Restarting"),
    missing: copy("Отсутствует", "Missing"),
    unavailable: copy("Недоступно", "Unavailable"),
    recent: copy("Свежие", "Recent"),
    paused: copy("Приостановлен", "Paused"),
    stale: copy("Устарели", "Stale"),
    active: copy("Активна", "Active"),
    unknown,
  }
  const state = (value?: string | null) => (value && states[value.toLowerCase()]) || unknown
  const eventLabels: Record<string, string> = {
    host_snapshot_invalid: copy("Некорректный отчёт хоста", "Invalid host report"),
    host_snapshot_unavailable: copy("Отчёт хоста недоступен", "Host report unavailable"),
    participant_sync_failed: copy("Ошибка получения участников", "Participant sync failed"),
    friendship_sync_failed: copy("Ошибка отправки статусов дружбы", "Friendship sync failed"),
    steam_enrollment_failed: copy("Сбой автоподключения через Steam", "Steam enrollment failed"),
    scheduler_sync_failed: copy("Очередь планировщика недоступна", "Scheduler queue unavailable"),
    docker_inspect_failed: copy("Состояние Docker недоступно", "Docker state unavailable"),
    docker_logs_failed: copy("Журнал Docker недоступен", "Docker log unavailable"),
  }
  const ingest = node.ingest
  const metrics = ingest?.metrics
  const quota = (used?: number | null, available?: number | null) => {
    if (used == null && available == null) return unknown
    return [
      used == null
        ? null
        : copy(`Использовано ${number.format(used)}`, `${number.format(used)} used`),
      available == null
        ? null
        : copy(`Доступно ${number.format(available)}`, `${number.format(available)} available`),
    ]
      .filter(Boolean)
      .join(" · ")
  }
  const rows = [
    [copy("Последний сигнал узла", "Last heartbeat"), date(node.last_heartbeat_at)],
    [copy("Последний успешный цикл", "Last successful cycle"), date(node.last_successful_cycle_at)],
    [copy("Версия Relay Manager", "Relay Manager version"), node.agent_version ?? unknown],
    [
      copy("Ключ узла", "Node key"),
      node.has_token ? copy("Зарегистрирован", "Registered") : copy("Отсутствует", "Missing"),
    ],
    [
      copy("Запись статуса дружбы", "Friendship status reports"),
      node.friendship_writes ? copy("Разрешена", "Enabled") : copy("Выключена", "Disabled"),
    ],
    [
      copy("Состояние отчёта Ingest", "Ingest report status"),
      ingestStatuses[node.ingest_status ?? "unknown"],
    ],
    [copy("Наблюдение Ingest", "Ingest observed at"), date(ingest?.observed_at)],
    [copy("Версия Ingest", "Ingest version"), ingest?.ingest_version ?? unknown],
    [copy("Контейнер", "Container"), state(ingest?.container_status)],
    [copy("Журнал Game Coordinator", "Game Coordinator log"), state(ingest?.gc_logs)],
    [
      copy("Последнее событие Game Coordinator", "Last Game Coordinator event"),
      date(ingest?.last_gc_event_at),
    ],
    [copy("Сессия Steam", "Steam session"), state(ingest?.steam_session)],
    ...(!ingest?.scheduler || ingest.scheduler.mode === "legacy"
      ? ([
          [
            copy("Квота метаданных", "Metadata quota"),
            quota(metrics?.metadata_used, metrics?.metadata_available),
          ],
          [
            copy("Квота истории матчей", "Match history quota"),
            quota(metrics?.history_used, metrics?.history_available),
          ],
        ] as const)
      : []),
    [
      copy("Последний сигнал о квоте метаданных", "Last metadata quota signal"),
      date(ingest?.last_metadata_quota_signal_at),
    ],
    [
      copy("Последнее ограничение истории", "Last history rate limit"),
      date(ingest?.last_history_rate_limit_at),
    ],
    [
      copy("Последняя успешная отправка", "Last successful upload"),
      ingest?.last_salt_upload ? (
        <>
          {date(ingest.last_salt_upload.at)} · {number.format(ingest.last_salt_upload.count)}
        </>
      ) : (
        unknown
      ),
    ],
    [
      copy("Нагрузка CPU контейнера", "Container CPU"),
      metrics?.cpu_percent == null ? unknown : `${number.format(metrics.cpu_percent)}%`,
    ],
    [
      copy("Память контейнера", "Container memory"),
      metrics?.ram_bytes == null
        ? unknown
        : copy(
            `${number.format(metrics.ram_bytes / 1048576)} МиБ`,
            `${number.format(metrics.ram_bytes / 1048576)} MiB`,
          ),
    ],
  ] as const
  const toggle = node.enabled ? "disable" : "enable"

  return (
    <article className="dc-panel dc-relay-node">
      <header>
        <h3>{node.id}</h3>
        <p role="status">{nodeStatuses[node.status] ?? unknown}</p>
      </header>
      {ingest?.error && (
        <p role="status">
          {copy("Ошибка Ingest", "Ingest error")} · {eventLabels[ingest.error] ?? unknown}
        </p>
      )}
      <dl className="dc-relay-facts">
        {rows.map(([label, value]) => (
          <div className="dc-admin-kv" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {ingest?.scheduler && (
        <Suspense>
          <RelayScheduler
            observation={ingest.scheduler}
            language={language}
            stale={node.status === "disabled" || node.scheduler_freshness !== "fresh"}
          />
        </Suspense>
      )}
      <details>
        <summary>{copy("Последние события синхронизации", "Recent sync events")}</summary>
        {node.history.length ? (
          <ul className="dc-relay-events">
            {node.history.map((item, index) => (
              <li key={`${item.received_at}-${index}`}>
                <div>
                  {date(item.observed_at)} · {state(item.container_status)}
                </div>
                {item.events.length > 0 && (
                  <div>{item.events.map((event) => eventLabels[event] ?? unknown).join(" · ")}</div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>{copy("Событий пока нет.", "No events have been reported.")}</p>
        )}
      </details>
      {canManage && (
        <div className="dc-admin-user-actions">
          {(node.enabled || node.has_token) && (
            <button
              type="button"
              className="dc-ghost"
              disabled={busy}
              onClick={() => void onAction(node, toggle)}
            >
              {adminActionLabel(toggle, copy)}
            </button>
          )}
          {node.has_token && (
            <button
              type="button"
              className="dc-ghost"
              disabled={busy}
              onClick={() => void onAction(node, "revoke")}
            >
              {adminActionLabel("revoke", copy)}
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function Effectiveness({
  data,
  language,
  copy,
}: {
  data: RelayEffectiveness
  language: Language
  copy: Copy
}) {
  const seconds = new Intl.NumberFormat(language, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  })
  const percent = new Intl.NumberFormat(language, {
    style: "percent",
    maximumFractionDigits: 1,
  })
  const unknown = "—"
  const latency = (summary: Latency) => (
    <>
      {[summary.median_seconds, summary.p90_seconds]
        .map((value) => (value == null ? unknown : seconds.format(value)))
        .join(" / ")}
      {" · n="}
      {summary.observed_count}
    </>
  )
  const relay = {
    eligible: copy("Дружба подтверждена", "Friendship confirmed"),
    baseline: copy("Без активного участия", "No active opt-in"),
    unknown: copy("Статус Relay неизвестен", "Relay status unknown"),
  }
  const columns = [
    copy("Группа · режим", "Cohort · mode"),
    "Companion",
    copy("Попытки", "Attempts"),
    copy("Без метаданных", "Metadata unobserved"),
    copy("Без итога", "Unresolved"),
    copy("Доля подтверждённых", "Confirmed share"),
    copy("До метаданных", "To metadata"),
    copy("До итога", "To decision"),
    copy("Метаданные → итог", "Metadata → decision"),
  ]
  return (
    <>
      <p>
        <ObservationTime value={data.window_start} language={language} unknown={unknown} />
        {" – "}
        <ObservationTime value={data.window_end} language={language} unknown={unknown} />
        {" · "}
        {copy("Наблюдения до", "Observed through")}{" "}
        <ObservationTime value={data.observed_until} language={language} unknown={unknown} />
      </p>
      {Boolean(data.unknown_match_end_count) && (
        <p>
          {copy("Без времени окончания", "Match end unknown")} · {data.unknown_match_end_count}
        </p>
      )}
      {data.truncated && (
        <p>{copy("Выборка ограничена сервером.", "The server capped the sample.")}</p>
      )}
      {data.quota_at_match_time === "unobserved" && (
        <p>{copy("Квота на момент матчей неизвестна.", "Quota at match time was unobserved.")}</p>
      )}
      {!!data.priority_cohorts?.length && (
        <Suspense>
          <RelayScheduler cohorts={data.priority_cohorts} copy={copy} latency={latency} />
        </Suspense>
      )}
      {data.sample_size === 0 || !data.cohorts.length ? (
        <p role="status">
          {copy(
            "Пока нет наблюдений для оценки задержки.",
            "No match observations are available yet.",
          )}
        </p>
      ) : (
        <>
          <p>
            {copy(
              "Задержка от конца найденного матча. Медиана / P90, n — число наблюдений.",
              "Latency from the end of a detected match. Median / P90, n is sample size.",
            )}
          </p>
          <div
            className="dc-relay-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={copy("Таблица задержек", "Latency table")}
          >
            <table className="dc-relay-table">
              <thead>
                <tr>
                  {columns.map((label) => (
                    <th scope="col" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((cohort) => (
                  <tr key={`${cohort.relay}-${cohort.companion}-${cohort.mode}`}>
                    <th scope="row">
                      {relay[cohort.relay] ?? relay.unknown} · {cohort.mode}
                    </th>
                    <td>
                      {cohort.companion === "observed"
                        ? copy("Сигнал получен", "Signal observed")
                        : copy("Сигнал не зафиксирован", "Signal unobserved")}
                    </td>
                    <td>{cohort.sample_size}</td>
                    <td>{cohort.metadata_unobserved_count}</td>
                    <td>{cohort.unresolved_count}</td>
                    <td>
                      {cohort.confirmed_share == null
                        ? unknown
                        : percent.format(cohort.confirmed_share)}
                    </td>
                    <td>{latency(cohort.discovery)}</td>
                    <td>{latency(cohort.verification)}</td>
                    <td>{latency(cohort.after_discovery)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

export default function AdminContractRelay({
  csrf,
  canManage,
  onAuthExpired,
  onShowParticipants,
}: {
  csrf: string
  canManage: boolean
  onAuthExpired: () => void
  onShowParticipants?: () => void
}) {
  const { language } = useLanguage()
  const copy = makeCopy(language)
  const overview = useResource<RelayOverview>(endpoint, { reloadOnLanguageChange: false })
  const effectiveness = useResource<RelayEffectiveness>(`${endpoint}/effectiveness`, {
    reloadOnLanguageChange: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    if (isAdminAccessDenied(overview.errorStatus) || isAdminAccessDenied(effectiveness.errorStatus))
      onAuthExpired()
  }, [overview.errorStatus, effectiveness.errorStatus, onAuthExpired])

  async function update(node: RelayNode, action: NodeAction) {
    if (busy || !canManage) return
    const questions = {
      enable: copy(`Возобновить обмен с узлом ${node.id}?`, `Resume exchange with ${node.id}?`),
      disable: copy(
        `Остановить обмен с ${node.id}? Этот ключ можно снова включить.`,
        `Pause ${node.id}? You can re-enable its key.`,
      ),
      revoke: copy(
        `Отозвать ключ ${node.id}? Для возобновления нужен новый ключ.`,
        `Revoke the ${node.id} key? Resuming requires a new key.`,
      ),
    }
    if (!window.confirm(questions[action])) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await request<{ ok: true }>(`${endpoint}/nodes/${encodeURIComponent(node.id)}`, csrf, {
        method: "POST",
        body: JSON.stringify({ action }),
      })
      setNotice(copy("Настройки узла сохранены.", "Node settings saved."))
      overview.reload()
    } catch (reason) {
      if (reason instanceof ApiError && isAdminAccessDenied(reason.status)) onAuthExpired()
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const participantLabels = [
    ["connected", copy("Подтверждены", "Connected")],
    ["pending", copy("Ожидают проверки", "Pending")],
    ["disconnected", copy("Дружба не найдена", "Friendship not found")],
    ["error", copy("Ошибка проверки", "Check error")],
  ] as const

  return (
    <section className="dc-relay-console" aria-labelledby="contract-relay-heading">
      <div className="dc-panel">
        <h2 id="contract-relay-heading">Contract Relay</h2>
        {overview.data?.integration_enabled === false && (
          <p role="status">
            {copy("Интеграция отключена на сайте.", "The integration is disabled on the site.")}
          </p>
        )}
        <div className="dc-admin-user-actions">
          <button
            type="button"
            className="dc-ghost"
            disabled={busy || overview.loading || effectiveness.loading}
            onClick={() => {
              overview.reload()
              effectiveness.reload()
            }}
          >
            {copy("Обновить данные", "Refresh data")}
          </button>
          {onShowParticipants && (
            <button type="button" className="dc-ghost" onClick={onShowParticipants}>
              {copy("Открыть участников", "Open participants")}
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </div>

      {overview.data ? (
        <>
          <section className="dc-panel">
            <h3>{copy("Участники", "Participants")}</h3>
            <dl className="dc-relay-counts">
              {participantLabels.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{overview.data?.participants[key]}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="dc-relay-nodes">
            <h3>{copy("Узлы Relay", "Relay nodes")}</h3>
            {overview.data.nodes.length ? (
              overview.data.nodes.map((node) => (
                <NodePanel
                  key={node.id}
                  node={node}
                  language={language}
                  copy={copy}
                  canManage={canManage}
                  busy={busy}
                  onAction={update}
                />
              ))
            ) : (
              <p>
                {copy("Узлы Relay пока не зарегистрированы.", "No Relay nodes are registered yet.")}
              </p>
            )}
          </section>
        </>
      ) : (
        <LoadState error={overview.error} retry={overview.reload} />
      )}

      <section className="dc-panel">
        <h3>{copy("Наблюдаемая задержка проверки", "Observed verification latency")}</h3>
        {effectiveness.data ? (
          <Effectiveness data={effectiveness.data} language={language} copy={copy} />
        ) : (
          <LoadState error={effectiveness.error} retry={effectiveness.reload} />
        )}
      </section>
    </section>
  )
}
