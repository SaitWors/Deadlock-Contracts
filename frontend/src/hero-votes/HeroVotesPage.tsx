import Icon from "../icons/Icon"
import { useLanguage } from "../i18n"
import type { Candidate, PublicVotes, VoteSource } from "./types"
import "./hero-votes.css"

const portraits = import.meta.glob<string>("./portraits/*.webp", {
  eager: true,
  query: "?url&no-inline",
  import: "default",
})
function portrait(hero: Candidate) {
  return portraits[`./portraits/${hero.hero_id}.webp`]
}
function name(hero: Candidate, ru: boolean) {
  return ru ? hero.name_ru : hero.name_en
}
export function sourceStatus(source: VoteSource, ru: boolean) {
  if (!source.enabled) return ru ? "Источник выключен" : "Source disabled"
  if (source.status === "AUTH_REQUIRED")
    return ru ? "Статистика требует входа" : "Statistics require sign-in"
  if (source.status === "INVALID_DATA")
    return ru ? "Состав или данные опроса изменились" : "Poll data or candidates changed"
  if (source.status === "UNSUPPORTED")
    return ru ? "Формат прогнозов не поддерживается" : "Prediction format is not supported"
  if (source.status === "UNAVAILABLE") return ru ? "Источник недоступен" : "Source unavailable"
  if (source.stale) return ru ? "Последний сохранённый результат" : "Last saved result"
  if (source.status === "PENDING")
    return ru ? "Ожидаем первый снимок" : "Waiting for the first observation"
  return ru ? "Опрос сообщества" : "Community poll"
}

