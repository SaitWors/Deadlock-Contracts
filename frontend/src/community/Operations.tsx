import { useRef, useState } from "react"
import { useLanguage } from "../i18n"
import { request, useResource } from "./api"
import { LoadState } from "./Shared"
import Regalia from "../regalia/Regalia"

type Operation = {
  id: string
  template: string
  title: Record<"ru" | "en", string>
  target: number
  min_contributors: number
  progress: number
  contributors: number
  status: string
  started_at: string
  ends_at: string
  checked_at: string
  cancel_reason: string
  my_contribution: number
  journal: { action: string; at: string; contract_id: string | null }[]
}
type Template = {
  title: Record<"ru" | "en", string>
  target: number
  min_contributors: number
  category: string | null
  metric: string
}
export default function Operations({
  slug,
  csrf,
  manager,
  director,
  frozen,
}: {
  slug: string
  csrf: string
  manager: boolean
  director: boolean
  frozen: boolean
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const url = `/api/bureaus/${encodeURIComponent(slug)}/operations`
  const resource = useResource<{ items: Operation[]; templates: Record<string, Template> }>(url)
  const [template, setTemplate] = useState("city_cases")
  const [days, setDays] = useState(7)
  const [cancel, setCancel] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const guard = useRef(false)
  async function mutate(path: string, body: unknown) {
    if (guard.current) return
    guard.current = true
    setBusy(true)
    setError("")
    try {
      await request(url + path, csrf, { method: "POST", body: JSON.stringify(body) })
      setCancel("")
      setReason("")
      resource.reload()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      guard.current = false
      setBusy(false)
    }
  }
  const labels: Record<string, string> = ru
    ? {
        ACTIVE: "Операция идёт",
        COMPLETED: "Цель достигнута",
        EXPIRED: "Срок истёк",
        CANCELLED: "Отменена",
        CORRECTED: "Результат пересмотрен",
      }
    : {
        ACTIVE: "In progress",
        COMPLETED: "Goal reached",
        EXPIRED: "Window closed",
        CANCELLED: "Cancelled",
        CORRECTED: "Result corrected",
      }
  const events: Record<string, string> = ru
    ? {
        CREDIT: "Контракт засчитан",
        REVOKE: "Зачёт отозван после проверки",
        RESTORE: "Зачёт восстановлен",
      }
    : {
        CREDIT: "Contract credited",
        REVOKE: "Credit revoked after review",
        RESTORE: "Credit restored",
      }
  const current = resource.data?.items.some(
    (item) => item.status !== "CANCELLED" && Date.parse(item.ends_at) > Date.now(),
  )
  const selected = resource.data?.templates[template]
  return (
    <section className="community-panel bureau-operations">
      <div className="bureau-regalia-heading">
        <Regalia id="seal-team" />
        <div>
          <p className="community-eyebrow">{ru ? "ОБЩЕЕ ДЕЛО" : "SHARED PURPOSE"}</p>
          <h2>{ru ? "Совместные операции" : "Joint operations"}</h2>
        </div>
      </div>
      <p>
        {ru
          ? "Выберите общую цель. Выполняйте свои контракты и собирайте командную печать для витрины профиля."
          : "Choose a shared goal. Complete your contracts and earn a team seal for your profile showcase."}
      </p>
      <details className="community-footnote">
        <summary>{ru ? "Как учитывается вклад" : "How contributions count"}</summary>
        <p>
          {ru
            ? "Контракт нужно подписать после начала операции и вступления в бюро. Матч должен закончиться до выхода из бюро и окончания срока. Подтверждение может прийти позже. Один контракт учитывается один раз; только подтверждение Companion без независимой проверки не засчитывается."
            : "Sign after the operation starts and after joining. Finish the match before leaving and before the deadline. Verification can arrive later. Each contract counts once; Companion-only attestation does not count."}
        </p>
        <p>
          {ru
            ? "Для печати нужны общая цель, минимальное число участников и ваш личный вклад. Дополнительного XP нет. Пересмотр результата контракта меняет прогресс и доступность печати. При приостановке бюро незавершённые операции отменяются."
            : "A seal requires the shared goal, minimum contributors and your own contribution. No extra XP is awarded. Corrected contract results update progress and seal eligibility. Pausing a bureau cancels unfinished operations."}
        </p>
      </details>
      {error && (
        <p role="alert" className="community-error">
          {error}
        </p>
      )}
      {resource.loading || resource.error || !resource.data ? (
        <LoadState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          {manager && !frozen && !current && (
            <form
              className="bureau-editor"
              onSubmit={(event) => {
                event.preventDefault()
                void mutate("", { template, days })
              }}
            >
              <fieldset disabled={busy}>
                <legend>{ru ? "Начать операцию" : "Start an operation"}</legend>
                <div className="community-form-grid">
                  <label>
                    {ru ? "Цель" : "Goal"}
                    <select value={template} onChange={(event) => setTemplate(event.target.value)}>
                      {Object.entries(resource.data.templates).map(([key, value]) => (
                        <option key={key} value={key}>
                          {value.title[language]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {ru ? "Срок" : "Duration"}
                    <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
                      {[1, 3, 7].map((value) => (
                        <option key={value} value={value}>
                          {value} {ru ? "дн." : "days"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {selected && (
                  <p>
                    {selected.target}{" "}
                    {selected.metric === "contributors"
                      ? ru
                        ? "участников с вкладом"
                        : "contributors"
                      : ru
                        ? "контрактов"
                        : "contracts"}
                    {selected.category ? (ru ? " поддержки" : " in support") : ""} ·{" "}
                    {ru ? "минимум участников:" : "minimum contributors:"}{" "}
                    {selected.min_contributors}
                  </p>
                )}
                <button className="dc-primary" disabled={busy}>
                  {ru ? "Начать общее дело" : "Start the shared mission"}
                </button>
              </fieldset>
            </form>
          )}
          {!resource.data.items.length && (
            <p className="community-muted">
              {manager
                ? ru
                  ? "Первую цель выбираете вы."
                  : "You choose the first goal."
                : ru
                  ? "Руководство ещё не назначило операцию."
                  : "Management has not started an operation yet."}
            </p>
          )}
          {resource.data.items.map((item) => (
            <article className="operation-card" key={item.id}>
              <p className="community-eyebrow">{labels[item.status]}</p>
              <h3>{item.title[language]}</h3>
              <p>
                {ru ? "До" : "Until"}{" "}
                <time dateTime={item.ends_at}>{new Date(item.ends_at).toLocaleString(locale)}</time>
              </p>
              <label>
                {ru ? "Общая цель" : "Shared goal"} · {item.progress} / {item.target}
                <progress max={item.target} value={Math.min(item.progress, item.target)} />
              </label>
              <p>
                {ru ? "Участников с вкладом" : "Contributors"}: {item.contributors} /{" "}
                {item.min_contributors} · {ru ? "Ваших контрактов" : "Your contracts"}:{" "}
                <b>{item.my_contribution}</b>
              </p>
              {item.status === "COMPLETED" && item.my_contribution > 0 && (
                <p className="community-notice">
                  {ru
                    ? "Командная печать открыта в достижениях. Её можно выбрать в витрине профиля."
                    : "Your team seal is available in achievements and the profile showcase."}
                </p>
              )}
              {item.cancel_reason && <p className="community-prose">{item.cancel_reason}</p>}
              <details>
                <summary>{ru ? "Мой журнал вклада" : "My contribution log"}</summary>
                {item.journal.length ? (
                  <ul>
                    {item.journal.map((entry, index) => (
                      <li key={index}>
                        {events[entry.action]} ·{" "}
                        <time dateTime={entry.at}>{new Date(entry.at).toLocaleString(locale)}</time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {ru ? "Подтверждённого вклада пока нет." : "No verified contributions yet."}
                  </p>
                )}
              </details>
              <p className="community-footnote">
                {ru ? "Проверено" : "Checked"}: {new Date(item.checked_at).toLocaleString(locale)}
              </p>
              {director && !["COMPLETED", "CANCELLED"].includes(item.status) && (
                <button
                  className="dc-ghost"
                  disabled={busy}
                  onClick={() => {
                    setCancel(item.id)
                    setReason("")
                  }}
                >
                  {ru ? "Отменить операцию…" : "Cancel operation…"}
                </button>
              )}
              {cancel === item.id && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void mutate(`/${item.id}/cancel`, { reason })
                  }}
                >
                  <label>
                    {ru ? "Причина отмены" : "Cancellation reason"}
                    <textarea
                      required
                      minLength={3}
                      maxLength={300}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <div className="community-actions">
                    <button className="dc-primary" disabled={busy}>
                      {ru ? "Подтвердить отмену" : "Confirm cancellation"}
                    </button>
                    <button
                      type="button"
                      className="dc-ghost"
                      disabled={busy}
                      onClick={() => setCancel("")}
                    >
                      {ru ? "Назад" : "Back"}
                    </button>
                  </div>
                </form>
              )}
            </article>
          ))}
          <p className="community-footnote">
            {ru
              ? "Прогресс пересчитывается автоматически после проверки результатов."
              : "Progress updates automatically after results are verified."}
          </p>
          <button className="dc-ghost" disabled={busy} onClick={resource.reload}>
            {ru ? "Обновить прогресс" : "Refresh progress"}
          </button>
        </>
      )}
    </section>
  )
}
