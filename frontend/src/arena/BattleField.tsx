import { useEffect, useMemo, useState } from "react"
import { useLanguage } from "../i18n"
import { useReducedMotion } from "../Appearance"
import CoinRewardReceipt from "../archive/CoinRewardReceipt"
import type { Action, Bootstrap, Hero, Match, Side } from "./types"
import { localized, modes } from "./types"

function Hp({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <label className="arena-hp">
      {label}{" "}
      <b>
        {value} / {max}
      </b>
      <meter min={0} max={max} low={max * 0.3} high={max * 0.7} optimum={max} value={value} />
    </label>
  )
}
function HeroView({
  hero,
  round,
  cost,
  role,
}: {
  hero: Hero
  round: number
  cost: number
  role: string
}) {
  const { language } = useLanguage(),
    ru = language === "ru"
  return (
    <article className="arena-hero" data-alive={hero.hp > 0} data-position={hero.position}>
      <header>
        <strong>{localized(hero.name, language)}</strong>
        <b>{hero.rank}</b>
      </header>
      {(hero.card?.image_url || hero.image_url) && (
        <img
          className="arena-hero-art"
          src={hero.card?.image_url || hero.image_url}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
      <small>
        {hero.position === "FRONT" ? (ru ? "Передний ряд" : "Front") : ru ? "Задний ряд" : "Back"} ·{" "}
        {role}
      </small>
      <Hp value={hero.hp} max={hero.max_hp} label="HP" />
      <p>
        ⚔ {hero.attack} · {ru ? "Броня" : "Armor"} {hero.armor}% · {ru ? "Стоимость" : "Cost"}{" "}
        {cost}
      </p>
      {hero.shield > 0 && (
        <p>
          {ru ? "Щит" : "Shield"}: {hero.shield}
        </p>
      )}
      <p>
        <b>{localized(hero.ability.name, language)}</b> · ⚡{hero.ability.cost}
      </p>
      <p>{localized(hero.ability.description, language)}</p>
      <small>
        {hero.hp > 0
          ? hero.ready_round <= round
            ? ru
              ? "Способность готова"
              : "Ability ready"
            : `${ru ? "Готова в раунде" : "Ready in round"} ${hero.ready_round}`
          : hero.respawn_round
            ? `${ru ? "Возвращение в раунде" : "Respawns in round"} ${hero.respawn_round}`
            : ru
              ? "Выбыл до конца боя"
              : "Eliminated"}
      </small>
    </article>
  )
}
const positionsAfterSwaps = (heroes: Hero[], actions: Action[]) => {
  const values = heroes.map((hero) => ({ ...hero }))
  for (const action of actions)
    if (action.type === "SWAP") {
      const first = values.find((hero) => hero.id === action.first_id),
        second = values.find((hero) => hero.id === action.second_id)
      if (first && second) {
        const { line, position } = first
        first.line = second.line
        first.position = second.position
        second.line = line
        second.position = position
      }
    }
  return values
}
export default function BattleField({
  match,
  data,
  busy,
  blocked,
  onPlan,
  onSurrender,
  onRefresh,
}: {
  match: Match
  data: Bootstrap
  busy: boolean
  blocked: boolean
  onPlan: (actions: Action[]) => void
  onSurrender: () => void
  onRefresh: () => void
}) {
  const { language } = useLanguage(),
    ru = language === "ru",
    reduced = useReducedMotion()
  const [lane, setLane] = useState(0),
    [actions, setActions] = useState<Action[]>([]),
    [first, setFirst] = useState(""),
    [second, setSecond] = useState(""),
    [actor, setActor] = useState(""),
    [target, setTarget] = useState("")
  const [confirmSurrender, setConfirmSurrender] = useState(false)
  const own = match.state.sides.find((side) => side.side === match.player_side)!,
    enemy = match.state.sides.find((side) => side.side !== match.player_side)!
  const rules = match.state.rules || data.rules
  useEffect(() => {
    setActions([])
    setTarget("")
    setActor("")
    setConfirmSurrender(false)
  }, [match.id, match.revision])
  const projected = useMemo(() => positionsAfterSwaps(own.heroes, actions), [own.heroes, actions])
  const living = projected.filter((hero) => hero.hp > 0)
  const selected = living.find((hero) => hero.id === actor) || living[0]
  const firstHero = living.find((hero) => hero.id === first) || living[0],
    secondHero =
      living.find((hero) => hero.id === second && hero.id !== firstHero?.id) ||
      living.find((hero) => hero.id !== firstHero?.id)
  const energy = actions.reduce(
    (sum, action) => sum + (action.type === "SWAP" ? 1 : action.type === "BASE_ABILITY" ? 3 : 2),
    0,
  )
  const abilityUsed = actions.some((action) => action.type !== "SWAP")
  const commandLocked = busy || blocked || match.status !== "ACTIVE"
  const locked = commandLocked || match.submitted
  const targets =
    selected?.ability.target === "ENEMY"
      ? enemy.heroes.filter((hero) => hero.hp > 0 && hero.line === selected.line)
      : living.filter(
          (hero) =>
            hero.line === selected?.line &&
            (selected?.ability.target !== "OTHER_ALLY" || hero.id !== selected.id),
        )
  const needsTarget =
    !!selected && ["ENEMY", "ALLY", "OTHER_ALLY"].includes(selected.ability.target || "")
  const targetHero = targets.find((hero) => hero.id === target) || targets[0]
  const baseTargets = living.filter((hero) => hero.hp > 60)
  const baseTarget = baseTargets.find((hero) => hero.id === target) || baseTargets[0]
  const available = actions.length < 2 && energy < 3
  const battleSide = (side: Side) => (
    <section className="arena-side" key={side.side} data-side={side.side}>
      <div className="arena-base" data-patron={side.base.key}>
        {side.base.image_url && (
          <img
            className="arena-base-art"
            src={side.base.image_url}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
        <h3>
          {side.side === own.side
            ? ru
              ? "Твоя база"
              : "Your base"
            : ru
              ? "База соперника"
              : "Opponent base"}{" "}
          · {localized(rules.bases[side.base.key]?.name, language) || side.base.key}
        </h3>
        <Hp value={side.base.hp} max={side.base.max_hp} label="HP" />
        <p>
          {localized(side.base.ability.name, language)} ·{" "}
          {side.base.ability.cost ? `⚡${side.base.ability.cost}` : "—"} ·{" "}
          {side.base.ready_round <= match.round
            ? ru
              ? "Готова"
              : "Ready"
            : `${ru ? "Готова в раунде" : "Ready in round"} ${side.base.ready_round}`}
        </p>
      </div>
      <div className="arena-lanes">
        {[0, 1, 2].map((line) => (
          <div className="arena-lane" data-focused={lane === line} key={line}>
            <h4>
              {ru ? "Линия" : "Lane"} {line + 1}
            </h4>
            <Hp value={side.guardians[line]?.hp || 0} max={240} label={ru ? "Страж" : "Guardian"} />
            <div className="arena-lane-summary">
              {side.heroes
                .filter((hero) => hero.line === line)
                .map((hero) => (
                  <span key={hero.id}>
                    {localized(hero.name, language)}: {hero.hp}
                  </span>
                ))}
            </div>
            <div className="arena-lane-cards">
              {side.heroes
                .filter((hero) => hero.line === line)
                .sort((a, b) => (a.position === b.position ? 0 : a.position === "FRONT" ? -1 : 1))
                .map((hero) => (
                  <HeroView
                    key={hero.id}
                    hero={hero}
                    round={match.round}
                    cost={rules.ranks[hero.rank]?.cost || 0}
                    role={localized(rules.heroes[hero.hero_key]?.role, language)}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
  return (
    <section
      className="arena-battle"
      data-reduced={reduced}
      aria-label={ru ? "Поле боя" : "Battlefield"}
    >
      <header className="arena-battle-header">
        <div>
          <small>
            {modes[match.mode]?.[ru ? 0 : 1]} ·{" "}
            {match.scope === "SANDBOX" ? (ru ? "ТЕСТ" : "SANDBOX") : "REAL"}
          </small>
          <h2>
            {ru ? "Раунд" : "Round"} {match.round} / {rules.max_rounds}
          </h2>
        </div>
        <button disabled={busy} onClick={onRefresh}>
          {ru ? "Обновить бой" : "Refresh battle"}
        </button>
      </header>
      <div className="arena-base-hud" aria-label={ru ? "Базы и здоровье" : "Base health"}>
        {[own, enemy].map((side) => (
          <div key={side.side}>
            <strong>
              {side === own
                ? ru
                  ? "Твоя база"
                  : "Your base"
                : ru
                  ? "База соперника"
                  : "Opponent base"}
            </strong>
            <small>{localized(rules.bases[side.base.key]?.name, language)}</small>
            <Hp value={side.base.hp} max={side.base.max_hp} label="HP" />
          </div>
        ))}
      </div>
      {match.mode === "TUTORIAL" && (
        <aside className="arena-notice">
          {ru
            ? "Передний герой закрывает заднего. Герои бьют по своей линии: передний → задний → страж → база. В раунде 3 энергии; до двух действий и одна способность. Сначала перемещения, затем защита, способности и одновременные обычные атаки."
            : "Front heroes protect the back. Attacks follow their lane: front → back → guardian → base. Each round has 3 energy, up to two actions and one ability. Movement resolves before defence, abilities and simultaneous basic attacks."}
          <p>
            {ru
              ? "Цель — уничтожить базу. После 12-го раунда сравниваются HP баз, стражей, затем героев. Герой возрождается один раз, пропустив два раунда. Перезарядка 3: способность из раунда 1 снова доступна в раунде 4."
              : "Destroy the opposing base. After round 12, ties compare base HP, then guardian HP, then hero HP. A hero respawns once after missing two rounds. Cooldown 3: an ability used in round 1 is ready again in round 4."}
          </p>
        </aside>
      )}
      <nav className="arena-lane-tabs" aria-label={ru ? "Линия в фокусе" : "Focused lane"}>
        {[0, 1, 2].map((value) => (
          <button key={value} aria-pressed={value === lane} onClick={() => setLane(value)}>
            {ru ? "Линия" : "Lane"} {value + 1} ·{" "}
            {own.heroes.filter((hero) => hero.line === value && hero.hp > 0).length}/
            {enemy.heroes.filter((hero) => hero.line === value && hero.hp > 0).length}
          </button>
        ))}
      </nav>
      <div className="arena-field" key={`${match.id}:${match.revision}`}>
        {battleSide(enemy)}
        {battleSide(own)}
      </div>
      {match.result ? (
        <section className="arena-panel arena-result" role="status">
          <h2>
            {match.result.winner_side === null
              ? ru
                ? "Ничья"
                : "Draw"
              : match.result.winner_side === own.side
                ? ru
                  ? "Победа"
                  : "Victory"
                : ru
                  ? "Поражение"
                  : "Defeat"}
          </h2>
          <p>
            {
              ({
                BASE_DESTROYED: ["База уничтожена", "Base destroyed"],
                ROUND_LIMIT: ["Достигнут предел раундов", "Round limit reached"],
                SURRENDER: ["Сдача", "Surrender"],
                EXPIRED: ["Срок боя истёк", "Battle expired"],
              }[match.result.reason] || [match.result.reason, match.result.reason])[ru ? 0 : 1]
            }
          </p>
          {match.reward ? (
            <CoinRewardReceipt reward={match.reward} />
          ) : (
            <p>
              {ru
                ? "Монеты за этот результат не назначены. Практика, дружеские и сезонные бои не дают монет за победу."
                : "No coin reward is assigned to this result. Practice, friendly and season wins do not award coins."}
            </p>
          )}
          <a href="#arena">{ru ? "К следующему бою" : "Prepare next battle"}</a>
        </section>
      ) : (
        <section className="arena-panel arena-plan">
          <h3>
            {ru ? "План раунда" : "Round plan"} · ⚡ {3 - energy} / 3 · {actions.length} / 2
          </h3>
          {match.submitted ? (
            <p role="status">
              {ru
                ? "План запечатан. Ожидаем второй план."
                : "Plan sealed. Waiting for the other plan."}
            </p>
          ) : (
            <>
              <p>
                {ru
                  ? "Действия выполняются по порядку; цели способностей проверяются после всех перемещений. Без действий — пропуск раунда."
                  : "Actions stay ordered; ability targets are checked after all movement. Confirm an empty plan to pass."}
              </p>
              <fieldset disabled={locked}>
                <legend>{ru ? "Перемещение · 1 энергия" : "Swap · 1 energy"}</legend>
                <label>
                  {ru ? "Первый герой" : "First hero"}
                  <select
                    value={firstHero?.id || ""}
                    onChange={(event) => setFirst(event.target.value)}
                  >
                    {living.map((hero) => (
                      <option key={hero.id} value={hero.id}>
                        {localized(hero.name, language)} · {hero.line + 1} {hero.position}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {ru ? "Второй герой" : "Second hero"}
                  <select
                    value={secondHero?.id || ""}
                    onChange={(event) => setSecond(event.target.value)}
                  >
                    {living
                      .filter((hero) => hero.id !== firstHero?.id)
                      .map((hero) => (
                        <option key={hero.id} value={hero.id}>
                          {localized(hero.name, language)} · {hero.line + 1} {hero.position}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={!available || !firstHero || !secondHero}
                  onClick={() =>
                    firstHero &&
                    secondHero &&
                    setActions((previous) => [
                      ...previous,
                      { type: "SWAP", first_id: firstHero.id, second_id: secondHero.id },
                    ])
                  }
                >
                  {ru ? "Добавить обмен" : "Add swap"}
                </button>
              </fieldset>
              <fieldset disabled={locked}>
                <legend>{ru ? "Способность героя · 2 энергии" : "Hero ability · 2 energy"}</legend>
                <label>
                  {ru ? "Герой" : "Hero"}
                  <select
                    value={selected?.id || ""}
                    onChange={(event) => {
                      setActor(event.target.value)
                      setTarget("")
                    }}
                  >
                    {living.map((hero) => (
                      <option key={hero.id} value={hero.id}>
                        {localized(hero.name, language)} · {localized(hero.ability.name, language)}
                      </option>
                    ))}
                  </select>
                </label>
                {selected && (
                  <p>
                    {localized(selected.ability.description, language)} ·{" "}
                    {ru ? "Линия после обменов" : "Lane after swaps"}: {selected.line + 1}
                  </p>
                )}
                {needsTarget && (
                  <label>
                    {ru ? "Цель" : "Target"}
                    <select
                      value={targetHero?.id || ""}
                      onChange={(event) => setTarget(event.target.value)}
                    >
                      {targets.map((hero) => (
                        <option key={hero.id} value={hero.id}>
                          {localized(hero.name, language)} · HP {hero.hp}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  disabled={
                    !available ||
                    abilityUsed ||
                    energy > 1 ||
                    !selected ||
                    selected.ready_round > match.round ||
                    (needsTarget && !targetHero) ||
                    (["lady-geist", "lady_geist"].includes(selected.hero_key) && selected.hp <= 40)
                  }
                  onClick={() =>
                    selected &&
                    setActions((previous) => [
                      ...previous,
                      {
                        type: "HERO_ABILITY",
                        actor_id: selected.id,
                        ...(needsTarget ? { target_id: targetHero.id } : {}),
                      },
                    ])
                  }
                >
                  {ru ? "Использовать" : "Use"} {localized(selected?.ability.name, language)}
                </button>
              </fieldset>
              {own.base.key !== "ORDINARY" && (
                <fieldset disabled={locked}>
                  <legend>{ru ? "Способность базы · 3 энергии" : "Base ability · 3 energy"}</legend>
                  <p>{localized(own.base.ability.description, language)}</p>
                  {own.base.key === "HIDDEN_KING" ? (
                    <label>
                      {ru ? "Союзник платит 60 HP" : "Ally pays 60 HP"}
                      <select
                        value={baseTarget?.id || ""}
                        onChange={(event) => setTarget(event.target.value)}
                      >
                        {baseTargets.map((hero) => (
                          <option key={hero.id} value={hero.id}>
                            {localized(hero.name, language)} · {hero.hp} HP
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      {ru ? "Линия щита" : "Shield lane"}
                      <select
                        value={lane}
                        onChange={(event) => setLane(Number(event.target.value))}
                      >
                        {[0, 1, 2].map((value) => (
                          <option key={value} value={value}>
                            {value + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    disabled={
                      actions.length > 0 ||
                      own.base.ready_round > match.round ||
                      (own.base.key === "HIDDEN_KING" && !baseTarget)
                    }
                    onClick={() =>
                      setActions([
                        {
                          type: "BASE_ABILITY",
                          ...(own.base.key === "HIDDEN_KING"
                            ? { target_id: baseTarget.id }
                            : { line: lane }),
                        },
                      ])
                    }
                  >
                    {ru ? "Использовать" : "Use"} {localized(own.base.ability.name, language)}
                  </button>
                </fieldset>
              )}
              <ol className="arena-action-list">
                {actions.map((action, index) => (
                  <li key={index}>
                    {action.type === "SWAP"
                      ? `${ru ? "Обмен" : "Swap"}: ${localized(own.heroes.find((hero) => hero.id === action.first_id)?.name, language)} ↔ ${localized(own.heroes.find((hero) => hero.id === action.second_id)?.name, language)}`
                      : action.type === "HERO_ABILITY"
                        ? `${localized(own.heroes.find((hero) => hero.id === action.actor_id)?.ability.name, language)}${action.target_id ? ` → ${localized([...own.heroes, ...enemy.heroes].find((hero) => hero.id === action.target_id)?.name, language)}` : ""}`
                        : localized(own.base.ability.name, language)}
                    <button
                      disabled={locked}
                      onClick={() =>
                        setActions((previous) => previous.filter((_, i) => i !== index))
                      }
                    >
                      {ru ? "Убрать" : "Remove"}
                    </button>
                  </li>
                ))}
              </ol>
              <button className="arena-primary" disabled={locked} onClick={() => onPlan(actions)}>
                {ru ? "Подтвердить план" : "Confirm plan"}
              </button>
            </>
          )}
          {confirmSurrender ? (
            <div>
              <p>
                {ru
                  ? "Подтвердить сдачу? Бой закончится поражением."
                  : "Confirm surrender? The battle will end as a defeat."}
              </p>
              <button disabled={commandLocked} onClick={onSurrender}>
                {ru ? "Да, сдаться" : "Yes, surrender"}
              </button>
              <button onClick={() => setConfirmSurrender(false)}>
                {ru ? "Продолжить бой" : "Continue battle"}
              </button>
            </div>
          ) : (
            <button disabled={commandLocked} onClick={() => setConfirmSurrender(true)}>
              {ru ? "Сдаться" : "Surrender"}
            </button>
          )}
        </section>
      )}
      <details className="arena-panel">
        <summary>{ru ? "Журнал последнего раунда" : "Last round log"}</summary>
        <ol className="arena-log">
          {match.last_events.map((event, index) => (
            <li key={index}>
              {event.text
                ? localized(event.text, language)
                : `${event.type || "EVENT"} · ${Object.entries(event)
                    .filter(([key]) => key !== "type")
                    .map(
                      ([key, value]) =>
                        `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`,
                    )
                    .join(" · ")}`}
            </li>
          ))}
        </ol>
      </details>
    </section>
  )
}
