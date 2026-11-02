import { useCallback, useEffect, useRef, useState } from "react"
import Icon from "../icons/Icon"
import { request } from "../community/api"
import { useLanguage } from "../i18n"
import PackReveal from "./PackReveal"
import type { FavoriteControls } from "./favorites"
import type { Pack, Receipt } from "./types"

type DailyStatus = {
  available: boolean
  next_reset_at: string
  claimed_at: string | null
  operation_id: string | null
  pack: Pack | null
}
const storageName = (account: string) => `dc-daily-pack:${account}`
function savedKey(account: string) {
  try {
    return sessionStorage.getItem(storageName(account)) || ""
  } catch {
    return ""
  }
}
function saveKey(account: string, key: string) {
  try {
    if (key) sessionStorage.setItem(storageName(account), key)
    else sessionStorage.removeItem(storageName(account))
  } catch {
    /* Claims remain idempotent on the server when storage is blocked. */
  }
}
function countdown(reset: string, clock: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(reset) - clock) / 1000))
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":")
}

const REQUEST_DEADLINE_MS = 15_000
function isDeadlineError(reason: unknown): reason is Error {
  return reason instanceof Error && reason.name === "TimeoutError"
}
async function dailyRequest<T>(
  url: string,
  csrf: string,
  init: RequestInit,
  controller: AbortController,
  timeoutMessage: string,
): Promise<T> {
  const timeout = new Error(timeoutMessage)
  timeout.name = "TimeoutError"
  let onAbort = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason || new Error("Request cancelled"))
    controller.signal.addEventListener("abort", onAbort, { once: true })
  })
  const timer = window.setTimeout(() => controller.abort(timeout), REQUEST_DEADLINE_MS)
  try {
    return await Promise.race([
      request<T>(url, csrf, { ...init, signal: controller.signal }),
      aborted,
    ])
  } finally {
    window.clearTimeout(timer)
    controller.signal.removeEventListener("abort", onAbort)
  }
}

