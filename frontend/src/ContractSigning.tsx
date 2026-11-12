import Icon from "./icons/Icon"
import { useEffect, useId, useRef, useState } from "react"
import { matchModeLabel, useLanguage } from "./i18n"
import { SelectionChangedError, SigningUnconfirmedError } from "./contract-signing"
import { useReducedMotion } from "./Appearance"
import SignatureField from "./SignatureField"
import { readSignature, saveSignature, type Autograph } from "./signature-state"
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
  accountId?: string
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
  const mounted = useRef(true)
  const titleId = useId()
  const descriptionId = useId()
  const termsId = useId()
  const [state, setState] = useState<"review" | "pending" | "sealing" | "signed">("review")
  const [receipt, setReceipt] = useState<SigningReceipt | null>(null)
  const [error, setError] = useState("")
  const [stale, setStale] = useState(false)
  const storageKey = preview ? "public-demo" : props.accountId
  const [signature, setSignature] = useState(() => readSignature(storageKey, operator))
  const [signatureSaved, setSignatureSaved] = useState<boolean | null>(null)
  const updateSignature = (next: Autograph) => {
    setSignature(next)
    setSignatureSaved(saveSignature(storageKey, next))
  }
  const unavailable = changed || stale
  const reward = options.reduce((sum, option) => sum + option.reward, 0)
  const confirmed = state === "sealing" || state === "signed"
  const animating = state === "sealing"

  useEffect(() => {
    mounted.current = true
    const element = dialog.current!
    const trigger = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = "hidden"
    heading.current?.focus()
    return () => {
      mounted.current = false
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
    if (state === "sealing" || state === "signed") heading.current?.focus()
  }, [state])

  // The native imprint is cosmetic; a validated server receipt remains authoritative.
  useEffect(() => {
    if (!animating) return
    if (reducedMotion) {
      setState("signed")
      return
    }
    const timeout = window.setTimeout(() => setState("signed"), 1400)
    return () => window.clearTimeout(timeout)
  }, [animating, reducedMotion])

  const sign = async () => {
    if (inFlight.current || confirmed || unavailable) return
    if (props.preview) {
      setState(reducedMotion ? "signed" : "sealing")
      return
    }
    inFlight.current = true
    setState("pending")
    setError("")
    try {
      const confirmedReceipt = await props.onSign()
      if (!mounted.current) return
      if (
        !confirmedReceipt?.id ||
        !confirmedReceipt.locked_at ||
        !Number.isFinite(Date.parse(confirmedReceipt.locked_at)) ||
        !Number.isFinite(Date.parse(confirmedReceipt.expires_at)) ||
        !Number.isInteger(confirmedReceipt.max_attempts) ||
        confirmedReceipt.max_attempts < 1
      )
        throw new SigningUnconfirmedError()
      setReceipt(confirmedReceipt)
      setState(reducedMotion ? "signed" : "sealing")
    } catch (reason) {
      if (!mounted.current) return
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
        if (animating) setState("signed")
        else if (!inFlight.current) onClose()
      }}
    >
      <article className="signing-document signing-scroll">
        <button
          type="button"
          className="signing-close"
          disabled={state === "pending"}
          onClick={onClose}
          aria-label={ru ? "Закрыть договор" : "Close contract"}
        >
          <Icon name="x" />
        </button>
        <header className="signing-heading">
          <p className="signing-eyebrow">
            DEADLOCK CONTRACTS <span>/ {preview ? "DEMO" : "CITY BUREAU"}</span>
          </p>
          <div className="signing-letterhead" aria-hidden="true">
            <span />
            <Icon name="eye" size={30} />
            <span />
          </div>
          <p className="signing-document-type">
            {ru ? "Бюро особых поручений" : "Bureau of unusual affairs"}
          </p>
          <h2 ref={heading} tabIndex={-1} id={titleId}>
            {preview
              ? confirmed
                ? ru
                  ? "Пробная печать поставлена"
                  : "Sample seal placed"
                : ru
                  ? "Пример подписания"
                  : "Try signing a contract"
              : confirmed
                ? ru
                  ? "Условия зафиксированы"
                  : "Terms are sealed"
                : ru
                  ? "Договор исполнителя"
                  : "Operator agreement"}
          </h2>
        </header>
        <p id={descriptionId} className="signing-intro">
          {preview
            ? ru
              ? "Пример договора. Настоящее дело можно открыть после входа через Steam."
              : "Preview your contract. Sign in with Steam to open a real case."
            : confirmed
              ? ru
                ? "Бюро подтвердило контракт. Выполните выбранные условия до окончания срока дела."
                : "The bureau confirmed your contract. Complete the selected terms before the case deadline."
              : ru
                ? "Проверьте условия и оставьте свою подпись. После подписания изменить выбор нельзя."
                : "Review the terms and add your signature. Your selection cannot be changed after signing."}
        </p>
        {preview && (
          <p className="signing-demo" role="note">
            {ru
              ? "Демонстрация. Контракт не сохраняется, XP не начисляется."
              : "Demo only. No contract is saved and no XP is awarded."}
          </p>
        )}
        <dl className="signing-identity">
          <div>
            <dt>{ru ? "Исполнитель" : "Operator"}</dt>
            <dd>{operator}</dd>
          </div>
          <div>
            <dt>{ru ? "Режим" : "Mode"}</dt>
            <dd>{matchModeLabel(mode, language)}</dd>
          </div>
          <div className="signing-reward">
            <dt>{ru ? "Возможная награда" : "Potential reward"}</dt>
            <dd>
              <strong>
                +{reward} <small>XP</small>
              </strong>
            </dd>
          </div>
        </dl>
        <section aria-labelledby={termsId}>
          <div className="signing-section-heading">
            <h3 id={termsId}>{ru ? "Условия поручения" : "Terms of assignment"}</h3>
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
        </section>
        <p className="signing-note">
          <Icon name="shield-check" size={16} />
          <span>
            {ru
              ? "XP начисляется за выполненные условия после проверки матча."
              : "XP is awarded for completed conditions after match verification."}
          </span>
        </p>
        <div className="signing-autograph-row">
          <SignatureField
            value={signature}
            operator={operator}
            ru={ru}
            disabled={state === "pending" || confirmed || unavailable}
            confirmed={confirmed}
            saved={signatureSaved}
            onChange={updateSignature}
          />
          <div className="signing-stamp-space" aria-hidden="true">
            {confirmed ? (
              <div
                className="signing-seal"
                onAnimationEnd={(event) => {
                  if (event.target === event.currentTarget && animating) setState("signed")
                }}
              >
                <Icon name="eye" size={30} />
                <span>{preview ? (ru ? "Образец" : "Sample") : ru ? "Принято" : "Accepted"}</span>
                <small>DEADLOCK CONTRACTS</small>
              </div>
            ) : (
              <div className="signing-stamp-placeholder">
                <Icon name="eye" size={24} />
                <span>{ru ? "Место печати" : "Bureau seal"}</span>
              </div>
            )}
          </div>
        </div>
        {!confirmed && (
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
              {preview
                ? ru
                  ? "Пробная печать покажет результат. Для настоящего контракта нужен вход через Steam."
                  : "The sample seal previews the result. Sign in with Steam to create a real contract."
                : ru
                  ? "Ставя печать, вы подтверждаете выбранные условия. Дело откроется после подтверждения бюро."
                  : "By placing your seal, you confirm these terms. Your case opens after the bureau confirms."}
            </p>
            <div className="signing-actions">
              <button
                type="button"
                className="signing-secondary"
                disabled={state === "pending"}
                onClick={onClose}
              >
                {ru ? "Вернуться к выбору" : "Back to selection"}
              </button>
              <button
                type="button"
                className="signing-primary"
                disabled={state === "pending" || unavailable}
                onClick={() => void sign()}
              >
                {state === "pending" ? (
                  <span className="signing-spinner" aria-hidden="true" />
                ) : (
                  <Icon name="feather" size={18} />
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
        {confirmed && (
          <section className="signing-success">
            <p role="status">
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
            {animating ? (
              <button
                type="button"
                className="signing-secondary"
                onClick={() => setState("signed")}
              >
                {ru ? "Пропустить анимацию" : "Skip animation"}
              </button>
            ) : (
              <button
                type="button"
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
            )}
          </section>
        )}
        <footer className="signing-colophon">
          <span>DEADLOCK CONTRACTS</span>
          <span>{ru ? "Твоё слово имеет вес" : "Your word carries weight"}</span>
        </footer>
      </article>
    </dialog>
  )
}
