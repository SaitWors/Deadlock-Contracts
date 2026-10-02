import Icon from "./icons/Icon"
import { useEffect, useId, useRef, useState } from "react"
import { useLanguage } from "./i18n"
import { SelectionChangedError, SigningUnconfirmedError } from "./contract-signing"
import { useReducedMotion } from "./Appearance"
import "./contract-signing.css"

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

function canRestoreFocus(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.matches(":disabled") || element.closest("[hidden], [inert]"))
    return false
  if (typeof element.checkVisibility === "function")
    return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    )
      return false
  }
  return true
}

export default function ContractSigning(props: SigningProps) {
  const { mode, operator, options, changed, onClose } = props
  const preview = props.preview === true
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const reducedMotion = useReducedMotion()
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const inFlight = useRef(false)
  const titleId = useId()
  const descriptionId = useId()
  const termsId = useId()
  const signatureId = useId()
  const signatureHintId = useId()
  const [state, setState] = useState<"review" | "pending" | "signed">("review")
  const [receipt, setReceipt] = useState<SigningReceipt | null>(null)
  const [error, setError] = useState("")
  const [stale, setStale] = useState(false)
  const [signature, setSignature] = useState(operator)
  const unavailable = changed || stale
  const autograph = signature.trim() || operator
  const reward = options.reduce((sum, option) => sum + option.reward, 0)
  const step = state === "signed" ? 2 : state === "pending" ? 1 : 0

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
      const targets = [
        trigger,
        document.querySelector<HTMLElement>(".ns-sidebar-brand"),
        ...document.querySelectorAll<HTMLElement>(".bureau-brand"),
      ]
      targets.find(canRestoreFocus)?.focus()
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
      data-state={state}
      data-motion={reducedMotion ? "reduced" : "full"}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        if (!inFlight.current) onClose()
      }}
    >
      <div className="signing-folder-bar">
        <div className="signing-folder-label">
          <Icon name="file-text" size={18} />
          <span>{ru ? "Досье контракта" : "Contract dossier"}</span>
          <span className="signing-mode">{mode}</span>
        </div>
        <button
          className="signing-close"
          disabled={state === "pending"}
          onClick={onClose}
          aria-label={ru ? "Закрыть договор" : "Close contract"}
        >
          <Icon name="x" />
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
        <p id={descriptionId} className="signing-intro">
          {preview
            ? ru
              ? "Посмотрите, как выглядит договор. Настоящее дело можно открыть после входа через Steam."
              : "Preview your contract. Sign in with Steam to open a real case."
            : state === "signed"
              ? ru
                ? "Бюро подтвердило контракт. Выполните выбранные условия до окончания срока дела."
                : "The bureau confirmed your contract. Complete the selected terms before the case deadline."
              : ru
                ? "Проверьте условия перед тем, как поставить печать. После подписания изменить выбор нельзя."
                : "Review the terms before placing your seal. Your selection cannot be changed after signing."}
        </p>
        {preview && (
          <p className="signing-demo" role="note">
            <Icon name="info" size={17} />
            {ru
              ? "Демонстрация. Контракт не сохраняется, XP не начисляется."
              : "Demo only. No contract is saved and no XP is awarded."}
          </p>
        )}
        <ol className="signing-steps" aria-label={ru ? "Этапы подписания" : "Signing progress"}>
          {(ru
            ? ["Проверить условия", "Поставить печать", preview ? "Пример готов" : "Открыть дело"]
            : ["Review terms", "Place seal", preview ? "Preview ready" : "Open case"]
          ).map((label, index) => (
            <li
              key={label}
              aria-current={step === index ? "step" : undefined}
              data-complete={step > index}
            >
              <span className="signing-step-number" aria-hidden="true">
                {step > index ? <Icon name="check" size={14} /> : index + 1}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
        <div className="signing-layout">
          <section className="signing-terms-panel" aria-labelledby={termsId}>
            <div className="signing-section-heading">
              <h3 id={termsId}>{ru ? "Выбранные условия" : "Selected terms"}</h3>
              <span>{String(options.length).padStart(2, "0")}</span>
            </div>
            <ol className="signing-terms">
              {options.map((option, index) => (
                <li key={option.id}>
                  <span className="signing-term-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{option.title}</h3>
                    <p>{option.description}</p>
                  </div>
                  <strong>+{option.reward} XP</strong>
                </li>
              ))}
            </ol>
            <p className="signing-note">
              <Icon name="shield-check" size={18} />
              <span>
                {ru
                  ? "XP начисляется за выполненные условия после проверки матча."
                  : "XP is awarded for completed conditions after match verification."}
              </span>
            </p>
          </section>
          <aside
            className="signing-summary"
            aria-label={ru ? "Сводка контракта" : "Contract summary"}
          >
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
            <div className="signing-reward">
              <span>{ru ? "Возможная награда" : "Potential reward"}</span>
              <strong>
                +{reward} <small>XP</small>
              </strong>
            </div>
            <div className="signing-signature">
              <div className="signing-signature-preview" aria-hidden="true">
                <span className="signing-signature-caption">
                  {ru ? "Подпись исполнителя" : "Operator signature"}
                </span>
                <span className="signing-autograph">{autograph}</span>
                <svg className="signing-signature-line" viewBox="0 0 240 16" fill="none">
                  <path d="M2 12C58 3 124 9 168 6c31-2 54-4 70-3" pathLength="1" />
                </svg>
              </div>
              {state !== "signed" && (
                <div className="signing-signature-field">
                  <label htmlFor={signatureId}>
                    {ru ? "Ваша подпись" : "Your signature"}
                    <span>{ru ? "необязательно" : "optional"}</span>
                  </label>
                  <input
                    id={signatureId}
                    name="signature"
                    type="text"
                    value={signature}
                    onChange={(event) => setSignature(event.target.value)}
                    disabled={state === "pending" || unavailable}
                    maxLength={80}
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={signatureHintId}
                  />
                  <p id={signatureHintId}>
                    {ru
                      ? "Оставьте поле пустым, чтобы использовать имя исполнителя."
                      : "Leave blank to use your operator name."}
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
        {state === "signed" ? (
          <div className="signing-success" role="status">
            <div className="signing-confirmed-heading">
              <div className="signing-seal" aria-hidden="true">
                <Icon name="check" size={20} />
                <span>{preview ? (ru ? "Образец" : "Sample") : ru ? "Принято" : "Accepted"}</span>
                <small>DEADLOCK CONTRACTS</small>
              </div>
              <p>
                {preview
                  ? ru
                    ? "Пример готов. После входа вы сможете выбрать условия на своей доске."
                    : "Preview complete. Sign in to choose terms from your own board."
                  : ru
                    ? "Бюро приняло условия. Ваше дело открыто."
                    : "The bureau accepted your terms. Your case is open."}
              </p>
            </div>
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
              <Icon name="arrow-up-right" size={18} />
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
            <p className="signing-acknowledgment">
              <Icon name="clipboard-check" size={19} />
              <span>
                {preview
                  ? ru
                    ? "Пробная печать покажет результат подписания. Для настоящего контракта нужен вход через Steam."
                    : "The sample seal previews the signing result. Sign in with Steam to create a real contract."
                  : ru
                    ? "Ставя печать, вы подтверждаете выбранные условия. Дело откроется после подтверждения бюро."
                    : "By placing your seal, you confirm the selected terms. Your case opens after the bureau confirms."}
              </span>
            </p>
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
                {state === "pending" ? (
                  <span className="signing-spinner" aria-hidden="true" />
                ) : (
                  <Icon name="shield-check" size={18} />
                )}
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
