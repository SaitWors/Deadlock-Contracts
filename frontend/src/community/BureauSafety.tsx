import { useRef, useState } from "react"
import { useLanguage } from "../i18n"
import { request, useResource } from "./api"
import { LoadState } from "./Shared"

export type Report = {
  id: string
  bureau_name: string
  bureau_slug: string | null
  kind: string
  message: string
  status: string
  revision: number
  decision: string
  decision_note: string
  created_at: string
  snapshot?: Record<string, string>
  bureau_status?: string
  current_artwork?: Record<string, string>
}
export default function BureauSafety({
  slug,
  csrf = "",
  banned = false,
  appeal = false,
}: {
  slug?: string
  csrf?: string
  banned?: boolean
  appeal?: boolean
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const resource = useResource<{ items: Report[] }>("/api/bureau-reports")
  const [kind, setKind] = useState("CONTENT")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const guard = useRef(false)
  async function submit() {
    if (guard.current) return
    guard.current = true
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await request(`/api/bureaus/${encodeURIComponent(slug!)}/reports`, csrf, {
        method: "POST",
        body: JSON.stringify({ kind, message }),
      })
      setMessage("")
      setNotice(
        ru
          ? "Обращение принято. Ответ появится здесь."
          : "Request received. The response will appear here.",
      )
      resource.reload()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      guard.current = false
      setBusy(false)
    }
  }
  const items = resource.data?.items.filter((item) => !slug || item.bureau_slug === slug) || []
  const status: Record<string, string> = ru
    ? { OPEN: "На рассмотрении", RESOLVED: "Решение принято", DISMISSED: "Отклонено" }
    : { OPEN: "Under review", RESOLVED: "Resolved", DISMISSED: "Dismissed" }
  return (
    <details className="community-panel bureau-safety">
      <summary>
        {slug
          ? ru
            ? "Жалоба или апелляция"
            : "Report or appeal"
          : ru
            ? "Мои обращения"
            : "My reports"}
      </summary>
      <p className="community-footnote">
        {ru
          ? "Текст обращения видите только вы и сотрудники сайта. Руководство бюро не получает личность автора жалобы. Не отправляйте пароли или коды входа."
          : "Only you and site staff can read your report. Bureau management cannot see who reported them. Do not include passwords or login codes."}
      </p>
      {error && (
        <p role="alert" className="community-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="community-notice">
          {notice}
        </p>
      )}
      {slug && (
        <form
          className="bureau-editor"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <fieldset disabled={busy}>
            <label>
              {ru ? "Тип обращения" : "Request type"}
              <select value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="CONTENT">{ru ? "Пожаловаться на бюро" : "Report bureau"}</option>
                {banned && (
                  <option value="BAN_APPEAL">
                    {ru ? "Обжаловать блокировку вступления" : "Appeal membership ban"}
                  </option>
                )}
                {appeal && (
                  <option value="BUREAU_APPEAL">
                    {ru ? "Запросить восстановление бюро" : "Request bureau restoration"}
                  </option>
                )}
              </select>
            </label>
            <label>
              {ru ? "Что произошло?" : "What happened?"}
              <textarea
                required
                minLength={10}
                maxLength={1000}
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <button className="dc-primary" disabled={busy}>
              {ru ? "Отправить сотрудникам сайта" : "Send to site staff"}
            </button>
          </fieldset>
        </form>
      )}
      {resource.loading || resource.error ? (
        <LoadState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          {!items.length && <p>{ru ? "Обращений пока нет." : "No reports yet."}</p>}
          {items.map((item) => (
            <article className="operation-card" key={item.id}>
              <h3>{item.bureau_name}</h3>
              <p className="community-eyebrow">{status[item.status]}</p>
              <p className="community-prose">{item.message}</p>
              {item.decision_note && (
                <blockquote className="community-prose">{item.decision_note}</blockquote>
              )}
            </article>
          ))}
          <button className="dc-ghost" onClick={resource.reload}>
            {ru ? "Проверить ответы" : "Check for responses"}
          </button>
        </>
      )}
    </details>
  )
}
