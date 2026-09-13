import { useEffect, useRef, useState } from "react"
import Icon from "../icons/Icon"
import { useLanguage } from "../i18n"
import Regalia from "../regalia/Regalia"
import CardPreview from "./CardPreview"
import type { Receipt } from "./types"
import "./pack-reveal.css"

type Stage = "sealed" | "opening" | "cards" | "results"

export default function PackReveal({ receipt }: { receipt: Receipt }) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const stageActionRef = useRef<HTMLButtonElement>(null)
  const closeActionRef = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<number | null>(null)
  const [stage, setStage] = useState<Stage>("sealed")
  const [cardIndex, setCardIndex] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [showInlineResults, setShowInlineResults] = useState(false)
  const [reduced, setReduced] = useState(false)

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const results = () => {
    clearTimer()
    setStage("results")
    setCompleted(true)
  }

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => {
      setReduced(media.matches)
      if (media.matches && dialogRef.current?.open) results()
    }
    update()
    media.addEventListener("change", update)
    return () => {
      clearTimer()
      media.removeEventListener("change", update)
    }
  }, [])

  useEffect(() => {
    clearTimer()
    setStage("sealed")
    setCardIndex(0)
    setCompleted(false)
    setShowInlineResults(false)
    if (dialogRef.current?.open) dialogRef.current.close()
  }, [receipt.id])

  useEffect(() => {
    if (!dialogRef.current?.open) return
    if (stage === "cards") stageActionRef.current?.focus()
    if (stage === "results") closeActionRef.current?.focus()
  }, [stage, cardIndex])

  const open = () => {
    setCardIndex(0)
    setStage(reduced || !receipt.items.length ? "results" : "sealed")
    if (reduced || !receipt.items.length) setCompleted(true)
    dialogRef.current?.showModal()
  }
  const breakSeal = () => {
    if (reduced) return results()
    setStage("opening")
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setStage(receipt.items.length ? "cards" : "results")
      if (!receipt.items.length) setCompleted(true)
    }, 550)
  }
  const next = () => {
    if (cardIndex + 1 >= receipt.items.length) results()
    else setCardIndex((index) => index + 1)
  }
  const close = () => dialogRef.current?.close()

  const itemSummary = (item: Receipt["items"][number]) => (
    <article key={item.id} data-rank={item.card.rank}>
      <CardPreview card={item.card} />
      <p>
        {item.duplicate ? (ru ? "Дубль" : "Duplicate") : ru ? "Новая карточка" : "New card"}
        {item.test_grant ? (ru ? " · Тестовая выдача OWNER" : " · OWNER test grant") : ""}
      </p>
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
      <dialog
        ref={dialogRef}
        className="pack-reveal"
        data-theme="archive"
        aria-labelledby={`pack-reveal-title-${receipt.id}`}
        onClose={() => {
          clearTimer()
          setShowInlineResults(true)
          triggerRef.current?.focus()
        }}
        onCancel={clearTimer}
      >
        <div className="pack-reveal-shell" data-stage={stage}>
          <header>
            <div>
              <small>{ru ? "АРХИВНАЯ ДОСТАВКА" : "ARCHIVE DELIVERY"}</small>
              <h2 id={`pack-reveal-title-${receipt.id}`}>{receipt.pack?.title}</h2>
            </div>
            <button onClick={close} aria-label={ru ? "Закрыть показ" : "Close reveal"}>
              <Icon name="x" />
            </button>
          </header>

          {(stage === "sealed" || stage === "opening") && (
            <div className="pack-reveal-envelope" aria-live="polite">
              <div className="pack-envelope-art" aria-hidden="true">
                <span className="pack-envelope-flap" />
                <span className="pack-envelope-seal">
                  <Regalia id="seal-archive" />
                </span>
              </div>
              <p>
                {ru
                  ? "Карточки уже сохранены в коллекции"
                  : "Cards are already saved to your collection"}
              </p>
              {stage === "sealed" && (
                <button className="archive-primary" onClick={breakSeal}>
                  {ru ? "Снять печать" : "Break the seal"}
                </button>
              )}
            </div>
          )}

          {stage === "cards" && receipt.items[cardIndex] && (
            <article
              key={receipt.items[cardIndex].id}
              className="pack-reveal-card"
              data-rank={receipt.items[cardIndex].card.rank}
              aria-live="polite"
            >
              <CardPreview card={receipt.items[cardIndex].card} />
              <p>
                {cardIndex + 1} / {receipt.items.length} ·{" "}
                {receipt.items[cardIndex].duplicate
                  ? ru
                    ? "Дубль"
                    : "Duplicate"
                  : ru
                    ? "Новая карточка"
                    : "New card"}
                {receipt.items[cardIndex].test_grant
                  ? ru
                    ? " · Тестовая выдача OWNER"
                    : " · OWNER test grant"
                  : ""}
              </p>
              <button ref={stageActionRef} className="archive-primary" onClick={next}>
                {cardIndex + 1 === receipt.items.length
                  ? ru
                    ? "Итоги"
                    : "Results"
                  : ru
                    ? "Следующая"
                    : "Next card"}
              </button>
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
            {stage !== "results" && (
              <button onClick={results}>{ru ? "Сразу к итогам" : "Skip to results"}</button>
            )}
            <button ref={closeActionRef} onClick={close}>
              {ru ? "Закрыть показ" : "Close reveal"}
            </button>
          </footer>
        </div>
      </dialog>
    </>
  )
}
