import { useEffect, useRef, useState } from "react"
import { useLanguage } from "../i18n"
import { useReducedMotion } from "../Appearance"
import CardPreview from "../archive/CardPreview"
import CoinRewardReceipt from "../archive/CoinRewardReceipt"
import Icon, { type IconName } from "../icons/Icon"
import type { BattleFieldProps } from "./BattleField"
import type { GwentAction, GwentCard, GwentMatch, GwentSide } from "./types"
import { localized, modes } from "./types"
import "./gwent.css"

const rowNames = [
  ["Улица", "Street"],
  ["Крыши", "Rooftops"],
  ["Ритуал", "Ritual"],
]
const rowIcons: IconName[] = ["house", "layers", "moon"]
const effectNames: Record<string, [string, string]> = {
  NONE: ["Боец", "Unit"],
  DAMAGE: ["Удар при выходе", "Deploy damage"],
  HEAL: ["Восстановление", "Restore"],
  BOOST: ["Усиление", "Boost"],
  BOND: ["Крепкая связь", "Tight bond"],
  MUSTER: ["Сбор", "Muster"],
  SPY: ["Шпион", "Spy"],
  WEATHER: ["Туман", "Weather"],
  CLEAR_WEATHER: ["Ясное небо", "Clear weather"],
  HORN: ["Боевой сигнал", "Horn"],
  SCORCH: ["Пепел", "Scorch"],
  DECOY: ["Приманка", "Decoy"],
}
const tacticIcons: Record<string, IconName> = {
  SPY: "eye",
  WEATHER: "moon",
  CLEAR_WEATHER: "star",
  HORN: "bell",
  SCORCH: "swords",
  DECOY: "repeat",
}
const deployEffects = ["DAMAGE", "HEAL", "BOOST"]
const isTactic = (card: GwentCard) => card.kind === "SPECIAL" || card.effect === "SPY"
function CombatArt({ card }: { card: GwentCard }) {
  const { language } = useLanguage(),
    ru = language === "ru"
  if (!isTactic(card) && (card.card || card.image_url)) {
    const artwork = card.card || {
      id: card.id,
      rank: card.rank === "TACTIC" ? "F" : card.rank,
      hero_name: localized(card.name, language),
      title: localized(card.name, language),
      image_url: card.image_url || null,
      crop_x: 50,
      crop_y: 50,
      zoom: 1,
    }
    return <CardPreview card={artwork} />
  }
  return (
    <figure className="gwent-tactic" aria-label={localized(card.name, language)}>
      <small>DC / {ru ? "ТАКТИКА" : "TACTIC"}</small>
      <Icon name={tacticIcons[card.effect] || "shield"} size={46} />
      <figcaption>{localized(card.name, language)}</figcaption>
    </figure>
  )
}
function CombatCard({
  card,
  selected,
  target,
  onClick,
  label,
}: {
  card: GwentCard
  selected?: boolean
  target?: boolean
  onClick: () => void
  label: string
}) {
  const { language } = useLanguage(),
    ru = language === "ru"
  return (
    <button
      type="button"
      className="gwent-card"
      data-selected={!!selected}
      data-target={!!target}
      aria-pressed={!!selected}
      aria-label={label}
      onClick={onClick}
    >
      <CombatArt card={card} />
      {card.kind === "UNIT" && (
        <span className="gwent-power" aria-label={`${ru ? "Сила" : "Power"} ${card.power}`}>
          {card.power}
        </span>
      )}
      <span
        className="gwent-card-effect"
        title={effectNames[card.effect]?.[ru ? 0 : 1] || card.effect}
      >
        <Icon
          name={
            tacticIcons[card.effect] ||
            (card.protected
              ? "shield"
              : card.effect === "DAMAGE"
                ? "swords"
                : card.effect === "MUSTER"
                  ? "users"
                  : "gem")
          }
          size={13}
        />
      </span>
    </button>
  )
}
function Wins({ value }: { value: number }) {
  const { language } = useLanguage()
  return (
    <span
      className="gwent-wins"
      aria-label={`${value} / 2 ${language === "ru" ? "побед в раундах" : "round wins"}`}
    >
      {[0, 1].map((i) => (
        <span key={i} data-won={value > i}>
          <Icon name="gem" size={15} />
        </span>
      ))}
    </span>
  )
}
export default function GwentBattleField({
  match,
  data,
  busy,
  blocked,
  onPlan,
  onSurrender,
  onRefresh,
}: Omit<BattleFieldProps, "match"> & { match: GwentMatch }) {
  const { language } = useLanguage(),
    ru = language === "ru",
    reduced = useReducedMotion()
  const state = match.state,
    own = state.sides.find((side) => side.side === match.player_side)!,
    enemy = state.sides.find((side) => side.side !== match.player_side)!
  const [selectedID, setSelectedID] = useState(""),
    [inspected, setInspected] = useState<GwentCard | null>(null),
    [row, setRow] = useState<number | null>(null),
    [targetID, setTargetID] = useState(""),
    [leader, setLeader] = useState(false),
    [graveyard, setGraveyard] = useState<"A" | "B" | null>(null),
    [confirmSurrender, setConfirmSurrender] = useState(false)
  const [inspectOpen, setInspectOpen] = useState(false)
  const battleRef = useRef<HTMLElement>(null),
    boardRef = useRef<HTMLDivElement>(null),
    handRef = useRef<HTMLElement>(null),
    inspectorRef = useRef<HTMLElement>(null)
  const selected = own.hand.find((card) => card.id === selectedID),
    currentCard = inspected || selected
  const active = match.status === "ACTIVE" && state.status !== "FINISHED" && !match.result
  const canPlay =
    active &&
    !busy &&
    !blocked &&
    !own.passed &&
    state.phase === "PLAY" &&
    state.turn_side === own.side
  const canMulligan =
    active && !busy && !blocked && state.phase === "MULLIGAN" && !own.mulligan_done
  const ownCards = own.rows.flat(),
    enemyCards = enemy.rows.flat()
  const leaderTarget =
    own.base.ability?.target ||
    (own.base.key === "HIDDEN_KING" ? "ENEMY" : own.base.key === "ARCHMOTHER" ? "ROW" : "NONE")
  const leaderAvailable = own.base.key !== "ORDINARY" && !own.leader_used
  const needsTarget = !!selected && selected.effect === "DECOY"
  const optionalTarget = !!selected && deployEffects.includes(selected.effect)
  const needsRow =
    !!selected && (selected.kind === "UNIT" || ["WEATHER", "HORN"].includes(selected.effect))
  useEffect(() => {
    setSelectedID("")
    setInspectOpen(false)
    setInspected(null)
    setRow(null)
    setTargetID("")
    setLeader(false)
    setConfirmSurrender(false)
  }, [match.id, match.revision, state.turn])
  useEffect(() => {
    const hand = handRef.current
    if (!hand) return
    const measure = () => {
      const height = hand.getBoundingClientRect().height
      if (height)
        battleRef.current?.style.setProperty("--gwent-hand-height", `${Math.ceil(height)}px`)
    }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(hand)
    window.addEventListener("resize", measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [state.phase, active])
  useEffect(() => {
    if (!canPlay || (!selectedID && !leader)) return
    const target = boardRef.current?.querySelector<HTMLElement>(
      ".gwent-row[data-legal=true], .gwent-card[data-target=true]",
    )
    if (!target) return
    const rect = target.getBoundingClientRect()
    if (!rect.height) return
    const handHeight =
      window.innerWidth <= 650 ? handRef.current?.getBoundingClientRect().height || 0 : 0
    const available = window.innerHeight - handHeight
    if (rect.top < 80 || rect.bottom > available - 12)
      window.scrollTo({
        top: Math.max(0, window.scrollY + rect.top - Math.max(80, (available - rect.height) / 2)),
        behavior: reduced ? "instant" : "smooth",
      })
  }, [selectedID, leader, canPlay, reduced])
  useEffect(() => {
    if (!inspectOpen) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const close = inspectorRef.current?.querySelector<HTMLButtonElement>("button")
    close?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspectOpen(false)
      if (event.key === "Tab") {
        event.preventDefault()
        close?.focus()
      }
    }
    document.addEventListener("keydown", keydown)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener("keydown", keydown)
      previous?.focus({ preventScroll: true })
    }
  }, [inspectOpen])
  const showCommands = () => {
    const hand = handRef.current
    if (!hand?.getBoundingClientRect().height) return
    window.requestAnimationFrame(() => {
      if (window.innerWidth > 650)
        hand.scrollIntoView({ block: "nearest", behavior: reduced ? "instant" : "smooth" })
      hand.querySelector<HTMLButtonElement>(".gwent-confirm")?.focus({ preventScroll: true })
    })
  }
  const send = (action: GwentAction) => {
    if (action.type === "MULLIGAN" || action.type === "READY" ? !canMulligan : !canPlay) return
    onPlan([action])
    setSelectedID("")
    setRow(null)
    setTargetID("")
    setLeader(false)
  }
  const select = (card: GwentCard) => {
    setSelectedID(card.id)
    setInspected(card)
    setRow(null)
    setTargetID("")
    setLeader(false)
  }
  const legalTarget = (side: GwentSide, card: GwentCard) => {
    if (!canPlay || card.kind !== "UNIT" || card.protected) return false
    if (leader) return leaderTarget === "ENEMY" && side.side !== own.side
    if (!selected) return false
    if (selected.effect === "DAMAGE") return side.side !== own.side
    if (["DECOY", "BOOST"].includes(selected.effect)) return side.side === own.side
    if (selected.effect === "HEAL") return side.side === own.side && (card.damage || 0) > 0
    return false
  }
  const legalRow = (side: GwentSide, index: number) => {
    if (!canPlay) return false
    if (leader)
      return leaderTarget === "ROW" && side.side === own.side && side.rows[index].length > 0
    if (!selected || !needsRow) return false
    if (selected.effect === "WEATHER") return true
    if (selected.effect === "HORN" && side.horns?.includes(index)) return false
    const targetSide = selected.effect === "SPY" ? enemy.side : own.side
    return (
      side.side === targetSide &&
      (selected.rows.length === 0 || selected.rows.includes(index)) &&
      (selected.kind !== "UNIT" || side.rows[index].length < 9)
    )
  }
  const chooseRow = (side: GwentSide, index: number) => {
    if (!legalRow(side, index)) return
    setRow(index)
    if (leader || optionalTarget || needsTarget) showCommands()
    if (selected && !optionalTarget && !needsTarget && !leader)
      send({ type: "PLAY", card_id: selected.id, row: index })
  }
  const chooseBoardCard = (side: GwentSide, card: GwentCard) => {
    setInspected(card)
    if (legalTarget(side, card)) {
      setTargetID(card.id)
      showCommands()
    } else setInspectOpen(true)
  }
  const confirmPlay = () => {
    if (leader) {
      if (leaderTarget === "ROW" && row !== null) send({ type: "LEADER", row })
      else if (leaderTarget === "ENEMY" && targetID) send({ type: "LEADER", target_id: targetID })
      return
    }
    if (!selected || (needsRow && row === null) || (needsTarget && !targetID)) return
    send({
      type: "PLAY",
      card_id: selected.id,
      ...(row !== null ? { row } : {}),
      ...(targetID ? { target_id: targetID } : {}),
    })
  }
  const playableSelection =
    canPlay &&
    (leader
      ? leaderTarget === "ROW"
        ? row !== null
        : !!targetID
      : !!selected && (!needsRow || row !== null) && (!needsTarget || !!targetID))
  const pickedTarget = [...ownCards, ...enemyCards].find((card) => card.id === targetID)
  const turnLabel =
    match.status === "WAITING"
      ? ru
        ? "Ожидаем соперника"
        : "Waiting for opponent"
      : !active
        ? ru
          ? "Бой завершён"
          : "Match finished"
        : state.phase === "MULLIGAN"
          ? own.mulligan_done
            ? ru
              ? "Соперник выбирает карты"
              : "Opponent is choosing cards"
            : ru
              ? "Замена стартовых карт"
              : "Opening hand"
          : own.passed
            ? ru
              ? "Вы спасовали"
              : "You passed"
            : state.turn_side === own.side
              ? ru
                ? "Ваш ход"
                : "Your turn"
              : ru
                ? "Ход соперника"
                : "Opponent’s turn"
  const scorePanel = (side: GwentSide) => (
    <section
      key={side.side}
      className="gwent-score"
      data-own={side.side === own.side}
      data-passed={side.passed}
      data-mulligan={state.phase === "MULLIGAN"}
      data-active={active && state.phase === "PLAY" && state.turn_side === side.side}
    >
      <header>
        <span>{side.side === own.side ? (ru ? "Вы" : "You") : ru ? "Соперник" : "Opponent"}</span>
        <Wins value={side.wins} />
      </header>
      <strong
        className="gwent-total"
        aria-label={`${side.side === own.side ? (ru ? "Ваша сила" : "Your score") : ru ? "Сила соперника" : "Opponent score"} ${side.score}`}
      >
        {side.score}
      </strong>
      <small>{ru ? "Общая сила" : "Total strength"}</small>
      <span className="gwent-score-patron">
        <Icon name="crown" size={12} />
        {localized(side.base.name || data.rules.bases[side.base.key]?.name, language)}
        {side.base.key !== "ORDINARY" &&
          ` · EX ${side.leader_used ? (ru ? "использован" : "used") : ru ? "готов" : "ready"}`}
      </span>
      <p className="gwent-side-status">
        {side.passed
          ? ru
            ? "Пас до конца раунда"
            : "Passed this round"
          : state.phase === "MULLIGAN"
            ? side.mulligan_done
              ? ru
                ? "Готов"
                : "Ready"
              : ru
                ? "Выбор карт"
                : "Choosing cards"
            : ru
              ? "В игре"
              : "In play"}
      </p>
      <div className="gwent-counts">
        <span>
          <Icon name="layers" size={14} />
          {side.deck_count} {ru ? "в колоде" : "in deck"}
        </span>
        <button
          type="button"
          onClick={() => setGraveyard(graveyard === side.side ? null : side.side)}
          aria-expanded={graveyard === side.side}
          aria-label={`${side.side === own.side ? (ru ? "Ваш" : "Your") : ru ? "Соперника" : "Opponent"} ${ru ? "сброс" : "graveyard"}`}
        >
          <Icon name="archive" size={14} />
          {side.graveyard_count} {ru ? "сброс" : "discarded"}
        </button>
      </div>
    </section>
  )
  const renderRow = (side: GwentSide, index: number) => {
    const legal = legalRow(side, index),
      name = rowNames[index][ru ? 0 : 1]
    return (
      <section
        key={`${side.side}:${index}`}
        className="gwent-row"
        data-own={side.side === own.side}
        data-legal={legal}
        data-weather={state.weather.includes(index)}
        data-horn={!!side.horns?.includes(index)}
        aria-label={`${side.side === own.side ? (ru ? "Ваш ряд" : "Your row") : ru ? "Ряд соперника" : "Opponent row"} · ${name}`}
      >
        <div className="gwent-row-label">
          <Icon name={rowIcons[index]} size={18} />
          <span>{name}</span>
          <b>{side.row_scores[index]}</b>
          {state.weather.includes(index) && <small>{ru ? "Туман" : "Weather"}</small>}
          {side.horns?.includes(index) && (
            <small>
              <Icon name="bell" size={11} /> ×2
            </small>
          )}
        </div>
        <div className="gwent-row-cards">
          {side.rows[index].map((card) => (
            <CombatCard
              key={card.id}
              card={card}
              selected={targetID === card.id}
              target={legalTarget(side, card)}
              label={`${legalTarget(side, card) ? (ru ? "Цель" : "Target") : ru ? "Осмотреть" : "Inspect"} ${localized(card.name, language)}`}
              onClick={() => chooseBoardCard(side, card)}
            />
          ))}
          {!side.rows[index].length && (
            <span className="gwent-row-empty">
              {legal ? (ru ? "Разыграть здесь" : "Play here") : ru ? "Пустой ряд" : "Empty row"}
            </span>
          )}
        </div>
        {legal && (
          <button
            type="button"
            className="gwent-row-play"
            disabled={!canPlay}
            onClick={() => chooseRow(side, index)}
            aria-label={`${leader ? (ru ? "Усилить ряд" : "Boost row") : ru ? "Разыграть в ряд" : "Play on"} ${name}`}
          >
            <Icon name="plus" size={18} />
            <span>{leader ? (ru ? "Выбрать" : "Choose") : ru ? "Играть" : "Play"}</span>
          </button>
        )}
      </section>
    )
  }
  const result = match.result || state.result
  return (
    <section
      className="arena-battle gwent-battle"
      data-reduced={reduced}
      data-active={active}
      data-phase={state.phase}
      ref={battleRef}
      aria-label={ru ? "Карточный бой" : "Card battle"}
    >
      <header className="gwent-battle-header">
        <div>
          <small>
            {modes[match.mode][ru ? 0 : 1]} / {ru ? "ДО ДВУХ ПОБЕД" : "FIRST TO TWO WINS"}
          </small>
          <h2>
            {ru ? "Раунд" : "Round"} {state.round} <span>/ 3</span>
          </h2>
        </div>
        <div
          className="gwent-turn"
          role="status"
          aria-live="polite"
          data-own={canPlay || canMulligan}
        >
          <span className="gwent-turn-dot" />
          {turnLabel}
        </div>
        <button
          type="button"
          className="gwent-refresh"
          disabled={busy}
          onClick={onRefresh}
          aria-label={ru ? "Обновить бой" : "Refresh battle"}
        >
          <Icon name="repeat" size={17} />
        </button>
      </header>
      {match.mode === "TUTORIAL" && (
        <aside className="arena-notice gwent-tutorial">
          {ru
            ? "Разыграйте одну карту за ход или спасуйте до конца раунда. Сила трёх рядов складывается. Выиграйте два раунда; при ничьей победу получают оба. Неразыгранные карты сохраняются, новых карт между раундами нет."
            : "Play one card per turn or pass for the rest of the round. Add the strength of all three rows. Win two rounds; a tie awards a win to both. Keep your unplayed cards; there is no automatic draw between rounds."}
        </aside>
      )}
      {blocked && active && (
        <p className="arena-notice" role="status">
          {match.expired
            ? ru
              ? "Срок боя истёк. Обновите бой, чтобы освободить карты."
              : "This match expired. Refresh the battle to release its cards."
            : ru
              ? "Команда сохранена. Проверьте результат или повторите сохранённый запрос."
              : "A command is saved. Check its result or retry the saved request."}
        </p>
      )}
      {result && (
        <section className="arena-panel gwent-result" role="status">
          <Icon name={result.winner_side === own.side ? "trophy" : "scale"} size={32} />
          <h2>
            {result.winner_side === null
              ? ru
                ? "Ничья"
                : "Draw"
              : result.winner_side === own.side
                ? ru
                  ? "Победа"
                  : "Victory"
                : ru
                  ? "Поражение"
                  : "Defeat"}
          </h2>
          <p>
            {result.reason === "SURRENDER"
              ? ru
                ? "Бой завершён сдачей."
                : "The match ended by surrender."
              : result.reason === "EXPIRED"
                ? ru
                  ? "Срок боя истёк."
                  : "The match expired."
                : ru
                  ? "Итог раундов зафиксирован."
                  : "Round results are final."}
          </p>
          {match.reward ? (
            <CoinRewardReceipt reward={match.reward} />
          ) : (
            <p>
              {ru
                ? "Этот бой завершён без монетной награды."
                : "This match ended without a coin reward."}
            </p>
          )}
        </section>
      )}
      <div className="gwent-layout">
        <aside
          className="gwent-sidebar"
          aria-label={ru ? "Счёт и покровитель" : "Score and patron"}
        >
          {scorePanel(enemy)}
          {scorePanel(own)}
          <section className="gwent-patron">
            <header>
              <Icon name="crown" size={20} />
              <small>
                {own.base.key === "ORDINARY" ? (ru ? "ПОКРОВИТЕЛЬ" : "PATRON") : "EX / PATRON"}
              </small>
            </header>
            {own.base.card && (
              <div className="gwent-patron-art">
                <CardPreview card={own.base.card} />
              </div>
            )}
            <h3>{localized(own.base.name || data.rules.bases[own.base.key]?.name, language)}</h3>
            {own.base.key === "ORDINARY" ? (
              <p>{ru ? "Без особой способности." : "No special ability."}</p>
            ) : (
              <>
                <p>{localized(own.base.ability?.description, language)}</p>
                <button
                  type="button"
                  disabled={!canPlay || !leaderAvailable}
                  aria-pressed={leader}
                  onClick={() => {
                    setLeader(!leader)
                    setSelectedID("")
                    setRow(null)
                    setTargetID("")
                  }}
                >
                  <Icon name="crown" size={15} />
                  {own.leader_used
                    ? ru
                      ? "EX использован"
                      : "EX used"
                    : ru
                      ? "Использовать EX"
                      : "Use EX"}
                </button>
                <small>
                  {ru ? "Один раз за весь матч · занимает ход" : "Once per match · takes a turn"}
                </small>
              </>
            )}
          </section>
        </aside>
        <div className="gwent-table">
          <div className="gwent-opponent-hand">
            <span>
              <Icon name="eye" size={16} />
              {ru ? "Скрытая рука соперника" : "Opponent’s hidden hand"}
              <b>
                {enemy.hand_count} {ru ? "карт" : "cards"}
              </b>
            </span>
            <div className="gwent-backs" aria-hidden="true">
              {Array.from({ length: Math.min(enemy.hand_count, 10) }, (_, i) => (
                <span key={i}>
                  <Icon name="layers" size={17} />
                </span>
              ))}
            </div>
          </div>
          <div
            className="gwent-board"
            ref={boardRef}
            aria-label={ru ? "Шесть боевых рядов" : "Six battlefield rows"}
          >
            {[2, 1, 0].map((index) => renderRow(enemy, index))}
            <div className="gwent-board-divider">
              <span>DEADLOCK CONTRACTS</span>
              <Icon name="swords" size={16} />
            </div>
            {[0, 1, 2].map((index) => renderRow(own, index))}
          </div>
          {state.history.length > 0 && (
            <ol
              className="gwent-round-history"
              aria-label={ru ? "История раундов" : "Round history"}
            >
              {state.history.map((round) => (
                <li key={round.round}>
                  {ru ? "Раунд" : "Round"} {round.round}
                  <b>
                    {own.side === "A" ? round.score_a : round.score_b} :{" "}
                    {own.side === "A" ? round.score_b : round.score_a}
                  </b>
                  <span>
                    {round.winner_side === null
                      ? ru
                        ? "Ничья"
                        : "Draw"
                      : round.winner_side === own.side
                        ? ru
                          ? "Выигран"
                          : "Won"
                        : ru
                          ? "Проигран"
                          : "Lost"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        {inspectOpen && currentCard && (
          <div className="gwent-inspector-layer">
            <div
              className="gwent-inspector-backdrop"
              aria-hidden="true"
              onClick={() => setInspectOpen(false)}
            />
            <aside
              className="gwent-inspector"
              ref={inspectorRef}
              role="dialog"
              aria-modal="true"
              aria-label={ru ? "Описание карты" : "Card inspection"}
            >
              <button
                type="button"
                className="gwent-inspector-close"
                aria-label={ru ? "Закрыть описание карты" : "Close card inspection"}
                onClick={() => setInspectOpen(false)}
              >
                <Icon name="x" size={19} />
              </button>
              {currentCard ? (
                <>
                  <small>{ru ? "ДОСЬЕ КАРТЫ" : "CARD DOSSIER"}</small>
                  <div className="gwent-inspector-art">
                    <CombatArt card={currentCard} />
                  </div>
                  <h3>{localized(currentCard.name, language)}</h3>
                  <dl>
                    <div>
                      <dt>{ru ? "Сила" : "Strength"}</dt>
                      <dd>
                        {currentCard.power} <small> / {currentCard.base_power}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>{ru ? "Ранг" : "Rank"}</dt>
                      <dd>
                        {currentCard.rank === "TACTIC"
                          ? ru
                            ? "Тактика"
                            : "Tactic"
                          : currentCard.rank}
                      </dd>
                    </div>
                  </dl>
                  <b className="gwent-effect-title">
                    {effectNames[currentCard.effect]?.[ru ? 0 : 1] || currentCard.effect}
                    {currentCard.effect_amount > 0 && ` · ${currentCard.effect_amount}`}
                  </b>
                  <p>{localized(currentCard.description, language)}</p>
                  {currentCard.protected && (
                    <small>
                      <Icon name="shield" size={13} />
                      {ru ? "Защищён от тактик и эффектов" : "Protected from tactics and effects"}
                    </small>
                  )}
                </>
              ) : (
                <div className="gwent-inspector-empty">
                  <Icon name="search" size={28} />
                  <h3>{ru ? "Изучите карты" : "Read the cards"}</h3>
                  <p>
                    {ru
                      ? "Выберите карту в руке или на поле: здесь появятся её сила, ранг и эффект."
                      : "Choose a card in your hand or on the board to see its strength, rank and effect."}
                  </p>
                </div>
              )}
            </aside>
          </div>
        )}
        <section className="gwent-hand" ref={handRef} aria-label={ru ? "Ваша рука" : "Your hand"}>
          <header>
            <div>
              <small>{ru ? "ВАША РУКА" : "YOUR HAND"}</small>
              <h3>
                {own.hand_count} {ru ? "карт" : "cards"}
              </h3>
            </div>
            <span>
              {state.phase === "MULLIGAN"
                ? `${own.mulligans_remaining} ${ru ? "замены осталось" : "replacements left"}`
                : ru
                  ? "Карты сохраняются между раундами"
                  : "Cards carry between rounds"}
            </span>
          </header>
          <div
            className="gwent-hand-cards"
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(".gwent-card"),
              ]
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
              if (current < 0) return
              event.preventDefault()
              const next =
                buttons[
                  (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                    buttons.length
                ]
              next.focus({ preventScroll: true })
              next.scrollIntoView?.({
                block: "nearest",
                inline: "center",
                behavior: reduced ? "instant" : "smooth",
              })
            }}
          >
            {own.hand.map((card) => (
              <CombatCard
                key={card.id}
                card={card}
                selected={selected?.id === card.id}
                label={`${ru ? "Выбрать" : "Select"} ${localized(card.name, language)}`}
                onClick={() => select(card)}
              />
            ))}
            {!own.hand.length && (
              <p>
                {ru
                  ? "Рука пуста. Используйте доступный EX или спасуйте."
                  : "Your hand is empty. Use an available EX or pass."}
              </p>
            )}
          </div>
          <div className="gwent-command" aria-live="polite">
            {state.phase === "MULLIGAN" ? (
              <>
                <p>
                  {own.mulligan_done
                    ? ru
                      ? "Вы готовы. Ожидаем соперника."
                      : "You are ready. Waiting for your opponent."
                    : ru
                      ? "Можно заменить до двух карт. Выберите карту и подтвердите замену, затем нажмите «Готов»."
                      : "Replace up to two cards. Select a card and confirm its replacement, then choose Ready."}
                </p>
                <div className="gwent-command-actions">
                  <button
                    type="button"
                    disabled={!canMulligan || !selected || own.mulligans_remaining <= 0}
                    onClick={() => selected && send({ type: "MULLIGAN", card_id: selected.id })}
                  >
                    <Icon name="shuffle" size={16} />
                    {ru ? "Заменить карту" : "Replace card"}
                  </button>
                  {selected && (
                    <button
                      type="button"
                      onClick={() => {
                        setInspected(selected)
                        setInspectOpen(true)
                      }}
                    >
                      <Icon name="eye" size={15} />
                      {ru ? "Описание" : "Inspect card"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="arena-primary"
                    disabled={!canMulligan}
                    onClick={() => send({ type: "READY" })}
                  >
                    {ru ? "Готов" : "Ready"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  {leader
                    ? leaderTarget === "ENEMY"
                      ? ru
                        ? "Выберите незащищённого бойца соперника и подтвердите EX."
                        : "Choose an unprotected enemy unit and confirm EX."
                      : ru
                        ? "Выберите свой непустой ряд и подтвердите EX."
                        : "Choose an occupied allied row and confirm EX."
                    : selected
                      ? needsTarget
                        ? ru
                          ? "Выберите своего незащищённого бойца и подтвердите карту."
                          : "Choose an unprotected allied unit and confirm the card."
                        : needsRow
                          ? row === null
                            ? selected.effect === "SPY"
                              ? ru
                                ? "Выберите ряд соперника: шпион даст вам две карты."
                                : "Choose an enemy row: the spy draws you two cards."
                              : ru
                                ? "Выберите подсвеченный ряд."
                                : "Choose a highlighted row."
                            : optionalTarget
                              ? ru
                                ? "Выберите цель на поле или подтвердите автоматический выбор."
                                : "Choose a target on the board or confirm automatic targeting."
                              : ru
                                ? "Подтвердите карту."
                                : "Confirm the card."
                          : ru
                            ? "Подтвердите розыгрыш карты."
                            : "Confirm playing the card."
                      : canPlay
                        ? ru
                          ? "Выберите карту в руке, затем ряд или цель."
                          : "Choose a card in your hand, then a row or target."
                        : turnLabel}
                  {row !== null && <b> · {rowNames[row][ru ? 0 : 1]}</b>}
                  {pickedTarget && <b> · {localized(pickedTarget.name, language)}</b>}
                </p>
                <div className="gwent-command-actions">
                  {(leader || (selected && (!needsRow || optionalTarget || needsTarget))) && (
                    <button
                      type="button"
                      className="arena-primary gwent-confirm"
                      disabled={!playableSelection}
                      onClick={confirmPlay}
                    >
                      {leader
                        ? ru
                          ? "Подтвердить EX"
                          : "Confirm EX"
                        : ru
                          ? "Разыграть карту"
                          : "Play selected card"}
                    </button>
                  )}
                  {selected && (
                    <button
                      type="button"
                      className="gwent-inspect-action"
                      onClick={() => {
                        setInspected(selected)
                        setInspectOpen(true)
                      }}
                    >
                      <Icon name="eye" size={15} />
                      {ru ? "Описание" : "Inspect card"}
                    </button>
                  )}
                  {(selected || leader) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedID("")
                        setLeader(false)
                        setRow(null)
                        setTargetID("")
                      }}
                    >
                      {ru ? "Отменить выбор" : "Cancel selection"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="gwent-pass"
                    disabled={!canPlay}
                    onClick={() => send({ type: "PASS" })}
                  >
                    {ru ? "Спасовать" : "Pass round"}
                    <Icon name="check" size={16} />
                  </button>
                </div>
                {active && (
                  <small>
                    {ru
                      ? "Пас завершает ваши ходы до конца этого раунда."
                      : "Passing ends your turns for this round."}
                  </small>
                )}
              </>
            )}
          </div>
        </section>
      </div>
      {graveyard && (
        <section className="gwent-graveyard arena-panel">
          <header>
            <h3>
              {graveyard === own.side
                ? ru
                  ? "Ваш сброс"
                  : "Your graveyard"
                : ru
                  ? "Сброс соперника"
                  : "Opponent graveyard"}
            </h3>
            <button
              type="button"
              onClick={() => setGraveyard(null)}
              aria-label={ru ? "Закрыть сброс" : "Close graveyard"}
            >
              <Icon name="x" size={17} />
            </button>
          </header>
          <div className="gwent-graveyard-cards">
            {state.sides
              .find((side) => side.side === graveyard)!
              .graveyard.map((card) => (
                <CombatCard
                  key={card.id}
                  card={card}
                  label={`${ru ? "Осмотреть" : "Inspect"} ${localized(card.name, language)}`}
                  onClick={() => {
                    setSelectedID("")
                    setInspected(card)
                    setInspectOpen(true)
                  }}
                />
              ))}
            {!state.sides.find((side) => side.side === graveyard)!.graveyard.length && (
              <p>{ru ? "Пока нет сброшенных карт." : "No discarded cards yet."}</p>
            )}
          </div>
        </section>
      )}
      <footer className="gwent-footer">
        <span>
          <Icon name="shield" size={14} />
          {ru
            ? "Состав и правила зафиксированы на весь матч"
            : "Squad and rules are fixed for this match"}
        </span>
        {active &&
          (confirmSurrender ? (
            <div>
              <span>{ru ? "Завершить бой поражением?" : "End this match in defeat?"}</span>
              <button type="button" disabled={busy || blocked} onClick={onSurrender}>
                {ru ? "Да, сдаться" : "Yes, surrender"}
              </button>
              <button type="button" onClick={() => setConfirmSurrender(false)}>
                {ru ? "Продолжить" : "Keep playing"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || blocked}
              onClick={() => setConfirmSurrender(true)}
            >
              {ru ? "Сдаться" : "Surrender"}
            </button>
          ))}
      </footer>
    </section>
  )
}
