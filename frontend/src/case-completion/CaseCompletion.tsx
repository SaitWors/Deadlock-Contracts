import { useEffect, useId, useRef, useState, type CSSProperties } from "react"
import { useLanguage } from "../i18n"
import { useReducedMotion } from "../Appearance"
import Icon from "../icons/Icon"
import { readReceipt } from "./timeline"
import { runFinale, type FinaleFrame, type Meter } from "./finale-motion"
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
  const stage = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const id = useId()
  const [receipt, setReceipt] = useState<CompletionReceipt | null>(null)
  const [status, setStatus] = useState<"loading" | "waiting" | "error" | "ready">("loading")
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<FinaleFrame["phase"]>("entering")
  const [states, setStates] = useState<TaskState[]>([])
  const [meter, setMeter] = useState<Meter | null>(null)
  const [centered, setCentered] = useState(false)
  const [impact, setImpact] = useState({ key: 0, kind: "hit" as "hit" | "level" })

  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    element.showModal()
    element.focus({ preventScroll: true })
    document.body.style.overflow = "hidden"
    const cancel = (event: Event) => {
      event.preventDefault()
      closeRef.current()
    }
    element.addEventListener("cancel", cancel)
    return () => {
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
        ?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setStatus("loading")
    setReceipt(null)
    setMeter(null)
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
        setReceipt(next)
        setStatus(next.ready ? "ready" : "waiting")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [boardId, attempt])

  useEffect(() => {
    if (!receipt?.ready || !stage.current) return
    const controller = new AbortController()
    const root = stage.current
    const one = (selector: string) => root.querySelector<HTMLElement>(selector)!
    const all = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector))
    setStates(receipt.tasks.map(() => "pending"))
    setCentered(false)
    setImpact({ key: 0, kind: "hit" })
    const update = (next: FinaleFrame) => {
      if (controller.signal.aborted) return
      setPhase(next.phase)
      if (next.phase === "done")
        setStates(
          receipt.tasks.map((task) => (task.status === "COMPLETED" ? "absorbed" : "broken")),
        )
      if (next.meter) setMeter(next.meter)
      if (next.centered !== undefined) setCentered(next.centered)
      if (next.taskIndex !== undefined && next.taskState) {
        setStates((previous) =>
          previous.map((state, index) => (index === next.taskIndex ? next.taskState! : state)),
        )
      }
      if (next.impact) setImpact((previous) => ({ key: previous.key + 1, kind: next.impact! }))
    }
    void runFinale(
      {
        stage: root,
        profileEntry: one(".cf-profile-entry"),
        profileShift: one(".cf-profile-shift"),
        profileDrift: one(".cf-profile-drift"),
        profileHit: one(".cf-profile-hit"),
        profilePanel: one(".cc-profile"),
        levelNumber: one(".cc-level strong"),
        bar: one(".cf-bar"),
        entries: all(".cf-task-entry"),
        drifts: all(".cf-task-drift"),
        flights: all(".cf-flight"),
        panels: all(".cc-task"),
      },
      receipt,
      update,
      controller.signal,
    ).catch(() => {
      if (!controller.signal.aborted) setStatus("error")
    })
    return () => controller.abort()
  }, [receipt, reduced])

  const format = (value: number) => value.toLocaleString(locale)
  const final = receipt?.progression.after
  const initial = receipt?.replayable && !reduced ? receipt.progression.before : final
  const shown =
    meter ||
    (initial
      ? {
          total: initial.total_xp,
          level: initial.level,
          value: initial.level_xp,
          cost: initial.next_level_xp,
          percent: initial.progress_pct,
        }
      : null)
  const title = ru ? "Итог контракта" : "Contract result"
  const staticResult = !!receipt && (!receipt.replayable || reduced)
  const taskContent = (task: CompletionTask) => (
    <>
      <Icon name={task.status === "COMPLETED" ? "check" : "x"} size={24} />
      <span className="cf-task-title">{task.title_i18n?.[language] || task.title}</span>
      <strong className="cf-task-xp">
        {task.xp > 0 ? "+" : ""}
        {format(task.xp)} XP
      </strong>
    </>
  )

  return (
    <dialog
      ref={dialog}
      className="case-completion"
      aria-labelledby={id}
      tabIndex={-1}
      data-phase={status === "ready" ? phase : status}
      data-centered={centered}
      data-static={staticResult}
      onClick={(event) => {
        if (event.target === event.currentTarget || event.target === stage.current)
          closeRef.current()
      }}
    >
      <h2 id={id} className="sr-only">
        {title}
      </h2>
      <button type="button" className="sr-only cf-return" onClick={() => closeRef.current()}>
        {ru ? "Вернуться к результату в кабинете" : "Return to the result in your dashboard"}
      </button>
      {status !== "ready" ? (
        <div className="cf-notice" role={status === "error" ? "alert" : "status"}>
          <p>
            {status === "loading"
              ? ru
                ? "Открываем итог…"
                : "Opening result…"
              : status === "waiting"
                ? ru
                  ? "Проверка ещё не завершена"
                  : "Verification is still in progress"
                : ru
                  ? "Не удалось открыть итог"
                  : "The result could not be opened"}
          </p>
          {status !== "loading" && (
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {ru ? "Повторить" : "Retry"}
            </button>
          )}
        </div>
      ) : (
        receipt && (
          <div ref={stage} className="cf-stage">
            <div className="cf-profile-entry cf-entry">
              <div className="cf-profile-shift">
                <div className="cf-profile-drift cf-drift">
                  <div
                    className="cf-profile-hit"
                    style={{ "--cf-progress": `${shown?.percent || 0}%` } as CSSProperties}
                  >
                    <div
                      className="cc-profile cf-panel"
                      style={{ "--cf-progress": `${shown?.percent || 0}%` } as CSSProperties}
                    >
                      <div className="cf-identity">
                        <div className="cf-avatar">
                          {receipt.user.avatar_url ? (
                            <img src={receipt.user.avatar_url} alt="" />
                          ) : (
                            <span>
                              {receipt.user.display_name.trim().slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="cf-name-level">
                          <div className="cf-name">{receipt.user.display_name}</div>
                          <div className="cc-level">
                            {ru ? "Уровень" : "Level"} <strong>{shown?.level ?? "—"}</strong>
                          </div>
                        </div>
                      </div>
                      <div className="cf-xp">
                        <div
                          className="cf-bar"
                          role="progressbar"
                          aria-label={ru ? "Опыт уровня" : "Level experience"}
                          aria-valuenow={shown?.value}
                          aria-valuemin={0}
                          aria-valuemax={shown?.cost}
                        >
                          <div className="cf-bar-fill" />
                        </div>
                        <div className="cc-total">
                          {shown ? `${format(shown.value)} / ${format(shown.cost)} XP` : "— / — XP"}
                        </div>
                      </div>
                    </div>
                    {impact.key > 0 && (
                      <div
                        key={impact.key}
                        aria-hidden="true"
                        className={`cf-impact cf-impact--${impact.kind}`}
                      >
                        <div className="cf-contour" />
                        <div className="cf-contact" />
                        {impact.kind === "level" && (
                          <>
                            <i className="cf-wave" />
                            <i className="cf-wave cf-wave--second" />
                          </>
                        )}
                        {Array.from({ length: impact.kind === "level" ? 14 : 6 }, (_, index) => (
                          <i
                            key={index}
                            className="cf-spark"
                            style={
                              { "--i": index, "--angle": `${index * 137.5}deg` } as CSSProperties
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <ol className="cf-tasks" aria-label={ru ? "Задания контракта" : "Contract tasks"}>
              {receipt.tasks.map((task, index) => (
                <li
                  key={task.id}
                  className="cf-task-entry cf-entry"
                  data-state={states[index] || "pending"}
                  data-task-state={states[index] || "pending"}
                  data-outcome={task.status === "COMPLETED" ? "success" : "failed"}
                >
                  <div className="cf-task-drift cf-drift">
                    <div className="cf-flight">
                      <div className="cf-trail" aria-hidden="true" />
                      <div className="cc-task cf-panel">{taskContent(task)}</div>
                      <div className="cf-fracture" aria-hidden="true">
                        <div className="cc-shard cf-panel cf-shard--left">{taskContent(task)}</div>
                        <div className="cc-shard cf-panel cf-shard--right">{taskContent(task)}</div>
                        {Array.from({ length: 7 }, (_, shard) => (
                          <i
                            key={shard}
                            className="cf-debris"
                            style={{ "--i": shard } as CSSProperties}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <p className="sr-only" role="status" aria-live="polite">
              {phase === "done"
                ? ru
                  ? `Итог контракта. Начислено ${receipt.total_xp} XP.`
                  : `Contract result. Awarded ${receipt.total_xp} XP.`
                : phase === "levelup" && shown
                  ? ru
                    ? `Уровень ${shown.level}`
                    : `Level ${shown.level}`
                  : ""}
            </p>
          </div>
        )
      )}
    </dialog>
  )
}
