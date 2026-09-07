import { useEffect, useId, useRef, useState } from "react"
import { useLanguage } from "./i18n"
import { SelectionChangedError, SigningUnconfirmedError } from "./contract-signing"

// Seal supplied in the user's Figma Make reference. The animation is decorative;
// the signed state is entered only after the caller confirms the server lock.
function WaxSeal() {
  return (
    <svg
      className="signing-seal"
      width="88"
      height="88"
      viewBox="0 0 96 96"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="48" cy="48" r="44" fill="#61382C" stroke="#8F795A" strokeWidth="2" />
      <circle
        cx="48"
        cy="48"
        r="36"
        fill="#7a4638"
        stroke="#A08060"
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      <circle cx="48" cy="48" r="20" fill="#61382C" stroke="#DDCDAD" strokeWidth="1.5" />
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <line
          key={angle}
          x1="48"
          y1="28"
          x2="48"
          y2="24"
          stroke="#DDCDAD"
          strokeWidth="1.5"
          transform={`rotate(${angle} 48 48)`}
        />
      ))}
      <circle cx="48" cy="48" r="6" fill="#DDCDAD" opacity=".9" />
      <circle cx="46" cy="46" r="2" fill="#8F795A" />
    </svg>
  )
}

export default function ContractSigning({
  mode,
  operator,
  options,
  changed,
  onSign,
  onClose,
  onOpenCase,
}: {
  mode: string
  operator: string
  options: { id: string; title: string; description: string; reward: number }[]
  changed: boolean
  onSign: () => Promise<void>
  onClose: () => void
  onOpenCase: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const inFlight = useRef(false)
  const titleId = useId()
  const descriptionId = useId()
  const [state, setState] = useState<"review" | "pending" | "signed">("review")
  const [error, setError] = useState("")
  const [stale, setStale] = useState(false)
  const unavailable = changed || stale

  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = "hidden"
    heading.current?.focus()
    return () => {
      element.close()
      document.body.style.overflow = overflow
      if (trigger?.isConnected && !trigger.matches(":disabled")) trigger.focus()
      else document.querySelector<HTMLButtonElement>(".bureau-brand")?.focus()
    }
  }, [])
  useEffect(() => {
    if (state === "signed") heading.current?.focus()
  }, [state])

  const sign = async () => {
    if (inFlight.current || state === "signed" || unavailable) return
    inFlight.current = true
    setState("pending")
    setError("")
    try {
      await onSign()
      setState("signed")
    } catch (reason) {
      if (reason instanceof SelectionChangedError) setStale(true)
      else
        setError(
          reason instanceof SigningUnconfirmedError
            ? ru
              ? "Не удалось узнать, принята ли печать. Проверьте соединение и повторите: сначала проверим состояние дела."
              : "We could not confirm whether the seal was accepted. Check your connection and retry: we will check the case first."
            : ru
              ? "Не удалось подтвердить подписание. Проверьте соединение и повторите. Ваш выбор сохранён."
              : "Signing could not be confirmed. Check your connection and retry. Your selection is preserved.",
        )
      setState("review")
    } finally {
      inFlight.current = false
    }
  }
  return (
    <dialog
      ref={dialog}
      className="signing-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        if (!inFlight.current) onClose()
      }}
    >
      <div className="signing-document">
        <header className="signing-heading">
          <div>
            <p className="signing-eyebrow">DEADLOCK CONTRACTS · {ru ? "БЮРО" : "BUREAU"}</p>
            <h2 ref={heading} tabIndex={-1} id={titleId}>
              {state === "signed"
                ? ru
                  ? "Условия зафиксированы"
                  : "Terms are sealed"
                : ru
                  ? "Подписание контракта"
                  : "Sign your contract"}
            </h2>
          </div>
          <button
            className="signing-close"
            disabled={state === "pending"}
            onClick={onClose}
            aria-label={ru ? "Закрыть договор" : "Close contract"}
          >
            ×
          </button>
        </header>
        <p id={descriptionId} className="signing-intro">
          {ru
            ? "Проверьте условия перед тем, как поставить печать. После подписания изменить выбор нельзя."
            : "Review the terms before placing your seal. Your selection cannot be changed after signing."}
        </p>
        <dl className="signing-identity">
          <div>
            <dt>{ru ? "Исполнитель" : "Operator"}</dt>
            <dd>{operator}</dd>
          </div>
          <div>
            <dt>{ru ? "Режим" : "Mode"}</dt>
            <dd>{mode}</dd>
          </div>
        </dl>
        <ol className="signing-terms">
          {options.map((option) => (
            <li key={option.id}>
              <div>
                <h3>{option.title}</h3>
                <p>{option.description}</p>
              </div>
              <strong>+{option.reward} XP</strong>
            </li>
          ))}
        </ol>
        <div className="signing-reward">
          <span>{ru ? "Возможная награда" : "Potential reward"}</span>
          <strong>+{options.reduce((sum, option) => sum + option.reward, 0)} XP</strong>
        </div>
        <p className="signing-note">
          {ru
            ? "XP начисляется за выполненные условия после проверки матча."
            : "XP is awarded for completed conditions after match verification."}
        </p>
        {state === "signed" ? (
          <div className="signing-success" role="status">
            <WaxSeal />
            <p>
              {ru
                ? "Бюро приняло условия. Ваше дело открыто."
                : "The bureau accepted your terms. Your case is open."}
            </p>
            <button className="signing-primary" onClick={onOpenCase}>
              {ru ? "Открыть дело" : "Open case"}
            </button>
          </div>
        ) : (
          <>
            {unavailable && (
              <p className="signing-error" role="alert">
                {ru
                  ? "Доска изменилась. Вернитесь к контрактам и проверьте актуальные условия."
                  : "The board has changed. Return to the contracts and review the current terms."}
              </p>
            )}
            {error && !unavailable && (
              <p className="signing-error" role="alert">
                {error}
              </p>
            )}
            <div className="signing-actions">
              <button
                className="signing-secondary"
                disabled={state === "pending"}
                onClick={onClose}
              >
                {ru ? "Вернуться к выбору" : "Back to selection"}
              </button>
              <button
                className="signing-primary"
                disabled={state === "pending" || unavailable}
                onClick={() => void sign()}
              >
                {state === "pending"
                  ? ru
                    ? "Подтверждаем…"
                    : "Confirming…"
                  : ru
                    ? "Поставить печать"
                    : "Place seal"}
              </button>
            </div>
            <p className="signing-progress" role="status">
              {state === "pending"
                ? ru
                  ? "Ожидаем подтверждения бюро…"
                  : "Waiting for confirmation from the bureau…"
                : ""}
            </p>
          </>
        )}
      </div>
    </dialog>
  )
}
