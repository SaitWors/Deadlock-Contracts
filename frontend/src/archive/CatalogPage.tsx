import { useState } from "react"
import { useResource } from "../community/api"
import { useLanguage } from "../i18n"
import { Pager } from "./ArchivePage"
import CardSurface from "./CardSurface"
import type { Card, Meta } from "./types"

type Catalog = { items: { card: Card; quantity: number }[]; total: number }

export default function CatalogPage({ meta }: { meta: Meta }) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [hero, setHero] = useState("")
  const [rank, setRank] = useState("")
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const params = new URLSearchParams({ offset: String(offset), hero, q: search })
  if (rank) params.set("rank", rank)
  const catalog = useResource<Catalog>(`/api/archive/catalog?${params}`)
  const foundLabel = ru ? "Найдено карточек" : "Cards found"

  return (
    <section className="archive-collection archive-catalog">
      <form
        className="archive-filters"
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(query)
          setOffset(0)
        }}
      >
        <label>
          {ru ? "Герой" : "Hero"}
          <select
            value={hero}
            onChange={(event) => {
              setHero(event.target.value)
              setOffset(0)
            }}
          >
            <option value="">{ru ? "Все герои" : "All heroes"}</option>
            {[...meta.heroes, ...(meta.bases || [])].map((item) => (
              <option key={item.key} value={item.key}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {ru ? "Ранг" : "Rank"}
          <select
            value={rank}
            onChange={(event) => {
              setRank(event.target.value)
              setOffset(0)
            }}
          >
            <option value="">{ru ? "Все ранги" : "All ranks"}</option>
            {meta.ranks.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          {ru ? "Название или автор" : "Title or artist"}
          <input value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="submit">{ru ? "Найти" : "Search"}</button>
      </form>
      {catalog.error && (
        <p role="alert">
          {catalog.error}{" "}
          <button onClick={catalog.reload}>{ru ? "Повторить" : "Retry"}</button>
        </p>
      )}
      {catalog.loading && <p role="status">{ru ? "Загружаем…" : "Loading…"}</p>}
      {!catalog.loading && catalog.data && (
        <>
          <p>{`${foundLabel}: ${catalog.data.total}`}</p>
          {catalog.data.total === 0 && (
            <div className="archive-empty">
              <h3>{ru ? "Нет подходящих карточек" : "No matching cards"}</h3>
              <p>{ru ? "Попробуй изменить фильтры." : "Try changing the filters."}</p>
            </div>
          )}
          <div className="archive-grid">
            {catalog.data.items.map(({ card, quantity }) => {
              const owned = quantity > 0
              const ownedLabel = ru ? "В коллекции" : "Owned"
              const missingLabel = ru ? "Не получена" : "Not owned"
              const label = owned ? `${ownedLabel} · ${quantity}` : missingLabel
              const status = owned ? "PUBLISHED" : undefined
              return (
                <article key={card.id} className="archive-catalog-item" data-owned={owned}>
                  <CardSurface card={card} />
                  <h3 className="archive-item-title">{card.title}</h3>
                  <span className="archive-status" data-status={status}>{label}</span>
                </article>
              )
            })
          </div>
          <Pager offset={offset} total={catalog.data.total} size={18} setOffset={setOffset} />
        </>
      )}
    </section>
  )
}
