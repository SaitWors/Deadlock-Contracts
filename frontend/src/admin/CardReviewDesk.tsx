import { useState } from "react"
import { request, useResource } from "../community/api"
import { useLanguage } from "../i18n"
import CardPreview from "../archive/CardPreview"
import { CardStatus } from "../archive/CardStudio"
import { Pager } from "../archive/ArchivePage"
import { STATUS, type Card } from "../archive/types"
import "../archive/archive.css"

export default function CardReviewDesk({ csrf }: { csrf: string }) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [status, setStatus] = useState("PENDING")
  const [offset, setOffset] = useState(0)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const data = useResource<{ items: Card[]; total: number }>(
    `/api/admin/archive/cards?status=${status}&offset=${offset}`,
  )
  const decide = async (card: Card, action: string) => {
    if (!notes[card.id]?.trim() || notes[card.id].trim().length < 3) {
      setError(
        ru ? "Добавьте пояснение: минимум 3 символа." : "Add a note of at least 3 characters.",
      )
      return
    }
    setBusy(true)
    setError("")
    try {
      await request(`/api/admin/archive/cards/${card.id}/decision`, csrf, {
        method: "POST",
        body: JSON.stringify({ revision: card.revision, action, note: notes[card.id] }),
      })
      setNotes((old) => {
        const next = { ...old }
        delete next[card.id]
        return next
      })
      data.reload()
    } catch (reason) {
      setError((reason as Error).message)
      data.reload()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="archive-page dc-admin-card-review">
      <header className="dc-admin-section-head">
        <div>
          <h2>{ru ? "Проверка карточек" : "Card review"}</h2>
          <p>
            {ru
              ? "Проверь героя, ранг, композицию и авторство. После публикации дизайн фиксируется. Пояснение увидит автор."
              : "Check hero, rank, composition and artwork credit. Published designs are locked. The author sees your note."}
          </p>
        </div>
      </header>
      <div className="dc-admin-filterbar">
        <label>
          {ru ? "Состояние" : "Status"}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setOffset(0)
              setError("")
            }}
          >
            {(["PENDING", "PUBLISHED", "REJECTED", "ARCHIVED"] as const).map((s) => (
              <option key={s} value={s}>
                {STATUS[s][ru ? 0 : 1]}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy} onClick={data.reload}>
          {ru ? "Обновить очередь" : "Refresh queue"}
        </button>
        {data.data && (
          <small>
            {data.data.total} {ru ? "карточек" : "cards"}
          </small>
        )}
      </div>
      {(error || data.error) && <p role="alert">{error || data.error}</p>}
      {data.loading && <p role="status">{ru ? "Загрузка…" : "Loading…"}</p>}
      {data.data && !data.data.items.length && (
        <p className="dc-admin-empty">
          {ru ? "В этой очереди пока нет карточек." : "No cards in this queue."}
        </p>
      )}
      <div className="archive-review-grid">
        {data.data?.items.map((card) => (
          <article key={`${card.id}:${card.revision}`}>
            <CardPreview card={card} />
            <div>
              <CardStatus card={card} />
              <h3>{card.title}</h3>
              <p>{card.description}</p>
              <p>
                {ru ? "Автор изображения: " : "Artwork by: "}
                {card.artist}
              </p>
              {card.source_url && (
                <a href={card.source_url} target="_blank" rel="noopener noreferrer">
                  {ru ? "Открыть источник" : "Open source"}
                </a>
              )}
              {card.review_note && <p>{card.review_note}</p>}
              {["PENDING", "PUBLISHED"].includes(card.status) && (
                <>
                  <label>
                    {ru ? "Пояснение автору" : "Note to author"}
                    <textarea
                      maxLength={600}
                      value={notes[card.id] || ""}
                      onChange={(e) => setNotes((old) => ({ ...old, [card.id]: e.target.value }))}
                    />
                  </label>
                  <div className="archive-actions">
                    {card.status === "PENDING" ? (
                      <>
                        <button
                          className="archive-primary"
                          disabled={busy}
                          onClick={() => void decide(card, "PUBLISH")}
                        >
                          {ru ? "Опубликовать" : "Publish"}
                        </button>
                        <button disabled={busy} onClick={() => void decide(card, "REJECT")}>
                          {ru ? "Вернуть на доработку" : "Request changes"}
                        </button>
                      </>
                    ) : (
                      <button disabled={busy} onClick={() => void decide(card, "ARCHIVE")}>
                        {ru ? "Снять с публикации" : "Unpublish"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {data.data && (
        <Pager offset={offset} size={18} total={data.data.total} setOffset={setOffset} />
      )}
    </section>
  )
}
