import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { useLanguage } from "../i18n"
import { useReducedMotion } from "../Appearance"
import Icon from "../icons/Icon"
import NavigationIcon from "../icons/NavigationIcon"
import { progressAt, readReceipt, replayTargets } from "./timeline"
import type { CompletionReceipt, CompletionTask } from "./types"
import "./case-completion.css"

type TaskState = "pending" | "flying" | "absorbed" | "breaking" | "broken"

export default function CaseCompletion({
  boardId,
  onClose,
}: {
  boardId: string
  onClose: () => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const reduced = useReducedMotion()
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const avatar = useRef<HTMLDivElement>(null)
  const cards = useRef<(HTMLLIElement | null)[]>([])
  const run = useRef(0)
  const timers = useRef(new Set<number>())
  const frames = useRef(new Set<number>())
  const skipButton = useRef<HTMLButtonElement>(null)
  const replayButton = useRef<HTMLButtonElement>(null)
  const doneButton = useRef<HTMLButtonElement>(null)
  const moveActionFocus = useRef(false)
  const id = useId()
  const [receipt, setReceipt] = useState<CompletionReceipt | null>(null)
  const [phase, setPhase] = useState<"loading" | "waiting" | "error" | "playing" | "done">(
    "loading",
  )
  const [attempt, setAttempt] = useState(0)
  const [replay, setReplay] = useState(0)
  const [states, setStates] = useState<TaskState[]>([])
  const [displayedXp, setDisplayedXp] = useState(0)
  const [announcement, setAnnouncement] = useState("")
  const [impact, setImpact] = useState(0)
  const [flight, setFlight] = useState<Record<string, string>>({})
  const final = () => {
    if (document.activeElement === skipButton.current) moveActionFocus.current = true
    run.current += 1
    if (!receipt?.ready) return
    setStates(receipt.tasks.map((task) => (task.status === "COMPLETED" ? "absorbed" : "broken")))
    setDisplayedXp(receipt.progression.after.total_xp)
    setPhase("done")
    setAnnouncement(ru ? "Итоги контракта готовы" : "Contract results are ready")
  }
  const skipRef = useRef(final)
  skipRef.current = final
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useLayoutEffect(() => {
    if (!moveActionFocus.current) return
    const target =
      phase === "done" ? doneButton.current : phase === "playing" ? skipButton.current : null
    if (target) {
      target.focus({ preventScroll: true })
      moveActionFocus.current = false
    }
  }, [phase])

  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = "hidden"
    title.current?.focus()
    const cancel = (event: Event) => {
      event.preventDefault()
      if (phaseRef.current === "playing") skipRef.current()
      else closeRef.current()
    }
    element.addEventListener("cancel", cancel)
    return () => {
      run.current += 1
      timers.current.forEach((timer) => window.clearTimeout(timer))
      frames.current.forEach((frame) => window.cancelAnimationFrame(frame))
      element.removeEventListener("cancel", cancel)
      element.close()
      document.body.style.overflow = overflow
      const candidates = [
        trigger,
        document.querySelector<HTMLElement>(".ns-sidebar-brand"),
        document.querySelector<HTMLElement>(".bureau-brand"),
      ]
      candidates
        .find(
          (target) =>
            target?.isConnected &&
            target !== document.body &&
            target !== document.documentElement &&
            !target.matches(":disabled") &&
            (typeof target.checkVisibility !== "function" ||
              target.checkVisibility({ checkVisibilityCSS: true })),
        )
        ?.focus()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setPhase("loading")
    setReceipt(null)
    const timeout = window.setTimeout(() => controller.abort(), 12_000)
    fetch(`/api/boards/${encodeURIComponent(boardId)}/completion`, {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Receipt unavailable")
        return readReceipt(await response.json(), boardId)
      })
      .then((next) => {
        if (!active) return
        setDisplayedXp(next.progression.before.total_xp)
        setReceipt(next)
        setPhase(next.ready ? "playing" : "waiting")
      })
      .catch(() => {
        if (active) setPhase("error")
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [boardId, attempt])

  useEffect(() => {
    if (!receipt?.ready) return
    if (reduced) {
      skipRef.current()
      return
    }
    const token = ++run.current
    const valid = () => run.current === token
    setPhase("playing")
    setDisplayedXp(receipt.progression.before.total_xp)
    setStates(receipt.tasks.map(() => "pending"))
    setImpact(0)
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
          timers.current.delete(timer)
          resolve()
        }, ms)
        timers.current.add(timer)
      })
    const tween = (from: number, to: number, duration: number) =>
      new Promise<void>((resolve) => {
        let start: number | null = null
        const tick = (time: number) => {
          if (!valid()) {
            resolve()
            return
          }
          start ??= time
          const fraction = Math.min(1, (time - start) / duration)
          setDisplayedXp(Math.round(from + (to - from) * (1 - (1 - fraction) ** 3)))
          if (fraction === 1) resolve()
          else schedule(tick)
        }
        const schedule = (callback: (time: number) => void) => {
          const frame = window.requestAnimationFrame((time) => {
            frames.current.delete(frame)
            callback(time)
          })
          frames.current.add(frame)
        }
        schedule(tick)
      })
    const update = (index: number, state: TaskState) => {
      if (valid())
        setStates((previous) => previous.map((value, i) => (i === index ? state : value)))
    }
    void (async () => {
      await wait(450)
      const targets = replayTargets(receipt)
      let current = receipt.progression.before.total_xp
      for (let index = 0; index < receipt.tasks.length; index++) {
        if (!valid()) return
        const task = receipt.tasks[index]
        const name = task.title_i18n?.[language] || task.title
        if (task.status === "COMPLETED") {
          const source = cards.current[index]?.getBoundingClientRect()
          const target = avatar.current?.getBoundingClientRect()
          setFlight(
            source && target
              ? {
                  "--cc-flight-x": `${target.left + target.width / 2 - source.left - source.width / 2}px`,
                  "--cc-flight-y": `${target.top + target.height / 2 - source.top - source.height / 2}px`,
                }
              : {},
          )
          update(index, "flying")
          await wait(650)
          if (!valid()) return
          update(index, "absorbed")
          setImpact(index + 1)
          setAnnouncement(`${name}: +${task.xp} XP`)
          const targetXp = targets[index]
          const boundaries = receipt.progression.levels
            .slice(1)
            .map((band) => band.start_xp)
            .filter((threshold) => threshold > current && threshold <= targetXp)
          const steps = [...new Set([...boundaries, targetXp])]
          for (const nextXp of steps) {
            if (!valid()) return
            await tween(current, nextXp, Math.max(180, 850 / steps.length))
            current = nextXp
            if (boundaries.includes(nextXp)) await wait(120)
          }
        } else {
          update(index, "breaking")
          setAnnouncement(`${name}: ${ru ? "без награды" : "no reward"}`)
          await wait(750)
          update(index, "broken")
        }
        await wait(150)
      }
      if (valid()) skipRef.current()
    })()
    return () => {
      run.current += 1
      timers.current.forEach((timer) => window.clearTimeout(timer))
      frames.current.forEach((frame) => window.cancelAnimationFrame(frame))
      timers.current.clear()
      frames.current.clear()
    }
  }, [receipt, reduced, replay, language, ru])

  const meter = receipt ? progressAt(displayedXp, receipt.progression.levels) : null
  const successful = receipt?.tasks.filter((task) => task.status === "COMPLETED").length || 0
  const announcedLevel = useRef(0)
  const gainedLevels = receipt
    ? Math.max(0, (meter?.level || 0) - receipt.progression.before.level)
    : 0
  useEffect(() => {
    if (!receipt || !meter) return
    if (
      phase === "playing" &&
      meter.level > receipt.progression.before.level &&
      meter.level > announcedLevel.current
    ) {
      setAnnouncement(ru ? `Достигнут уровень ${meter.level}` : `Level ${meter.level} reached`)
    }
    announcedLevel.current = meter.level
  }, [meter?.level, phase, receipt, ru])
  const taskStatus = (task: CompletionTask) => {
    if (task.status === "COMPLETED") return ru ? "Выполнено" : "Completed"
    if (task.status === "VOID") return ru ? "Не засчитано" : "Voided"
    if (task.status === "EXPIRED") return ru ? "Время истекло" : "Expired"
    return ru ? "Не выполнено" : "Not completed"
  }
  return (
    <dialog
      className="case-completion"
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      data-phase={phase}
      data-motion={reduced ? "reduced" : "full"}
    >
      <header className="cc-header">
        <div>
          <span>DEADLOCK CONTRACTS</span>
          <h2 ref={title} tabIndex={-1} id={`${id}-title`}>
            {ru ? "Итоги контракта" : "Contract results"}
          </h2>
        </div>
        <button
          type="button"
          className="cc-close"
          onClick={onClose}
          aria-label={ru ? "Закрыть итог" : "Close results"}
        >
          <Icon name="x" />
        </button>
      </header>
      <p id={`${id}-description`} className="cc-description">
        {receipt?.ready
          ? ru
            ? "Твой матч. Твой результат. XP уже зачислен — здесь его итог."
            : "Your match. Your result. XP is already credited — this is its recap."
          : ru
            ? "Окончательный итог по выбранным заданиям."
            : "The verified result of your selected tasks."}
      </p>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {phase === "loading" && (
        <div className="cc-feedback" role="status">
          <span className="cc-spinner" />
          {ru ? "Собираем подтверждённый результат…" : "Loading your verified result…"}
        </div>
      )}
      {(phase === "error" || phase === "waiting") && (
        <div className="cc-feedback" role={phase === "error" ? "alert" : "status"}>
          <Icon name={phase === "error" ? "triangle-alert" : "hourglass"} size={28} />
          <h3>
            {phase === "error"
              ? ru
                ? "Не удалось загрузить итог"
                : "Could not load results"
              : ru
                ? "Результат ещё готовится"
                : "Your result is still being prepared"}
          </h3>
          <p>
            {phase === "error"
              ? ru
                ? "Проверь соединение и попробуй снова. Прогресс сохранён."
                : "Check your connection and retry. Your progress is safe."
              : receipt?.reason === "REWARDS_PENDING"
                ? ru
                  ? "Задания проверены. Ждём подтверждения начисленного XP."
                  : "Tasks are verified. Waiting for the XP receipt."
                : ru
                  ? "Ждём окончательной проверки всех выбранных заданий."
                  : "Waiting for the final verdict on every selected task."}
          </p>
          <button
            type="button"
            className="cc-primary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {ru ? "Проверить снова" : "Try again"}
          </button>
        </div>
      )}
      {receipt?.ready && meter && (
        <>
          <div className="cc-stage">
            <section className="cc-profile" aria-label={ru ? "Профиль игрока" : "Player profile"}>
              <div className="cc-avatar" ref={avatar} data-level={meter.level}>
                <span>{receipt.user.display_name.slice(0, 2).toUpperCase()}</span>
                {receipt.user.avatar_url && (
                  <img
                    src={receipt.user.avatar_url}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.hidden = true
                    }}
                  />
                )}
                {impact > 0 && phase === "playing" && (
                  <i
                    className="cc-level-ring"
                    key={`impact-${replay}-${impact}`}
                    aria-hidden="true"
                  />
                )}
                {gainedLevels > 0 && (
                  <i
                    className="cc-level-ring"
                    key={`${replay}-${meter.level}`}
                    aria-hidden="true"
                  />
                )}
              </div>
              <h3>{receipt.user.display_name}</h3>
              <div
                className="cc-level"
                key={meter.level}
                role="group"
                aria-label={ru ? `Уровень ${meter.level}` : `Level ${meter.level}`}
              >
                <NavigationIcon name="leaderboards" />
                <strong>{meter.level}</strong>
                <span>
                  {gainedLevels ? (ru ? "Уровень повышен" : "Level up") : ru ? "Уровень" : "Level"}
                </span>
              </div>
              <div className="cc-xp-label">
                <span>
                  {meter.value.toLocaleString(locale)} / {meter.cost.toLocaleString(locale)} XP
                </span>
                <span>{Math.floor(meter.percent)}%</span>
              </div>
              <progress
                className="cc-progress"
                value={meter.value}
                max={meter.cost}
                aria-label={ru ? "Опыт до следующего уровня" : "Experience toward next level"}
              />
              <p className="cc-total">
                {displayedXp.toLocaleString(locale)} <span>{ru ? "всего XP" : "total XP"}</span>
              </p>
              <span className="cc-earned">
                +{receipt.total_xp.toLocaleString(locale)} XP{" "}
                <small>{ru ? "за это дело" : "from this case"}</small>
              </span>
            </section>
            <ol className="cc-tasks" aria-label={ru ? "Выбранные задания" : "Selected tasks"}>
              {receipt.tasks.map((task, index) => {
                const name = task.title_i18n?.[language] || task.title
                const taskState = states[index] || "pending"
                return (
                  <li
                    className="cc-task"
                    key={task.id}
                    ref={(element) => {
                      cards.current[index] = element
                    }}
                    data-task-state={taskState}
                    data-outcome={task.status}
                    style={flight as CSSProperties}
                  >
                    <div className="cc-task-content">
                      <span className="cc-task-number">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <h3>{name}</h3>
                        <span>{taskStatus(task)}</span>
                      </div>
                      <strong>
                        +{task.xp} <small>XP</small>
                      </strong>
                    </div>
                    {taskState === "breaking" &&
                      ["left", "right"].map((half) => (
                        <div className={`cc-shard cc-shard-${half}`} aria-hidden="true" key={half}>
                          <span>{name}</span>
                          <strong>0 XP</strong>
                        </div>
                      ))}
                    {(taskState === "absorbed" || taskState === "broken") && (
                      <div className="cc-task-receipt" aria-hidden="true">
                        <Icon name={taskState === "absorbed" ? "check" : "x"} size={17} />
                        <span>{name}</span>
                        <strong>
                          {taskState === "absorbed" ? `+${task.xp} XP` : taskStatus(task)}
                        </strong>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
          <footer className="cc-footer">
            <div>
              <strong>
                {phase === "done"
                  ? successful
                    ? ru
                      ? "Контракт завершён"
                      : "Contract complete"
                    : ru
                      ? "Попытки закончились"
                      : "Attempts exhausted"
                  : ru
                    ? "Подводим итоги"
                    : "Wrapping up"}
              </strong>
              <p>
                {ru
                  ? `Выполнено ${successful} из ${receipt.tasks.length} · Получено ${receipt.total_xp} XP`
                  : `${successful} of ${receipt.tasks.length} completed · ${receipt.total_xp} XP earned`}
              </p>
            </div>
            {phase === "playing" ? (
              <button ref={skipButton} type="button" className="cc-primary" onClick={final}>
                {ru ? "Пропустить анимацию" : "Skip animation"}
              </button>
            ) : (
              <div className="cc-actions">
                <button
                  type="button"
                  className="cc-secondary"
                  ref={replayButton}
                  onClick={() => {
                    if (document.activeElement === replayButton.current)
                      moveActionFocus.current = true
                    setReplay((value) => value + 1)
                  }}
                  disabled={reduced}
                >
                  {ru ? "Повторить" : "Replay"}
                </button>
                <button ref={doneButton} type="button" className="cc-primary" onClick={onClose}>
                  {ru ? "Готово" : "Done"}
                </button>
              </div>
            )}
          </footer>
          <p className="cc-note">
            {ru
              ? "Это просмотр результата. Повтор и пропуск не меняют награды. Текущий баланс учитывает все изменения профиля."
              : "This is a recap. Replay and skip never change rewards. Your current balance includes all profile changes."}
          </p>
        </>
      )}
    </dialog>
  )
}
