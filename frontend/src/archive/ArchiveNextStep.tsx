import { useResource } from "../community/api"
import { useLanguage } from "../i18n"
import type { Wallet } from "./types"
import "./archive-next-step.css"

type Destination = "archive" | "collection" | "bureaus"

export default function ArchiveNextStep({
  revision,
  onNavigate,
}: {
  revision: number
  onNavigate: (destination: Destination) => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const wallet = useResource<Wallet>(`/api/archive/wallet?view=${revision}`)
  const data = wallet.data
  const open = data?.round?.status === "OPEN"
  const eligible = Boolean(data && data.completed < data.weekly_limit)
  const exhausted = Boolean(data && !open && !eligible)
  const mainDestination: Destination = exhausted ? "collection" : "archive"
  const mainLabel = open
    ? ru
      ? "Продолжить шифр"
      : "Continue cipher"
    : exhausted
      ? ru
        ? "Открыть коллекцию"
        : "Open collection"
      : ru
        ? "Разобрать шифр"
        : "Decode a cipher"

  return (
    <section className="dc-home-archive-callout" aria-labelledby="archive-next-title">
      <div>
        <span className="bureau-callout-label">
          {ru ? "ДОСТУПНО В БРАУЗЕРЕ" : "AVAILABLE IN YOUR BROWSER"}
        </span>
        <strong id="archive-next-title">{ru ? "Сегодня в бюро" : "Today at the bureau"}</strong>
        {wallet.loading && (
          <p role="status">{ru ? "Загружаем состояние архива…" : "Loading archive status…"}</p>
        )}
        {!wallet.loading && wallet.error && (
          <div role="alert">
            <p>
              {ru ? "Не удалось загрузить состояние архива." : "Could not load archive status."}
            </p>
            <button type="button" className="bureau-callout-link" onClick={wallet.reload}>
              {ru ? "Повторить" : "Retry"}
            </button>
          </div>
        )}
        {data && (
          <>
            <p>
              {open
                ? ru
                  ? "У вас есть незавершённый шифр. Продолжите с сохранённой попытки."
                  : "You have an unfinished cipher. Continue from your saved attempt."
                : eligible
                  ? ru
                    ? "Разберите новый шифр и получите награду архива."
                    : "Decode a new cipher and earn its archive reward."
                  : ru
                    ? `Недельный лимит выполнен. Новые задания появятся ${new Date(data.reset_at).toLocaleString(locale)}.`
                    : `Your weekly limit is complete. New tasks arrive ${new Date(data.reset_at).toLocaleString(locale)}.`}
            </p>
            <dl className="bureau-callout-stats">
              <div>
                <dt>{ru ? "Баланс" : "Balance"}</dt>
                <dd>
                  {data.balance} {ru ? "жет." : "tokens"}
                </dd>
              </div>
              <div>
                <dt>{ru ? "Награда за шифр" : "Reward per cipher"}</dt>
                <dd>
                  +{data.reward} {ru ? "жет." : "tokens"}
                </dd>
              </div>
              <div>
                <dt>{ru ? "На этой неделе" : "This week"}</dt>
                <dd>
                  {data.completed} / {data.weekly_limit}
                </dd>
              </div>
            </dl>
          </>
        )}
      </div>
      <div className="bureau-callout-actions">
        {data && (
          <button
            className="bureau-action"
            type="button"
            onClick={() => onNavigate(mainDestination)}
          >
            {mainLabel}
          </button>
        )}
        <button
          className="bureau-action bureau-action-secondary"
          type="button"
          onClick={() => onNavigate("collection")}
        >
          {ru ? "Моя коллекция" : "My collection"}
        </button>
        <button className="bureau-callout-link" type="button" onClick={() => onNavigate("bureaus")}>
          {ru ? "Бюро игроков" : "Player bureaus"}
        </button>
      </div>
    </section>
  )
}
