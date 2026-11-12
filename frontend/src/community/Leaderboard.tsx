import { useId, useState } from "react"
import { useLanguage } from "../i18n"
import { useResource } from "./api"
import { PageHead } from "./Shared"
import Icon from "../icons/Icon"
import "./leaderboard-clarity.css"

type Row = {
  rank: number
  slug: string
  display_name: string
  avatar_url: string | null
  score: number
  level: number
  contracts_completed: number
}
type Board = {
  scope: string
  rows: Row[]
  total: number
  generated_at: string
  reset_at: string | null
  me?: { row: Row | null; reason: string | null }
}
export default function Leaderboard({
  authenticated = false,
  onProfile,
}: {
  authenticated?: boolean
  onProfile?: () => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const explanationId = useId()
  const [scope, setScope] = useState("all_time")
  const resource = useResource<Board>(
    `/api/${authenticated ? "" : "public/"}leaderboard?scope=${scope}&limit=50`,
  )
  const data = resource.data
  const scoreLabel = scope === "all_time" || scope === "today" ? "XP" : ru ? "очки" : "points"
  const scoreHeading =
    scope === "all_time"
      ? ru
        ? "XP рейтинга"
        : "Leaderboard XP"
      : scope === "today"
        ? ru
          ? "XP сегодня"
          : "XP today"
        : ru
          ? "Очки"
          : "Points"
  const scopes = [
    ["all_time", ru ? "Всё время" : "All time"],
    ["today", ru ? "Сегодня" : "Today"],
    ["rare", ru ? "Редкие дела" : "Rare cases"],
    ["mastery", ru ? "Мастерство" : "Mastery"],
  ]
  const updated = data ? new Date(data.generated_at) : null
  const reset = data?.reset_at ? new Date(data.reset_at) : null
  return (
    <section className="community-page leaderboard-page" aria-busy={resource.loading}>
      {authenticated ? (
        <PageHead
          number="03 / CITY REGISTER"
          title={ru ? "Лучшие агенты бюро" : "The bureau's finest"}
          text={
            ru
              ? "Имена, за которыми стоят завершённые дела. Найдите своё место в городском реестре."
              : "Names backed by completed cases. Find your place in the city register."
          }
        />
      ) : (
        <h2>{ru ? "Актуальная таблица" : "Current standings"}</h2>
      )}
      <div
        className="community-tabs"
        role="group"
        aria-label={ru ? "Раздел рейтинга" : "Leaderboard scope"}
      >
        {scopes.map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={scope === value}
            onClick={() => setScope(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="community-muted leaderboard-scoring" id={explanationId}>
        {scope === "today"
          ? ru
            ? "Подтверждённые награды за контракты с 00:00 UTC."
            : "Verified contract rewards since 00:00 UTC."
          : scope === "rare"
            ? ru
              ? "Редкое дело — 1 очко, эпическое — 2."
              : "Rare case: 1 point. Epic case: 2 points."
            : scope === "mastery"
              ? ru
                ? "Сложный контракт — 1 очко, экстремальный — 2."
                : "Hard contract: 1 point. Extreme contract: 2 points."
              : ru
                ? "XP за подтверждённые контракты. Общий опыт в профиле может отличаться."
                : "Verified contract XP. Total experience in a profile may differ."}
        {scope === "today" && reset && Number.isFinite(reset.getTime()) && (
          <span>
            {" "}
            {ru ? "Следующее обновление:" : "Next reset:"}{" "}
            <time dateTime={data!.reset_at!}>
              {reset.toLocaleString(locale, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </time>
            .
          </span>
        )}
      </p>
      {resource.loading || resource.error || !data ? (
        <div className="leaderboard-state" role={resource.error ? "alert" : "status"}>
          <Icon name={resource.error ? "triangle-alert" : "trophy"} size={24} />
          <h2>
            {resource.error
              ? ru
                ? "Не удалось загрузить рейтинг"
                : "Could not load the standings"
              : ru
                ? "Загружаем рейтинг…"
                : "Loading the standings…"}
          </h2>
          {resource.error && (
            <>
              <p>{resource.error}</p>
              <button type="button" className="dc-ghost" onClick={resource.reload}>
                {ru ? "Повторить" : "Try again"}
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {data.me && (
            <div className="leaderboard-mine">
              <div>
                <p className="community-eyebrow">{ru ? "ВАШЕ МЕСТО" : "YOUR POSITION"}</p>
                {data.me.row ? (
                  <h2>
                    #{data.me.row.rank} <span>{data.me.row.display_name}</span>
                  </h2>
                ) : (
                  <h2>
                    {data.me.reason === "PRIVATE_PROFILE"
                      ? ru
                        ? "Вы пока вне публичного рейтинга"
                        : "Your profile is not listed yet"
                      : ru
                        ? "Первый результат ещё впереди"
                        : "Your first result is still ahead"}
                  </h2>
                )}
                <p>
                  {data.me.row
                    ? `${data.me.row.score.toLocaleString(locale)} ${scoreLabel} · ${ru ? "из" : "of"} ${data.total} ${ru ? "игроков" : "players"}`
                    : data.me.reason === "PRIVATE_PROFILE"
                      ? ru
                        ? "Опубликуйте профиль и включите показ статистики, чтобы участвовать."
                        : "Publish your profile and enable public stats to participate."
                      : ru
                        ? "Выполните контракт, который учитывается в этой таблице."
                        : "Complete a contract that counts toward this board."}
                </p>
              </div>
              {data.me.reason === "PRIVATE_PROFILE" && onProfile && (
                <button className="dc-ghost" onClick={onProfile}>
                  {ru ? "Настроить профиль" : "Profile settings"}
                </button>
              )}
            </div>
          )}
          {data.rows.length ? (
            <>
              <div className="leaderboard-table-wrap">
                <table className="leaderboard-table" aria-describedby={explanationId}>
                  <caption>
                    {scopes.find(([value]) => value === scope)?.[1]} · {ru ? "Показано" : "Showing"}{" "}
                    {data.rows.length} {ru ? "из" : "of"} {data.total.toLocaleString(locale)}
                    <span>
                      {ru ? "Учтённые контракты за всё время" : "Eligible contracts, all-time"}
                    </span>
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">{ru ? "Оперативник" : "Operative"}</th>
                      <th scope="col" className="leaderboard-extra">
                        {ru ? "Контракты" : "Contracts"}
                      </th>
                      <th scope="col">{scoreHeading}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.slug} className={row.slug === data.me?.row?.slug ? "is-me" : ""}>
                        <td>
                          <span className="leaderboard-place">
                            {String(row.rank).padStart(2, "0")}
                            {row.rank === 1 && <Icon name="trophy" size={14} />}
                          </span>
                        </td>
                        <td>
                          <a href={`/u/${row.slug}`} className="leaderboard-player">
                            {row.avatar_url ? (
                              <img src={row.avatar_url} alt="" loading="lazy" />
                            ) : (
                              <span className="community-avatar">DC</span>
                            )}
                            <span>
                              <b>{row.display_name}</b>
                              <small>
                                LVL {row.level}
                                {row.slug === data.me?.row?.slug ? (ru ? " · ВЫ" : " · YOU") : ""}
                              </small>
                            </span>
                          </a>
                        </td>
                        <td className="leaderboard-extra">{row.contracts_completed}</td>
                        <td>{row.score.toLocaleString(locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="leaderboard-state" role="status">
              <Icon name="trophy" size={24} />
              <h2>
                {scope === "today"
                  ? ru
                    ? "Сегодня результатов ещё нет"
                    : "No results today yet"
                  : ru
                    ? "В этой таблице пока нет результатов"
                    : "No results on this board yet"}
              </h2>
              <p>
                {ru
                  ? "Здесь появятся подтверждённые результаты игроков с публичной статистикой. Можно посмотреть другой раздел рейтинга."
                  : "Verified results from players with public stats will appear here. You can explore another board in the meantime."}
              </p>
            </div>
          )}
          <p className="community-footnote leaderboard-footnote">
            {ru
              ? "Ручные корректировки XP не влияют на место. Обновлено"
              : "Administrative XP adjustments do not affect rank. Updated"}{" "}
            {updated && Number.isFinite(updated.getTime()) && (
              <time dateTime={data.generated_at}>
                {updated.toLocaleTimeString(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            )}{" "}
            · <button onClick={resource.reload}>{ru ? "Обновить" : "Refresh"}</button>
          </p>
        </>
      )}
    </section>
  )
}
