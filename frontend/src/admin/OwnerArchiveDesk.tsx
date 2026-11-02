import { useEffect, useState, type FormEvent } from "react"
import { request, useResource } from "../community/api"
import { useLanguage } from "../i18n"
import { Pager } from "../archive/ArchivePage"
import CardPreview from "../archive/CardPreview"
import PackReveal from "../archive/PackReveal"
import { RANKS, type Card, type Meta, type Pack } from "../archive/types"
import { useTransaction } from "../archive/transactions"
import "../archive/archive.css"
import "../archive/packs.css"
import OwnerArenaDesk from "./OwnerArenaDesk"

export default function OwnerArchiveDesk({
  csrf,
  permissions,
  isOwner = false,
}: {
  csrf: string
  permissions: string[]
  isOwner?: boolean
}) {
  const { language } = useLanguage()
  if (!permissions.includes("packs.manage") && !permissions.includes("*"))
    return (
      <p role="alert">
        {language === "ru"
          ? "Этот раздел доступен только OWNER."
          : "Only OWNER can access this section."}
      </p>
    )
  return <OwnerContent csrf={csrf} isOwner={isOwner} />
}

function OwnerContent({ csrf, isOwner }: { csrf: string; isOwner: boolean }) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const meta = useResource<Meta>("/api/archive/meta")
  const [offset, setOffset] = useState(0)
  const packs = useResource<{ items: Pack[]; total: number }>(
    `/api/owner/archive/packs?offset=${offset}`,
  )
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState("")
  const [card, setCard] = useState<Card | null>(null)
  const tx = useTransaction(
    csrf,
    meta.data?.account_key ? `${meta.data.account_key}:sandbox-card-grants` : "",
    () => {},
  )
  const pause = async (pack: Pack) => {
    setBusy(true)
    setError("")
    try {
      await request(`/api/owner/archive/packs/${pack.id}/pause`, csrf, {
        method: "POST",
        body: JSON.stringify({ revision: pack.revision }),
      })
      packs.reload()
    } catch (reason) {
      setError((reason as Error).message)
      packs.reload()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="archive-page owner-archive-desk dc-admin-packs">
      <header className="dc-admin-section-head">
        <div>
          <small>{ru ? "OWNER / УПРАВЛЕНИЕ АРХИВОМ" : "OWNER / ARCHIVE CONTROL"}</small>
          <h2>{ru ? "Конверты и инструменты владельца" : "Packs & owner tools"}</h2>
          <p>
            {ru
              ? "Только владелец из серверного списка SteamID может менять паки и выполнять тестовую выдачу. Обычный ADMIN этого доступа не получает."
              : "Only the owner in the server SteamID allowlist can change packs and issue test grants. ADMIN has no access."}
          </p>
        </div>
      </header>
      {(error || meta.error || packs.error) && (
        <p role="alert">
          {error || meta.error || packs.error}
          <button
            onClick={() => {
              setError("")
              meta.reload()
              packs.reload()
            }}
          >
            {ru ? "Обновить" : "Refresh"}
          </button>
        </p>
      )}
      {(!meta.data || packs.loading) && <p role="status">{ru ? "Загрузка…" : "Loading…"}</p>}
      {tx.error && <p role="alert">{tx.error}</p>}
      {tx.pending && (
        <div role="status" className="archive-pending">
          <p>
            {ru
              ? "Тестовая выдача сохранена. При обрыве связи проверь результат или повтори запрос."
              : "Your test grant is saved. Check its result or retry after a connection error."}
          </p>
          <div className="archive-actions">
            <button disabled={tx.busy} onClick={() => void tx.recover()}>
              {ru ? "Проверить результат" : "Check result"}
            </button>
            <button disabled={tx.busy} onClick={() => void tx.retry()}>
              {ru ? "Повторить выдачу" : "Retry grant"}
            </button>
          </div>
        </div>
      )}
      {tx.receipt && (
        <section
          className="archive-panel"
          aria-label={ru ? "Полученные тестовые карточки" : "Granted sandbox cards"}
        >
          <p>{ru ? "Тестовые карточки сохранены." : "Sandbox cards saved."}</p>
          <PackReveal key={tx.receipt.id} receipt={tx.receipt} />
          <button onClick={tx.clearReceipt}>{ru ? "Закрыть результат" : "Close result"}</button>
        </section>
      )}
      {isOwner && meta.data && <OwnerArenaDesk csrf={csrf} accountKey={meta.data.account_key} />}
      {meta.data && (
        <>
          {editing ? (
            <PackEditor
              key={editing}
              id={editing}
              csrf={csrf}
              meta={meta.data}
              onSaved={() => {
                setEditing(null)
                packs.reload()
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              <button className="archive-primary" onClick={() => setEditing("new")}>
                {ru ? "Создать пак" : "Create pack"}
              </button>
              <div className="archive-owner-packs">
                {packs.data?.items.map((pack) => (
                  <article key={pack.id}>
                    <h3>{pack.title}</h3>
                    <p>
                      {pack.draws} {ru ? "карточек" : "cards"} ·{" "}
                      {pack.active
                        ? ru
                          ? "Опубликован"
                          : "Published"
                        : ru
                          ? "Приостановлен / черновик"
                          : "Paused / draft"}
                    </p>
                    {!pack.ready && (
                      <p>
                        {ru
                          ? "Состав недоступен. Удали снятую карточку или замени её перед публикацией."
                          : "Contents unavailable. Remove or replace unpublished cards before publishing."}
                      </p>
                    )}
                    <div className="archive-actions">
                      <button onClick={() => setEditing(pack.id)}>
                        {ru ? "Редактировать состав" : "Edit contents"}
                      </button>
                      {pack.active && (
                        <button disabled={busy} onClick={() => void pause(pack)}>
                          {ru ? "Приостановить" : "Pause"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {packs.data && !packs.data.items.length && (
                <p className="dc-admin-empty">
                  {ru
                    ? "Паков пока нет. Создай первый выпуск."
                    : "No packs yet. Create the first release."}
                </p>
              )}
              {packs.data && (
                <Pager offset={offset} total={packs.data.total} size={8} setOffset={setOffset} />
              )}
            </>
          )}
          <details className="archive-owner-tools">
            <summary>
              {ru ? "Тестовая выдача себе · только OWNER" : "Self test grants · OWNER only"}
            </summary>
            <p>
              {ru
                ? "Получатель — твой текущий аккаунт. Тестовые карточки сохраняются отдельно от основной коллекции. Укажи причину выдачи."
                : "Recipient: your current account. Sandbox cards are stored separately from your main collection. Give a reason for the grant."}
            </p>
            <label>
              {ru ? "Для чего выдача" : "Reason for grant"}
              <input
                value={note}
                minLength={3}
                maxLength={300}
                onChange={(event) => setNote(event.target.value)}
                placeholder={
                  ru
                    ? "Например: проверка открытия конверта"
                    : "For example: testing a pack opening"
                }
              />
            </label>
            <h3>{ru ? "Выдать себе карточку" : "Grant myself a card"}</h3>
            <p>
              {ru
                ? "Выбери опубликованный дизайн для тестовой коллекции."
                : "Choose a published design for your sandbox collection."}
            </p>
            <CardPicker meta={meta.data} selected={card ? [card.id] : []} onPick={setCard} />
            {card && (
              <div className="archive-owner-grant">
                <p>
                  {card.hero_name} · {card.title} · {card.rank}
                </p>
                <label>
                  {ru ? "Количество экземпляров" : "Number of copies"}
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={quantity}
                    onChange={(event) => setQuantity(Number(event.target.value))}
                  />
                </label>
                <button
                  disabled={
                    tx.busy ||
                    !!tx.pending ||
                    note.trim().length < 3 ||
                    !Number.isInteger(quantity) ||
                    quantity < 1 ||
                    quantity > 100
                  }
                  onClick={() =>
                    void tx.execute(`/api/owner/archive/cards/${card.id}/grant`, {
                      quantity,
                      note,
                      scope: "SANDBOX",
                    })
                  }
                >
                  {ru ? `Выдать себе ${quantity} шт.` : `Grant myself ${quantity} copies`}
                </button>
              </div>
            )}
          </details>
        </>
      )}
    </section>
  )
}

function PackEditor({
  id,
  csrf,
  meta,
  onSaved,
  onCancel,
}: {
  id: string
  csrf: string
  meta: Meta
  onSaved: () => void
  onCancel: () => void
}) {
  if (id === "new")
    return <PackForm csrf={csrf} meta={meta} onSaved={onSaved} onCancel={onCancel} />
  return <ExistingPack id={id} csrf={csrf} meta={meta} onSaved={onSaved} onCancel={onCancel} />
}
function ExistingPack({
  id,
  ...props
}: {
  id: string
  csrf: string
  meta: Meta
  onSaved: () => void
  onCancel: () => void
}) {
  const { language } = useLanguage()
  const data = useResource<{ pack: Pack }>(`/api/archive/packs/${id}`)
  if (data.error)
    return (
      <p role="alert">
        {data.error}
        <button onClick={data.reload}>{language === "ru" ? "Повторить" : "Retry"}</button>
      </p>
    )
  if (!data.data)
    return <p role="status">{language === "ru" ? "Загрузка конверта…" : "Loading pack…"}</p>
  return <PackForm {...props} initial={data.data.pack} />
}

function PackForm({
  initial,
  csrf,
  meta,
  onSaved,
  onCancel,
}: {
  initial?: Pack
  csrf: string
  meta: Meta
  onSaved: () => void
  onCancel: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [title, setTitle] = useState(initial?.title || "")
  const [description, setDescription] = useState(initial?.description || "")
  const price = initial?.price ?? 30
  const [draws, setDraws] = useState(initial?.draws || 1)
  const [active, setActive] = useState(initial?.active || false)
  const starter = initial?.starter ?? false
  const [entries, setEntries] = useState(initial?.entries || [])
  const [preview, setPreview] = useState<{
    odds: Pack["odds"]
  } | null>(null)
  const [error, setError] = useState("")
  const [previewError, setPreviewError] = useState("")
  const [busy, setBusy] = useState(false)
  const [previewRetry, setPreviewRetry] = useState(0)
  const versionTwo = initial?.rule_version === "packs-v2"
  const payload = {
    title,
    description,
    price,
    draws,
    active,
    starter,
    ...(versionTwo ? { kind: initial.kind } : {}),
    entries: entries.map((entry) => ({ card_id: entry.card_id, weight: entry.weight })),
  }
  const previewBody = JSON.stringify({
    ...payload,
    title: title.trim().length >= 2 ? title : "Pack preview",
  })
  useEffect(() => {
    const abort = new AbortController()
    setPreview(null)
    setPreviewError("")
    if (!entries.length) return
    const timer = setTimeout(() => {
      request<{ odds: Pack["odds"] }>("/api/owner/archive/packs/preview", csrf, {
        method: "POST",
        body: previewBody,
        signal: abort.signal,
      })
        .then((value) => {
          if (!abort.signal.aborted) setPreview(value)
        })
        .catch((reason) => {
          if (!abort.signal.aborted) setPreviewError((reason as Error).message)
        })
    }, 450)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [previewBody, previewRetry, csrf])
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await request(
        initial ? `/api/owner/archive/packs/${initial.id}` : "/api/owner/archive/packs",
        csrf,
        {
          method: initial ? "PUT" : "POST",
          body: JSON.stringify({ ...payload, ...(initial ? { revision: initial.revision } : {}) }),
        },
      )
      onSaved()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="archive-pack-editor">
      <form className="archive-form" onSubmit={(event) => void save(event)}>
        <h3>
          {initial ? (ru ? "Изменение конверта" : "Edit pack") : ru ? "Новый конверт" : "New pack"}
        </h3>
        {error && <p role="alert">{error}</p>}
        <fieldset disabled={busy}>
          <label>
            {ru ? "Название конверта" : "Pack title"}
            <input
              value={title}
              minLength={2}
              maxLength={80}
              required
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            {ru ? "Карточек при открытии" : "Cards per opening"}
            <input
              type="number"
              min={1}
              max={5}
              step={1}
              required
              value={draws}
              disabled={versionTwo}
              onChange={(event) => setDraws(Number(event.target.value))}
            />
          </label>
          <label>
            {ru ? "Описание выпуска" : "Release description"}
            <textarea
              maxLength={600}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="archive-check">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            {ru ? "Опубликовать и разрешить открытие" : "Publish and allow opening"}
          </label>
        </fieldset>
        {versionTwo ? (
          <div className="archive-odds-preview">
            <h3>{ru ? "Фиксированные правила выпуска" : "Fixed release rules"}</h3>
            <p>
              {ru
                ? "Количество карточек и порядок слотов для этого выпуска фиксированы. Для каждого указанного ранга нужны подходящие опубликованные карточки. EX в конверты не входит."
                : "Card count and slot order are fixed for this release. Every listed rank needs eligible published cards. EX cards are excluded."}
            </p>
            <PackOdds pack={initial} />
          </div>
        ) : (
          <div className="archive-odds-preview" aria-live="polite">
            {previewError && (
              <p role="alert">
                {previewError}
                <button type="button" onClick={() => setPreviewRetry((value) => value + 1)}>
                  {ru ? "Повторить расчёт" : "Retry odds"}
                </button>
              </p>
            )}
            {preview ? (
              <PackOdds pack={{ odds: preview.odds, draws }} />
            ) : (
              !previewError && (
                <p>
                  {entries.length
                    ? ru
                      ? "Обновляем шансы…"
                      : "Updating odds…"
                    : ru
                      ? "Выбери карточки, чтобы рассчитать шансы."
                      : "Choose cards to calculate odds."}
                </p>
              )
            )}
          </div>
        )}
        <h3>{ru ? `Состав: ${entries.length} / 400` : `Pool: ${entries.length} / 400`}</h3>
        <p>
          {versionTwo
            ? ru
              ? "Вес задаёт частоту героя и ранга. Все иллюстрации одного варианта должны иметь одинаковый вес; новая иллюстрация не повышает шанс героя."
              : "Weight belongs to the hero and rank variant. All its artworks must use the same weight; a new artwork does not increase hero probability."
            : ru
              ? "Вес задаёт относительную частоту конкретной карточки. Вес 20 выпадает вдвое чаще веса 10. Точные шансы рангов показаны выше."
              : "Weight controls relative frequency: weight 20 is twice as likely as weight 10. Rank probabilities are shown above."}
        </p>
        <div className="archive-selected-pool">
          {entries.map((entry) => (
            <div key={entry.card_id}>
              <span>
                {entry.rank} · {entry.card?.title || entry.card_id}
                {entry.card?.status !== "PUBLISHED"
                  ? ru
                    ? " · недоступна"
                    : " · unavailable"
                  : ""}
              </span>
              <label>
                {ru ? "Вес" : "Weight"}
                <input
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  required
                  value={entry.weight}
                  disabled={busy}
                  onChange={(event) =>
                    setEntries((old) =>
                      old.map((item) =>
                        item.card_id === entry.card_id
                          ? { ...item, weight: Number(event.target.value) }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setEntries((old) => old.filter((item) => item.card_id !== entry.card_id))
                }
              >
                {ru ? "Убрать" : "Remove"}
              </button>
            </div>
          ))}
        </div>
        <div className="archive-actions">
          <button className="archive-primary" disabled={busy || !entries.length}>
            {ru ? "Сохранить конверт" : "Save pack"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            {ru ? "Закрыть редактор" : "Close editor"}
          </button>
        </div>
      </form>
      <CardPicker
        meta={meta}
        excludeBases
        selected={entries.map((entry) => entry.card_id)}
        disabled={busy || entries.length >= 400}
        onPick={(card) =>
          setEntries((old) =>
            old.some((entry) => entry.card_id === card.id)
              ? old
              : [
                  ...old,
                  {
                    card_id: card.id,
                    card,
                    rank: card.rank,
                    weight: meta.default_weights[card.rank],
                    percent: 0,
                  },
                ],
          )
        }
      />
    </div>
  )
}

function PackOdds({ pack }: { pack: Pick<Pack, "odds" | "draws" | "slots"> }) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const odds = (items: Pack["odds"]) => (
    <div>
      {items.map((item) => (
        <span key={item.rank}>
          <b>{item.rank}</b> {item.percent.toLocaleString(locale, { maximumFractionDigits: 4 })}
          %{" "}
        </span>
      ))}
    </div>
  )
  return (
    <section className="archive-pack-odds">
      <h3>{ru ? "Шансы рангов" : "Rank probabilities"}</h3>
      <p>
        {ru
          ? `Карточек в конверте: ${pack.draws}. Возможны дубли.`
          : `${pack.draws} cards per pack. Duplicates are possible.`}
      </p>
      {pack.slots?.length
        ? pack.slots.map((slot, index) => (
            <section key={index}>
              <h4>
                {ru ? "Слот" : "Slot"} {index + 1}
                {slot.kind === "B_PLUS" ? " · B+" : ""}
              </h4>
              {odds(slot.odds)}
            </section>
          ))
        : odds(pack.odds)}
    </section>
  )
}

function CardPicker({
  meta,
  selected,
  onPick,
  disabled = false,
  excludeBases = false,
}: {
  meta: Meta
  selected: string[]
  onPick: (card: Card) => void
  disabled?: boolean
  excludeBases?: boolean
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [hero, setHero] = useState("")
  const [rank, setRank] = useState("")
  const [q, setQ] = useState("")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const cards = useResource<{ items: Card[]; total: number }>(
    `/api/archive/cards?hero=${hero}${rank ? `&rank=${rank}` : ""}${excludeBases ? "&category=HERO" : ""}&q=${encodeURIComponent(search)}&offset=${offset}`,
  )
  return (
    <section className="archive-card-picker">
      <h3>{ru ? "Выбрать из опубликованных карточек" : "Choose published cards"}</h3>
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
            {[...meta.heroes, ...(excludeBases ? [] : meta.bases || [])].map((h) => (
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
            {(excludeBases ? RANKS : meta.ranks).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          {ru ? "Поиск карточки" : "Card search"}
          <input value={q} maxLength={80} onChange={(event) => setQ(event.target.value)} />
        </label>
        <button>{ru ? "Найти" : "Search"}</button>
      </form>
      {cards.error && (
        <p role="alert">
          {cards.error}
          <button onClick={cards.reload}>{ru ? "Повторить" : "Retry"}</button>
        </p>
      )}
      {cards.loading && <p role="status">{ru ? "Загрузка карточек…" : "Loading cards…"}</p>}
      {cards.data?.total === 0 && (
        <p>
          {ru ? "Подходящих опубликованных карточек пока нет." : "No matching published cards yet."}
        </p>
      )}
      <div className="archive-picker-grid">
        {cards.data?.items
          .filter((card) => !excludeBases || card.rank !== "EX")
          .map((card) => (
            <article key={card.id}>
              <CardPreview card={card} />
              <p>{card.title}</p>
              <button
                disabled={disabled || selected.includes(card.id)}
                onClick={() => onPick(card)}
              >
                {selected.includes(card.id)
                  ? ru
                    ? "Выбрана"
                    : "Selected"
                  : ru
                    ? "Выбрать"
                    : "Select"}
              </button>
            </article>
          ))}
      </div>
      {cards.data && (
        <Pager offset={offset} total={cards.data.total} size={18} setOffset={setOffset} />
      )}
    </section>
  )
}
