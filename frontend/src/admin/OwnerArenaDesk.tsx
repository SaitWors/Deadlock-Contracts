import { useState } from "react"
import { request, useResource } from "../community/api"
import { useLanguage } from "../i18n"
import CardPreview from "../archive/CardPreview"
import type { Card } from "../archive/types"
import { useArenaCommand } from "../arena/commands"
import { localized, type Definition } from "../arena/types"
export default function OwnerArenaDesk({ csrf, accountKey }: { csrf: string; accountKey: string }) {
  const { language } = useLanguage(),
    ru = language === "ru"
  const definitions = useResource<{
    definitions: {
      id: string
      key: string
      category: string
      version: number
      approved: boolean
      rules: Definition
    }[]
  }>("/api/arena/definitions")
  const [definitionID, setDefinitionID] = useState(""),
    [cardID, setCardID] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("")
  const [title, setTitle] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [active, setActive] = useState(false)
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0)
  const definition =
    definitions.data?.definitions.find((value) => value.id === definitionID) ||
    definitions.data?.definitions.find((value) => value.approved)
  const cards = useResource<{ items: Card[]; total: number }>(
    `/api/archive/cards?hero=${encodeURIComponent(definition?.key || "")}${definition?.category === "BASE" ? "&rank=EX" : ""}&q=${encodeURIComponent(search)}&offset=${offset}`,
  )
  const card =
    cards.data?.items.find((value) => value.id === cardID) ||
    cards.data?.items.find(
      (value) => value.status === "PUBLISHED" && value.hero === definition?.key,
    )
  const command = useArenaCommand(
    csrf,
    accountKey,
    () => setNotice(ru ? "Сезон сохранён." : "Season saved."),
    () => {},
  )
  const approve = async (approved: boolean) => {
    if (!card || !definition || busy) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await request("/api/arena/artwork-approval", csrf, {
        method: "PUT",
        body: JSON.stringify({ card_id: card.id, definition_id: definition.id, approved }),
      })
      setNotice(ru ? "Допуск иллюстрации обновлён." : "Artwork approval updated.")
      cards.reload()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const validDates = start && end && Date.parse(end) > Date.parse(start)
  return (
    <section className="archive-panel owner-arena-desk">
      <h2>{ru ? "Арена · инструменты OWNER" : "Arena owner tools"}</h2>
      <p>
        {ru
          ? "Нужна подтверждённая сессия OWNER с TOTP. Публикация дизайна и одобрение боевого варианта — отдельные действия."
          : "Requires an elevated OWNER session with TOTP. Publishing artwork and approving its battle definition are separate actions."}
      </p>
      {(error || definitions.error || command.error) && (
        <p role="alert">{error || definitions.error || command.error}</p>
      )}
      {notice && <p role="status">{notice}</p>}
      <h3>{ru ? "Допуск иллюстрации к бою" : "Battle artwork approval"}</h3>
      <label>
        {ru ? "Одобренное боевое определение" : "Approved battle definition"}
        <select
          value={definition?.id || ""}
          disabled={busy}
          onChange={(event) => {
            setDefinitionID(event.target.value)
            setCardID("")
            setOffset(0)
          }}
        >
          {definitions.data?.definitions
            .filter((value) => value.approved)
            .map((value) => (
              <option key={value.id} value={value.id}>
                {localized(value.rules.name, language) || value.key} · {value.category} · v
                {value.version}
              </option>
            ))}
        </select>
      </label>
      <form
        className="archive-filters"
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(query.trim())
          setOffset(0)
          setCardID("")
        }}
      >
        <label>
          {ru ? "Поиск иллюстрации" : "Artwork search"}
          <input maxLength={80} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button>{ru ? "Найти" : "Search"}</button>
      </form>
      {cards.error && (
        <p role="alert">
          {cards.error}
          <button onClick={cards.reload}>{ru ? "Повторить" : "Retry"}</button>
        </p>
      )}
      <label>
        {ru ? "Опубликованная иллюстрация того же героя" : "Published artwork for this hero"}
        <select
          value={card?.id || ""}
          disabled={busy || cards.loading}
          onChange={(event) => setCardID(event.target.value)}
        >
          {cards.data?.items
            .filter((value) => value.hero === definition?.key && value.status === "PUBLISHED")
            .map((value) => (
              <option key={value.id} value={value.id}>
                {value.title} · {value.rank}
              </option>
            ))}
        </select>
      </label>
      {!!cards.data && cards.data.total > 18 && (
        <div className="archive-actions">
          <button
            disabled={busy || offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - 18))
              setCardID("")
            }}
          >
            {ru ? "Назад" : "Previous"}
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 18, cards.data.total)} / {cards.data.total}
          </span>
          <button
            disabled={busy || offset + 18 >= cards.data.total}
            onClick={() => {
              setOffset(offset + 18)
              setCardID("")
            }}
          >
            {ru ? "Далее" : "Next"}
          </button>
        </div>
      )}
      {card && (
        <div style={{ maxWidth: 220, margin: "16px 0" }}>
          <CardPreview card={card} />
        </div>
      )}
      <div className="archive-actions">
        <button disabled={busy || !card || !definition} onClick={() => void approve(true)}>
          {ru ? "Одобрить боевую иллюстрацию" : "Approve battle artwork"}
        </button>
        <button disabled={busy || !card || !definition} onClick={() => void approve(false)}>
          {ru ? "Отозвать боевой допуск" : "Revoke battle approval"}
        </button>
      </div>
      <form
        className="archive-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (validDates)
            void command.execute("/api/arena/season", {
              title,
              starts_at: new Date(start).toISOString(),
              ends_at: new Date(end).toISOString(),
              active,
            })
        }}
      >
        <h3>{ru ? "Новый сезон" : "New season"}</h3>
        <fieldset disabled={command.busy || !!command.pending}>
          <label>
            {ru ? "Название" : "Title"}
            <input
              required
              minLength={2}
              maxLength={80}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            {ru ? "Начало · местное время" : "Starts · local time"}
            <input
              required
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            {ru ? "Окончание · местное время" : "Ends · local time"}
            <input
              required
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <label className="archive-check">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            {ru ? "Активировать сезон" : "Activate season"}
          </label>
          <p>
            {ru
              ? "Создание сезона отключает предыдущий активный сезон и очищает очередь подбора. Результаты прошлых сезонов сохраняются."
              : "Creating a season deactivates the previous active season and clears matchmaking. Previous season results are retained."}
          </p>
          <button disabled={!validDates || title.trim().length < 2} className="archive-primary">
            {ru ? "Создать сезон" : "Create season"}
          </button>
        </fieldset>
      </form>
      {command.pending && (
        <p role="status">
          {ru ? "Запрос арены сохранён." : "Arena request saved."}
          <button disabled={command.busy} onClick={() => void command.recover()}>
            {ru ? "Проверить результат" : "Check result"}
          </button>
          <button disabled={command.busy} onClick={() => void command.retry()}>
            {ru ? "Повторить запрос" : "Retry request"}
          </button>
        </p>
      )}
    </section>
  )
}
