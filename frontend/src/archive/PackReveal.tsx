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

export default function PackReveal({
  receipt,
  favorites,
}: {
  receipt: Receipt
  favorites?: FavoriteControls
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const stageActionRef = useRef<HTMLButtonElement>(null)
  const closeActionRef = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<number | null>(null)
  const session = useRef(0)
  const actionLocked = useRef(false)
  const opening = useRef(false)
  const [stage, setStage] = useState<Stage>("sealed")
  const [cardIndex, setCardIndex] = useState(0)
  const [faceUp, setFaceUp] = useState(false)
  const [departure, setDeparture] = useState<"left" | "right" | null>(null)
  const [saving, setSaving] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [showInlineResults, setShowInlineResults] = useState(false)
  const reduced = useReducedMotion()

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const invalidate = () => {
    ++session.current
    opening.current = false
    clearTimer()
    actionLocked.current = false
  }
  const results = () => {
    invalidate()
    setSaving(false)
    setDeparture(null)
    setStage("results")
    setCompleted(true)
  }
  useEffect(() => {
    if (reduced && dialogRef.current?.open) results()
  }, [reduced])
  useEffect(() => () => invalidate(), [])
  useEffect(() => {
    invalidate()
    setStage("sealed")
    setCardIndex(0)
    setFaceUp(false)
    setCompleted(false)
    setShowInlineResults(false)
    setSaving(false)
    setDeparture(null)
    if (dialogRef.current?.open) dialogRef.current.close()
  }, [receipt.id])
  useEffect(() => {
    if (!dialogRef.current?.open) return
    if (stage === "cards" || stage === "sealed") stageActionRef.current?.focus()
    if (stage === "results") closeActionRef.current?.focus()
  }, [stage, cardIndex, faceUp])

  const open = () => {
    invalidate()
    setCardIndex(0)
    setFaceUp(false)
    setDeparture(null)
    setSaving(false)
    setShowInlineResults(false)
    setStage(reduced || !receipt.items.length ? "results" : "sealed")
    if (reduced || !receipt.items.length) setCompleted(true)
    dialogRef.current?.showModal()
    stageActionRef.current?.focus()
  }
  const finishOpening = () => {
    if (!opening.current || !dialogRef.current?.open) return
    opening.current = false
    clearTimer()
    actionLocked.current = false
    setStage(receipt.items.length ? "cards" : "results")
    if (!receipt.items.length) setCompleted(true)
  }
  const breakSeal = () => {
    if (actionLocked.current) return
    if (reduced) return results()
    actionLocked.current = true
    opening.current = true
    setStage("opening")
    clearTimer()
    // animationend owns the transition; recover if CSS or the event is unavailable.
    timerRef.current = window.setTimeout(finishOpening, 3600)
  }
  const next = async (direction: "left" | "right") => {
    if (stage !== "cards" || !faceUp || actionLocked.current) return
    const item = receipt.items[cardIndex]
    if (
      !item ||
      (direction === "left" && (!favorites?.ids || favorites.loading || favorites.pendingId))
    )
      return
    const epoch = session.current
    actionLocked.current = true
    if (direction === "left") {
      setSaving(true)
      const saved = await favorites!.setFavorite(item.card.id, true)
      if (epoch !== session.current || !dialogRef.current?.open) return
      setSaving(false)
      if (!saved) {
        actionLocked.current = false
        return
      }
    }
    if (epoch !== session.current || !dialogRef.current?.open) return
    setDeparture(direction)
    clearTimer()
    timerRef.current = window.setTimeout(
      () => {
        timerRef.current = null
        if (cardIndex + 1 >= receipt.items.length) results()
        else {
          setFaceUp(false)
          setDeparture(null)
          setCardIndex((index) => index + 1)
          actionLocked.current = false
        }
      },
      reduced ? 0 : 240,
    )
  }
  const close = () => dialogRef.current?.close()
  const current = receipt.items[cardIndex]
  const itemLabel = (item: Receipt["items"][number]) =>
    `${item.duplicate ? (ru ? "Дубль" : "Duplicate") : ru ? "Новая карточка" : "New card"}${item.test_grant ? (ru ? " · Тестовый экземпляр" : " · Sandbox copy") : ""}`
  const itemSummary = (item: Receipt["items"][number]) => (
    <article key={item.id} data-rank={item.card.rank}>
      <CardSurface card={item.card} reduced={reduced} />
      <p>{itemLabel(item)}</p>
      {favorites && <FavoriteButton controls={favorites} cardId={item.card.id} />}
    </article>
  )

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
          {receipt.items.map(itemSummary)}
        </div>
      )}
      {showInlineResults && favorites && <FavoriteError controls={favorites} />}
      <dialog
        ref={dialogRef}
        className="pack-reveal"
        data-theme="archive"
        aria-labelledby={`pack-reveal-title-${receipt.id}`}
        onClose={() => {
          invalidate()
          setShowInlineResults(true)
          setCompleted(true)
          triggerRef.current?.focus()
        }}
        onCancel={invalidate}
      >
        <div className="pack-reveal-shell" data-stage={stage}>
          <header>
            <div>
              <small>{ru ? "АРХИВНАЯ ДОСТАВКА" : "ARCHIVE DELIVERY"}</small>
              <h2 id={`pack-reveal-title-${receipt.id}`}>
                {receipt.pack?.title || (ru ? "Карточки архива" : "Archive cards")}
              </h2>
            </div>
            <button onClick={close} aria-label={ru ? "Закрыть показ" : "Close reveal"}>
              <Icon name="x" />
            </button>
          </header>

          {(stage === "sealed" || stage === "opening") && (
            <div className="pack-reveal-envelope" aria-live="polite">
              <div
                className="pack-opening-scene"
                aria-hidden="true"
                onAnimationEnd={(event) => {
                  if (event.target === event.currentTarget && event.animationName === "pack-scene")
                    finishOpening()
                }}
              >
                <div className="pack-opening-fan">
                  {receipt.items.slice(0, 4).map((item, index, items) => (
                    <div
                      key={item.id}
                      className="pack-fan-back"
                      style={{ "--fan-offset": index - (items.length - 1) / 2 } as CSSProperties}
                    >
                      <Icon name="layers" size={42} />
                      <span>
                        DEADLOCK
                        <br />
                        CONTRACTS
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pack-envelope-art">
                  <div className="pack-tear-strip">
                    <b>DEAD</b>
                    <span>
                      <b>LOCK</b>
                      <span>
                        <b>CON</b>
                        <span>
                          <b>TRACTS</b>
                        </span>
                      </span>
                    </span>
                  </div>
                  <div className="pack-envelope-body">
                    <Icon name="layers" size={70} />
                    <span>{receipt.pack?.title || "THE ARCHIVE"}</span>
                    <small>
                      {String(receipt.items.length).padStart(2, "0")} · COLLECTION FILES
                    </small>
                  </div>
                  <span className="pack-open-light" />
                </div>
              </div>
              <p>
                {ru
                  ? "Карточки уже сохранены в коллекции"
                  : "Cards are already saved to your collection"}
              </p>
              {stage === "sealed" && (
                <button ref={stageActionRef} className="archive-primary" onClick={breakSeal}>
                  {ru ? "Вскрыть конверт" : "Break the seal"}
                </button>
              )}
            </div>
          )}

          {stage === "cards" && current && (
            <article
              key={current.id}
              className="pack-reveal-card"
              aria-live="polite"
              onKeyDown={(event) => {
                if (faceUp && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                  event.preventDefault()
                  if (!event.repeat) void next(event.key === "ArrowLeft" ? "left" : "right")
                }
              }}
            >
              <div className="pack-card-stack">
                {[0, 1].slice(0, Math.min(2, receipt.items.length - cardIndex - 1)).map((layer) => (
                  <span key={layer} className="pack-stack-back" aria-hidden="true" />
                ))}
                <div className="pack-card-moving" data-departure={departure}>
                  <CardSurface
                    card={current.card}
                    revealed={faceUp}
                    reduced={reduced}
                    disabled={saving || !!departure}
                    actionRef={!faceUp ? stageActionRef : undefined}
                    onFlip={() => setFaceUp((value) => !value)}
                    onSwipe={(direction) => void next(direction)}
                  />
                </div>
              </div>
              <p className="pack-card-status">
                {cardIndex + 1} / {receipt.items.length} ·{" "}
                {faceUp
                  ? itemLabel(current)
                  : ru
                    ? "Нажми на карточку, чтобы раскрыть"
                    : "Tap the card to reveal it"}
              </p>
              {faceUp && (
                <div className="pack-card-actions">
                  {favorites && (
                    <button
                      disabled={
                        saving ||
                        !!departure ||
                        favorites.loading ||
                        !favorites.ids ||
                        !!favorites.pendingId
                      }
                      onClick={() => void next("left")}
                    >
                      <Icon name="star" size={18} />
                      {saving
                        ? ru
                          ? "Сохраняем…"
                          : "Saving…"
                        : ru
                          ? "В избранное и дальше"
                          : "Favorite & next"}
                    </button>
                  )}
                  <button
                    ref={stageActionRef}
                    className="archive-primary"
                    disabled={saving || !!departure}
                    onClick={() => void next("right")}
                  >
                    {cardIndex + 1 === receipt.items.length
                      ? ru
                        ? "Итоги"
                        : "Results"
                      : ru
                        ? "Следующая"
                        : "Next card"}
                    <Icon name="arrow-up-right" size={18} />
                  </button>
                </div>
              )}
              {faceUp && (
                <small>
                  {ru
                    ? favorites
                      ? "Влево — в избранное · вправо — дальше"
                      : "Вправо — следующая карточка"
                    : favorites
                      ? "Swipe left to favorite · right to continue"
                      : "Swipe right to continue"}
                </small>
              )}
            </article>
          )}

          {stage === "results" && (
            <div className="pack-reveal-results" aria-live="polite">
              <p>
                {ru ? `Получено: ${receipt.items.length}` : `Received: ${receipt.items.length}`}
              </p>
              <div className="archive-grid">{receipt.items.map(itemSummary)}</div>
            </div>
          )}
          <footer>
            {favorites && <FavoriteError controls={favorites} />}
            <div>
              {stage !== "results" && (
                <button onClick={results}>{ru ? "Сразу к итогам" : "Skip to results"}</button>
              )}
              <button ref={closeActionRef} onClick={close}>
                {ru ? "Закрыть показ" : "Close reveal"}
              </button>
            </div>
          </footer>
        </div>
      </dialog>
    </>
  )
}
