import { useEffect, useState } from "react"
import Icon from "../icons/Icon"
import { useLanguage } from "../i18n"
import { adminApi } from "./admin-api"
import type { AdminCampaign, CampaignDraft, Candidate } from "../hero-votes/types"
import { sourceStatus } from "../hero-votes/HeroVotesPage"
import "../hero-votes/hero-votes.css"

type Listing = { items: AdminCampaign[]; preset: CampaignDraft }
function draftOf(item: AdminCampaign): CampaignDraft {
  return {
    title_ru: item.title_ru,
    title_en: item.title_en,
    candidates: item.candidates.map((hero) => ({ ...hero })),
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    providers: item.sources.filter((source) => source.enabled).map((source) => source.provider),
  }
}
function localDate(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function HeroVotesDesk({
  csrf,
  permissions,
}: {
  csrf: string
  permissions: string[]
}) {
  const { language, locale } = useLanguage(),
    ru = language === "ru"
  const canManage = permissions.includes("*") || permissions.includes("hero_votes.manage")
  const [listing, setListing] = useState<Listing | null>(null)
  const [selected, setSelected] = useState<AdminCampaign | null>(null)
  const [draft, setDraft] = useState<CampaignDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    void adminApi<Listing>("/api/admin/hero-votes", csrf, { signal: controller.signal })
      .then((data) => {
        setListing(data)
        const initial = data.items.find((item) => item.active) || data.items[0] || null
        setSelected(initial)
        setDraft(initial ? draftOf(initial) : structuredClone(data.preset))
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError((reason as Error).message)
      })
    return () => controller.abort()
  }, [csrf])
  const update = (values: Partial<CampaignDraft>) => {
    setDraft((old) => (old ? { ...old, ...values } : old))
    setDirty(true)
    setNotice("")
  }
  const updateHero = (index: number, value: Partial<Candidate>) => {
    if (draft)
      update({
        candidates: draft.candidates.map((hero, position) =>
          position === index ? { ...hero, ...value } : hero,
        ),
      })
  }
  const choose = (item: AdminCampaign | null) => {
    // Keep unsaved changes until the operator explicitly saves or discards them.
    if (
      dirty &&
      !window.confirm(ru ? "Отменить несохранённые изменения?" : "Discard unsaved changes?")
    )
      return
    setSelected(item)
    setDraft(item ? draftOf(item) : structuredClone(listing!.preset))
    setDirty(false)
    setError("")
    setNotice("")
  }
  const mutate = async (action?: "ACTIVATE" | "HIDE" | "END") => {
    if (!draft || !canManage || busy) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const url = action
        ? `/api/admin/hero-votes/${selected!.id}/actions`
        : selected
          ? `/api/admin/hero-votes/${selected.id}`
          : "/api/admin/hero-votes"
      const payload = action
        ? { action, expected_revision: selected!.revision }
        : { ...draft, ...(selected ? { expected_revision: selected.revision } : {}) }
      const response = await adminApi<{ item: AdminCampaign }>(url, csrf, {
        method: action || !selected ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      })
      setSelected(response.item)
      setDraft(draftOf(response.item))
      setDirty(false)
      setListing(await adminApi<Listing>("/api/admin/hero-votes", csrf))
      setNotice(ru ? "Изменения сохранены." : "Changes saved.")
      window.dispatchEvent(new Event("dc:hero-votes-changed"))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const status = (item: AdminCampaign) =>
    item.ended_at
      ? ru
        ? "Завершена"
        : "Ended"
      : item.live
        ? ru
          ? "Вкладка включена"
          : "Tab enabled"
        : item.active && item.visible
          ? ru
            ? "Ожидает начала / срок истёк"
            : "Scheduled / expired"
          : item.active
            ? ru
              ? "Вкладка скрыта"
              : "Tab hidden"
            : ru
              ? "Черновик / архив"
              : "Draft / archive"
  const hasData = Boolean(selected?.sources.some((source) => source.result))
  return (
    <section className="hv-page hv-desk">
      <header className="hv-desk-head">
        <div>
          <p className="ns-eyebrow">VOTE WATCH / {ru ? "УПРАВЛЕНИЕ" : "STAFF"}</p>
          <h2>{ru ? "Голосование за героев" : "Hero polls"}</h2>
        </div>
        {canManage && listing && (
          <button type="button" disabled={busy} onClick={() => choose(null)}>
            <Icon name="plus" size={16} /> {ru ? "Новая кампания" : "New campaign"}
          </button>
        )}
      </header>
      <p className="hv-scope">
        {ru
          ? "Включение показывает вкладку игрокам. Скрытие останавливает сбор данных. Завершённые кампании сохраняются в истории. Общих результатов Valve у этих источников нет."
          : "Activation shows the tab to players. Hiding it stops collection. Ended campaigns remain in history. These sources do not provide Valve’s global totals."}
      </p>
      {error && (
        <p className="hv-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="hv-change" role="status">
          {notice}
        </p>
      )}
      {!listing && !error && (
        <p role="status">{ru ? "Загрузка кампаний…" : "Loading campaigns…"}</p>
      )}
      {listing && (
        <div className="hv-desk-list" aria-label={ru ? "Кампании" : "Campaigns"}>
          {listing.items.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={busy}
              aria-pressed={selected?.id === item.id}
              onClick={() => choose(item)}
            >
              <b>{ru ? item.title_ru : item.title_en}</b>
              <small>
                {status(item)} · rev. {item.revision}
              </small>
            </button>
          ))}
        </div>
      )}
      {draft && (
        <form
          className="hv-editor"
          onSubmit={(event) => {
            event.preventDefault()
            void mutate()
          }}
        >
          <div className="hv-desk-head">
            <h3>
              {selected
                ? status(selected)
                : ru
                  ? "Новая кампания · черновик"
                  : "New campaign · draft"}
            </h3>
            {selected && <span className="hv-pill">rev. {selected.revision}</span>}
          </div>
          <div className="hv-fields">
            <label>
              {ru ? "Название · RU" : "Title · RU"}
              <input
                required
                minLength={3}
                maxLength={120}
                value={draft.title_ru}
                disabled={!canManage || busy}
                onChange={(event) => update({ title_ru: event.target.value })}
              />
            </label>
            <label>
              {ru ? "Название · EN" : "Title · EN"}
              <input
                required
                minLength={3}
                maxLength={120}
                value={draft.title_en}
                disabled={!canManage || busy}
                onChange={(event) => update({ title_en: event.target.value })}
              />
            </label>
            <label>
              {ru ? "Начало · местное время (необязательно)" : "Start · local time (optional)"}
              <input
                type="datetime-local"
                value={localDate(draft.starts_at)}
                disabled={!canManage || busy}
                onChange={(event) =>
                  update({
                    starts_at: event.target.value
                      ? new Date(event.target.value).toISOString()
                      : null,
                  })
                }
              />
            </label>
            <label>
              {ru ? "Завершение · местное время (необязательно)" : "End · local time (optional)"}
              <input
                type="datetime-local"
                value={localDate(draft.ends_at)}
                disabled={!canManage || busy}
                onChange={(event) =>
                  update({
                    ends_at: event.target.value ? new Date(event.target.value).toISOString() : null,
                  })
                }
              />
            </label>
          </div>
          <fieldset disabled={!canManage || busy}>
            <legend>{ru ? "Источники" : "Sources"}</legend>
            {["deadlock_labs", "statlocker"].map((provider) => (
              <label className="hv-check" key={provider}>
                <input
                  type="checkbox"
                  checked={draft.providers.includes(provider)}
                  onChange={(event) =>
                    update({
                      providers: event.target.checked
                        ? [...draft.providers, provider]
                        : draft.providers.filter((value) => value !== provider),
                    })
                  }
                />
                {provider === "deadlock_labs" ? "Deadlock Labs" : "Statlocker"}
              </label>
            ))}
            <p>
              {ru
                ? "Labs: публичный опрос, один голос в день. Statlocker: прогнозы, агрегаты требуют входа. Новая кампания не обнуляет счётчики внешнего сайта. Проверьте состав героев и соответствие опроса новой кампании."
                : "Labs: public poll, one vote a day. Statlocker: predictions; aggregates require sign-in. A new campaign does not reset external counters. Verify that the source poll and hero list match the new campaign."}
            </p>
          </fieldset>
          <fieldset disabled={!canManage || busy}>
            <legend>{ru ? "Герои" : "Heroes"}</legend>
            {hasData && (
              <p>
                {ru
                  ? "Состав со снимками зафиксирован. Для других героев создайте новую кампанию. Отметка «Вышел» исключает героя из гонки, сохраняя его голоса в общем итоге."
                  : "The hero list is fixed after observations arrive. Create a new campaign for different heroes. “Released” removes a hero from the race while keeping their votes in the total."}
              </p>
            )}
            {draft.candidates.map((hero, index) => (
              <div className="hv-candidate-edit" key={index}>
                <label>
                  ID
                  <input
                    required
                    type="number"
                    min={1}
                    max={100000}
                    disabled={hasData}
                    value={hero.hero_id || ""}
                    onChange={(event) => updateHero(index, { hero_id: Number(event.target.value) })}
                  />
                </label>
                <label>
                  RU
                  <input
                    required
                    maxLength={80}
                    value={hero.name_ru}
                    onChange={(event) => updateHero(index, { name_ru: event.target.value })}
                  />
                </label>
                <label>
                  EN
                  <input
                    required
                    maxLength={80}
                    value={hero.name_en}
                    onChange={(event) => updateHero(index, { name_en: event.target.value })}
                  />
                </label>
                <label className="hv-check">
                  <input
                    type="checkbox"
                    checked={hero.released}
                    onChange={(event) => updateHero(index, { released: event.target.checked })}
                  />
                  {ru ? "Вышел" : "Released"}
                </label>
                <button
                  type="button"
                  disabled={hasData || draft.candidates.length <= 2}
                  aria-label={`${ru ? "Удалить" : "Remove"} ${ru ? hero.name_ru : hero.name_en}`}
                  onClick={() =>
                    update({
                      candidates: draft.candidates.filter((_, position) => position !== index),
                    })
                  }
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            ))}
            {!hasData && (
              <button
                type="button"
                disabled={draft.candidates.length >= 12}
                onClick={() =>
                  update({
                    candidates: [
                      ...draft.candidates,
                      { hero_id: 0, name_ru: "", name_en: "", released: false },
                    ],
                  })
                }
              >
                {ru ? "Добавить героя" : "Add hero"}
              </button>
            )}
          </fieldset>
          {selected && (
            <div className="hv-sources">
              {selected.sources.map((source) => (
                <article key={source.provider}>
                  <h3>{source.name}</h3>
                  <p>{sourceStatus(source, ru)}</p>
                  <small>
                    {source.updated_at
                      ? `${ru ? "Снимок" : "Observed"}: ${new Date(source.updated_at).toLocaleString(locale)}`
                      : ru
                        ? "Нет сохранённых чисел"
                        : "No saved counts"}
                  </small>
                  <p>
                    {ru ? "Следующая попытка" : "Next attempt"}:{" "}
                    {new Date(source.next_refresh_at).toLocaleString(locale)}
                  </p>
                </article>
              ))}
            </div>
          )}
          {canManage && (
            <div className="hv-desk-actions">
              <button
                className="hv-primary"
                type="submit"
                disabled={busy || !draft.providers.length}
              >
                {busy
                  ? ru
                    ? "Сохраняем…"
                    : "Saving…"
                  : selected
                    ? ru
                      ? "Сохранить изменения"
                      : "Save changes"
                    : ru
                      ? "Создать черновик"
                      : "Create draft"}
              </button>
              {selected && (
                <>
                  <button
                    type="button"
                    disabled={busy || dirty}
                    title={dirty ? (ru ? "Сначала сохраните изменения" : "Save changes first") : ""}
                    onClick={() => void mutate(selected.visible ? "HIDE" : "ACTIVATE")}
                  >
                    {selected.visible
                      ? ru
                        ? "Скрыть вкладку"
                        : "Hide tab"
                      : ru
                        ? "Активировать вкладку"
                        : "Activate tab"}
                  </button>
                  {!selected.ended_at && (
                    <button
                      type="button"
                      disabled={busy || dirty}
                      onClick={() => void mutate("END")}
                    >
                      {ru ? "Завершить кампанию" : "End campaign"}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </form>
      )}
    </section>
  )
}
