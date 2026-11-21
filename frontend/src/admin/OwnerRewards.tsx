import { useEffect, useRef, useState, type FormEvent } from "react"
import type { Card, Pack } from "../archive/types"
import { useResource } from "../community/api"
import { useLanguage } from "../i18n"
import { adminApi, AdminApiError } from "./admin-api"

type Kind = "xp" | "cards" | "packs"
type Choice = { id: string; revision: number; label: string }
type Grant = {
  kind: Kind
  item: Choice | null
  quantity: number
  reason: string
  request_key: string
}

function RewardCatalog({
  kind,
  choice,
  onPick,
}: {
  kind: "cards" | "packs"
  choice: Choice | null
  onPick: (choice: Choice | null) => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const isCard = kind === "cards"
  const pageSize = isCard ? 18 : 8
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const catalog = useResource<{ items: (Card | Pack)[]; total: number }>(
    isCard
      ? `/api/archive/cards?q=${encodeURIComponent(search)}&offset=${offset}`
      : `/api/owner/archive/packs?offset=${offset}`,
  )
  const choices = (catalog.data?.items ?? []).flatMap((item): Choice[] => {
    if ("hero_name" in item) {
      return item.image_url
        ? [{ id: item.id, revision: item.revision, label: `${item.title} · ${item.rank}` }]
        : []
    }
    return item.active && item.ready
      ? [{ id: item.id, revision: item.revision, label: item.title }]
      : []
  })
  const applySearch = () => {
    setSearch(query.trim())
    setOffset(0)
    catalog.reload()
  }

  return (
    <div className="dc-admin-reward-catalog">
      {isCard && (
        <div className="archive-actions">
          <label>
            {ru ? "Поиск карточки" : "Search cards"}
            <input
              maxLength={80}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  applySearch()
                }
              }}
            />
          </label>
          <button type="button" className="dc-ghost" onClick={applySearch}>
            {ru ? "Найти" : "Search"}
          </button>
        </div>
      )}
      <label>
        {isCard ? (ru ? "Карточка" : "Card") : ru ? "Конверт" : "Pack"}
        <select
          value={choice?.id || ""}
          disabled={catalog.loading}
          onChange={(event) =>
            onPick(choices.find((item) => item.id === event.target.value) ?? null)
          }
        >
          <option value="">{ru ? "Выбрать" : "Choose"}</option>
          {choice && !choices.some((item) => item.id === choice.id) && (
            <option value={choice.id}>{choice.label}</option>
          )}
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {catalog.loading && <p role="status">{ru ? "Загрузка…" : "Loading…"}</p>}
      {catalog.error && <p role="alert">{catalog.error}</p>}
      {catalog.data && !choices.length && (
        <p>
          {ru ? "На этой странице нет доступных наград." : "No rewards are available on this page."}
        </p>
      )}
      <div className="archive-actions">
        <button
          type="button"
          className="dc-ghost"
          onClick={() => {
            onPick(null)
            catalog.reload()
          }}
        >
          {ru ? "Обновить список" : "Refresh list"}
        </button>
        {catalog.data && catalog.data.total > pageSize && (
          <>
            <button
              type="button"
              className="dc-ghost"
              disabled={!offset}
              onClick={() => setOffset(offset - pageSize)}
            >
              {ru ? "Назад" : "Previous"}
            </button>
            <button
              type="button"
              className="dc-ghost"
              disabled={offset + pageSize >= catalog.data.total}
              onClick={() => setOffset(offset + pageSize)}
            >
              {ru ? "Далее" : "Next"}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function OwnerRewards({
  actorId,
  recipient,
  csrf,
  onGranted,
}: {
  actorId: string
  recipient: { id: string; display_name: string; status: string }
  csrf: string
  onGranted: (balance?: number) => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const storageKey = `dc-owner-reward:${actorId}:${recipient.id}`
  const [pending, setPending] = useState<Grant | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || "null")
    } catch {
      return null
    }
  })
  const [kind, setKind] = useState<Kind>(pending?.kind ?? "xp")
  const [expanded, setExpanded] = useState(!!pending)
  const [choice, setChoice] = useState<Choice | null>(pending?.item ?? null)
  const [quantity, setQuantity] = useState(String(pending?.quantity ?? 100))
  const [reason, setReason] = useState(pending?.reason ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const flight = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      flight.current?.abort()
      flight.current = null
    },
    [],
  )

  const save = (grant: Grant | null) => {
    setPending(grant)
    try {
      if (grant) sessionStorage.setItem(storageKey, JSON.stringify(grant))
      else sessionStorage.removeItem(storageKey)
    } catch {
      // The current view can still retry the original key.
    }
  }
  const send = async (grant: Grant) => {
    if (flight.current) return
    const controller = new AbortController()
    flight.current = controller
    const timer = window.setTimeout(() => controller.abort(), 15000)
    save(grant)
    setBusy(true)
    setError("")
    try {
      const base = `/api/admin/users/${recipient.id}`
      const xp = grant.kind === "xp"
      const path = xp
        ? `${base}/xp-adjust`
        : `${base}/rewards/${grant.kind === "packs" ? "packs" : "cards"}/${encodeURIComponent(grant.item?.id ?? "")}`
      const { balance } = await adminApi<{ balance?: number }>(path, csrf, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          request_key: grant.request_key,
          reason: grant.reason,
          ...(xp
            ? { delta: grant.quantity }
            : { quantity: grant.quantity, revision: grant.item?.revision }),
        }),
      })
      if (flight.current !== controller) return
      save(null)
      setReason("")
      onGranted(balance)
    } catch (errorValue) {
      if (flight.current !== controller) return
      if (errorValue instanceof AdminApiError && [400, 404, 409, 422].includes(errorValue.status))
        save(null)
      setError(
        controller.signal.aborted
          ? ru
            ? "Истекло время ожидания. Повтори сохранённый запрос."
            : "The request timed out. Retry the saved request."
          : (errorValue as Error).message,
      )
    } finally {
      window.clearTimeout(timer)
      if (flight.current === controller) {
        flight.current = null
        setBusy(false)
      }
    }
  }

  const amount = Number(quantity)
  const min = kind === "xp" ? -100000 : 1
  const max = kind === "xp" ? 100000 : kind === "cards" ? 100 : 10
  const valid =
    Number.isInteger(amount) &&
    amount !== 0 &&
    amount >= min &&
    amount <= max &&
    reason.trim().length >= 3 &&
    (kind === "xp" || choice !== null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy || pending || !valid) return
    const reward = kind === "xp" ? `${amount} XP` : `${choice?.label} × ${amount}`
    if (
      !window.confirm(
        ru
          ? `Применить к игроку ${recipient.display_name} — ${reward}?`
          : `Apply ${reward} to ${recipient.display_name}?`,
      )
    )
      return
    void send({
      kind,
      item: choice,
      quantity: amount,
      reason: reason.trim(),
      request_key: crypto.randomUUID(),
    })
  }

  return (
    <details
      className="dc-admin-identity-editor dc-admin-rewards"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>{ru ? "Ручная выдача наград" : "Manual rewards"}</summary>
      <form onSubmit={submit}>
        <fieldset disabled={busy || !!pending}>
          <div className="dc-admin-form-grid">
            <label>
              {ru ? "Награда" : "Reward"}
              <select
                value={kind}
                onChange={(event) => {
                  const next = event.target.value as Kind
                  setKind(next)
                  setChoice(null)
                  setQuantity(next === "xp" ? "100" : "1")
                }}
              >
                <option value="xp">XP</option>
                <option value="cards" disabled={recipient.status !== "ACTIVE"}>
                  {ru ? "Карточки" : "Cards"}
                </option>
                <option value="packs" disabled={recipient.status !== "ACTIVE"}>
                  {ru ? "Подарочные конверты" : "Gift packs"}
                </option>
              </select>
            </label>
            <label>
              {kind === "xp"
                ? ru
                  ? "Изменение XP"
                  : "XP adjustment"
                : ru
                  ? "Количество"
                  : "Quantity"}
              <input
                type="number"
                required
                min={min}
                max={max}
                step={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
          </div>
          {kind !== "xp" && (
            <RewardCatalog key={kind} kind={kind} choice={choice} onPick={setChoice} />
          )}
          <label>
            {ru ? "Причина выдачи" : "Reason"}
            <input
              required
              minLength={3}
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button type="submit" className="dc-primary" disabled={!valid}>
            {ru ? "Подтвердить выдачу" : "Confirm grant"}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {pending && (
        <button
          type="button"
          className="dc-ghost"
          disabled={busy}
          onClick={() => void send(pending)}
        >
          {busy
            ? ru
              ? "Отправляем…"
              : "Sending…"
            : ru
              ? "Повторить сохранённую выдачу"
              : "Retry saved grant"}
        </button>
      )}
    </details>
  )
}