export default function HeroVotesPage({
  data,
  error,
  onReload,
}: {
  data: PublicVotes | null
  error: boolean
  onReload: () => void
}) {
  const { language, locale } = useLanguage(),
    ru = language === "ru"
  const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 })
  const date = (value: string) =>
    new Date(value).toLocaleString(locale, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
  const campaign = data?.enabled ? data.campaign : null
  const source = campaign?.sources.find((item) => item.provider === "deadlock_labs" && item.enabled)
  const result = source?.result
  const leaders = result?.rows.filter((hero) => result.leader_ids.includes(hero.hero_id)) || []
  const leader = leaders.length === 1 ? leaders[0] : null
  return (
    <section className="hv-page" aria-label={ru ? "Голосование за героев" : "Hero vote watch"}>
      <header className="hv-heading">
        <div>
          <p className="ns-eyebrow">VOTE WATCH / {ru ? "ГОЛОС ГОРОДА" : "VOICE OF THE CITY"}</p>
          <h1>
            {campaign
              ? ru
                ? campaign.title_ru
                : campaign.title_en
              : ru
                ? "Голосование за героев"
                : "Hero vote watch"}
          </h1>
          <p>{ru ? "Кого сообщество ждёт следующим?" : "Who does the community want next?"}</p>
        </div>
        <span className="hv-pill">
          <Icon name="users" size={16} />
          {ru ? "Опрос сообщества" : "Community poll"}
        </span>
      </header>
      {error && (
        <div className="hv-message" role="alert">
          <p>
            {ru
              ? "Не удалось обновить страницу. Сохранённые данные могут устареть."
              : "Could not refresh this page. Saved data may be out of date."}
          </p>
          <button onClick={onReload}>{ru ? "Повторить" : "Retry"}</button>
        </div>
      )}
      {!campaign ? (
        <div className="hv-empty" role="status">
          <Icon name="hourglass" size={32} />
          <h2>
            {data
              ? ru
                ? "Сейчас нет активного опроса"
                : "No active poll right now"
              : error
                ? ru
                  ? "Данные недоступны"
                  : "Data unavailable"
                : ru
                  ? "Загружаем опрос…"
                  : "Loading the poll…"}
          </h2>
          <p>
            {ru
              ? "Вкладка появится, когда начнётся новая кампания."
              : "The tab will appear when a new campaign starts."}
          </p>
        </div>
      ) : (
        <>
          <aside className="hv-scope">
            <Icon name="info" size={20} />
            <p>
              {ru
                ? "Это голоса на Deadlock Labs, а не общие результаты голосования в игре. Один участник может голосовать на сайте каждый день. Лидер здесь отражает только этот опрос."
                : "These are votes on Deadlock Labs, not the global in-game results. Participants can vote on that site daily. The leader reflects this poll only."}
            </p>
          </aside>
          {source && (
            <>
              <div className="hv-source-line">
                <span
                  className={`hv-pill ${source.stale || source.status !== "OK" ? "hv-warning" : ""}`}
                >
                  <i />
                  {sourceStatus(source, ru)}
                </span>
                <span>
                  {source.updated_at ? (
                    <>
                      {ru ? "Снимок" : "Observed"}:{" "}
                      <time dateTime={source.updated_at}>{date(source.updated_at)}</time>
                    </>
                  ) : ru ? (
                    "Обновление раз в 10 минут"
                  ) : (
                    "Updates every 10 minutes"
                  )}
                </span>
              </div>
              {result ? (
                <>
                  <div className="hv-overview">
                    <article className="hv-leader">
                      {leader && portrait(leader) && (
                        <img src={portrait(leader)} alt="" width="192" height="256" />
                      )}
                      <div>
                        <span className="hv-pill">
                          <Icon name={leader ? "crown" : "scale"} size={16} />
                          {leader
                            ? ru
                              ? "Лидирует в опросе"
                              : "Poll leader"
                            : leaders.length
                              ? ru
                                ? "Равенство голосов"
                                : "Tied for the lead"
                              : ru
                                ? "Пока нет лидера"
                                : "No leader yet"}
                        </span>
                        <h2>
                          {leaders.length
                            ? leaders.map((hero) => name(hero, ru)).join(" / ")
                            : ru
                              ? "Город ещё выбирает"
                              : "The city is still deciding"}
                        </h2>
                        <p>
                          {leader
                            ? `${number(leader.votes)} ${ru ? "голосов" : "votes"} · ${number(leader.percent)}%`
                            : ru
                              ? "Следим за следующим снимком опроса."
                              : "Watching for the next observation."}
                        </p>
                      </div>
                    </article>
                    <div className="hv-metrics">
                      <article>
                        <span>{ru ? "Голосов в источнике" : "Votes in this source"}</span>
                        <strong>{number(result.total_votes)}</strong>
                        <small>
                          {ru ? "С учётом уже вышедших героев" : "Includes already released heroes"}
                        </small>
                      </article>
                      <article>
                        <span>{ru ? "Отрыв от второго места" : "Lead over second place"}</span>
                        <strong>
                          {result.gap_votes === null ? "—" : `+${number(result.gap_votes)}`}
                        </strong>
                        <small>
                          {result.gap_percent === null
                            ? ru
                              ? "Недостаточно данных"
                              : "Not enough data"
                            : `${number(result.gap_percent)} ${ru ? "п. п. от всех голосов" : "pp of all votes"}`}
                        </small>
                      </article>
                      {source.change && (
                        <p className="hv-change" role="status">
                          {source.change.leader_changed
                            ? ru
                              ? "Лидер изменился · "
                              : "Leader changed · "
                            : ""}
                          {ru
                            ? "Изменение с предыдущего снимка: "
                            : "Since the previous observation: "}
                          {source.change.votes_delta >= 0 ? "+" : ""}
                          {number(source.change.votes_delta)} {ru ? "голосов" : "votes"}
                          {source.change.gap_delta !== null && (
                            <>
                              {" "}
                              · {ru ? "отрыв " : "lead "}
                              {source.change.gap_delta >= 0 ? "+" : ""}
                              {number(source.change.gap_delta)}
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <section className="hv-ranking">
                    <header>
                      <div>
                        <p className="ns-eyebrow">{ru ? "СЛЕДУЮЩИЙ ГЕРОЙ" : "THE NEXT HERO"}</p>
                        <h2>{ru ? "Как распределились голоса" : "Where the votes went"}</h2>
                      </div>
                      <span>
                        {ru ? "Доля всех голосов источника" : "Share of all votes in this source"}
                      </span>
                    </header>
                    <ol>
                      {result.rows
                        .filter((hero) => !hero.released)
                        .map((hero, index) => (
                          <li
                            key={hero.hero_id}
                            className={result.leader_ids.includes(hero.hero_id) ? "hv-leading" : ""}
                          >
                            <span className="hv-rank">{String(index + 1).padStart(2, "0")}</span>
                            {portrait(hero) ? (
                              <img
                                src={portrait(hero)}
                                alt=""
                                width="48"
                                height="58"
                                loading="lazy"
                              />
                            ) : (
                              <span className="hv-monogram">{name(hero, ru).slice(0, 1)}</span>
                            )}
                            <div className="hv-row-main">
                              <div>
                                <strong>{name(hero, ru)}</strong>
                                <span>
                                  {number(hero.votes)} <small>{ru ? "голосов" : "votes"}</small>
                                </span>
                              </div>
                              <div className="hv-track" aria-hidden="true">
                                <i style={{ width: `${hero.percent}%` }} />
                              </div>
                            </div>
                            <b className="hv-percent">{number(hero.percent)}%</b>
                          </li>
                        ))}
                    </ol>
                    {result.rows.some((hero) => hero.released) && (
                      <div className="hv-released">
                        <Icon name="circle-check" size={18} />
                        <div>
                          <b>{ru ? "Уже в городе" : "Already in the city"}</b>
                          <p>
                            {result.rows
                              .filter((hero) => hero.released)
                              .map(
                                (hero) =>
                                  `${name(hero, ru)} — ${number(hero.votes)} (${number(hero.percent)}%)`,
                              )
                              .join(" · ")}
                          </p>
                          <small>
                            {ru
                              ? "Эти голоса входят в общий итог, но герой больше не участвует в гонке за следующий выход."
                              : "These votes remain in the total; released heroes are excluded from the race for the next release."}
                          </small>
                        </div>
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <div className="hv-empty" role="status">
                  <Icon name="chart-no-axes-column-increasing" size={32} />
                  <h2>{sourceStatus(source, ru)}</h2>
                  <p>
                    {ru
                      ? "Подтверждённых чисел пока нет. Следующая попытка: "
                      : "No verified counts yet. Next attempt: "}
                    {date(source.next_refresh_at)}
                  </p>
                </div>
              )}
            </>
          )}
          <div className="hv-sources">
            {campaign.sources
              .filter((item) => item.enabled)
              .map((item) => (
                <article key={item.provider}>
                  <div>
                    <Icon name={item.kind === "COMMUNITY_POLL" ? "users" : "compass"} size={22} />
                    <h3>{item.name}</h3>
                    <span className="hv-pill">
                      {item.kind === "COMMUNITY_POLL"
                        ? ru
                          ? "Опрос"
                          : "Poll"
                        : ru
                          ? "Прогнозы выхода"
                          : "Release predictions"}
                    </span>
                  </div>
                  <p>
                    {item.kind === "COMMUNITY_POLL"
                      ? ru
                        ? "Голоса посетителей сайта. Обновляем раз в 10 минут; источники не суммируются."
                        : "Votes cast by site visitors. Updated every 10 minutes; sources are never added together."
                      : ru
                        ? "Прогноз порядка выхода героев. Общая статистика недоступна без входа; чисел здесь нет."
                        : "Predictions of hero release order. Community statistics require sign-in; no counts are shown here."}
                  </p>
                  <footer>
                    <small>{sourceStatus(item, ru)}</small>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {ru ? "Открыть источник" : "Open source"}
                      <Icon name="arrow-up-right" size={16} />
                    </a>
                  </footer>
                </article>
              ))}
          </div>
          {campaign.ends_at && (
            <p className="hv-end">
              <Icon name="calendar-days" size={16} />
              {ru ? "Кампания на Contracts до " : "Contracts campaign ends "}
              <time dateTime={campaign.ends_at}>{date(campaign.ends_at)}</time>
            </p>
          )}
        </>
      )}
    </section>
  )
}
