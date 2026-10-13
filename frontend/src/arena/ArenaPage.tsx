import { useCallback, useEffect, useRef, useState } from "react"
import { useLanguage } from "../i18n"
import { request, useResource } from "../community/api"
import type { EconomyScope } from "../archive/types"
import CoinRewards from "../archive/CoinRewards"
import CardPreview from "../archive/CardPreview"
import Icon from "../icons/Icon"
import SquadEditor from "./SquadEditor"
import BattleField from "./BattleField"
import { useArenaCommand } from "./commands"
import {
  localized,
  isGwentMatch,
  seasonTitle,
  modes,
  type ArenaReply,
  type Bootstrap,
  type Match,
  type Mode,
  type Patron,
  type Room,
} from "./types"
import "./arena.css"

const route = () => location.hash.replace(/^#arena\/?/, "").split("/")
export default function ArenaPage({ csrf, accountKey }: { csrf: string; accountKey: string }) {
  const { language, locale } = useLanguage(),
    ru = language === "ru"
  const [path, setPath] = useState(route),
    [scope, setScope] = useState<EconomyScope>("REAL"),
    [match, setMatch] = useState<Match | null>(null),
    [room, setRoom] = useState<Room | null>(null),
    [code, setCode] = useState(""),
    [copy, setCopy] = useState(""),
    [queued, setQueued] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [publicSquad, setPublicSquad] = useState(false)
  const preparationKey = `dc-arena-preparation:${accountKey}`
  const [preparation, setPreparation] = useState<{
    mode: Mode
    options: Record<string, unknown>
    scope: EconomyScope
  } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(preparationKey) || "null")
    } catch {
      return null
    }
  })
  const [squadReady, setSquadReady] = useState(false)
  const bootstrap = useResource<Bootstrap>(`/api/arena/bootstrap?scope=${scope}`)
  const matchRequest = useRef<AbortController | null>(null),
    sequence = useRef(0),
    matchID = path[0] === "match" ? path[1] : null
  const navigate = (next: string) => {
    location.hash = `arena${next ? `/${next}` : ""}`
    setPath(next.split("/"))
  }
  useEffect(() => {
    const update = () => setPath(route())
    window.addEventListener("hashchange", update)
    return () => window.removeEventListener("hashchange", update)
  }, [])
  useEffect(() => {
    if (bootstrap.data) setPublicSquad(bootstrap.data.showcase?.is_public || false)
  }, [bootstrap.data?.showcase?.revision])
  const accept = useCallback(
    (incoming: Match) =>
      setMatch((previous) => {
        if (previous?.id !== incoming.id) return incoming
        if (previous.revision > incoming.revision) return previous
        if (previous.revision === incoming.revision)
          return {
            ...incoming,
            submitted: previous.submitted || incoming.submitted,
            opponent_submitted: previous.opponent_submitted || incoming.opponent_submitted,
          }
        return incoming
      }),
    [],
  )
  const refreshMatch = useCallback(async () => {
    if (!matchID) return
    matchRequest.current?.abort()
    const controller = new AbortController()
    matchRequest.current = controller
    const current = ++sequence.current
    setLoading(true)
    setError("")
    try {
      const reply = await request<{ match: Match }>(
        `/api/arena/matches/${encodeURIComponent(matchID)}`,
        "",
        { signal: controller.signal },
      )
      if (!controller.signal.aborted && sequence.current === current) {
        accept(reply.match)
        setScope(reply.match.scope)
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [matchID, accept])
  useEffect(() => {
    setMatch(null)
    void refreshMatch()
    return () => matchRequest.current?.abort()
  }, [matchID, refreshMatch])
  const onReply = (reply: ArenaReply) => {
    if (reply.match) {
      accept(reply.match)
      setScope(reply.match.scope)
      navigate(`match/${reply.match.id}`)
    }
    if (reply.room) {
      setRoom(reply.room)
      if (reply.room.scope) setScope(reply.room.scope)
      if (reply.room.match_id) navigate(`match/${reply.room.match_id}`)
      else navigate(`social/${reply.room.code}`)
    }
    if (typeof reply.queued === "boolean") {
      setQueued(reply.queued)
      if (!reply.match) navigate("social")
    }
    if (!reply.match) bootstrap.reload()
  }
  const commands = useArenaCommand(csrf, accountKey, onReply, () => {
    bootstrap.reload()
    void refreshMatch()
  })
  const blocked = commands.busy || !!commands.pending
  useEffect(() => {
    if (!matchID || match?.status === "FINISHED" || commands.busy) return
    const timer = setInterval(() => {
      if (!document.hidden) void refreshMatch()
    }, 4000)
    const wake = () => {
      if (!document.hidden) void refreshMatch()
    }
    window.addEventListener("online", wake)
    document.addEventListener("visibilitychange", wake)
    return () => {
      clearInterval(timer)
      window.removeEventListener("online", wake)
      document.removeEventListener("visibilitychange", wake)
    }
  }, [matchID, match?.status, commands.busy, refreshMatch])
  useEffect(() => {
    if (path[0] !== "social" && !queued) return
    const controller = new AbortController()
    const check = async () => {
      try {
        if (path[0] === "social" && path[1]) {
          const reply = await request<{ room: Room }>(
            `/api/arena/rooms/${encodeURIComponent(path[1])}`,
            "",
            { signal: controller.signal },
          )
          if (!controller.signal.aborted) {
            setRoom(reply.room)
            if (reply.room.scope) setScope(reply.room.scope)
            if (reply.room.match_id) navigate(`match/${reply.room.match_id}`)
          }
        }
        if (queued) {
          const reply = await request<ArenaReply>("/api/arena/queue", "", {
            signal: controller.signal,
          })
          if (!controller.signal.aborted) {
            if (reply.match) {
              accept(reply.match)
              navigate(`match/${reply.match.id}`)
            }
            if (typeof reply.queued === "boolean") setQueued(reply.queued)
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError((failure as Error).message)
      }
    }
    if (path[0] === "social" && path[1]) void check()
    const timer = setInterval(() => {
      if (!document.hidden) void check()
    }, 4000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [path[0], path[1], queued, accept])
  // Resume the queue after a page reload without creating another queue entry.
  useEffect(() => {
    const controller = new AbortController()
    void request<ArenaReply>("/api/arena/queue", "", { signal: controller.signal })
      .then((reply) => {
        if (!controller.signal.aborted) {
          setQueued(!!reply.queued)
          if (reply.match) accept(reply.match)
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [accountKey, accept])
  const data = bootstrap.data
  useEffect(() => {
    if (preparation) sessionStorage.setItem(preparationKey, JSON.stringify(preparation))
    else sessionStorage.removeItem(preparationKey)
  }, [preparation, preparationKey])
  useEffect(() => {
    if (path[0] === "prepare" && preparation) setScope(preparation.scope)
  }, [path[0]])
  useEffect(() => {
    if (data && path[0] === "copy" && path[1]) {
      setPreparation({ mode: "COPY", scope, options: { copy_user_id: path[1] } })
      setSquadReady(false)
      navigate("prepare")
    }
  }, [!!data, path[0], path[1]])
  const launch = (mode: Mode, options: Record<string, unknown> = {}) => {
    if (!data) return
    if (mode === "FRIENDLY")
      return commands.execute(
        `/api/arena/rooms/${encodeURIComponent(String(options.room_code))}/confirm`,
        { squad_revision: data.squad.revision, base_item_id: data.squad.base_item_id },
      )
    if (mode === "RANKED")
      return commands.execute("/api/arena/queue", {
        squad_revision: data.squad.revision,
        base_item_id: data.squad.base_item_id,
      })
    return commands.execute("/api/arena/matches", {
      mode,
      scope,
      squad_revision: data.squad.revision,
      base_item_id: data.squad.base_item_id,
      ...options,
    })
  }
  const start = (mode: Mode, options: Record<string, unknown> = {}) => {
    setPreparation({ mode, options, scope })
    setSquadReady(false)
    navigate("prepare")
  }
  const savedBase = data?.inventory.find((item) => item.item_id === data.squad.base_item_id)
  const patronName = localized(
    savedBase?.definition?.rules.name ||
      data?.rules.bases[(savedBase?.definition_key || "ORDINARY") as Patron]?.name,
    language,
  )
  const navs = [
    ["", ru ? "Арена" : "Arena"],
    ["squad", ru ? "Состав и покровитель" : "Squad & patron"],
    ["social", ru ? "Комнаты и сезон" : "Rooms & season"],
    ["rewards", ru ? "Награды" : "Rewards"],
  ]
  return (
    <main
      className="arena-page"
      data-arena-view={matchID && match && isGwentMatch(match) ? "gwent" : undefined}
    >
      <header className="arena-heading">
        <div>
          <small>DEADLOCK CONTRACTS / CARD ARENA</small>
          <h1>{ru ? "Арена бюро" : "Bureau arena"}</h1>
          <p>
            {ru
              ? "Шесть героев. Двадцать четыре карты. Две победы в раундах."
              : "Six heroes. Twenty-four cards. Two round wins."}
          </p>
          <div className="arena-format">
            <span>
              <Icon name="layers" size={15} />
              {ru ? "3 ряда" : "3 rows"}
            </span>
            <span>
              <Icon name="shuffle" size={15} />
              {ru ? "10 карт в руке" : "10 opening cards"}
            </span>
            <span>
              <Icon name="crown" size={15} />
              {ru ? "EX один раз за матч" : "EX once per match"}
            </span>
          </div>
        </div>
        <label>
          {ru ? "Коллекция" : "Collection"}
          <select
            aria-label={ru ? "Область арены" : "Arena scope"}
            value={scope}
            disabled={blocked || !!matchID || !!room || path[0] === "prepare"}
            onChange={(event) => setScope(event.target.value as EconomyScope)}
          >
            <option value="REAL">{ru ? "Основная" : "Real economy"}</option>
            <option value="SANDBOX">{ru ? "Тестовая" : "Sandbox"}</option>
          </select>
        </label>
      </header>
      <nav className="arena-tabs" aria-label={ru ? "Разделы арены" : "Arena sections"}>
        {navs.map(([value, label]) => (
          <button
            key={value}
            aria-current={(path[0] || "") === value ? "page" : undefined}
            onClick={() => navigate(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {scope === "SANDBOX" && (
        <p className="arena-notice">
          {ru
            ? "Тестовая коллекция: без настоящих монет, доступа EX, рейтинга и публичной витрины."
            : "Sandbox collection: no real coins, EX access, rating or public showcase."}
        </p>
      )}
      {queued && path[0] !== "social" && (
        <p className="arena-notice" role="status">
          {ru ? "Поиск сезонного соперника продолжается." : "Season opponent search continues."}
          <button onClick={() => navigate("social")}>{ru ? "Открыть поиск" : "Open queue"}</button>
        </p>
      )}
      {(error || commands.error || bootstrap.error) && (
        <p role="alert" className="arena-error">
          {error || commands.error || bootstrap.error}
          <button
            onClick={() => {
              bootstrap.reload()
              void refreshMatch()
            }}
          >
            {ru ? "Обновить" : "Refresh"}
          </button>
        </p>
      )}
      {commands.pending && (
        <aside className="arena-notice" role="status">
          <p>
            {ru
              ? "Запрос сохранён. После обрыва связи повтор вернёт исходный результат."
              : "Request saved. After a connection error, retry returns the original result."}
          </p>
          <button disabled={commands.busy} onClick={() => void commands.retry()}>
            {ru ? "Повторить сохранённый запрос" : "Retry saved request"}
          </button>
          {!!commands.pending.body.request_key && (
            <button disabled={commands.busy} onClick={() => void commands.recover()}>
              {ru ? "Проверить сохранённый результат" : "Check saved result"}
            </button>
          )}
          {commands.pending.match_id && (
            <button onClick={() => navigate(`match/${commands.pending!.match_id}`)}>
              {ru ? "Открыть сохранённый бой" : "Open saved battle"}
            </button>
          )}
        </aside>
      )}
      {!data ? (
        <p role="status">{ru ? "Открываем арену…" : "Opening arena…"}</p>
      ) : (
        <>
          {matchID ? (
            match?.id === matchID ? (
              <>
                {match.expired && (
                  <aside className="arena-notice">
                    <p>
                      {ru
                        ? "Срок боя истёк. Закройте просроченные бои, чтобы освободить карточки; рейтинг не изменится."
                        : "This battle expired. Close expired battles to release the cards; rating is unchanged."}
                    </p>
                    <button
                      disabled={blocked}
                      onClick={() =>
                        void commands.execute("/api/arena/cleanup", {}).then((success) => {
                          if (success) void refreshMatch()
                        })
                      }
                    >
                      {ru ? "Закрыть просроченные бои" : "Close expired battles"}
                    </button>
                  </aside>
                )}
                <BattleField
                  match={match}
                  data={data}
                  busy={commands.busy}
                  blocked={!!commands.pending || !!match.expired}
                  onPlan={(actions) =>
                    void commands.execute(`/api/arena/matches/${match.id}/plans`, {
                      expected_revision: match.revision,
                      actions,
                    })
                  }
                  onSurrender={() =>
                    void commands.execute(`/api/arena/matches/${match.id}/surrender`, {
                      expected_revision: match.revision,
                    })
                  }
                  onRefresh={() => void refreshMatch()}
                />
              </>
            ) : (
              <p role="status">
                {loading
                  ? ru
                    ? "Восстанавливаем поле…"
                    : "Restoring battlefield…"
                  : ru
                    ? "Бой не загружен"
                    : "Battle unavailable"}
              </p>
            )
          ) : ["squad", "prepare"].includes(path[0]) ? (
            <>
              {!(path[0] === "prepare" && preparation?.mode === "WEEKLY") && (
                <SquadEditor
                  data={data}
                  busy={blocked}
                  onSave={(squad) =>
                    void commands.execute(
                      "/api/arena/squad",
                      {
                        expected_revision: squad.revision,
                        scope,
                        base_item_id: squad.base_item_id,
                        slots: squad.slots,
                      },
                      "PUT",
                    )
                  }
                  onTrial={(patron) => start("TRIAL", { patron_key: patron })}
                  onReady={setSquadReady}
                />
              )}
              {path[0] === "prepare" && preparation && (
                <section className="arena-panel">
                  <h2>{modes[preparation.mode][ru ? 0 : 1]}</h2>
                  <p className="arena-deck-explainer">
                    <Icon name="layers" size={20} />
                    {ru
                      ? "6 героев × 3 копии + 6 тактик = 24 боевые карты. Одна карта за ход; выиграйте два раунда. Копии существуют только внутри матча."
                      : "6 heroes × 3 copies + 6 tactics = 24 combat cards. One card per turn; win two rounds. Copies exist only inside the match."}
                  </p>
                  <p>
                    {preparation.mode === "WEEKLY"
                      ? ru
                        ? "Бой использует фиксированный временный состав и обычную базу. Карточки не выдаются в коллекцию. Победа занимает одно из трёх наградных мест PvE в день: 8 монет в общем лимите 120 за неделю."
                        : "This battle uses a fixed loaned squad and Ordinary base. Cards are not added to your collection. A win uses one of three daily PvE reward slots: 8 coins within the shared 120 weekly limit."
                      : ru
                        ? "Покровитель и состав фиксируются на весь бой. Сохраните изменения перед стартом."
                        : "Patron and squad are fixed for the entire battle. Save changes before starting."}
                  </p>
                  <button
                    className="arena-primary"
                    disabled={blocked || (preparation.mode !== "WEEKLY" && !squadReady)}
                    onClick={() => void launch(preparation.mode, preparation.options)}
                  >
                    {ru ? "Начать бой" : "Start battle"} ·{" "}
                    {preparation.mode === "WEEKLY"
                      ? localized(data.rules.bases.ORDINARY.name, language)
                      : preparation.mode === "TRIAL"
                        ? localized(
                            data.rules.bases[preparation.options.patron_key as Patron].name,
                            language,
                          )
                        : patronName}
                  </button>
                </section>
              )}
              {path[0] === "prepare" && !preparation && (
                <p>
                  {ru
                    ? "Выберите режим на главной странице арены."
                    : "Choose a mode on the arena home page."}
                </p>
              )}
            </>
          ) : path[0] === "social" ? (
            <>
              <section className="arena-panel">
                <h2>{ru ? "Дружеская комната" : "Friendly room"}</h2>
                <p>
                  {ru
                    ? "Монеты за дружеские бои не выдаются. Составы и покровители раскрываются после подтверждения обоих игроков."
                    : "No coins for friendly matches. Squads and patrons are revealed after both players confirm."}
                </p>
                {room ? (
                  <>
                    <h3>{room.code}</h3>
                    <p role="status">
                      {ru ? "Твой состав" : "Your squad"}:{" "}
                      {room.own_confirmed
                        ? ru
                          ? "Подтверждён"
                          : "Confirmed"
                        : ru
                          ? "Не подтверждён"
                          : "Not confirmed"}{" "}
                      · {ru ? "Соперник" : "Opponent"}:{" "}
                      {room.opponent_confirmed
                        ? ru
                          ? "Подтверждён"
                          : "Confirmed"
                        : ru
                          ? "Ожидаем"
                          : "Waiting"}
                    </p>
                    <button
                      disabled={blocked || room.own_confirmed}
                      onClick={() => start("FRIENDLY", { room_code: room.code })}
                    >
                      {ru ? "Подтвердить состав и базу" : "Confirm squad & base"}
                    </button>
                    <button
                      disabled={blocked}
                      onClick={() =>
                        void commands
                          .execute(`/api/arena/rooms/${room.code}/leave`, {})
                          .then((success) => {
                            if (success) {
                              setRoom(null)
                              navigate("social")
                            }
                          })
                      }
                    >
                      {ru ? "Выйти из комнаты" : "Leave room"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={blocked}
                      onClick={() => void commands.execute("/api/arena/rooms", { scope })}
                    >
                      {ru ? "Создать комнату" : "Create room"}
                    </button>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        if (code.trim())
                          void commands.execute(
                            `/api/arena/rooms/${encodeURIComponent(code.trim())}/join`,
                            {},
                          )
                      }}
                    >
                      <label>
                        {ru ? "Код комнаты" : "Room code"}
                        <input
                          maxLength={32}
                          value={code}
                          onChange={(event) => setCode(event.target.value)}
                        />
                      </label>
                      <button disabled={blocked || !code.trim()}>
                        {ru ? "Присоединиться" : "Join room"}
                      </button>
                    </form>
                  </>
                )}
              </section>
              <section className="arena-panel">
                <h2>{ru ? "Отдельный сезон арены" : "Arena season"}</h2>
                {data.season ? (
                  <>
                    <h3>{localized(data.season.title, language)}</h3>
                    <p>
                      {ru ? "Рейтинг" : "Rating"}: <b>{data.season.rating}</b> ·{" "}
                      {ru ? "Боев" : "Games"}: {data.season.games}
                    </p>
                    <p>
                      {ru ? "Звание" : "Title"}: {seasonTitle(data.season.earned_title, language)} ·{" "}
                      {ru
                        ? "Косметика сезона, без боевого усиления"
                        : "Season cosmetic, no battle bonuses"}
                    </p>
                    <p>
                      {ru ? "До" : "Until"} {new Date(data.season.ends_at).toLocaleString(locale)}
                    </p>
                    <p>
                      {ru
                        ? "Рейтинг арены не меняет рейтинг проверенных контрактов. Сезонные победы не дают монет."
                        : "Arena rating is separate from verified contracts. Season wins do not award coins."}
                    </p>
                    {queued ? (
                      <>
                        <p role="status">{ru ? "Поиск соперника…" : "Finding an opponent…"}</p>
                        <button
                          disabled={blocked}
                          onClick={() => void commands.execute("/api/arena/queue", {}, "DELETE")}
                        >
                          {ru ? "Отменить поиск" : "Cancel search"}
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={blocked || scope !== "REAL"}
                        onClick={() => start("RANKED")}
                      >
                        {ru ? "Участвовать в сезоне" : "Join season queue"}
                      </button>
                    )}
                    <ArenaLeaderboard />
                  </>
                ) : (
                  <p>{ru ? "Активного сезона пока нет." : "No active season yet."}</p>
                )}
              </section>
              <section className="arena-panel">
                <h2>{ru ? "Публичная витрина состава" : "Public squad showcase"}</h2>
                <p>
                  {ru
                    ? "Показывает сохранённый основной состав и базу, если публичны профиль и витрина. Тестовые карточки не публикуются."
                    : "Shows your saved real squad and base when both profile and showcase are public. Sandbox cards stay private."}
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={publicSquad}
                    onChange={(event) => setPublicSquad(event.target.checked)}
                  />
                  {ru ? "Показывать состав в профиле" : "Show squad on profile"}
                </label>
                <button
                  disabled={blocked || scope !== "REAL"}
                  onClick={() =>
                    void commands.execute(
                      "/api/arena/showcase",
                      {
                        expected_revision: data.showcase.revision,
                        is_public: publicSquad,
                        base_item_id: data.squad.base_item_id,
                        slots: data.squad.slots,
                      },
                      "PUT",
                    )
                  }
                >
                  {ru ? "Сохранить витрину" : "Save showcase"}
                </button>
              </section>
            </>
          ) : path[0] === "rewards" ? (
            <CoinRewards />
          ) : (
            <>
              <section className="arena-panel arena-welcome">
                <h2>{ru ? "Начни с шести героев" : "Start with six heroes"}</h2>
                <p>
                  {data.rules.version === "gwent-v1"
                    ? ru
                      ? "Бесплатный старт: шесть разных опубликованных карт с оригинальными иллюстрациями. Герои и ранги выбираются из доступных дизайнов в пределах 24 очков. Выдаётся один раз для выбранной коллекции."
                      : "Your free starter contains six different published cards with original artwork. Available designs determine the heroes and ranks, within the 24-point budget. Granted once per collection."
                    : ru
                      ? "Бесплатные опубликованные оригинальные карты F: Abrams, Bebop, Dynamo, Haze, Ivy и Seven. Боевой старт выдаётся один раз для выбранной коллекции."
                      : "Free published original F cards: Abrams, Bebop, Dynamo, Haze, Ivy and Seven. The battle starter is granted once per collection."}
                </p>
                {!!data.starter?.cards?.length && (
                  <div
                    className="arena-starter-cards"
                    aria-label={ru ? "Карты боевого старта" : "Your starter cards"}
                  >
                    {data.starter.cards.map((card) => (
                      <article key={card.id}>
                        <CardPreview card={card} />
                        <small>
                          {card.hero_name} · {card.rank}
                        </small>
                      </article>
                    ))}
                  </div>
                )}
                {!data.starter?.claimed && data.starter?.available === false && (
                  <p className="arena-notice" role="status">
                    {data.rules.version === "gwent-v1"
                      ? ru
                        ? "Для боевого старта пока недостаточно разных опубликованных иллюстрированных карт в пределах бюджета."
                        : "The starter needs enough different published illustrated cards within the budget."
                      : ru
                        ? "Боевой старт пока недоступен: опубликованы не все оригинальные карты F."
                        : "The battle starter is unavailable: some published original F cards are missing."}{" "}
                    {!!data.starter.missing_heroes.length && (
                      <>
                        {ru ? "Нужны карты героев: " : "Missing hero cards: "}
                        {data.starter.missing_heroes
                          .map((key) => key.charAt(0).toUpperCase() + key.slice(1))
                          .join(", ")}
                        .{" "}
                      </>
                    )}
                    {ru
                      ? "Можно подготовить состав из подходящих карт вашей коллекции."
                      : "You can prepare a squad using eligible cards from your collection."}
                  </p>
                )}
                <button
                  disabled={blocked || data.starter?.claimed || data.starter?.available === false}
                  onClick={() => void commands.execute("/api/arena/starter", { scope })}
                >
                  {data.starter?.claimed
                    ? ru
                      ? "Боевой старт получен"
                      : "Battle starter claimed"
                    : data.starter?.available === false
                      ? ru
                        ? "Боевой старт недоступен"
                        : "Battle starter unavailable"
                      : ru
                        ? "Получить боевой старт"
                        : "Claim battle starter"}
                </button>
                <button onClick={() => navigate("squad")}>
                  {ru ? "Подготовить состав" : "Prepare squad"}
                </button>
              </section>
              {data.active_matches.length > 0 && (
                <section className="arena-panel">
                  <h2>{ru ? "Продолжить бой" : "Resume battle"}</h2>
                  {data.active_matches.map((active) => (
                    <button key={active.id} onClick={() => navigate(`match/${active.id}`)}>
                      {modes[active.mode]?.[ru ? 0 : 1]} · {ru ? "Раунд" : "Round"} {active.round}{" "}
                      {active.expired ? (ru ? "· Истёк" : "· Expired") : ""}
                    </button>
                  ))}
                  {data.active_matches.some((active) => active.expired) && (
                    <button
                      disabled={blocked}
                      onClick={() => void commands.execute("/api/arena/cleanup", {})}
                    >
                      {ru ? "Закрыть просроченные бои" : "Close expired battles"}
                    </button>
                  )}
                </section>
              )}
              <section className="arena-panel">
                <h2>{ru ? "Назначенные бои" : "Assigned battles"}</h2>
                <button disabled={blocked} onClick={() => start("ASSIGNED")}>
                  {ru ? "Подготовить назначенный бой" : "Prepare assigned battle"}
                </button>
                <p>
                  {ru
                    ? "Победа: 8 монет, первые три наградные победы в день, максимум 120 в неделю. Назначение и соперник сохраняются после обновления."
                    : "Win: 8 coins, first three reward-eligible wins each day, up to 120 a week. Assignment and opponent persist after reload."}
                </p>
                {data.assignments.length ? (
                  data.assignments.map((assignment) => (
                    <article className="arena-assignment" key={assignment.id}>
                      <h3>
                        {localized(assignment.opponent, language) ||
                          `${ru ? "Назначение" : "Assignment"} ${assignment.slot}`}
                      </h3>
                      <p>
                        {modes[assignment.mode]?.[ru ? 0 : 1]} · {assignment.status}
                      </p>
                      <button
                        disabled={blocked || assignment.status !== "OPEN"}
                        onClick={() =>
                          void start(assignment.mode, { assignment_id: assignment.id })
                        }
                      >
                        {ru ? "Выбрать покровителя и состав" : "Choose patron & squad"}
                      </button>
                      <button
                        disabled={blocked || assignment.status !== "OPEN"}
                        onClick={() =>
                          void start(assignment.mode, { assignment_id: assignment.id })
                        }
                      >
                        {ru ? "Начать с сохранённым составом" : "Start with saved squad"}
                      </button>
                    </article>
                  ))
                ) : (
                  <p>
                    {ru
                      ? "Выберите назначенный бой: сервер закрепит соперника и наградное место."
                      : "Choose an assigned battle: the server fixes your opponent and reward slot."}
                  </p>
                )}
              </section>
              <section className="arena-panel">
                <h2>{ru ? "Практика и испытания" : "Practice & challenges"}</h2>
                <div className="arena-mode-grid">
                  {(["TUTORIAL", "TRAINING", "HARD", "WEEKLY"] as Mode[]).map((mode) => (
                    <article key={mode}>
                      <h3>{modes[mode][ru ? 0 : 1]}</h3>
                      <p>
                        {mode === "WEEKLY"
                          ? ru
                            ? "Временный выданный состав. Награда использует существующий PvE-лимит."
                            : "Temporary loaned squad. Rewards use the existing PvE allowance."
                          : ru
                            ? "Без бесконечных наград. Учись позициям, энергии и способностям."
                            : "No repeatable coin farming. Learn row choices, card conservation and when to pass."}
                      </p>
                      <button disabled={blocked} onClick={() => void start(mode)}>
                        {ru ? "Начать" : "Start"}
                      </button>
                    </article>
                  ))}
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (copy.trim()) void start("COPY", { copy_user_id: copy.trim() })
                  }}
                >
                  <label>
                    {ru ? "ID игрока с публичным составом" : "Player ID with a public squad"}
                    <input
                      value={copy}
                      maxLength={80}
                      onChange={(event) => setCopy(event.target.value)}
                    />
                  </label>
                  <button disabled={blocked || !copy.trim()}>
                    {ru ? "Бой с ботом по копии состава" : "Play bot using squad copy"}
                  </button>
                  <p>
                    {ru
                      ? "Это бот с копией состава, а не победа над человеком."
                      : "This is a bot using a squad copy, not a victory over a human."}
                  </p>
                </form>
                <p>
                  {ru
                    ? "Испытания EX доступны в выборе покровителя. Во время испытания база может быть выдана временно; владение не меняется."
                    : "EX trials are in patron selection. A trial may lend its base temporarily without granting ownership."}
                </p>
              </section>
            </>
          )}
        </>
      )}
    </main>
  )
}
function ArenaLeaderboard() {
  const { language } = useLanguage(),
    ru = language === "ru"
  const board = useResource<{
    players?: {
      slug: string
      display_name: string
      rating: number
      games: number
      rank?: number
      earned_title?: string
    }[]
  }>("/api/arena/leaderboard")
  return (
    <div>
      <h3>{ru ? "Рейтинг сезона" : "Season leaderboard"}</h3>
      {board.error ? (
        <p role="alert">
          {board.error}
          <button onClick={board.reload}>{ru ? "Повторить" : "Retry"}</button>
        </p>
      ) : board.loading ? (
        <p role="status">{ru ? "Загрузка…" : "Loading…"}</p>
      ) : (
        <ol className="arena-leaderboard">
          {board.data?.players?.map((item) => (
            <li key={item.slug}>
              <span>
                <a href={`/u/${encodeURIComponent(item.slug)}`}>{item.display_name}</a>
              </span>
              <b>{item.rating}</b>
              <small>
                {item.games} {ru ? "боев" : "games"} · {seasonTitle(item.earned_title, language)}
              </small>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
