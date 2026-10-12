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
      {rewards.data.source_quotas && (
        <>
          <h3>{ru ? "Другие источники монет" : "Other coin sources"}</h3>
          <p>
            {ru ? "Регулярный недельный максимум" : "Regular weekly maximum"}:{" "}
            {rewards.data.regular_weekly_maximum ?? 840}.{" "}
            {ru
              ? "Разовые награды учитываются отдельно. Сбросы показаны по местному времени."
              : "One-time rewards are separate. Resets use your local time."}
          </p>
          <dl className="bureau-callout-stats">
            {Object.entries(rewards.data.source_quotas).flatMap(([source, periods]) =>
              Object.entries(periods).map(
                ([period, quota]) =>
                  quota && (
                    <div key={`${source}:${period}`}>
                      <dt>
                        {
                          ({
                            PVE: ["Назначенный PvE", "Assigned PvE"],
                            DAILY: ["Активность", "Activity"],
                            WEEKLY: ["Недельный заказ", "Weekly commission"],
                            BUREAU: ["Операция бюро", "Bureau operation"],
                          }[source] || [source, source])[ru ? 0 : 1]
                        }{" "}
                        · {period === "daily" ? (ru ? "день" : "day") : ru ? "неделя" : "week"}
                      </dt>
                      <dd>
                        {quota.used} / {quota.limit} · {ru ? "Осталось" : "Remaining"}:{" "}
                        {quota.remaining}
                      </dd>
                      <small>
                        {ru ? "Сброс" : "Resets"}: {new Date(quota.reset_at).toLocaleString(locale)}
                      </small>
                    </div>
                  ),
              ),
            )}
          </dl>
        </>
      )}
      {rewards.data.progress && (
        <section>
          <h3>{ru ? "Прогресс наград" : "Reward progress"}</h3>
          <p>
            {ru
              ? "Недельный заказ: 5 контрактов или 10 наградных PvE-побед; 60 монет один раз."
              : "Weekly commission: 5 contracts or 10 reward-eligible PvE wins; 60 coins once."}
          </p>
          <p>
            {rewards.data.progress.weekly_contracts} / 5 {ru ? "контрактов" : "contracts"} ·{" "}
            {rewards.data.progress.weekly_pve_wins} / 10 PvE
          </p>
          <p>
            {ru ? "Проверенных контрактов всего" : "Total verified contracts"}:{" "}
            {rewards.data.progress.confirmed_contracts} ·{" "}
            {ru ? "Разовые рубежи" : "One-time milestones"}: 10 → 50, 50 → 100, 100 → 150{" "}
            {ru ? "монет" : "coins"}.
          </p>
          <p>
            {ru
              ? "Активность: 10 монет за первый подходящий контракт, шифр или наградную PvE-победу за день. Вход сам по себе не считается. Обучающий маршрут: 60 монет один раз после обучения и первого нормального боя."
              : "Activity: 10 coins for the first qualifying contract, cipher or reward-eligible PvE win that day. Login alone does not count. Tutorial route: 60 coins once after training and the first normal battle."}
          </p>
        </section>
      )}
      <h3>{ru ? "Квитанции наград" : "Reward receipts"}</h3>
      <ul className="archive-ledger archive-coin-receipts">
        {rewards.data.receipts.map((reward) => (
          <li key={reward.id || `${reward.source_type}:${reward.source_id}`}>
            <span>
              {
                ({
                  case: ["Бонус дела", "Case bonus"],
                  assignment: ["Контракт", "Contract"],
                  pve: ["Победа PvE", "PvE win"],
                  daily: ["Активность", "Activity"],
                  weekly: ["Недельный заказ", "Weekly commission"],
                  tutorial: ["Обучающий маршрут", "Tutorial route"],
                  milestone: ["Рубеж контрактов", "Contract milestone"],
                  bureau: ["Операция бюро", "Bureau operation"],
                }[reward.source_type] || [reward.source_type, reward.source_type])[ru ? 0 : 1]
              }{" "}
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
