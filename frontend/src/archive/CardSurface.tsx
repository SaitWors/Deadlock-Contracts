import { useEffect, useRef, type PointerEvent, type ReactNode } from "react"
import { useReducedMotion } from "../Appearance"
import Icon from "../icons/Icon"
import CardPreview from "./CardPreview"
import { wideCard } from "./pack-layout"
import { REVEAL_PROFILES } from "./reveal-profiles"
import type { Card } from "./types"
import "./card-surface.css"

type Gesture = {
  id: number
  x: number
  y: number
  dx: number
  dy: number
  vertical: boolean
  moved: boolean
}

export default function CardSurface({
  card,
  revealed = true,
  reduced: forceReduced = false,
  disabled = false,
  preloadArtwork = false,
  edgeMark,
  actionLabel,
  onFlip,
  onSwipe,
}: {
  card: Card
  revealed?: boolean
  reduced?: boolean
  disabled?: boolean
  preloadArtwork?: boolean
  edgeMark?: ReactNode
  actionLabel?: string
  onFlip?: () => void
  onSwipe?: (direction: "left" | "right") => void
}) {
  const reducedPreference = useReducedMotion()
  const reduced = forceReduced || reducedPreference
  const surface = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef(false)
  const reset = () => {
    const style = surface.current?.style
    for (const key of [
      "--tilt-x",
      "--tilt-y",
      "--shine-x",
      "--shine-y",
      "--drag-x",
      "--shine-active",
    ])
      style?.removeProperty(key)
  }
  useEffect(() => {
    reset()
  }, [revealed, reduced, disabled])
  const cancel = () => {
    if (gesture.current) suppressClick.current = gesture.current.moved
    gesture.current = null
    reset()
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (active) {
      if (active.id !== event.pointerId) return
      active.dx = event.clientX - active.x
      active.dy = event.clientY - active.y
      active.moved ||= Math.abs(active.dx) > 10 || Math.abs(active.dy) > 10
      active.vertical ||= Math.abs(active.dy) > 12 && Math.abs(active.dy) > Math.abs(active.dx)
      if (onSwipe && !reduced && revealed && !disabled && !active.vertical)
        surface.current?.style.setProperty(
          "--drag-x",
          `${Math.max(-150, Math.min(150, active.dx))}px`,
        )
    }
    if (
      !reduced &&
      revealed &&
      !disabled &&
      !active?.vertical &&
      (active || event.pointerType === "mouse")
    ) {
      const rect = event.currentTarget.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      const style = surface.current?.style
      style?.setProperty("--tilt-x", `${(0.5 - y) * 24}deg`)
      style?.setProperty("--tilt-y", `${(x - 0.5) * 30}deg`)
      style?.setProperty("--shine-x", `${x * 100}%`)
      style?.setProperty("--shine-y", `${y * 100}%`)
      style?.setProperty("--shine-active", "1")
    }
  }
  return (
    <div
      ref={surface}
      className="card-surface"
      data-rank={revealed ? card.rank : undefined}
      data-category={wideCard(card) ? "BASE" : "HERO"}
      data-revealed={revealed}
      data-reduced={reduced}
      data-material={revealed ? REVEAL_PROFILES[card.rank].material : undefined}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || disabled) return
        const target = event.target as Element
        suppressClick.current = false
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          dx: 0,
          dy: 0,
          vertical: false,
          moved: false,
        }
        target.setPointerCapture?.(event.pointerId)
      }}
      onPointerUp={(event) => {
        const active = gesture.current
        if (!active || active.id !== event.pointerId) return
        gesture.current = null
        suppressClick.current = active.moved
        reset()
        if (
          revealed &&
          !disabled &&
          !active.vertical &&
          Math.abs(active.dx) > 72 &&
          Math.abs(active.dx) > Math.abs(active.dy) * 1.2
        )
          onSwipe?.(active.dx < 0 ? "left" : "right")
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onPointerMove={move}
      onPointerLeave={() => {
        if (!gesture.current) reset()
      }}
    >
      <div className="card-surface-tilt">
        <div className="card-surface-turn">
          <div className="card-surface-back" aria-hidden="true">
            <Icon name="layers" size={68} />
            <span>
              DEADLOCK
              <br />
              CONTRACTS
            </span>
          </div>
          <div className="card-surface-front" aria-hidden={!revealed}>
            <CardPreview
              card={card}
              preloadArtwork={preloadArtwork}
              artOverlay={
                <>
                  <span className="card-surface-shine" aria-hidden="true" />
                  <span className="card-surface-glare" aria-hidden="true" />
                </>
              }
            />
            {edgeMark}
          </div>
        </div>
      </div>
      {onFlip && (
        <button
          className="card-surface-control"
          aria-label={actionLabel}
          disabled={disabled}
          onClick={(event) => {
            if (suppressClick.current && event.detail !== 0) {
              suppressClick.current = false
              return
            }
            onFlip()
          }}
        />
      )}
    </div>
  )
}
