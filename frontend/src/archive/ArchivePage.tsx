import Icon from "../icons/Icon"
import { useState } from "react"
import { request, useResource } from "../community/api"
import { useLanguage } from "../i18n"
import CardPreview from "./CardPreview"
import CardStudio, { CardStatus } from "./CardStudio"
import Cipher from "./Cipher"
import PackShop from "./PackShop"
import CollectionPage from "./CollectionPage"
import { TransactionStatus, useTransaction } from "./transactions"
import { RANKS, type Card, type Meta, type Wallet } from "./types"
import "./archive.css"
import "./packs.css"

export default function ArchivePage({
  csrf,
  mode = "archive",
  onWalletChange,
}: {
  csrf: string
  mode?: "archive" | "studio" | "wallet" | "packs" | "collection"
  onWalletChange: () => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const [view, setView] = useState(
    mode === "studio" ? "mine" : mode === "archive" ? "cipher" : mode,
  )
  const [hero, setHero] = useState("")
  const [rank, setRank] = useState("")
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [historyOffset, setHistoryOffset] = useState(0)
  const [editing, setEditing] = useState<Card | "new" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [collectionRevision, setCollectionRevision] = useState(0)
  const meta = useResource<Meta>("/api/archive/meta")
  const wallet = useResource<Wallet>(`/api/archive/wallet?offset=${historyOffset}`)
  const cards = useResource<{ items: Card[]; total: number }>(
    `/api/archive/cards?mine=${view === "mine"}&hero=${encodeURIComponent(hero)}&rank=${encodeURIComponent(rank)}&q=${encodeURIComponent(search)}&offset=${offset}`.replace(
      "&rank=&",
      "&",
    ),
  )
  const coverage = useResource<{ items: { hero: string; rank: string; count: number }[] }>(
    "/api/archive/coverage",
  )
  const transaction = useTransaction(csrf, meta.data?.account_key || "", () => {
    wallet.reload()
    onWalletChange()
    setCollectionRevision((value) => value + 1)
  })
  const chooseView = (next: string) => {
    setView(next)
    setOffset(0)
    setEditing(null)
    setError("")
    setNotice("")
  }
  const authorAction = async (card: Card, action: string) => {
    setBusy(true)
    setError("")
    try {
      await request(`/api/archive/cards/${card.id}/${action}`, csrf, {
        method: "POST",
        body: JSON.stringify({ revision: card.revision }),
      })
      cards.reload()
      setNotice(ru ? "Состояние карточки обновлено." : "Card status updated.")
    } catch (reason) {
      setError((reason as Error).message)
      cards.reload()
    } finally {
      setBusy(false)
    }
  }
  if (!meta.data)
    return (
      <section className="archive-page">
        <p role={meta.error ? "alert" : "status"}>
          {meta.error || (ru ? "Открываем архив…" : "Opening archive…")}
        </p>
        {meta.error && <button onClick={meta.reload}>{ru ? "Повторить" : "Retry"}</button>}
      </section>
    )
  return (
    <section className="archive-page">
      <header className="archive-heading">
        <div>
          <small>DEADLOCK CONTRACTS / ARCHIVE BUREAU</small>
          <h1>{ru ? "Архив бюро" : "Bureau archive"}</h1>
          <p>
            {ru
              ? "Расшифровывай документы. Открывай конверты. Собирай свою коллекцию."
              : "Decode documents. Open envelopes. Build your collection."}
          </p>
        </div>
        <div className="archive-balance">
          <small>{ru ? "Жетоны архива" : "Archive tokens"}</small>
          <strong>
            <Icon name="coins" size={18} />{" "}
            {wallet.data ? wallet.data.balance.toLocaleString(locale) : "—"}
          </strong>
        </div>
      </header>
      <nav className="archive-tabs" aria-label={ru ? "Разделы архива" : "Archive sections"}>
        {[
          ["cipher", ru ? "Шифр бюро" : "Cipher"],
          ["packs", ru ? "Конверты" : "Envelopes"],
          ["collection", ru ? "Моя коллекция" : "My collection"],
          ["catalog", ru ? "Каталог" : "Catalogue"],
          ["mine", ru ? "Мои карточки" : "My designs"],
          ["wallet", ru ? "История жетонов" : "Token history"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-current={view === key ? "page" : undefined}
            onClick={() => chooseView(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {(error || cards.error || wallet.error) && (
        <p role="alert">
          {error || cards.error || wallet.error}{" "}
          <button
            onClick={() => {
              setError("")
              cards.reload()
              wallet.reload()
            }}
          >
            {ru ? "Обновить" : "Refresh"}
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <TransactionStatus transaction={transaction} />
      {view === "packs" && (
        <PackShop
          revision={collectionRevision}
          balance={wallet.data?.balance || 0}
          transaction={transaction}
        />
      )}
      {view === "collection" && (
        <CollectionPage
          csrf={csrf}
          meta={meta.data}
          revision={collectionRevision}
          transaction={transaction}
        />
      )}
      {view === "cipher" && wallet.data && (
        <Cipher
          wallet={wallet.data}
          csrf={csrf}
          onEarned={() => {
            wallet.reload()
            onWalletChange()
          }}
        />
      )}
      {(view === "cipher" || view === "wallet") && !wallet.data && !wallet.error && (
        <p role="status">{ru ? "Загружаем счёт…" : "Loading wallet…"}</p>
      )}
      {view === "wallet" && wallet.data && (
        <div className="archive-panel">
          <h2>{ru ? "История жетонов" : "Token history"}</h2>
          <p>
            {ru
              ? "Жетоны тратятся на конверты или конкретные карточки в каталоге. История показывает заработок, покупки, обмен дублей и выдачу OWNER. XP за матчи учитывается отдельно."
              : "Spend tokens on envelopes or specific catalogue cards. This history includes earnings, purchases, duplicate recycling and OWNER adjustments. Match XP is separate."}
          </p>
          {wallet.data.history.length ? (
            <ul className="archive-ledger">
              {wallet.data.history.map((item) => (
                <li key={item.id}>
                  <span>{new Date(item.created_at).toLocaleString(locale)}</span>
                  <span>
                    {
                      ({
                        CIPHER: ["Шифр бюро", "Bureau cipher"],
                        PACK_OPEN: ["Открытие конверта", "Pack opening"],
                        DIRECT_CARD: ["Получение карточки", "Direct card"],
                        RECYCLE: ["Обмен дубля", "Duplicate recycling"],
                        OWNER_TOKENS: ["Корректировка OWNER", "OWNER adjustment"],
                      }[item.reason] || [item.reason, item.reason])[ru ? 0 : 1]
                    }
                  </span>
                  <b>
                    {item.delta > 0 ? "+" : ""}
                    {item.delta} <Icon name="coins" size={18} />
                  </b>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {ru
                ? "Пока нет начислений. Начни с шифра бюро."
                : "No entries yet. Start with a cipher."}
            </p>
          )}
          <Pager
            offset={historyOffset}
            total={wallet.data.history_total}
            size={20}
            setOffset={setHistoryOffset}
          />
        </div>
      )}
      {view === "mine" && editing && (
        <CardStudio
          key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`}
          card={editing === "new" ? undefined : editing}
          meta={meta.data}
          csrf={csrf}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            cards.reload()
            setNotice(
              ru
                ? "Черновик сохранён. Проверь его и отправь администратору."
                : "Draft saved. Check it and submit for review.",
            )
          }}
        />
      )}
      {["catalog", "mine"].includes(view) && !editing && (
        <>
          <div className="archive-section-heading">
            <div>
              <h2>
                {view === "mine"
                  ? ru
                    ? "Мастерская оперативника"
                    : "Operative's studio"
                  : ru
                    ? "Каталог карточек"
                    : "Card catalogue"}
              </h2>
              <p>
                {view === "mine"
                  ? ru
                    ? "Создание доступно каждому. Публикация — после проверки администратором."
                    : "Anyone can design. An administrator reviews each publication."
                  : ru
                    ? "Опубликованные дизайны. Наличие в каталоге ещё не означает владение карточкой."
                    : "Published designs. A catalogue entry does not grant ownership."}
              </p>
            </div>
            {view === "mine" && (
              <button
                className="archive-primary"
                onClick={() => {
                  setEditing("new")
                  setError("")
                  setNotice("")
                }}
              >
                {ru ? "+ Создать карточку" : "+ Create card"}
              </button>
            )}
          </div>
          <form
            className="archive-filters"
            onSubmit={(e) => {
              e.preventDefault()
              setSearch(query)
              setOffset(0)
            }}
          >
            <label>
              {ru ? "Герой" : "Hero"}
              <select
                value={hero}
                onChange={(e) => {
                  setHero(e.target.value)
                  setOffset(0)
                }}
              >
                <option value="">{ru ? "Все герои" : "All heroes"}</option>
                {meta.data.heroes.map((h) => (
                  <option key={h.key} value={h.key}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ru ? "Ранг" : "Rank"}
              <select
                value={rank}
                onChange={(e) => {
                  setRank(e.target.value)
                  setOffset(0)
                }}
              >
                <option value="">{ru ? "Все ранги" : "All ranks"}</option>
                {RANKS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              {ru ? "Название или автор" : "Title or artist"}
              <input value={query} maxLength={80} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <button type="submit">{ru ? "Найти" : "Search"}</button>
          </form>
          {hero && view === "catalog" && (
            <div
              className="archive-coverage"
              aria-label={ru ? "Заполнение рангов героя" : "Hero rank coverage"}
            >
              {RANKS.map((r) => {
                const count =
                  coverage.data?.items.find((i) => i.hero === hero && i.rank === r)?.count || 0
                return (
                  <span key={r} data-filled={count > 0}>
                    {r} <b>{count}</b>
                  </span>
                )
              })}
            </div>
          )}
          {cards.loading ? (
            <p role="status">{ru ? "Загружаем карточки…" : "Loading cards…"}</p>
          ) : !cards.data?.items.length ? (
            <div className="archive-empty">
              <Icon name="layers" size={28} />
              <h3>{ru ? "Здесь начинается коллекция" : "The collection starts here"}</h3>
              <p>
                {view === "mine"
                  ? ru
                    ? "Создай первый дизайн: изображение, герой и рамка нужного ранга."
                    : "Create your first design: artwork, hero and a rank frame."
                  : ru
                    ? "По этим условиям пока нет опубликованных карточек. Первые дизайны появятся после проверки."
                    : "No published cards match yet. Designs appear after review."}
              </p>
            </div>
          ) : (
            <div className="archive-grid">
              {cards.data.items.map((card) => (
                <article key={card.id}>
                  <CardPreview card={card} />
                  <CardStatus card={card} />
                  <h3 className="archive-item-title">{card.title}</h3>
                  <p>{card.description}</p>
                  <small>{card.artist}</small>
                  {card.source_url && (
                    <a href={card.source_url} target="_blank" rel="noopener noreferrer">
                      {ru ? "Источник изображения" : "Artwork source"}
                    </a>
                  )}
                  {card.review_note && <p className="archive-review-note">{card.review_note}</p>}
                  {view === "catalog" && meta.data!.direct_costs && (
                    <button
                      disabled={
                        transaction.busy ||
                        !!transaction.pending ||
                        !wallet.data ||
                        wallet.data.balance < meta.data!.direct_costs[card.rank]
                      }
                      onClick={() =>
                        void transaction.execute(`/api/archive/cards/${card.id}/acquire`, {
                          expected_price: meta.data!.direct_costs[card.rank],
                        })
                      }
                    >
                      {ru
                        ? `Получить за ${meta.data!.direct_costs[card.rank]} жет.`
                        : `Acquire for ${meta.data!.direct_costs[card.rank]} tokens`}
                    </button>
                  )}
                  {view === "mine" && (
                    <div className="archive-actions">
                      {["DRAFT", "REJECTED"].includes(card.status) && (
                        <>
                          <button disabled={busy} onClick={() => setEditing(card)}>
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
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          {cards.data && (
            <Pager offset={offset} total={cards.data.total} size={18} setOffset={setOffset} />
          )}
        </>
      )}
    </section>
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
  setOffset: (offset: number) => void
}) {
  const { language } = useLanguage()
  if (!total) return null
  return (
    <div className="archive-pager">
      <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - size))}>
        {language === "ru" ? "Назад" : "Previous"}
      </button>
      <span>
        {Math.min(offset + 1, total)}–{Math.min(offset + size, total)} / {total}
      </span>
      <button disabled={offset + size >= total} onClick={() => setOffset(offset + size)}>
        {language === "ru" ? "Далее" : "Next"}
      </button>
    </div>
  )
}
