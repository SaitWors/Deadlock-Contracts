import { useState } from "react"
import { request, useResource } from "../community/api"
import { useLanguage } from "../i18n"
import CardStudio, { CardStatus } from "../archive/CardStudio"
import CardPreview from "../archive/CardPreview"
import { Pager } from "../archive/ArchivePage"
import type { Card, Meta } from "../archive/types"

export default function AdminCardStudio({
  csrf,
  onChanged,
}: {
  csrf: string
  onChanged: () => void
}) {
  const { language } = useLanguage()
  const meta = useResource<Meta>("/api/archive/meta")
  if (!meta.data)
    return (
      <section>
        <p role={meta.error ? "alert" : "status"}>
          {meta.error || (language === "ru" ? "Загрузка мастерской…" : "Loading studio…")}
        </p>
        {meta.error && (
          <button onClick={meta.reload}>{language === "ru" ? "Повторить" : "Retry"}</button>
        )}
      </section>
    )
  if (!meta.data.can_publish)
    return (
      <p role="alert">
        {language === "ru"
          ? "Мастерская доступна администратору и владельцу."
          : "The studio is available to administrators and the owner."}
      </p>
    )
  return <Drafts key={meta.data.account_key} meta={meta.data} csrf={csrf} onChanged={onChanged} />
}

function Drafts({ meta, csrf, onChanged }: { meta: Meta; csrf: string; onChanged: () => void }) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState<Card | "new" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const cards = useResource<{ items: Card[]; total: number }>(
    `/api/archive/cards?mine=true&offset=${offset}`,
  )
  const action = async (card: Card, next: "submit" | "withdraw" | "remove") => {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await request(`/api/archive/cards/${card.id}/${next}`, csrf, {
        method: "POST",
        body: JSON.stringify({ revision: card.revision }),
      })
      cards.reload()
      onChanged()
      setNotice(ru ? "Состояние карточки обновлено." : "Card status updated.")
    } catch (reason) {
      setError((reason as Error).message)
      cards.reload()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="admin-card-studio" aria-labelledby="admin-card-studio-title">
      <div className="archive-section-heading">
        <div>
          <h3 id="admin-card-studio-title">{ru ? "Мои дизайны" : "My designs"}</h3>
          <p>
            {ru
              ? "Создай черновик и отправь готовый дизайн в очередь проверки."
              : "Create a draft and submit the finished design to the review queue."}
          </p>
        </div>
        {!editing && (
          <button
            className="archive-primary"
            disabled={!meta.heroes.length}
            onClick={() => {
              setEditing("new")
              setError("")
              setNotice("")
            }}
          >
            {ru ? "Создать карточку" : "Create card"}
          </button>
        )}
      </div>
      {(error || cards.error) && (
        <p role="alert">
          {error || cards.error}
          <button
            onClick={() => {
              setError("")
              cards.reload()
            }}
          >
            {ru ? "Обновить" : "Refresh"}
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {editing ? (
        <CardStudio
          key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`}
          card={editing === "new" ? undefined : editing}
          meta={meta}
          csrf={csrf}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            cards.reload()
            onChanged()
            setNotice(
              ru
                ? "Черновик сохранён. Отправь готовый дизайн на проверку."
                : "Draft saved. Submit the finished design for review.",
            )
          }}
        />
      ) : (
        <>
          {cards.loading && <p role="status">{ru ? "Загрузка дизайнов…" : "Loading designs…"}</p>}
          {cards.data?.total === 0 && (
            <p>
              {ru
                ? "Черновиков пока нет. Создай первый дизайн."
                : "No drafts yet. Create your first design."}
            </p>
          )}
          <div className="archive-grid">
            {cards.data?.items.map((card) => (
              <article key={`${card.id}:${card.revision}`}>
                <CardPreview card={card} />
                <CardStatus card={card} />
                <h3 className="archive-item-title">{card.title}</h3>
                <p>{card.description}</p>
                {card.review_note && <p>{card.review_note}</p>}
                <div className="archive-actions">
                  {["DRAFT", "REJECTED"].includes(card.status) && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditing(card)
                          setNotice("")
                        }}
                      >
                        {ru ? "Редактировать" : "Edit"}
                      </button>
                      <button disabled={busy} onClick={() => void action(card, "submit")}>
                        {ru ? "На проверку" : "Submit"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(ru ? "Удалить этот черновик?" : "Remove this draft?"))
                            void action(card, "remove")
                        }}
                      >
                        {ru ? "Удалить" : "Remove"}
                      </button>
                    </>
                  )}
                  {card.status === "PENDING" && (
                    <button disabled={busy} onClick={() => void action(card, "withdraw")}>
                      {ru ? "Отозвать заявку" : "Withdraw"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {cards.data && (
            <Pager offset={offset} size={18} total={cards.data.total} setOffset={setOffset} />
          )}
        </>
      )}
    </section>
  )
}
