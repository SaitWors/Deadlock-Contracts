import Icon from "./icons/Icon"
import { useId } from "react"
import { useResource } from "./community/api"
import CardPreview from "./archive/CardPreview"
import type { Card } from "./archive/types"
import "./collection-preview.css"

type PreviewCard = Pick<
  Card,
  | "id"
  | "rank"
  | "title"
  | "hero_name"
  | "image_url"
  | "crop_x"
  | "crop_y"
  | "zoom"
  | "source_url"
  | "release_poster"
>
type DailyPreview = { available: boolean; next_reset_at: string; cards: PreviewCard[] }

export default function DailyCollectionPreview({ language }: { language: "ru" | "en" }) {
  const ru = language === "ru"
  const titleId = useId()
  const preview = useResource<DailyPreview>("/api/public/archive/preview")
  const data = preview.data
  const reset = data?.next_reset_at ? new Date(data.next_reset_at) : null
  const localReset =
    reset && Number.isFinite(reset.getTime())
      ? reset.toLocaleString(ru ? "ru-RU" : "en-US", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : null
  return (
    <section className="collection-daily-preview" aria-labelledby={titleId}>
      <header>
        <Icon name="layers" size={18} />
        <h2 id={titleId}>{ru ? "Из ежедневного пака" : "From the daily pack"}</h2>
      </header>
      {preview.loading ? (
        <div className="collection-preview-state" role="status">
          <p>{ru ? "Загружаем карточки…" : "Loading the cards…"}</p>
        </div>
      ) : preview.error || !data ? (
        <div className="collection-preview-state" role="alert">
          <p>{ru ? "Не удалось показать карточки." : "Could not load the card preview."}</p>
          <button type="button" className="dc-ghost" onClick={preview.reload}>
            {ru ? "Повторить" : "Try again"}
          </button>
        </div>
      ) : data.cards.length ? (
        <>
          <div
            className="collection-preview-cards"
            role="region"
            tabIndex={0}
            aria-label={
              ru ? "Примеры карточек — прокручиваемая область" : "Example cards — scrollable region"
            }
          >
            {data.cards.map((card) => (
              <CardPreview key={card.id} card={card} preserveArtwork />
            ))}
          </div>
          <p className="collection-preview-caption">
            {ru
              ? "Примеры из текущего пака. Карточки при открытии выбираются случайно."
              : "Examples from the current pack. Your cards are selected at random when you open it."}
          </p>
        </>
      ) : (
        <div className="collection-preview-state" role="status">
          <p>
            {data.available
              ? ru
                ? "Превью иллюстраций пока недоступно."
                : "Artwork previews are not available yet."
              : ru
                ? "Ежедневный пак временно недоступен. Попробуйте позже."
                : "The daily pack is temporarily unavailable. Please try again later."}
          </p>
          <button type="button" className="dc-ghost" onClick={preview.reload}>
            {ru ? "Обновить" : "Refresh"}
          </button>
        </div>
      )}
      <div className="collection-preview-facts">
        <p>
          <strong>{ru ? "1 бесплатный пак в день" : "1 free pack per day"}</strong>
        </p>
        <p>
          {ru ? "Обновляется в 00:00 UTC." : "Resets at 00:00 UTC."}{" "}
          {localReset && (
            <span>
              {ru ? "Ближайшее обновление:" : "Next reset:"}{" "}
              <time dateTime={data!.next_reset_at}>{localReset}</time>
            </span>
          )}
        </p>
      </div>
    </section>
  )
}
