import Icon from "../icons/Icon"
import { useEffect, useState } from "react"
import { request, useResource } from "../community/api"
import { useLanguage } from "../i18n"
import { Pager } from "./ArchivePage"
import CardSurface from "./CardSurface"
import { FavoriteButton, FavoriteError, type FavoriteControls } from "./favorites"
import {
  RANKS,
  type EconomyScope,
  type Inventory,
  type Meta,
  type Receipt,
  type Showcase,
} from "./types"
import { ReceiptView, type useTransaction } from "./transactions"

export default function CollectionPage({
  csrf,
  meta,
  revision,
  transaction,
  favorites,
  scope,
}: {
  csrf: string
  meta: Meta
  revision: number
  transaction: ReturnType<typeof useTransaction>
  favorites: FavoriteControls
  scope: EconomyScope
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [hero, setHero] = useState("")
  const [rank, setRank] = useState("")
  const [q, setQ] = useState("")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [historyOffset, setHistoryOffset] = useState(0)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const inventory = useResource<Inventory>(
    `/api/archive/inventory?hero=${hero}${rank ? `&rank=${rank}` : ""}&q=${encodeURIComponent(search)}&offset=${offset}&refresh=${revision}&favorites_only=${favoritesOnly}&scope=${scope}`,
  )
  const coverage = useResource<{ items: { hero: string; rank: string; count: number }[] }>(
    `/api/archive/inventory/coverage?refresh=${revision}&scope=${scope}`,
  )
  const showcase = useResource<Showcase>("/api/archive/showcase")
  const history = useResource<{ items: Receipt[]; total: number }>(
    `/api/archive/openings?offset=${historyOffset}&refresh=${revision}&scope=${scope}`,
  )
  useEffect(() => {
    if (showcase.data) {
      setSelected(showcase.data.card_ids)
      setVisible(showcase.data.is_public)
    }
  }, [showcase.data])
  useEffect(() => {
    if (!favoritesOnly) return
    setOffset(0)
    inventory.reload()
  }, [favorites.revision])
  const save = async () => {
    if (!showcase.data) return
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const result = await request<Showcase>("/api/archive/showcase", csrf, {
        method: "PUT",
        body: JSON.stringify({
          revision: showcase.data.revision,
          card_ids: selected,
          is_public: visible,
        }),
      })
      showcase.setData(result)
      setNotice(ru ? "Витрина сохранена." : "Showcase saved.")
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const toggle = (id: string) =>
    setSelected((old) =>
      old.includes(id) ? old.filter((value) => value !== id) : old.length < 3 ? [...old, id] : old,
    )
  return (
    <section className="archive-collection">
      <h2>{ru ? "Моя коллекция" : "My collection"}</h2>
      <p>
        {ru
          ? "Здесь находятся полученные экземпляры. Последняя копия каждого дизайна остаётся у тебя; платные дубли возвращают 20% своей доли цены, с округлением вниз."
          : "These are your owned copies. Keep the last copy of each design; paid duplicates refund 20% of their share of the price, rounded down."}
      </p>
      {(error || inventory.error || showcase.error || history.error || coverage.error) && (
        <p role="alert">
          {error || inventory.error || showcase.error || history.error || coverage.error}
          <button
            onClick={() => {
              setError("")
              inventory.reload()
              showcase.reload()
              history.reload()
              coverage.reload()
            }}
          >
            {ru ? "Обновить" : "Refresh"}
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <FavoriteError controls={favorites} />
      {coverage.data && (
        <div className="archive-collection-overview">
          <div className="archive-collection-count">
            <strong>{coverage.data.items.reduce((total, item) => total + item.count, 0)}</strong>
            <span>
              {ru ? "В твоей коллекции" : "In your collection"}
              <small>{ru ? "уникальных дизайнов" : "unique designs"}</small>
            </span>
          </div>
          <div className="archive-rarity-summary">
            {(["S", "SS", "SSS"] as const).map((value) => (
              <span key={value} data-rank={value}>
                <b>{value}</b>
                <small>
                  {coverage
                    .data!.items.filter((item) => item.rank === value)
                    .reduce((total, item) => total + item.count, 0)}{" "}
                  {ru ? "шт." : "owned"}
                </small>
              </span>
            ))}
          </div>
          <p>{ru ? "Твоя коллекция. Твой почерк." : "Your collection. Your signature."}</p>
        </div>
      )}
      {scope === "REAL" && (
        <details className="archive-panel archive-showcase-settings">
          <summary>
            <Icon name="images" size={20} />
            <span>
              {ru
                ? `Витрина профиля: ${selected.length} / 3`
                : `Profile showcase: ${selected.length} / 3`}
            </span>
            <Icon name="chevron-down" size={18} />
          </summary>
          <p>
            {ru
              ? "Отметь до трёх карточек ниже. Они появятся в профиле в порядке выбора."
              : "Select up to three cards below. They appear in the order selected."}
          </p>
          <label className="archive-check">
            <input
              type="checkbox"
              checked={visible}
              disabled={saving}
              onChange={(event) => setVisible(event.target.checked)}
            />
            {ru
              ? "Показывать выбранные карточки в публичном профиле"
              : "Show selected cards on my public profile"}
          </label>
          {visible && !showcase.data?.profile_public && (
            <p>
              {ru
                ? "Сам профиль сейчас закрыт. Его можно открыть в настройках профиля; одна эта галочка не делает профиль публичным."
                : "Your profile is private. Enable its public visibility in profile settings; this checkbox alone does not publish it."}
            </p>
          )}
          <div className="archive-actions">
            <button disabled={saving || !showcase.data} onClick={() => void save()}>
              {ru ? "Сохранить витрину" : "Save showcase"}
            </button>
            <button disabled={saving} onClick={() => setSelected([])}>
              {ru ? "Снять все отметки" : "Clear selection"}
            </button>
          </div>
        </details>
      )}
      <form
        className="archive-filters"
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(q)
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
            {meta.heroes.map((h) => (
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
            onChange={(event) => {
              setRank(event.target.value)
              setOffset(0)
            }}
          >
            <option value="">{ru ? "Все ранги" : "All ranks"}</option>
            {meta.ranks.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          {ru ? "Название" : "Title"}
          <input value={q} maxLength={80} onChange={(event) => setQ(event.target.value)} />
        </label>
        <button>{ru ? "Найти" : "Search"}</button>
      </form>
      <label className="archive-check">
        <input
          name="favorites_only"
          type="checkbox"
          checked={favoritesOnly}
          onChange={(event) => {
            setFavoritesOnly(event.target.checked)
            setOffset(0)
          }}
        />
        {ru ? "Только избранное" : "Favorites only"}
      </label>
      {hero && (
        <>
          <p>
            {ru
              ? "Ранги этого героя в твоей коллекции. Ноль означает, что ранг ещё не собран."
              : "Ranks owned for this hero. Zero means the rank is still missing."}
          </p>
          <div className="archive-coverage">
            {RANKS.map((r) => {
              const count =
                coverage.data?.items.find((item) => item.hero === hero && item.rank === r)?.count ||
                0
              return (
                <span key={r} data-filled={!!count}>
                  {r}
                  <b>{count}</b>
                </span>
              )
            })}
          </div>
        </>
      )}
      {inventory.loading && (
        <p role="status">{ru ? "Загрузка коллекции…" : "Loading collection…"}</p>
      )}
      {inventory.data?.total === 0 && (
        <div className="archive-empty">
          <Icon name="layers" size={30} />
          <h3>{ru ? "Место для новой истории" : "Room for a new story"}</h3>
          <p>
            {favoritesOnly
              ? ru
                ? "В избранном пока нет подходящих карточек. Отметь понравившиеся звёздочкой в коллекции или при открытии конверта."
                : "No matching favorites. Star a card in your collection or while opening an envelope."
              : ru
                ? "Здесь пока нет карточек. Загляни в конверты или выбери конкретную карточку в каталоге."
                : "No matching cards yet. Open an envelope or choose a card in the catalogue."}
          </p>
        </div>
      )}
      <div className="archive-grid">
        {inventory.data?.items.map((item) => (
          <article
            key={item.card.id}
            className="archive-collection-item"
            data-selected={selected.includes(item.card.id)}
          >
            <CardSurface card={item.card} />
            <h3 className="archive-item-title">{item.card.title}</h3>
            {typeof item.card.battle_eligible === "boolean" && (
              <p>
                {item.card.battle_eligible
                  ? ru
                    ? "Боевой вариант одобрен"
                    : "Approved battle variant"
                  : ru
                    ? "Коллекционный дизайн: боевой допуск ещё не выдан"
                    : "Collectible artwork: battle approval pending"}
              </p>
            )}
            <p>
              {ru ? "Экземпляров" : "Copies"}: {item.quantity}
              {item.test_count > 0
                ? ` · ${ru ? "тестовых" : "test copies"}: ${item.test_count}`
                : ""}
            </p>
            <FavoriteButton controls={favorites} cardId={item.card.id} />
            {scope === "REAL" && (
              <label className="archive-check">
                <input
                  type="checkbox"
                  checked={selected.includes(item.card.id)}
                  disabled={saving || (!selected.includes(item.card.id) && selected.length >= 3)}
                  onChange={() => toggle(item.card.id)}
                />
                {ru ? "В витрину профиля" : "Feature on profile"}
              </label>
            )}
            {item.recycle && (
              <button
                disabled={transaction.busy || !!transaction.pending}
                onClick={() =>
                  void transaction.execute(`/api/archive/items/${item.recycle!.id}/recycle`, {
                    scope,
                  })
                }
              >
                {ru
                  ? `Обменять один дубль: +${item.recycle.value} монет`
                  : `Recycle one duplicate: +${item.recycle.value} coins`}
              </button>
            )}
          </article>
        ))}
      </div>
      {inventory.data && (
        <Pager offset={offset} total={inventory.data.total} size={18} setOffset={setOffset} />
      )}
      <details className="archive-opening-history">
        <summary>{ru ? "История открытий и выдачи" : "Opening & grant history"}</summary>
        {history.data?.items.map((item) => (
          <button key={item.id} onClick={() => setReceipt({ ...item, scope: item.scope ?? scope })}>
            {item.pack?.title || item.kind} · {new Date(item.created_at).toLocaleString()} ·{" "}
            {item.delta > 0 ? "+" : ""}
            {item.delta} <Icon name="coins" size={18} />
          </button>
        ))}
        {history.data?.total === 0 && <p>{ru ? "Операций пока нет." : "No transactions yet."}</p>}
        {history.data && (
          <Pager
            offset={historyOffset}
            total={history.data.total}
            size={10}
            setOffset={setHistoryOffset}
          />
        )}
        {receipt && (
          <ReceiptView key={receipt.id} receipt={receipt} onClose={() => setReceipt(null)} />
        )}
      </details>
    </section>
  )
}
