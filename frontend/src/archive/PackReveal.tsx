import { useEffect, useRef, useState, type CSSProperties } from "react"
import Icon from "../icons/Icon"
import { useLanguage } from "../i18n"
import { useReducedMotion } from "../Appearance"
import CardSurface from "./CardSurface"
import { FavoriteButton, FavoriteError, type FavoriteControls } from "./favorites"
import type { Receipt } from "./types"
import "./pack-reveal.css"
import "./nightshift-archive.css"

type Stage = "sealed" | "opening" | "cards" | "results"
type Flight = {
  id: string
  phase: "lifting" | "inspect" | "returning"
  position: CSSProperties
}

export default function PackReveal({
  receipt,
  favorites,
}: {
  receipt: Receipt
  favorites?: FavoriteControls
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const reduced = useReducedMotion()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const sealRef = useRef<HTMLButtonElement>(null)
  const seats = useRef(new Map<string, HTMLElement>())
  const timerRef = useRef<number | null>(null)
  const session = useRef(0)
  const saving = useRef(false)
  const [stage, setStage] = useState<Stage>("sealed")
  const [isOpen, setIsOpen] = useState(false)
  const [revealed, setRevealed] = useState<string[]>([])
  const [flight, setFlight] = useState<Flight | null>(null)
  const [completed, setCompleted] = useState(false)
  const [showInlineResults, setShowInlineResults] = useState(false)
  const results = stage === "results" || reduced
  const title = receipt.pack?.title || (ru ? "Карточки архива" : "Archive cards")

  useEffect(() => {
    if (reduced && dialogRef.current?.open) {
      ++session.current
      saving.current = false
      setFlight(null)
      setStage("results")
    }
  }, [reduced])

  useEffect(() => {
    if (!isOpen) return
    if (stage === "sealed") sealRef.current?.focus()
    if (stage === "cards") {
      const seat = seats.current.values().next().value
      seat?.querySelector("button")?.focus({ preventScroll: true })
    }
  }, [stage, isOpen])

  useEffect(() => {
    const phase = flight?.phase
    // CSS events lead the interaction. Timers cover interrupted or unavailable animations.
    const delay =
      stage === "opening"
        ? 1330 + 70 * (receipt.items.length - 1)
        : phase === "lifting"
          ? 850
          : phase === "returning"
            ? 700
            : null
    if (delay === null) return
    timerRef.current = window.setTimeout(stage === "opening" ? finishOpening : finishFlight, delay)
    return () => clearTimer()
  }, [stage, flight?.id, flight?.phase, receipt.items.length])

  useEffect(() => {
    if (!flight || flight.phase === "returning") return
    const { id } = flight
    const recenter = () => {
      const position = flightPosition(id)
      setFlight((current) =>
        current?.id === id && current.phase !== "returning" ? { ...current, position } : current,
      )
    }
    window.addEventListener("resize", recenter)
    return () => window.removeEventListener("resize", recenter)
  }, [flight?.id, flight?.phase])

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function finishOpening() {
    if (dialogRef.current?.open) setStage((current) => (current === "opening" ? "cards" : current))
  }

  function finishFlight() {
    if (!flight || !dialogRef.current?.open) return
    if (flight.phase === "lifting") {
      setRevealed((ids) => (ids.includes(flight.id) ? ids : [...ids, flight.id]))
      setFlight({ ...flight, phase: "inspect" })
    } else if (flight.phase === "returning") {
      setFlight(null)
      if (revealed.length === receipt.items.length) setStage("results")
    }
  }

  const open = () => {
    ++session.current
    clearTimer()
    saving.current = false
    setRevealed([])
    setFlight(null)
    setShowInlineResults(false)
    setStage(reduced || !receipt.items.length ? "results" : "sealed")
    dialogRef.current?.showModal()
    setIsOpen(true)
  }

  function positionFromCenter(id: string) {
    const seat = seats.current.get(id)?.getBoundingClientRect()
    const scene = dialogRef.current?.getBoundingClientRect()
    if (!seat || !scene) return { x: 0, y: 0, scale: 1 }
    const ratio = seat.width ? seat.height / seat.width : 1.5
    const width = Math.min(ratio < 1 ? 460 : 320, scene.width * 0.8, (scene.height * 0.78) / ratio)
    return {
      x: scene.left + (scene.width - seat.width) / 2 - seat.left,
      y: scene.top + (scene.height - seat.height) / 2 - seat.top,
      scale: seat.width ? width / seat.width : 1,
    }
  }

  function flightPosition(id: string) {
    const { x, y, scale } = positionFromCenter(id)
    return {
      "--flight-x": `${x}px`,
      "--flight-y": `${y}px`,
      "--flight-scale": scale,
    } as CSSProperties
  }

  const breakSeal = () => {
    for (const [id, seat] of seats.current) {
      const { x, y } = positionFromCenter(id)
      seat.style.setProperty("--deal-x", `${x}px`)
      seat.style.setProperty("--deal-y", `${y}px`)
    }
    setStage("opening")
  }

  const inspect = (id: string) => {
    if (flight || stage === "opening" || stage === "sealed") return
    setFlight({ id, phase: "lifting", position: flightPosition(id) })
  }

  const returnCard = async (direction: "left" | "right" = "right") => {
    if (flight?.phase !== "inspect" || saving.current) return
    const item = receipt.items.find(({ id }) => id === flight.id)
    if (direction === "left") {
      if (!item || !favorites?.ids || favorites.loading || favorites.pendingId) return
      const epoch = session.current
      saving.current = true
      const saved = await favorites.setFavorite(item.card.id, true)
      if (epoch !== session.current || !dialogRef.current?.open) return
      saving.current = false
      if (!saved) return
    }
    setFlight({ ...flight, phase: "returning" })
  }

  return (
    <>
      <button ref={triggerRef} className="archive-primary" onClick={open}>
        {completed
          ? ru
            ? "Повторить открытие"
            : "Replay reveal"
          : ru
            ? "Раскрыть карточки"
            : "Reveal cards"}
      </button>
      {showInlineResults && (
        <div
          className="pack-reveal-inline archive-grid"
          aria-label={ru ? "Полученные карточки" : "Received cards"}
        >
          {receipt.items.map((item) => (
            <article key={item.id} data-rank={item.card.rank}>
              <CardSurface card={item.card} reduced={reduced} />
              <p>
                {item.duplicate ? (ru ? "Дубль" : "Duplicate") : ru ? "Новая карточка" : "New card"}
                {item.test_grant && (ru ? " · Тестовый экземпляр" : " · Sandbox copy")}
                {item.forced && (
                  <span>
                    {" · "}
                    {ru ? "Гарантированный ранг" : "Guaranteed rank"}: {item.card.rank} (
                    {ru ? "исходный" : "natural"}: {item.natural_rank})
                  </span>
                )}
              </p>
              {favorites && <FavoriteButton controls={favorites} cardId={item.card.id} />}
            </article>
          ))}
        </div>
      )}
      {showInlineResults && favorites && <FavoriteError controls={favorites} />}
      <dialog
        ref={dialogRef}
        className="pack-reveal"
        aria-label={title}
        onClick={(event) => {
          if (!(event.target as Element).closest(".pack-opening-scene, .pack-card-seat")) {
            if (flight) void returnCard()
            else event.currentTarget.close()
          }
        }}
        onClose={() => {
          if (dialogRef.current?.open) return
          ++session.current
          clearTimer()
          saving.current = false
          setIsOpen(false)
          setFlight(null)
          setShowInlineResults(true)
          setCompleted(true)
          triggerRef.current?.focus()
        }}
      >
        {isOpen && (
          <div className="pack-reveal-shell" data-stage={stage} data-reduced={reduced}>
            {(stage === "sealed" || stage === "opening") && (
              <button
                ref={sealRef}
                type="button"
                className="pack-opening-scene pack-envelope-art"
                aria-label={ru ? "Вскрыть конверт" : "Break the seal"}
                aria-disabled={stage === "opening"}
                onClick={() => {
                  if (stage === "sealed") breakSeal()
                }}
                onAnimationEnd={(event) => {
                  if (
                    stage === "opening" &&
                    event.target === event.currentTarget &&
                    event.animationName === "pack-burst"
                  ) {
                    finishOpening()
                  }
                }}
                style={
                  { "--deal-time": `${1180 + 70 * (receipt.items.length - 1)}ms` } as CSSProperties
                }
              >
                <span className="pack-wrapper" aria-hidden="true">
                  <span className="pack-tear-strip">
                    <b>DEAD</b>
                    <b>LOCK</b>
                    <b>CON</b>
                    <b>TRACTS</b>
                  </span>
                  <span className="pack-envelope-body">
                    <Icon name="layers" size={70} />
                    <span>{receipt.pack?.title || "THE ARCHIVE"}</span>
                    <small>
                      {String(receipt.items.length).padStart(2, "0")} · COLLECTION FILES
                    </small>
                  </span>
                </span>
              </button>
            )}

            <div
              className={results ? "pack-deck pack-reveal-results" : "pack-deck"}
              data-pentagon={receipt.items.length === 5}
              inert={stage === "sealed" || stage === "opening"}
            >
              {receipt.items.map((item, index) => {
                const itemFlight = flight?.id === item.id ? flight : null
                const faceUp = results || revealed.includes(item.id)
                const label = itemFlight
                  ? ru
                    ? "Вернуть карточку в раскладку"
                    : "Return card to pack"
                  : faceUp
                    ? ru
                      ? "Рассмотреть карточку"
                      : "Inspect card"
                    : ru
                      ? "Перевернуть карточку"
                      : "Reveal card"
                return (
                  <article
                    key={item.id}
                    className="pack-card-seat"
                    data-active={!!itemFlight}
                    ref={(node) => {
                      if (node) seats.current.set(item.id, node)
                      else seats.current.delete(item.id)
                    }}
                    style={
                      {
                        "--deal-delay": `${580 + 70 * index}ms`,
                        "--deal-rotation": `${[28, -34, 15, 38, -22][index % 5]}deg`,
                      } as CSSProperties
                    }
                    onKeyDown={(event) => {
                      if (!itemFlight || (event.key !== "ArrowLeft" && event.key !== "ArrowRight"))
                        return
                      event.preventDefault()
                      if (!event.repeat)
                        void returnCard(event.key === "ArrowLeft" ? "left" : "right")
                    }}
                  >
                    <div
                      className="pack-card-motion"
                      data-flight={itemFlight?.phase}
                      style={itemFlight?.position}
                      onTransitionEnd={(event) => {
                        if (
                          itemFlight &&
                          event.target === event.currentTarget &&
                          event.propertyName === "transform"
                        )
                          finishFlight()
                      }}
                    >
                      <CardSurface
                        card={item.card}
                        revealed={faceUp}
                        reduced={reduced}
                        disabled={!!flight && !itemFlight}
                        actionLabel={label}
                        onFlip={
                          reduced
                            ? undefined
                            : () => {
                                if (itemFlight) void returnCard()
                                else inspect(item.id)
                              }
                        }
                        onSwipe={itemFlight ? (direction) => void returnCard(direction) : undefined}
                      />
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
