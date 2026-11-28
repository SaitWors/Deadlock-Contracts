import { useEffect, useState } from "react"
import { useLanguage } from "../i18n"
import { adminApi } from "./admin-api"

type Ratio = { players: number; eligible: number }
type Report = {
  observation_start: string | null
  window_end: string
  activity: { dau: number | null; wau: number | null; mau: number | null }
  retention: { d1: Ratio; d7: Ratio; d30: Ratio }
  first_contract: Ratio
  first_completion: Ratio
  second_contract: Ratio
  median_first_contract_seconds: number | null
  contracts_per_player: number | null
  pack_only_sessions: { sessions: number; eligible: number }
  onboarding_completion: Ratio
}

export default function FoundationAnalytics({ csrf }: { csrf: string }) {
  const { language, locale } = useLanguage()
  const [report, setReport] = useState<Report | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const request = new AbortController()
    void adminApi<Report>("/api/admin/foundation-analytics", csrf, { signal: request.signal })
      .then((data) => {
        if (request.signal.aborted) return
        setReport(data)
        setStatus("ready")
      })
      .catch(() => {
        if (!request.signal.aborted) setStatus("error")
      })
    return () => request.abort()
  }, [csrf, revision])

  const text = (ru: string, en: string) => (language === "ru" ? ru : en)
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 })
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" })
  const unavailable = text("Недостаточно данных", "Insufficient data")
  const value = (n: number | null) => (n === null ? "—" : number.format(n))
  const ratio = (count: number, eligible: number) =>
    eligible ? percent.format(count / eligible) : "—"
  const sample = (count: number, eligible: number) =>
    eligible ? `${number.format(count)} / ${number.format(eligible)}` : unavailable
  const cards: Array<{ label: string; value: string; description: string; sample?: string }> = []
  if (report) {
    const addRatio = (label: string, metric: Ratio, description: string) =>
      cards.push({
        label,
        value: ratio(metric.players, metric.eligible),
        description,
        sample: sample(metric.players, metric.eligible),
      })

    const seconds = report.median_first_contract_seconds
    const duration =
      seconds === null
        ? "—"
        : new Intl.NumberFormat(locale, {
            style: "unit",
            unit: seconds < 60 ? "second" : seconds < 3600 ? "minute" : "hour",
            maximumFractionDigits: 1,
          }).format(seconds < 60 ? seconds : seconds < 3600 ? seconds / 60 : seconds / 3600)
    cards.push(
      {
        label: "DAU",
        value: value(report.activity.dau),
        description: text("Последний полный день", "Last complete day"),
      },
      {
        label: "WAU",
        value: value(report.activity.wau),
        description: text("7 полных дней", "7 complete days"),
      },
      {
        label: "MAU",
        value: value(report.activity.mau),
        description: text("30 полных дней", "30 complete days"),
      },
    )
    for (const [label, metric] of Object.entries(report.retention))
      addRatio(
        label.toUpperCase(),
        metric,
        text("Возврат в этот день после регистрации", "Return on this day after signup"),
      )
    addRatio(
      text("Первое дело", "First case signed"),
      report.first_contract,
      text("Из новых аккаунтов", "Share of new accounts"),
    )
    addRatio(
      text("Первый результат", "First verified result"),
      report.first_completion,
      text("Из новых аккаунтов", "Share of new accounts"),
    )
    addRatio(
      text("Второе дело", "Second case signed"),
      report.second_contract,
      text("Из подписавших первое дело", "Share of first-case signers"),
    )
    cards.push(
      {
        label: text("Время до первого дела", "Time to first case"),
        value: duration,
        description: text("Медиана от регистрации до подписания", "Median from signup to signing"),
      },
      {
        label: text("Дел на игрока", "Cases per player"),
        value: value(report.contracts_per_player),
        description: text(
          "Подписанные дела / активные игроки за 30 дней",
          "Cases signed / active players over 30 days",
        ),
      },
      {
        label: text("Сессии только за конвертом", "Pack-only sessions"),
        value: ratio(report.pack_only_sessions.sessions, report.pack_only_sessions.eligible),
        description: text("Из сессий за 30 дней", "Share of sessions over 30 days"),
        sample: sample(report.pack_only_sessions.sessions, report.pack_only_sessions.eligible),
      },
    )
    addRatio(
      text("Прошли обучение", "Onboarding completed"),
      report.onboarding_completion,
      text("Из начавших обучение", "Share of players who started onboarding"),
    )
  }

  return (
    <section aria-labelledby="foundation-analytics-title" aria-busy={status === "loading"}>
      <div className="dc-admin-head">
        <div>
          <h2 id="foundation-analytics-title">
            {text("Продуктовая аналитика", "Product analytics")}
          </h2>
          {report?.observation_start && (
            <p>
              {text("Данные доступны с", "Data available since")}{" "}
              {day.format(new Date(report.observation_start))}.{" "}
              {text("Период закрыт на", "Period ended at")} 00:00 UTC{" "}
              {day.format(new Date(report.window_end))}.
            </p>
          )}
        </div>
        <button
          className="dc-ghost"
          type="button"
          disabled={status === "loading"}
          onClick={() => {
            setStatus("loading")
            setRevision((current) => current + 1)
          }}
        >
          {text("Обновить", "Refresh")}
        </button>
      </div>
      {status === "loading" && <p role="status">{text("Загружаем данные…", "Loading metrics…")}</p>}
      {status === "error" && (
        <p role="alert">
          {report
            ? text(
                "Не удалось обновить данные. Ниже последний загруженный отчёт.",
                "Refresh failed. The last loaded report is shown below.",
              )
            : text("Не удалось загрузить данные.", "Could not load metrics.")}
        </p>
      )}
      {report && !report.observation_start && (
        <p>{text("Сбор данных ещё не начался.", "No activity has been recorded yet.")}</p>
      )}
      {report?.observation_start && (
        <>
          <div className="dc-admin-grid dc-admin-grid-max">
            {cards.map((card) => (
              <article key={card.label}>
                <span>{card.label}</span>
                <b>{card.value}</b>
                <small>{card.description}</small>
                {card.sample && <small>{card.sample}</small>}
              </article>
            ))}
          </div>
          <article className="dc-panel">
            <h3>{text("Как считаются показатели", "Metric definitions")}</h3>
            <ul>
              <li>
                {text(
                  "Активность — посещения разделов, явные действия, подписание дела или получение ежедневного конверта. Сессия заканчивается через 30 минут без такой активности.",
                  "Activity includes section visits, explicit actions, case signing and daily pack claims. Sessions end after 30 minutes of inactivity.",
                )}
              </li>
              <li>
                {text(
                  "Возврат считается на точный день после регистрации. Для каждого интервала берутся до 30 зрелых дневных когорт.",
                  "Retention measures a return on the exact day after signup, using up to 30 mature daily cohorts for each interval.",
                )}
              </li>
              <li>
                {text(
                  "Первое и второе дело, подтверждённый итог (в том числе неудачный) и обучение считаются в течение семи суток от регистрации или от начала обучения. Для каждого показателя берутся до 30 зрелых дневных когорт.",
                  "First and second cases, verified outcomes (including failed outcomes), and onboarding use seven days from signup or the start of onboarding. Each metric uses up to 30 mature daily cohorts.",
                )}
              </li>
              <li>
                {text(
                  "Сессия только за конвертом содержит получение ежедневного конверта. Другие просмотры разделов и действия относят её к обычным сессиям.",
                  "A pack-only session contains a daily pack claim. Other section visits and recorded actions classify it as a regular session.",
                )}
              </li>
            </ul>
          </article>
        </>
      )}
    </section>
  )
}
