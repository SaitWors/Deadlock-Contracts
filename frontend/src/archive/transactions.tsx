import Icon from "../icons/Icon"
import { useEffect, useRef, useState } from "react"
import { ApiError, request } from "../community/api"
import { useLanguage } from "../i18n"
import CardPreview from "./CardPreview"
import PackReveal from "./PackReveal"
import type { Receipt } from "./types"

type Pending = { url: string; body: Record<string, unknown> & { request_key: string } }
const EVENT = "dc-archive-pending"

export function useTransaction(csrf: string, accountKey: string, onChanged: () => void) {
  const storageKey = `dc-archive-request:${accountKey}`
  const read = (): Pending | null => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || "null")
    } catch {
      return null
    }
  }
  const [pending, setPending] = useState<Pending | null>(read)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  useEffect(() => {
    const refresh = () => setPending(read())
    refresh()
    window.addEventListener(EVENT, refresh)
    return () => window.removeEventListener(EVENT, refresh)
  }, [storageKey])
  const save = (value: Pending | null) => {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value))
    else sessionStorage.removeItem(storageKey)
    setPending(value)
    window.dispatchEvent(new Event(EVENT))
  }
  const completed = (value: Receipt) => {
    save(null)
    setReceipt(value)
    setError("")
    onChanged()
  }
  const run = async (value: Pending) => {
    setBusy(true)
    setError("")
    setReceipt(null)
    try {
      completed(
        await request<Receipt>(value.url, csrf, {
          method: "POST",
          body: JSON.stringify(value.body),
        }),
      )
    } catch (reason) {
      // Domain failures roll back before returning. Network/5xx failures retain the exact key.
      if (reason instanceof ApiError && [400, 404, 409, 422].includes(reason.status)) save(null)
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const execute = async (url: string, body: Record<string, unknown> = {}) => {
    if (busy || read()) return
    const value = { url, body: { ...body, request_key: crypto.randomUUID() } }
    try {
      save(value)
    } catch {
      setError("Разрешите хранение данных этой вкладки / Enable session storage")
      return
    }
    await run(value)
  }
  const recover = async () => {
    if (!pending || busy) return
    setBusy(true)
    setError("")
    try {
      const result = await request<{ operation: Receipt | null }>(
        `/api/archive/requests/${pending.body.request_key}`,
      )
      if (result.operation) completed(result.operation)
      else
        setError("Результат пока не найден. Повторите сохранённый запрос / Retry the saved request")
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return {
    pending,
    busy,
    error,
    receipt,
    execute,
    recover,
    retry: () => pending && run(pending),
    clearReceipt: () => setReceipt(null),
  }
}

export function TransactionStatus({
  transaction,
}: {
  transaction: ReturnType<typeof useTransaction>
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  return (
    <>
      {transaction.error && <p role="alert">{transaction.error}</p>}
      {transaction.pending && (
        <div className="archive-pending" role="status">
          <p>
            {ru
              ? "Запрос сохранён. При обрыве связи повтор вернёт тот же результат."
              : "Request saved. Retrying after a connection error returns the same result."}
          </p>
          <div className="archive-actions">
            <button disabled={transaction.busy} onClick={() => void transaction.recover()}>
              {ru ? "Проверить результат" : "Check result"}
            </button>
            <button disabled={transaction.busy} onClick={() => void transaction.retry()}>
              {ru ? "Повторить запрос" : "Retry request"}
            </button>
          </div>
        </div>
      )}
      {transaction.receipt && (
        <ReceiptView receipt={transaction.receipt} cinematic onClose={transaction.clearReceipt} />
      )}
    </>
  )
}

export function ReceiptView({
  receipt,
  onClose,
  cinematic = false,
}: {
  receipt: Receipt
  onClose?: () => void
  cinematic?: boolean
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const useCinematic = cinematic && ["PACK_OPEN", "STARTER_PACK"].includes(receipt.kind)
  const result = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!cinematic) return
    result.current?.focus({ preventScroll: true })
    result.current?.scrollIntoView?.({ block: "start", behavior: "instant" })
  }, [receipt.id, cinematic])
  return (
    <section
      ref={result}
      tabIndex={cinematic ? -1 : undefined}
      className="archive-receipt"
      aria-label={ru ? "Результат операции" : "Transaction result"}
    >
      <header>
        <h2>{receipt.pack?.title || (ru ? "Запись архива" : "Archive receipt")}</h2>
        {onClose && <button onClick={onClose}>{ru ? "Закрыть результат" : "Close result"}</button>}
      </header>
      <p>
        {new Date(receipt.created_at).toLocaleString(locale)} · {receipt.delta > 0 ? "+" : ""}
        {receipt.delta} <Icon name="coins" size={18} /> ·{" "}
        {ru ? "Баланс после операции" : "Balance after transaction"}: {receipt.balance_after}{" "}
        <Icon name="coins" size={18} />
      </p>
      {useCinematic ? (
        <PackReveal key={receipt.id} receipt={receipt} />
      ) : (
        <div className="archive-grid archive-revealed">
          {receipt.items.map((item) => (
            <article key={item.id}>
              <CardPreview card={item.card} />
              <p>
                {item.duplicate ? (ru ? "Дубль" : "Duplicate") : ru ? "Новая карточка" : "New card"}
                {item.test_grant ? (ru ? " · Тестовая выдача OWNER" : " · OWNER test grant") : ""}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
