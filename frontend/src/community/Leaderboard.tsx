import { useState } from "react"
import { useLanguage } from "../i18n"
import { useResource } from "./api"
import { LoadState, PageHead } from "./Shared"

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
  const [scope, setScope] = useState("all_time")
  const resource = useResource<Board>(
    `/api/${authenticated ? "" : "public/"}leaderboard?scope=${scope}&limit=50`,
  )
  const data = resource.data
  const scoreLabel = scope === "all_time" || scope === "today" ? "XP" : ru ? "ОЧКИ" : "POINTS"
  return (
    <section className="community-page">
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
        aria-label={ru ? "Период рейтинга" : "Leaderboard scope"}
      >
        {[
          ["all_time", ru ? "Всё время" : "All time"],
          ["today", ru ? "Сегодня" : "Today"],
          ["rare", ru ? "Редкие дела" : "Rare cases"],
          ["mastery", ru ? "Мастерство" : "Mastery"],
        ].map(([value, label]) => (
          <button key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>
            {label}
          </button>
        ))}
      </div>
      <p className="community-muted">
        {scope === "today"
          ? ru
            ? "Награды с 00:00 UTC. Новый день начинается в 00:00 UTC."
            : "Awards since 00:00 UTC. Resets at 00:00 UTC."
          : scope === "rare"
            ? ru
              ? "Редкое дело — 1 очко, эпическое — 2."
              : "Rare case: 1 point. Epic case: 2 points."
            : scope === "mastery"
              ? ru
                ? "Сложный контракт — 1 очко, экстремальный — 2."
                : "Hard contract: 1 point. Extreme contract: 2 points."
              : ru
                ? "XP за подтверждённые контракты за всё время."
                : "Verified contract XP earned over all time."}
      </p>
      {resource.loading || resource.error || !data ? (
        <LoadState error={resource.error} retry={resource.reload} />
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
              {data.me.reason === "PRIVATE_PROFILE" && (
                <button className="dc-ghost" onClick={onProfile}>
                  {ru ? "Настроить профиль" : "Profile settings"}
                </button>
              )}
            </div>
          )}
          {data.rows.length ? (
            <div className="leaderboard-table-wrap">
              <table className="leaderboard-table">
                <caption>
                  {ru ? "Городской реестр · первые 50 мест" : "City register · top 50"}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{ru ? "Оперативник" : "Operative"}</th>
                    <th scope="col" className="leaderboard-extra">
                      {ru ? "Дела" : "Cases"}
                    </th>
                    <th scope="col">{scoreLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.slug} className={row.slug === data.me?.row?.slug ? "is-me" : ""}>
                      <td>{String(row.rank).padStart(2, "0")}</td>
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
          ) : (
            <div className="community-empty">
              <h2>{ru ? "В реестре пока тихо" : "The register is quiet"}</h2>
              <p>
                {ru
                  ? "Здесь появятся игроки с публичной статистикой и подтверждёнными результатами."
                  : "Players with public stats and verified results will appear here."}
              </p>
            </div>
          )}
          <p className="community-footnote">
            {ru
              ? "Ручные корректировки XP не влияют на место. Обновлено"
              : "Administrative XP adjustments do not affect rank. Updated"}{" "}
            {new Date(data.generated_at).toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · <button onClick={resource.reload}>{ru ? "Обновить" : "Refresh"}</button>
          </p>
        </>
      )}
    </section>
  )
}
