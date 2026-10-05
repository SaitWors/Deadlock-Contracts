import Icon from "../icons/Icon"
import type { ReactNode } from "react"
import { RANKS, type Card } from "./types"
import "./card-preview.css"

export default function CardPreview({
  card,
  artOverlay,
}: {
  card: Pick<Card, "rank" | "title" | "hero_name" | "image_url" | "crop_x" | "crop_y" | "zoom"> &
    Partial<Pick<Card, "id" | "source_url" | "release_poster">>
  artOverlay?: ReactNode
}) {
  const tier = RANKS.indexOf(card.rank)
  const releasePoster =
    card.release_poster === true &&
    card.source_url === "https://www.playdeadlock.com/cityneversleeps" &&
    card.crop_x === 50 &&
    card.crop_y === 50 &&
    card.zoom === 1
  return (
    <figure
      className="archive-card"
      data-rank={card.rank}
      data-tier={tier}
      data-release={releasePoster ? "city-never-sleeps" : undefined}
      aria-label={`${card.hero_name} · ${card.title} · ${card.rank}`}
      title={`${card.hero_name} · ${card.title} · ${card.rank}`}
    >
      <div className="archive-card-art">
        {card.image_url ? (
          <img
            src={card.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            style={{
              objectFit: releasePoster ? "contain" : undefined,
              objectPosition: `${card.crop_x}% ${card.crop_y}%`,
              transform: `scale(${card.zoom})`,
            }}
          />
        ) : (
          <span className="archive-art-placeholder" aria-hidden="true">
            <Icon name="images" size={40} />
          </span>
        )}
        {artOverlay}
      </div>
      <svg className="archive-card-frame" viewBox="0 0 400 600" fill="none" aria-hidden="true">
        <rect
          x="3"
          y="3"
          width="394"
          height="594"
          rx="11"
          stroke="currentColor"
          strokeWidth={tier > 5 ? 4 : 2}
        />
        <rect x="11" y="11" width="378" height="578" rx="7" stroke="currentColor" opacity=".48" />
        <path d="M27 549H373" stroke="currentColor" opacity=".35" />
        {Array.from({ length: tier + 1 }, (_, index) => (
          <circle
            key={index}
            cx={30 + index * 9}
            cy="566"
            r="2"
            fill="currentColor"
            opacity=".75"
          />
        ))}
        <path d="M361 558V574M353 566H369" stroke="currentColor" opacity=".7" />
      </svg>
      <span className="archive-card-edition" aria-hidden="true">
        DC / ARCHIVE
      </span>
      <span className="archive-rank">{card.rank}</span>
      <figcaption>
        <small>{card.hero_name || "DEADLOCK CONTRACTS"}</small>
        <strong>{card.title || "…"}</strong>
      </figcaption>
    </figure>
  )
}
