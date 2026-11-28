import { useRef, useState } from "react"
import { request, useResource } from "../community/api"
import { useLanguage } from "../i18n"
import CardPreview from "./CardPreview"
import CardStudio, { CardStatus } from "./CardStudio"
import CollectionPage from "./CollectionPage"
import CatalogPage from "./CatalogPage"
import DailyPack from "./DailyPack"
import GiftPacks from "./GiftPacks"
import { useFavorites } from "./favorites"
import type { Card, Meta } from "./types"
import "./archive.css"
import "./packs.css"

export default function ArchivePage({
  csrf,
  mode = "collection",
  accountKey = "",
  onCollectionChange,
  onWalletChange,
  onNavigate,
}: {
  csrf: string
  mode?: "archive" | "studio" | "wallet" | "packs" | "collection" | "all-collection"
  accountKey?: string
  onCollectionChange?: () => void
  onWalletChange?: () => void
  onNavigate?: (view: "collection" | "packs" | "all-collection") => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [view, setView] = useState(
    mode === "packs" || mode === "studio" || mode === "all-collection" ? mode : "collection",
  )
  const navigate = (next: "collection" | "packs" | "all-collection") => {
    if (onNavigate) onNavigate(next)
    setView(next)
  }
  const [revision, setRevision] = useState(0)
  const meta = useResource<Meta>("/api/archive/meta")
  const account = accountKey || meta.data?.account_key || ""
  const favorites = useFavorites(csrf, account, "REAL")
  const changed = () => {
    setRevision((value) => value + 1)
    onCollectionChange?.()
    // Retain the prop for old embedders without fetching or displaying a wallet.
    onWalletChange?.()
  }
  return (
    <section className="archive-page ritual-collection" data-view={view}>
      <header className="archive-heading">
        <div>
          <small>DEADLOCK CONTRACTS / {ru ? "КОЛЛЕКЦИЯ" : "COLLECTION"}</small>
          <h1>
            {view === "packs"
              ? ru
                ? "Ежедневный конверт"
                : "Daily pack"
              : view === "studio"
                ? ru
                  ? "Мастерская карточек"
                  : "Card studio"
                : view === "all-collection"
                  ? ru
                    ? "Вся коллекция"
                    : "All collection"
                  : ru
                    ? "Твоя коллекция"
                    : "Your collection"}
          </h1>
          <p>
            {view === "studio"
              ? ru
                ? "Создавай карточки героев и отправляй их на проверку."
                : "Design hero cards and submit them for review."
              : view === "all-collection"
                ? ru
                  ? "Все опубликованные карточки, включая ещё не полученные."
                  : "All published cards, including those you have not collected yet."
                : ru
                  ? "Собирай карточки героев и выбирай любимые."
                  : "Collect hero cards and keep your favorites."}
          </p>
        </div>
      </header>
      <nav className="archive-tabs" aria-label={ru ? "Коллекция" : "Collection"}>
        <button
          aria-current={view === "collection" ? "page" : undefined}
          onClick={() => navigate("collection")}
        >
          {ru ? "Моя коллекция" : "My collection"}
        </button>
        <button
          aria-current={view === "packs" ? "page" : undefined}
          onClick={() => navigate("packs")}
        >
          {ru ? "Ежедневный конверт" : "Daily pack"}
        </button>
        <button
          aria-current={view === "all-collection" ? "page" : undefined}
          onClick={() => navigate("all-collection")}
        >
          {ru ? "Вся коллекция" : "All collection"}
        </button>
        <button
          aria-current={view === "studio" ? "page" : undefined}
          onClick={() => setView("studio")}
        >
          {ru ? "Мастерская карточек" : "Card studio"}
        </button>
      </nav>
      {view === "packs" && (
        <>
          <DailyPack
            key={account}
            accountKey={account}
            csrf={csrf}
            favorites={favorites}
            onClaimed={changed}
          />
          {account && (
            <GiftPacks
              key={`gifts:${account}`}
              accountKey={account}
              csrf={csrf}
              favorites={favorites}
              onOpened={changed}
            />
          )}
        </>
      )}
      {view !== "packs" && !meta.data && (
        <p role={meta.error ? "alert" : "status"}>
          {meta.error || (ru ? "Загрузка коллекции…" : "Loading collection…")}
          {meta.error && <button onClick={meta.reload}>{ru ? "Повторить" : "Retry"}</button>}
        </p>
      )}
      {view === "studio" && meta.data && (
        <PlayerCardStudio key={account} csrf={csrf} meta={meta.data} />
      )}
      {view === "all-collection" && meta.data && <CatalogPage key={account} meta={meta.data} />}
      {view === "collection" && meta.data && (
        <CollectionPage
          key={account}
          csrf={csrf}
          meta={meta.data}
          scope="REAL"
          favorites={favorites}
          revision={revision}
        />
      )}
    </section>
  )
}

function PlayerCardStudio({ csrf, meta }: { csrf: string; meta: Meta }) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [hero, setHero] = useState("")
  const [rank, setRank] = useState("")
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState<Card | "new" | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const params = new URLSearchParams({ mine: "true", offset: String(offset) })
  if (hero) params.set("hero", hero)
  if (rank) params.set("rank", rank)
  if (search) params.set("q", search)
  const cards = useResource<{ items: Card[]; total: number }>(`/api/archive/cards?${params}`)
  const openEditor = (card: Card | "new") => {
    setError("")
    setNotice("")
    setEditing(card)
  }
  const authorAction = async (card: Card, action: "submit" | "withdraw" | "remove") => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await request(`/api/archive/cards/${card.id}/${action}`, csrf, {
        method: "POST",
        body: JSON.stringify({ revision: card.revision }),
      })
      if (action === "remove" && cards.data?.items.length === 1 && offset > 0)
        setOffset(Math.max(0, offset - 18))
      cards.reload()
      setNotice(ru ? "Состояние карточки обновлено." : "Card status updated.")
    } catch (reason) {
      setError((reason as Error).message)
      cards.reload()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const changeBannerPermission = async (card: Card) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await request(`/api/archive/cards/${card.id}/banner-permission`, csrf, {
        method: "PUT",
        body: JSON.stringify({ revision: card.revision, enabled: !card.banner_artwork }),
      })
      setNotice(ru ? "Настройка иллюстрации обновлена." : "Artwork preference updated.")
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      cards.reload()
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <>
      {(error || cards.error) && (
        <p role="alert">
          {error || cards.error}{" "}
          <button
            disabled={busy}
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
          csrf={csrf}
          meta={meta}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setHero("")
            setRank("")
            setQuery("")
            setSearch("")
            setOffset(0)
            cards.reload()
            setNotice(
              ru
                ? "Черновик сохранён. Проверь его и отправь на модерацию."
                : "Draft saved. Check it and submit for review.",
            )
          }}
        />
      ) : (
        <>
          <div className="archive-section-heading">
            <div>
              <h2>{ru ? "Мои работы" : "My designs"}</h2>
              <p>
                {ru
                  ? "Создание доступно каждому. Публикация — после проверки администратором."
                  : "Anyone can design. An administrator reviews each publication."}
              </p>
            </div>
            <button
              className="archive-primary"
              disabled={busy || !meta.heroes.length}
              onClick={() => openEditor("new")}
            >
              {ru ? "+ Создать карточку" : "+ Create card"}
            </button>
          </div>
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
                disabled={busy}
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
                disabled={busy}
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
              <input
                value={query}
                disabled={busy}
                maxLength={80}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {ru ? "Найти" : "Search"}
            </button>
          </form>
          {cards.loading ? (
            <p role="status">{ru ? "Загружаем карточки…" : "Loading cards…"}</p>
          ) : cards.data?.items.length ? (
            <div className="archive-grid">
              {cards.data.items.map((card) => (
                <article key={card.id}>
                  <CardPreview card={card} />
                  <CardStatus card={card} />
                  <h3 className="archive-item-title">{card.title}</h3>
                  <p>{card.description}</p>
                  <small>{card.artist}</small>
                  {/^https?:\/\//i.test(card.source_url) && (
                    <a href={card.source_url} target="_blank" rel="noopener noreferrer">
                      {ru ? "Источник изображения" : "Artwork source"}
                    </a>
                  )}
                  {card.review_note && <p className="archive-review-note">{card.review_note}</p>}
                  <div className="archive-actions">
                    {["DRAFT", "REJECTED"].includes(card.status) && (
                      <>
                        <button disabled={busy} onClick={() => openEditor(card)}>
                          {ru ? "Редактировать" : "Edit"}
                        </button>
                        <button disabled={busy} onClick={() => void authorAction(card, "submit")}>
                          {ru ? "На проверку" : "Submit"}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(ru ? "Удалить этот черновик?" : "Remove this draft?")
                            )
                              void authorAction(card, "remove")
                          }}
                        >
                          {ru ? "Удалить" : "Remove"}
                        </button>
                      </>
                    )}
                    {card.status === "PENDING" && (
                      <button disabled={busy} onClick={() => void authorAction(card, "withdraw")}>
                        {ru ? "Отозвать заявку" : "Withdraw"}
                      </button>
                    )}
                    {card.status === "PUBLISHED" && card.rank !== "EX" && card.rights_confirmed && (
                      <label className="archive-check">
                        <input
                          type="checkbox"
                          checked={card.banner_artwork ?? false}
                          disabled={busy}
                          onChange={() => void changeBannerPermission(card)}
                        />
                        {ru
                          ? "Разрешаю показывать иллюстрацию на главной с указанием автора. На ней нет текста и рамки."
                          : "Allow this artwork on the overview with its credit. It has no lettering or frame."}
                      </label>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : cards.data ? (
            <div className="archive-empty">
              <h3>{ru ? "Нет карточек" : "No designs"}</h3>
              <p>
                {hero || rank || search
                  ? ru
                    ? "Попробуй изменить фильтры."
                    : "Try changing the filters."
                  : ru
                    ? "Создай первый дизайн: изображение, герой и рамка нужного ранга."
                    : "Create your first design: artwork, hero and a rank frame."}
              </p>
            </div>
          ) : null}
          {cards.data && (
            <Pager
              offset={offset}
              total={cards.data.total}
              size={18}
              setOffset={(next) => {
                if (!busy) setOffset(next)
              }}
            />
          )}
        </>
      )}
    </>
  )
}

export function Pager({
  offset,
  total,
  size,
  setOffset,
}: {
  offset: number
  total: number
  size: number
  setOffset: (value: number) => void
}) {
  const { language } = useLanguage()
  if (total <= size) return null
  return (
    <nav className="archive-pager" aria-label={language === "ru" ? "Страницы" : "Pages"}>
      <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - size))}>
        {language === "ru" ? "Назад" : "Previous"}
      </button>
      <span>
        {Math.floor(offset / size) + 1} / {Math.ceil(total / size)}
      </span>
      <button disabled={offset + size >= total} onClick={() => setOffset(offset + size)}>
        {language === "ru" ? "Далее" : "Next"}
      </button>
    </nav>
  )
}
