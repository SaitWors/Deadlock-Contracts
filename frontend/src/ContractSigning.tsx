import { useEffect, useId, useRef, useState } from "react"
import { useLanguage } from "./i18n"
import { SelectionChangedError, SigningUnconfirmedError } from "./contract-signing"

import Regalia from "./regalia/Regalia"

type SigningReceipt = {
  id: string
  locked_at: string | null
  expires_at: string
  max_attempts: number
}

type SigningProps = {
  mode: string
  operator: string
  options: { id: string; title: string; description: string; reward: number }[]
  changed: boolean
  onClose: () => void
} & (
  | { preview: true; onSignIn: () => void; onSign?: never; onOpenCase?: never }
  | {
      preview?: false
      onSign: () => Promise<SigningReceipt>
      onOpenCase: () => void
      onSignIn?: never
    }
)

export default function ContractSigning(props: SigningProps) {
  const { mode, operator, options, changed, onClose } = props
  const preview = props.preview === true
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const inFlight = useRef(false)
  const titleId = useId()
  const descriptionId = useId()
  const [state, setState] = useState<"review" | "pending" | "signed">("review")
  const [receipt, setReceipt] = useState<SigningReceipt | null>(null)
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
    if (props.preview) {
      setState("signed")
      return
    }
    inFlight.current = true
    setState("pending")
    setError("")
    try {
      const confirmed = await props.onSign()
      setReceipt(confirmed)
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
      <div className="signing-folder-bar">
        <span>
          {ru ? "БЮРО / КОНТРАКТ" : "BUREAU / CONTRACT"} · {mode}
        </span>
        <button
          className="signing-close"
          disabled={state === "pending"}
          onClick={onClose}
          aria-label={ru ? "Закрыть договор" : "Close contract"}
        >
          ×
        </button>
      </div>
      <div className="signing-document">
        <header className="signing-heading">
          <div>
            <p className="signing-eyebrow">DEADLOCK CONTRACTS · {ru ? "БЮРО" : "BUREAU"}</p>
            <h2 ref={heading} tabIndex={-1} id={titleId}>
              {preview
                ? state === "signed"
                  ? ru
                    ? "Пробная печать поставлена"
                    : "Sample seal placed"
                  : ru
                    ? "Пример подписания"
                    : "Try signing a contract"
                : state === "signed"
                  ? ru
                    ? "Условия зафиксированы"
                    : "Terms are sealed"
                  : ru
                    ? "Подписание контракта"
                    : "Sign your contract"}
            </h2>
          </div>
        </header>
        {preview && (
          <p className="signing-demo" role="note">
            {ru
              ? "Демонстрация. Контракт не сохраняется, XP не начисляется."
              : "Demo only. No contract is saved and no XP is awarded."}
          </p>
        )}
        <p id={descriptionId} className="signing-intro">
          {preview
            ? ru
              ? "Посмотрите, как выглядит договор. Настоящее дело можно открыть после входа через Steam."
              : "Preview your contract. Sign in with Steam to open a real case."
            : ru
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
            <Regalia id="seal-team" className="signing-seal" />
            <p>
              {preview
                ? ru
                  ? "Пример готов. После входа вы сможете выбрать условия на своей доске."
                  : "Preview complete. Sign in to choose terms from your own board."
                : ru
                  ? "Бюро приняло условия. Ваше дело открыто."
                  : "The bureau accepted your terms. Your case is open."}
            </p>
            {!preview && receipt && (
              <dl className="signing-receipt">
                <div>
                  <dt>{ru ? "Номер дела" : "Case ID"}</dt>
                  <dd>{receipt.id}</dd>
                </div>
                {receipt.locked_at && (
                  <div>
                    <dt>{ru ? "Подписано" : "Signed"}</dt>
                    <dd>
                      <time dateTime={receipt.locked_at}>
                        {new Date(receipt.locked_at).toLocaleString(locale)}
                      </time>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{ru ? "Срок дела" : "Case deadline"}</dt>
                  <dd>
                    <time dateTime={receipt.expires_at}>
                      {new Date(receipt.expires_at).toLocaleString(locale)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>{ru ? "Лимит попыток" : "Attempt limit"}</dt>
                  <dd>{receipt.max_attempts}</dd>
                </div>
              </dl>
            )}
            <button
              className="signing-primary"
              onClick={preview ? props.onSignIn : props.onOpenCase}
            >
              {preview
                ? ru
                  ? "Войти через Steam"
                  : "Sign in with Steam"
                : ru
                  ? "Открыть дело"
                  : "Open case"}
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
                  : preview
                    ? ru
                      ? "Поставить пробную печать"
                      : "Place sample seal"
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
