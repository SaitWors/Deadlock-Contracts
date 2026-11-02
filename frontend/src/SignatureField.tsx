import { useId, useRef, useState, type PointerEvent } from "react"
import { MAX_SIGNATURE_POINTS, strokePath, type Autograph, type Stroke } from "./signature-state"

type Props = {
  value: Autograph
  operator: string
  ru: boolean
  disabled: boolean
  confirmed: boolean
  saved: boolean | null
  onChange: (value: Autograph) => void
}

export default function SignatureField({
  value,
  operator,
  ru,
  disabled,
  confirmed,
  saved,
  onChange,
}: Props) {
  const id = useId()
  const hintId = useId()
  const drawing = useRef<{ id: number; stroke: Stroke } | null>(null)
  const [draft, setDraft] = useState<Stroke>([])
  const point = (event: PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [
      Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / (rect.width || 1))) * 1000) /
        1000,
      Math.round(Math.max(0, Math.min(1, (event.clientY - rect.top) / (rect.height || 1))) * 1000) /
        1000,
    ]
  }
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (
      disabled ||
      drawing.current ||
      event.button !== 0 ||
      value.strokes.length >= 40 ||
      value.strokes.reduce((n, stroke) => n + stroke.length, 0) >= MAX_SIGNATURE_POINTS - 2
    )
      return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = { id: event.pointerId, stroke: [point(event)] }
    setDraft([...drawing.current.stroke])
  }
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const active = drawing.current
    if (disabled || !active || active.id !== event.pointerId) return
    if (
      value.strokes.reduce((n, s) => n + s.length, 0) + active.stroke.length >=
      MAX_SIGNATURE_POINTS
    )
      return
    active.stroke.push(point(event))
    setDraft([...active.stroke])
  }
  const finish = (event: PointerEvent<SVGSVGElement>, cancel = false) => {
    const active = drawing.current
    if (!active || active.id !== event.pointerId) return
    drawing.current = null
    setDraft([])
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancel && !disabled) {
      // A tap is a meaningful dot. Two identical points render a round cap and
      // keep the same bounded stroke format as continuous handwriting.
      if (active.stroke.length === 1) active.stroke.push(point(event))
      onChange({ ...value, strokes: [...value.strokes, active.stroke] })
    }
  }
  const autograph = value.text.trim() || operator
  return (
    <section
      className="signing-signature"
      aria-label={ru ? "Подпись исполнителя" : "Operator signature"}
    >
      <div className="signature-tools">
        <label htmlFor={id}>{ru ? "Ваша подпись" : "Your signature"}</label>
        {!confirmed && (
          <div role="group" aria-label={ru ? "Способ подписи" : "Signature method"}>
            <button
              type="button"
              aria-pressed={value.mode === "text"}
              disabled={disabled}
              onClick={() => onChange({ ...value, mode: "text" })}
            >
              {ru ? "Ввести" : "Type"}
            </button>
            <button
              type="button"
              aria-pressed={value.mode === "draw"}
              disabled={disabled}
              onClick={() => onChange({ ...value, mode: "draw" })}
            >
              {ru ? "Нарисовать" : "Draw"}
            </button>
          </div>
        )}
      </div>
      {value.mode === "draw" && (value.strokes.length > 0 || !confirmed) ? (
        <>
          <svg
            id={id}
            className="signature-pad"
            viewBox="0 0 400 120"
            preserveAspectRatio="none"
            role="img"
            aria-label={
              ru
                ? "Поле для подписи мышью или пальцем"
                : "Draw your signature with a mouse or finger"
            }
            aria-describedby={hintId}
            data-disabled={disabled}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={(event) => finish(event)}
            onPointerCancel={(event) => finish(event, true)}
            onLostPointerCapture={(event) => finish(event, true)}
          >
            {[...value.strokes, ...(draft.length ? [draft] : [])].map((stroke, i) => (
              <path key={i} d={strokePath(stroke)} />
            ))}
          </svg>
          {!confirmed && (
            <div className="signature-edit-tools">
              <span>{ru ? "Распишитесь над линией" : "Sign above the line"}</span>
              <button
                type="button"
                disabled={disabled || !value.strokes.length}
                onClick={() => onChange({ ...value, strokes: value.strokes.slice(0, -1) })}
              >
                {ru ? "Отменить штрих" : "Undo stroke"}
              </button>
              <button
                type="button"
                disabled={disabled || !value.strokes.length}
                onClick={() => onChange({ ...value, strokes: [] })}
              >
                {ru ? "Очистить" : "Clear"}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="signature-text">
          <span className="signing-autograph" aria-hidden={!confirmed}>
            {autograph}
          </span>
          {!confirmed && (
            <input
              id={id}
              name="signature"
              type="text"
              value={value.text}
              onChange={(event) => onChange({ ...value, text: event.target.value.slice(0, 80) })}
              disabled={disabled}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={hintId}
              placeholder={operator}
            />
          )}
        </div>
      )}
      {!confirmed && (
        <p id={hintId} className="signature-hint" role="status">
          {saved === false
            ? ru
              ? "Не удалось запомнить подпись в браузере. Подписать этот контракт всё равно можно."
              : "Your browser could not save this signature. You can still sign this contract."
            : ru
              ? "Подпись запоминается для вашего аккаунта в этом браузере. Пустая подпись — имя исполнителя."
              : "Remembered for your account in this browser. Leave blank to use your operator name."}
        </p>
      )}
    </section>
  )
}
