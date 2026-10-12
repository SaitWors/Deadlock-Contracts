import { useLanguage } from "../i18n"
import type { CoinReward } from "./types"
import "./coin-rewards.css"

function coinReason(reason: string, ru: boolean) {
  return ({
    AWARDED: ["Награда подтверждена", "Reward confirmed"],
    PENDING: ["Ожидается решение о награде", "Reward decision pending"],
    DAILY_LIMIT: ["Дневной лимит", "Daily limit"],
    WEEKLY_LIMIT: ["Недельный лимит", "Weekly limit"],
    NO_SIGNED_POLICY: ["До запуска монет", "Before coin rewards launched"],
    NOT_COMPLETED: ["Контракт не выполнен", "Contract not completed"],
    UNTRUSTED_RESULT: ["Нет подтверждённого результата", "No verified result"],
    MISSING_MATCH_TIME: ["Не установлено время матча", "Match time unavailable"],
    OUTSIDE_ATTEMPT_WINDOW: ["Матч вне срока контракта", "Match outside contract window"],
    RESULT_CHANGED: ["Результат изменён", "Result changed"],
  }[reason] || [reason, reason])[ru ? 0 : 1]
}

export default function CoinRewardReceipt({ reward }: { reward: CoinReward }) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const pending = ["PENDING", "RESERVED"].includes(reward.status)
  const cancelled = ["INVALIDATED", "CORRECTED"].includes(reward.status)
  const label = pending
    ? ru
      ? "В очереди"
      : "Pending"
    : reward.status === "REJECTED"
      ? ru
        ? "Без награды монетами"
        : "No coin reward"
      : reward.status === "CORRECTED"
        ? ru
          ? "Исправлено"
          : "Corrected"
        : reward.status === "INVALIDATED"
          ? ru
            ? "Отменено"
            : "Cancelled"
          : ""
  return (
    <span className="archive-coin-reward">
      {label && <b>{label} · </b>}
      {cancelled && <span>{ru ? "Исходная сумма" : "Original amount"}: </span>}
      <b>
        {!label && reward.amount > 0 ? "+" : ""}
        {reward.amount} {ru ? "монет" : "coins"}
      </b>
      {reward.amount !== reward.nominal_amount && (
        <span>
          {" "}
          / {reward.nominal_amount} {ru ? "до лимита" : "before limit"}
        </span>
      )}
      <small> · {coinReason(reward.reason, ru)}</small>
    </span>
  )
}
