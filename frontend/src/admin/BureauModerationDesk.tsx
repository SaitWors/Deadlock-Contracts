import { useRef, useState } from "react"
import { request, useResource } from "../community/api"
import { LoadState } from "../community/Shared"
import type { Report } from "../community/BureauSafety"

export default function BureauModerationDesk({ csrf }: { csrf: string }) {
  const [status, setStatus] = useState("OPEN")
  const [offset, setOffset] = useState(0)
  const resource = useResource<{ items: Report[]; total: number }>(
    `/api/admin/bureau-reports?status=${status}&offset=${offset}`,
  )
  const [selected, setSelected] = useState("")
  const [action, setAction] = useState("DISMISS")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const guard = useRef(false)
  async function decide(item: Report) {
    if (guard.current) return
    guard.current = true
    setBusy(true)
    setError("")
    try {
      await request(`/api/admin/bureau-reports/${item.id}/decision`, csrf, {
        method: "POST",
        body: JSON.stringify({ revision: item.revision, action, note }),
      })
      setSelected("")
      setNote("")
      resource.reload()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      guard.current = false
      setBusy(false)
    }
  }
  const kinds: Record<string, string> = {
    CONTENT: "Жалоба на бюро",
    BAN_APPEAL: "Апелляция блокировки",
    BUREAU_APPEAL: "Восстановление бюро",
  }
  return (
    <section className="community-page">
      <h2>Обращения по бюро</h2>
      <p>
        Решение и пояснение получит автор обращения. Приостановка скрывает бюро из каталога и
        отменяет незавершённые операции.
      </p>
      <div className="community-actions">
        <label>
          Статус
          <select
            value={status}
            disabled={busy}
            onChange={(event) => {
              setStatus(event.target.value)
              setOffset(0)
              setSelected("")
            }}
          >
            <option value="OPEN">Открытые</option>
            <option value="RESOLVED">Решённые</option>
            <option value="DISMISSED">Отклонённые</option>
          </select>
        </label>
        <button
          className="dc-ghost"
          disabled={busy}
          onClick={() => {
            setSelected("")
            resource.reload()
          }}
        >
          Обновить очередь
        </button>
      </div>
      {error && (
        <p role="alert" className="community-error">
          {error}
        </p>
      )}
      {resource.loading || resource.error || !resource.data ? (
        <LoadState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          {!resource.data.items.length && <p className="community-empty">Обращений нет.</p>}
          {resource.data.items.map((item) => (
            <article className="community-panel" key={item.id}>
              <p className="community-eyebrow">
                {kinds[item.kind]} · {item.bureau_status}
              </p>
              <h3>{item.bureau_name}</h3>
              <p className="community-prose">{item.message}</p>
              <details>
                <summary>Снимок на момент обращения</summary>
                {Object.entries(item.snapshot || {}).map(([key, value]) => (
                  <p className="community-prose" key={key}>
                    <b>
                      {{
                        name: "Название",
                        description: "Описание",
                        rules: "Правила",
                        ban_reason: "Причина блокировки",
                        moderation_note: "Пояснение сотрудника",
                      }[key] || key}
                      :{" "}
                    </b>
                    {value || "—"}
                  </p>
                ))}
              </details>
              {item.decision_note && <blockquote>{item.decision_note}</blockquote>}
              {item.status === "OPEN" &&
                (selected !== item.id ? (
                  <button
                    className="dc-ghost"
                    disabled={busy}
                    onClick={() => {
                      setSelected(item.id)
                      setAction("DISMISS")
                      setNote("")
                    }}
                  >
                    Рассмотреть
                  </button>
                ) : (
                  <form
                    className="bureau-editor"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void decide(item)
                    }}
                  >
                    <fieldset disabled={busy}>
                      <label>
                        Решение
                        <select value={action} onChange={(event) => setAction(event.target.value)}>
                          <option value="DISMISS">Отклонить обращение</option>
                          {item.bureau_status !== "DELETED" && (
                            <>
                              <option value="WARN">Предупредить бюро</option>
                              <option value="FREEZE">Приостановить бюро</option>
                              {item.kind === "BAN_APPEAL" && (
                                <option value="LIFT_BAN">Снять блокировку вступления</option>
                              )}
                              {item.kind === "BUREAU_APPEAL" && item.bureau_status === "FROZEN" && (
                                <option value="RESTORE">Восстановить бюро</option>
                              )}
                            </>
                          )}
                        </select>
                      </label>
                      <label>
                        Пояснение для автора обращения
                        <textarea
                          required
                          minLength={10}
                          maxLength={1000}
                          rows={4}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                        />
                      </label>
                      <p className="community-footnote">
                        Предупреждение или причина приостановки также видны в бюро. Не цитируйте
                        личные сведения заявителя. Собственное бюро проверяет другой сотрудник.
                      </p>
                      <div className="community-actions">
                        <button className="dc-primary" disabled={busy}>
                          Подтвердить решение
                        </button>
                        <button type="button" className="dc-ghost" onClick={() => setSelected("")}>
                          Отмена
                        </button>
                      </div>
                    </fieldset>
                  </form>
                ))}
            </article>
          ))}
          <div className="community-pagination">
            <button
              className="dc-ghost"
              disabled={!offset || busy}
              onClick={() => {
                setOffset(offset - 20)
                setSelected("")
              }}
            >
              Назад
            </button>
            <span>
              {resource.data.total
                ? `${offset + 1}–${Math.min(offset + 20, resource.data.total)} / ${resource.data.total}`
                : "0"}
            </span>
            <button
              className="dc-ghost"
              disabled={offset + 20 >= resource.data.total || busy}
              onClick={() => {
                setOffset(offset + 20)
                setSelected("")
              }}
            >
              Дальше
            </button>
          </div>
        </>
      )}
    </section>
  )
}