export default function DailyPack({
  accountKey,
  csrf,
  favorites,
  onClaimed,
}: {
  accountKey: string
  csrf: string
  favorites: FavoriteControls
  onClaimed: () => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const [status, setStatus] = useState<DailyStatus | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [pending, setPending] = useState(() => savedKey(accountKey))
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [clock, setClock] = useState(Date.now())
  const currentAccount = useRef(accountKey)
  currentAccount.current = accountKey
  const claimFlight = useRef<AbortController | null>(null)
  const statusFlight = useRef<AbortController | null>(null)
  const onClaimedRef = useRef(onClaimed)
  onClaimedRef.current = onClaimed
  const refresh = useCallback(async () => {
    statusFlight.current?.abort()
    const controller = new AbortController()
    statusFlight.current = controller
    setLoading(true)
    try {
      const result = await dailyRequest<DailyStatus>(
        "/api/archive/daily-pack?scope=REAL",
        "",
        {},
        controller,
        language === "ru"
          ? "Проверка доступности заняла слишком много времени. Повтори запрос."
          : "Availability request timed out. Retry the request.",
      )
      if (controller.signal.aborted || currentAccount.current !== accountKey) return
      setStatus(result)
      setError("")
    } catch (reason) {
      if (
        (!controller.signal.aborted || isDeadlineError(reason)) &&
        currentAccount.current === accountKey
      )
        setError((reason as Error).message)
    } finally {
      if (statusFlight.current === controller && currentAccount.current === accountKey)
        setLoading(false)
    }
  }, [accountKey, language])
  useEffect(() => {
    setStatus(null)
    setReceipt(null)
    setPending(savedKey(accountKey))
    setBusy(false)
    setError("")
    if (accountKey) void refresh()
    return () => {
      statusFlight.current?.abort()
      statusFlight.current = null
      claimFlight.current?.abort()
      claimFlight.current = null
    }
  }, [accountKey, refresh])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    const visible = () => {
      if (document.visibilityState === "visible" && accountKey) void refresh()
    }
    window.addEventListener("focus", visible)
    document.addEventListener("visibilitychange", visible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", visible)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [refresh, accountKey])
  useEffect(() => {
    if (!status?.next_reset_at) return
    const delay = Math.max(0, Date.parse(status.next_reset_at) - Date.now())
    // Avoid zero-delay loops if a cached response still reports the old day.
    const timer = window.setTimeout(
      () => void refresh(),
      Math.min(2147483647, Math.max(1000, delay + 100)),
    )
    return () => window.clearTimeout(timer)
  }, [status, refresh])
  const claim = async () => {
    if (
      !accountKey ||
      claimFlight.current ||
      (!pending && !status?.available && !status?.claimed_at)
    )
      return
    const controller = new AbortController()
    claimFlight.current = controller
    const key = pending || crypto.randomUUID()
    saveKey(accountKey, key)
    setPending(key)
    setBusy(true)
    setError("")
    try {
      const result = await dailyRequest<Receipt>(
        "/api/archive/daily-pack/claim",
        csrf,
        {
          method: "POST",
          body: JSON.stringify({ scope: "REAL", idempotency_key: key }),
        },
        controller,
        ru
          ? "Получение конверта заняло слишком много времени. Повтори сохранённый запрос."
          : "Your claim timed out. Retry the saved request.",
      )
      if (controller.signal.aborted || currentAccount.current !== accountKey) return
      saveKey(accountKey, "")
      setPending("")
      setReceipt(result)
      onClaimedRef.current()
      void refresh()
    } catch (reason) {
      if (
        (!controller.signal.aborted || isDeadlineError(reason)) &&
        currentAccount.current === accountKey
      )
        setError((reason as Error).message)
    } finally {
      if (claimFlight.current === controller) {
        claimFlight.current = null
        if (currentAccount.current === accountKey) setBusy(false)
      }
    }
  }
  return (
    <section className="ritual-daily-pack" aria-labelledby="daily-pack-title">
      <div className="ritual-pack-art" aria-hidden="true">
        <Icon name="mail" size={72} />
        <span>
          DEADLOCK
          <br />
          CONTRACTS
        </span>
        <i>DC</i>
      </div>
      <div className="ritual-pack-copy">
        <small>{ru ? "ОДИН КОНВЕРТ КАЖДЫЙ ДЕНЬ · UTC" : "ONE PACK EACH DAY · UTC"}</small>
        <h2 id="daily-pack-title">
          {status?.pack?.title || (ru ? "Ежедневный конверт" : "Daily pack")}
        </h2>
        {loading && !status && (
          <p role="status">{ru ? "Проверяем доступность…" : "Checking availability…"}</p>
        )}
        {status && (
          <>
            <p>
              {status.claimed_at
                ? ru
                  ? "Сегодняшний конверт уже в коллекции. Возвращайся завтра."
                  : "Today's pack is in your collection. Come back tomorrow."
                : status.available
                  ? ru
                    ? `Открой бесплатно. Карточек внутри: ${status.pack?.draws ?? "—"}.`
                    : `Open it for free. Cards inside: ${status.pack?.draws ?? "—"}.`
                  : ru
                    ? "Конверт пока недоступен. Попробуй обновить статус позже."
                    : "The daily pack is currently unavailable. Try refreshing its status later."}
            </p>
            <div className="ritual-pack-reset">
              <span>{ru ? "Новый конверт через" : "Next pack in"}</span>
              <strong aria-label={ru ? "До следующего сброса" : "Time to next reset"}>
                {countdown(status.next_reset_at, clock)}
              </strong>
              <time dateTime={status.next_reset_at}>
                {new Date(status.next_reset_at).toLocaleString(locale, {
                  timeZone: "UTC",
                  timeZoneName: "short",
                })}
              </time>
            </div>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {pending && !busy && (
          <p>
            {ru
              ? "Запрос сохранён. Повтор вернёт тот же результат."
              : "Your claim is saved. Retrying returns the same result."}
          </p>
        )}
        <div className="archive-actions">
          {(status?.available || pending || (status?.claimed_at && !receipt)) && (
            <button
              className="archive-primary"
              disabled={busy || !accountKey || loading}
              onClick={() => void claim()}
            >
              {busy
                ? ru
                  ? "Получаем…"
                  : "Claiming…"
                : pending
                  ? ru
                    ? "Повторить получение"
                    : "Retry claim"
                  : status?.claimed_at
                    ? ru
                      ? "Показать сегодняшний конверт"
                      : "Show today's pack"
                    : ru
                      ? "Получить ежедневный конверт"
                      : "Claim daily pack"}
            </button>
          )}
          <button disabled={busy || loading || !accountKey} onClick={() => void refresh()}>
            {ru ? "Обновить статус" : "Refresh status"}
          </button>
        </div>
        {receipt && (
          <div className="ritual-daily-receipt" role="status">
            <p>{ru ? "Карточки сохранены в коллекции." : "Cards saved to your collection."}</p>
            <PackReveal key={receipt.id} receipt={receipt} favorites={favorites} />
          </div>
        )}
      </div>
    </section>
  )
}
