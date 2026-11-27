import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react"
import Icon from "../icons/Icon"
import { useLanguage } from "../i18n"
import { useAppearance, useEffectsQuality, useReducedMotion } from "../Appearance"
import CardSurface from "./CardSurface"
import { FavoriteButton, FavoriteError, type FavoriteControls } from "./favorites"
import { createPackAudio } from "./pack-audio"
import { deckRows, restingOffset, wideCard } from "./pack-layout"
import { createRevealEffects, prewarmRevealEffects } from "./reveal-effects"
import { PACK_REVEAL_PROFILE, revealProfile, type RevealProfile } from "./reveal-profiles"
import { RANKS, type Receipt } from "./types"
import "./pack-reveal.css"
import "./nightshift-archive.css"

type Stage = "sealed" | "opening" | "cards" | "results"
type Flight = {
  id: string
  phase: "lifting" | "charging" | "revealing" | "inspect" | "returning"
  first: boolean
  starred?: boolean
  position: CSSProperties
}

const TEAR_MS = 420
const DEAL_MS = 660
const LAND_MS = 600
const STAGGER_MS = 70

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
  const { appearance } = useAppearance()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const sealRef = useRef<HTMLButtonElement>(null)
  const seats = useRef(new Map<string, HTMLElement>())
  const effectsLayer = useRef<HTMLDivElement>(null)
  const effects = useRef<ReturnType<typeof createRevealEffects> | null>(null)
  const audio = useRef<ReturnType<typeof createPackAudio>>(undefined)
  const session = useRef(0)
  const saving = useRef(false)
  const favoriteRequest = useRef(0)
  const pointerStart = useRef<{ object: boolean; x: number; y: number } | null>(null)
  const [stage, setStage] = useState<Stage>("sealed")
  const [isOpen, setIsOpen] = useState(false)
  const [revealed, setRevealed] = useState<string[]>([])
  const [flight, setFlight] = useState<Flight | null>(null)
  const [completed, setCompleted] = useState(false)
  const [showInlineResults, setShowInlineResults] = useState(false)
  const [favoriteError, setFavoriteError] = useState<string | null>(null)
  const results = stage === "results" || reduced
  const title = receipt.pack?.title || (ru ? "Карточки архива" : "Archive cards")
  const activeItem = receipt.items.find(({ id }) => flight?.id === id)
  const profile = activeItem && revealProfile(activeItem.card)
  const dealTime = DEAL_MS + LAND_MS + STAGGER_MS * Math.max(0, receipt.items.length - 1)
  const mixed = receipt.items.some(({ card }) => wideCard(card))
  const quality = useEffectsQuality()
  const lite = quality === "LITE"
  const chargeMs = (profile?.chargeMs ?? 0) * (lite ? 0.6 : 1)
  const highlight = results
    ? receipt.items.reduce<Receipt["items"][number] | undefined>((best, item) => {
        const rank = item.card.rank
        if (rank === "EX") return best
        return !best ||
          RANKS.indexOf(rank) > RANKS.indexOf(best.card.rank as (typeof RANKS)[number])
          ? item
          : best
      }, undefined)?.id
    : undefined

  useEffect(() => {
    if (reduced && dialogRef.current?.open) {
      stopSession()
      setFlight(null)
      setStage("results")
    }
  }, [reduced])

  useEffect(() => {
    if (!appearance.packSound) stopAudio()
  }, [appearance.packSound])

  useEffect(() => () => stopSession(), [])

  useEffect(() => {
    if (!isOpen) return
    if (stage === "sealed") sealRef.current?.focus()
    if (stage === "cards" || (stage === "results" && reduced)) {
      const seat = seats.current.values().next().value
      seat?.querySelector("button")?.focus({ preventScroll: true })
    }
  }, [stage, isOpen, reduced])

  useEffect(() => {
    if (!isOpen || reduced) return
    const phase = flight?.phase
    const phaseDelay = {
      lifting: 850,
      charging: chargeMs,
      revealing: (profile?.turnMs ?? 600) + 110,
      returning: 700,
      inspect: undefined,
    }
    const delay = stage === "opening" ? dealTime + 150 : phase && phaseDelay[phase]
    if (delay === undefined) return
    const epoch = session.current
    const timer = window.setTimeout(() => {
      if (epoch !== session.current) return
      if (stage === "opening") finishOpening()
      else if (phase) finishFlight(phase)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [isOpen, reduced, stage, flight?.id, flight?.phase, dealTime, chargeMs, profile?.turnMs])

  useEffect(() => {
    if (!isOpen || reduced) return
    const epoch = session.current
    const play = (cue: "pack" | "hum" | "reveal", anchor: HTMLElement, recipe: RevealProfile) => {
      if (epoch !== session.current || !effectsLayer.current) return
      const handle = (effects.current ??= createRevealEffects(effectsLayer.current))
      handle.play(cue, anchor, recipe, lite ? "lite" : "full")
    }

    if (stage === "opening") {
      const count = receipt.items.length
      audio.current?.play("press")
      audio.current?.play("tear", TEAR_MS / 1000)
      for (let i = 0; i < count; i++) {
        const launch = DEAL_MS + STAGGER_MS * i
        audio.current?.play("deal", launch / 1000)
        audio.current?.play("land", (launch + LAND_MS - 70) / 1000)
      }
      const timer = window.setTimeout(() => {
        if (sealRef.current) play("pack", sealRef.current, PACK_REVEAL_PROFILE)
      }, TEAR_MS)
      return () => window.clearTimeout(timer)
    }

    const subject =
      flight && seats.current.get(flight.id)?.querySelector<HTMLElement>(".card-surface")
    if (!flight || !profile || !subject) return
    if (flight.phase === "lifting") audio.current?.play("lift")
    if (flight.phase === "charging") {
      play("hum", subject, profile)
      audio.current?.play("hum", 0, profile.sound, chargeMs / 1000)
    }
    if (flight.phase === "revealing") {
      play("reveal", subject, profile)
      audio.current?.play("reveal", profile.turnMs / 2000, profile.sound)
    }
    if (flight.phase === "returning") {
      effects.current?.clear()
      audio.current?.play("return")
    }
  }, [isOpen, reduced, stage, flight?.id, flight?.phase])

  useEffect(() => {
    if (!flight || flight.phase === "returning") return
    const { id } = flight
    const recenter = () => {
      effects.current?.clear()
      const position = flightPosition(id)
      setFlight((current) =>
        current?.id === id && current.phase !== "returning" ? { ...current, position } : current,
      )
    }
    window.addEventListener("resize", recenter)
    return () => window.removeEventListener("resize", recenter)
  }, [flight?.id, flight?.phase])

  function stopAudio() {
    audio.current?.close()
    audio.current = undefined
  }

  function stopSession() {
    ++session.current
    saving.current = false
    effects.current?.clear()
    effects.current = null
    stopAudio()
  }

  function finishOpening() {
    if (dialogRef.current?.open) setStage((current) => (current === "opening" ? "cards" : current))
  }

  function markRevealed(id: string) {
    setRevealed((ids) => (ids.includes(id) ? ids : [...ids, id]))
  }

  function finishFlight(expected: Flight["phase"]) {
    if (flight?.phase !== expected || !dialogRef.current?.open) return
    if (expected === "returning") {
      setFlight((current) =>
        current?.id === flight.id && current.phase === expected ? null : current,
      )
      if (revealed.length === receipt.items.length) setStage("results")
      return
    }
    const phase =
      expected === "revealing" || !flight.first
        ? "inspect"
        : expected === "lifting" && chargeMs > 0
          ? "charging"
          : "revealing"
    if (phase === "revealing") markRevealed(flight.id)
    setFlight((current) =>
      current?.id === flight.id && current.phase === expected ? { ...current, phase } : current,
    )
  }

  const open = () => {
    if (dialogRef.current?.open) return
    stopSession()
    setRevealed([])
    setFlight(null)
    setFavoriteError(null)
    pointerStart.current = null
    setShowInlineResults(false)
    setStage(reduced || !receipt.items.length ? "results" : "sealed")
    dialogRef.current?.showModal()
    setIsOpen(true)
    if (!reduced) {
      void prewarmRevealEffects()
      if (appearance.packSound) {
        audio.current = createPackAudio()
        audio.current?.play("appear")
      }
    }
  }

  function positionFromCenter(id: string) {
    const seat = seats.current.get(id)?.getBoundingClientRect()
    const scene = dialogRef.current?.getBoundingClientRect()
    if (!seat || !scene) return { x: 0, y: 0, scale: 1, picked: seat, scene }
    const ratio = seat.width ? seat.height / seat.width : 1.5
    const width = Math.min(
      ratio < 1 ? 520 : 360,
      scene.width * (ratio < 1 ? 0.88 : 0.8),
      (scene.height * 0.76) / ratio,
    )
    return {
      x: scene.left + (scene.width - seat.width) / 2 - seat.left,
      y: scene.top + (scene.height - seat.height) / 2 - seat.top,
      scale: seat.width ? width / seat.width : 1,
      picked: seat,
      scene,
    }
  }

  function flightPosition(id: string) {
    const { x, y, scale, picked, scene } = positionFromCenter(id)
    if (scene && picked?.width) {
      for (const [other, seat] of seats.current) {
        if (other === id) continue
        const offset = restingOffset(
          seat.getBoundingClientRect(),
          picked,
          scene,
          picked.width * scale,
        )
        seat.style.setProperty("--rest-shift", `${offset.x}px,${offset.y}px`)
        seat.style.setProperty("--rest-opacity", String(offset.opacity))
      }
    }
    return {
      "--flight-shift": `${x}px,${y}px`,
      "--flight-scale": scale,
    } as CSSProperties
  }

  const breakSeal = () => {
    audio.current?.resume()
    const exitOffset = (sealRef.current?.getBoundingClientRect().height ?? 0) * 0.24
    for (const [id, seat] of seats.current) {
      const { x, y } = positionFromCenter(id)
      seat.style.setProperty("--deal-x", `${x}px`)
      seat.style.setProperty("--deal-y", `${y - exitOffset}px`)
    }
    setStage("opening")
  }

  const inspect = (id: string) => {
    if (flight || stage === "opening" || stage === "sealed") return
    audio.current?.resume()
    setFavoriteError(null)
    const position = flightPosition(id)
    setFlight(
      (current) =>
        current ?? {
          id,
          phase: reduced ? "inspect" : "lifting",
          position,
          first: !results && !revealed.includes(id),
        },
    )
  }

  const returnCard = async (direction: "left" | "right" = "right") => {
    if (flight?.phase !== "inspect") return
    setFavoriteError(null)
    if (direction === "left") {
      if (saving.current) return
      if (!activeItem || !favorites?.ids || favorites.loading || favorites.pendingId) return
      const epoch = session.current
      const request = ++favoriteRequest.current
      saving.current = true
      const saved = await favorites.setFavorite(activeItem.card.id, true).catch(() => false)
      if (
        epoch !== session.current ||
        request !== favoriteRequest.current ||
        !dialogRef.current?.open
      )
        return
      saving.current = false
      if (!saved) {
        setFavoriteError(ru ? "Не удалось сохранить" : "Could not save favorite")
        return
      }
      audio.current?.play("favorite")
    }
    favoriteRequest.current++
    saving.current = false
    if (reduced) {
      setFlight(null)
      return
    }
    setFlight((current) =>
      current?.id === flight.id && current.phase === "inspect"
        ? { ...current, phase: "returning", starred: direction === "left" }
        : current,
    )
  }

  const tiltSeal = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "mouse" || stage !== "sealed" || reduced) return
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect()
    if (!width || !height) return
    const x = (event.clientX - left) / width
    const y = (event.clientY - top) / height
    event.currentTarget.style.setProperty("--pack-x", `${x * 100}%`)
    event.currentTarget.style.setProperty("--pack-y", `${y * 100}%`)
    event.currentTarget.style.setProperty("--pack-rx", `${(0.5 - y) * 12}deg`)
    event.currentTarget.style.setProperty("--pack-ry", `${(x - 0.5) * 14}deg`)
  }

  const backdropAction = () => {
    if (!flight) {
      dialogRef.current?.close()
    } else if (flight.phase === "inspect") {
      void returnCard()
    } else if (flight.phase !== "returning") {
      markRevealed(flight.id)
      setFlight({ ...flight, phase: "returning", first: false })
    }
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
        data-reduced={reduced}
        aria-label={title}
        onPointerDownCapture={(event) => {
          pointerStart.current = {
            object: Boolean(
              (event.target as Element).closest(".pack-opening-scene, .pack-card-seat"),
            ),
            x: event.clientX,
            y: event.clientY,
          }
        }}
        onClick={(event) => {
          const origin = pointerStart.current
          pointerStart.current = null
          if (
            event.detail &&
            origin &&
            (origin.object || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 12)
          )
            return
          if (!(event.target as Element).closest(".pack-opening-scene, .pack-card-seat"))
            backdropAction()
        }}
        onClose={() => {
          if (dialogRef.current?.open) return
          stopSession()
          setIsOpen(false)
          setFlight(null)
          setShowInlineResults(true)
          setCompleted(true)
          triggerRef.current?.focus()
        }}
      >
        {isOpen && (
          <div
            className="pack-reveal-shell"
            data-stage={stage}
            data-reduced={reduced}
            data-quality={quality}
            style={{ "--tear-at": `${TEAR_MS}ms`, "--deal-at": `${DEAL_MS}ms` } as CSSProperties}
          >
            <div
              className="pack-effects-layer rco-fx-layer"
              ref={effectsLayer}
              aria-hidden="true"
              data-phase={
                flight?.phase === "charging"
                  ? "hum"
                  : flight?.phase === "revealing"
                    ? "turn"
                    : undefined
              }
            />
            <span className="sr-only" role="status">
              {flight?.phase === "inspect" && activeItem
                ? `${activeItem.card.title} · ${activeItem.card.rank}`
                : ""}
            </span>
            {(stage === "sealed" || stage === "opening") && (
              <button
                ref={sealRef}
                type="button"
                className="pack-opening-scene"
                aria-label={ru ? "Вскрыть конверт" : "Break the seal"}
                aria-disabled={stage === "opening"}
                onPointerMove={tiltSeal}
                onPointerLeave={(event) => {
                  for (const name of ["--pack-x", "--pack-y", "--pack-rx", "--pack-ry"]) {
                    event.currentTarget.style.removeProperty(name)
                  }
                }}
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
                style={{ "--deal-time": `${dealTime}ms` } as CSSProperties}
              >
                <span className="pack-arrival" aria-hidden="true">
                  <span className="pack-wrapper">
                    <span className="pack-wrapper-pose">
                      <span className="pack-envelope-body">
                        <Icon name="layers" size={70} />
                        <span>{receipt.pack?.title || "THE ARCHIVE"}</span>
                      </span>
                      <span className="pack-tear-light" />
                      <span className="pack-tear-strip">
                        <b>DEAD</b>
                        <b>LOCK</b>
                        <b>CON</b>
                        <b>TRACTS</b>
                      </span>
                    </span>
                  </span>
                </span>
              </button>
            )}

            <div
              className={results ? "pack-deck pack-reveal-results" : "pack-deck"}
              data-pentagon={receipt.items.length === 5}
              data-occupied={!!flight}
              data-dense={receipt.items.length > 6}
              data-mixed={mixed}
              style={
                {
                  "--rows-wide": deckRows(receipt.items, mixed ? 5.52 : 5),
                  "--rows-mobile": deckRows(receipt.items, 3),
                  "--rows-narrow": deckRows(receipt.items, 2),
                } as CSSProperties
              }
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
                    data-wide={wideCard(item.card)}
                    data-highlight={item.id === highlight && !reduced}
                    ref={(node) => {
                      if (node) seats.current.set(item.id, node)
                      else seats.current.delete(item.id)
                    }}
                    style={
                      {
                        "--deal-delay": `${DEAL_MS + STAGGER_MS * index}ms`,
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
                      style={
                        itemFlight && profile
                          ? ({
                              ...itemFlight.position,
                              "--turn-time": `${profile.turnMs}ms`,
                              "--reveal-color": profile.color,
                              "--charge-time": `${chargeMs}ms`,
                              "--charge-glow": profile.glow,
                            } as CSSProperties)
                          : undefined
                      }
                      onTransitionEnd={(event) => {
                        if (!itemFlight || event.propertyName !== "transform") return
                        if (
                          event.target === event.currentTarget &&
                          (itemFlight.phase === "lifting" || itemFlight.phase === "returning")
                        )
                          finishFlight(itemFlight.phase)
                      }}
                      onAnimationEnd={(event) => {
                        if (
                          itemFlight?.phase === "revealing" &&
                          event.animationName === "pack-turn"
                        )
                          finishFlight("revealing")
                      }}
                    >
                      <div className="pack-card-scale">
                        <div className="pack-card-recoil">
                          <CardSurface
                            card={item.card}
                            revealed={faceUp}
                            reduced={reduced}
                            preloadArtwork
                            disabled={!!flight && !itemFlight}
                            actionLabel={label}
                            onFlip={() => {
                              if (itemFlight) void returnCard()
                              else inspect(item.id)
                            }}
                            onSwipe={
                              itemFlight ? (direction) => void returnCard(direction) : undefined
                            }
                            edgeMark={
                              itemFlight?.first &&
                              (itemFlight.phase === "revealing" ||
                                itemFlight.phase === "inspect") && (
                                <span
                                  className="pack-receipt-mark"
                                  data-duplicate={item.duplicate}
                                  aria-hidden="true"
                                >
                                  {item.duplicate ? (ru ? "ДУБЛЬ" : "COPY") : ru ? "НОВАЯ" : "NEW"}
                                </span>
                              )
                            }
                          />
                        </div>
                      </div>
                      {itemFlight?.starred && (
                        <span className="pack-favorite-spark" aria-hidden="true">
                          <Icon name="star" size={18} />
                        </span>
                      )}
                      {itemFlight && favoriteError && (
                        <span className="pack-favorite-notice" role="alert">
                          {favoriteError}
                        </span>
                      )}
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
