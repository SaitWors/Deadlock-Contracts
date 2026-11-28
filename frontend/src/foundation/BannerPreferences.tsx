import { useId, useState } from "react"
import { request, useResource } from "../community/api"
import {
  bannerPath,
  bannerPreferenceChanged,
  type BannerAccount,
  type BannerCard,
  type BannerMode,
} from "./banner"

type Preferences = {
  account_key: string
  mode: BannerMode
  selected_card: BannerCard | null
}
type Options = { account_key: string; items: BannerCard[]; next_offset: number | null }

const modes = [
  ["favorite_hero", "Любимый герой", "Most-played hero"],
  ["collection", "Моя коллекция", "My collection"],
  ["selected_card", "Избранная карточка", "Selected card"],
  ["random_hero", "Случайный герой", "Random hero"],
  ["off", "Без изображения", "No image"],
] as const

export default function BannerPreferences({
  account,
  ru,
}: {
  account: BannerAccount
  ru: boolean
}) {
  const resource = useResource<Preferences>(bannerPath + "/preferences", {
    reloadOnLanguageChange: false,
  })
  const title = ru ? "Иллюстрация на главной" : "Overview artwork"
  return (
    <section className="ns-preference-group ns-banner-preferences" aria-label={title}>
      {resource.data?.account_key === account.id ? (
        <Editor account={account} initial={resource.data} title={title} ru={ru} />
      ) : (
        <div className="ns-banner-preference-actions">
          <p role={resource.loading ? "status" : "alert"}>
            {resource.loading
              ? ru
                ? "Загружаем настройки баннера…"
                : "Loading banner preferences…"
              : ru
                ? "Настройки баннера недоступны."
                : "Banner preferences are unavailable."}
          </p>
          {!resource.loading && (
            <button type="button" className="ns-theme-trigger" onClick={resource.reload}>
              {ru ? "Повторить" : "Retry"}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function Editor({
  account,
  initial,
  title,
  ru,
}: {
  account: BannerAccount
  initial: Preferences
  title: string
  ru: boolean
}) {
  const id = useId()
  const [saved, setSaved] = useState(initial)
  const [mode, setMode] = useState(initial.mode)
  const [card, setCard] = useState(initial.selected_card)
  const [message, setMessage] = useState("")
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const changed =
    mode !== saved.mode || (mode === "selected_card" && card?.id !== saved.selected_card?.id)

  const save = async () => {
    if (busy) return
    setBusy(true)
    setMessage("")
    setError(false)
    try {
      const result = await request<Preferences>(bannerPath + "/preferences", account.csrf, {
        method: "PUT",
        body: JSON.stringify({ mode, card_id: mode === "selected_card" ? card?.id : null }),
      })
      if (result.account_key !== account.id) throw new Error()
      setSaved(result)
      setCard(result.selected_card)
      bannerPreferenceChanged()
      setMessage(ru ? "Настройка сохранена." : "Preference saved.")
    } catch {
      setError(true)
      setMessage(
        ru
          ? "Не удалось сохранить настройку. Повтори попытку."
          : "Could not save the preference. Try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <label htmlFor={id}>{title}</label>
      <select
        className="ns-preference-select"
        id={id}
        value={mode}
        disabled={busy}
        onChange={(event) => {
          setMode(event.target.value as BannerMode)
          setMessage("")
        }}
      >
        {modes.map(([key, russian, english]) => (
          <option value={key} key={key}>
            {ru ? russian : english}
          </option>
        ))}
      </select>
      {mode === "selected_card" && (
        <ArtPicker account={account} card={card} onSelect={setCard} ru={ru} busy={busy} />
      )}
      <div className="ns-banner-preference-actions">
        <button
          className="ns-theme-trigger"
          type="button"
          disabled={busy || !changed || (mode === "selected_card" && !card)}
          onClick={() => void save()}
        >
          {busy ? (ru ? "Сохранение…" : "Saving…") : ru ? "Сохранить" : "Save"}
        </button>
        {message && <p role={error ? "alert" : "status"}>{message}</p>}
      </div>
    </>
  )
}

function ArtPicker({
  account,
  card,
  onSelect,
  ru,
  busy,
}: {
  account: BannerAccount
  card: BannerCard | null
  onSelect: (card: BannerCard | null) => void
  ru: boolean
  busy: boolean
}) {
  const id = useId()
  const [offset, setOffset] = useState(0)
  const resource = useResource<Options>(bannerPath + "/options?offset=" + offset)
  const page = resource.data?.account_key === account.id ? resource.data : null
  const options = page?.items ?? []
  const cards =
    card && !options.some((option) => option.id === card.id) ? [card, ...options] : options
  return (
    <div className="ns-banner-art-picker">
      <label htmlFor={id}>{ru ? "Дизайн карточки" : "Card design"}</label>
      <select
        id={id}
        className="ns-preference-select"
        value={card?.id ?? ""}
        disabled={busy || resource.loading || !cards.length}
        onChange={(event) => onSelect(cards.find((item) => item.id === event.target.value) ?? null)}
      >
        <option value="">{ru ? "Выбери иллюстрацию" : "Choose artwork"}</option>
        {cards.map((item) => (
          <option value={item.id} key={item.id}>
            {item.title} · {item.hero_name}
          </option>
        ))}
      </select>
      {resource.loading ? (
        <p role="status">{ru ? "Загрузка иллюстраций…" : "Loading artwork…"}</p>
      ) : !page ? (
        <div className="ns-banner-preference-actions">
          <p role="alert">{ru ? "Не удалось загрузить иллюстрации." : "Artwork is unavailable."}</p>
          <button type="button" className="ns-theme-trigger" onClick={resource.reload}>
            {ru ? "Повторить" : "Retry"}
          </button>
        </div>
      ) : (
        <div className="ns-banner-preference-actions">
          {!cards.length && (
            <p>{ru ? "Пока нет доступных иллюстраций." : "No artwork is available yet."}</p>
          )}
          {offset > 0 && (
            <button
              className="ns-theme-trigger"
              type="button"
              disabled={busy}
              onClick={() => setOffset(Math.max(0, offset - 30))}
            >
              {ru ? "Назад" : "Previous"}
            </button>
          )}
          {page.next_offset !== null && (
            <button
              className="ns-theme-trigger"
              type="button"
              disabled={busy}
              onClick={() => setOffset(page.next_offset ?? 0)}
            >
              {ru ? "Далее" : "Next"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
