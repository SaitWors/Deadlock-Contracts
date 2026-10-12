import { useResource } from "../community/api"
import { useEffect } from "react"
import { useLanguage } from "../i18n"
import CoinRewardReceipt from "./CoinRewardReceipt"
import type { CoinRewardStatus } from "./types"

export default function CoinRewards() {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const rewards = useResource<CoinRewardStatus>("/api/archive/coin-rewards")
  useEffect(() => {
    const refresh = () => rewards.reload()
    window.addEventListener("dc-archive-wallet", refresh)
    return () => window.removeEventListener("dc-archive-wallet", refresh)
  }, [])
  if (rewards.error)
    return (
      <p role="alert">
        {rewards.error} <button onClick={rewards.reload}>{ru ? "Повторить" : "Retry"}</button>
      </p>
    )
  if (!rewards.data?.quotas)
    return <p role="status">{ru ? "Загружаем награды контрактов…" : "Loading contract rewards…"}</p>
  return (
    <section className="archive-panel">
      <h2>{ru ? "Монеты за контракты" : "Contract coins"}</h2>
      {!rewards.data.enabled && (
        <p role="status">
          {ru
            ? "Выдача монет приостановлена. Подтверждённые награды сохраняются в очереди."
            : "Coin delivery is paused. Confirmed rewards stay queued."}
        </p>
      )}
      <p>
        {ru
          ? "Подтверждённые контракты и бонус дела используют общий лимит: 80 в день и 400 в неделю. Шифры учитываются отдельно."
          : "Verified contracts and case bonuses share a limit of 80 per day and 400 per week. Ciphers have a separate limit."}
      </p>
      <dl className="bureau-callout-stats">
        {(["daily", "weekly"] as const).map((period) => {
          const quota = rewards.data!.quotas[period]
          return (
            <div key={period}>
              <dt>
                {period === "daily" ? (ru ? "За день" : "Today") : ru ? "За неделю" : "This week"}
              </dt>
              <dd>
                {quota.used} / {quota.limit} · {ru ? "Осталось" : "Remaining"}: {quota.remaining}
              </dd>
              <small>
                {ru ? "Сброс" : "Resets"}: {new Date(quota.reset_at).toLocaleString(locale)}
              </small>
            </div>
          )
        })}
      </dl>
      <h3>{ru ? "Квитанции наград" : "Reward receipts"}</h3>
      <ul className="archive-ledger archive-coin-receipts">
        {rewards.data.receipts.map((reward) => (
          <li key={reward.id || `${reward.source_type}:${reward.source_id}`}>
            <span>
              {reward.source_type === "case"
                ? ru
                  ? "Бонус дела"
                  : "Case bonus"
                : ru
                  ? "Контракт"
                  : "Contract"}{" "}
              · {reward.source_id}
              {reward.created_at && (
                <small> · {new Date(reward.created_at).toLocaleString(locale)}</small>
              )}
            </span>
            <CoinRewardReceipt reward={reward} />
          </li>
        ))}
      </ul>
      {!rewards.data.receipts.length && (
        <p>
          {ru
            ? "Квитанции появятся после проверки новых контрактов."
            : "Receipts appear after new contracts are verified."}
        </p>
      )}
    </section>
  )
}
