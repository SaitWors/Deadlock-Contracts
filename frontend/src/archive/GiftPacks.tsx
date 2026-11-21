import { useEffect } from "react"
import { useResource } from "../community/api"
import { useLanguage } from "../i18n"
import type { FavoriteControls } from "./favorites"
import { TransactionStatus, useTransaction } from "./transactions"

type Gift = { id: string; title: string; remaining: number; draws: number; active: boolean }

export default function GiftPacks({
  accountKey,
  csrf,
  favorites,
  onOpened,
}: {
  accountKey: string
  csrf: string
  favorites: FavoriteControls
  onOpened: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const gifts = useResource<{ items: Gift[] }>("/api/archive/gift-packs")
  const reloadGifts = gifts.reload
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") reloadGifts()
    }
    window.addEventListener("focus", onVisible)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("focus", onVisible)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [reloadGifts])
  const transaction = useTransaction(
    csrf,
    `${accountKey}:gift-packs`,
    () => {
      reloadGifts()
      onOpened()
    },
    { allowWithoutStorage: true },
  )
  if (!gifts.data?.items.length && !gifts.error && !transaction.pending && !transaction.receipt)
    return null

  return (
    <section className="archive-receipt" aria-labelledby="gift-packs-title">
      <header>
        <h2 id="gift-packs-title">{ru ? "Подарочные конверты" : "Gift packs"}</h2>
        <button type="button" disabled={gifts.loading || transaction.busy} onClick={gifts.reload}>
          {ru ? "Обновить" : "Refresh"}
        </button>
      </header>
      {gifts.error && <p role="alert">{gifts.error}</p>}
      {gifts.data?.items.map((gift) => (
        <div key={gift.id} className="archive-actions">
          <p>
            <strong>{gift.title}</strong>{" "}
            {ru
              ? `· ${gift.remaining} шт. · ${gift.draws} карт в каждом`
              : `· ${gift.remaining} left · ${gift.draws} cards each`}
          </p>
          <button
            type="button"
            className="archive-primary"
            disabled={!gift.active || transaction.busy || !!transaction.pending}
            onClick={() =>
              void transaction.execute(`/api/archive/gift-packs/${gift.id}/open`, {
                remaining: gift.remaining,
              })
            }
          >
            {gift.active ? (ru ? "Открыть подарок" : "Open gift") : ru ? "Приостановлен" : "Paused"}
          </button>
        </div>
      ))}
      <TransactionStatus transaction={transaction} favorites={favorites} />
    </section>
  )
}
