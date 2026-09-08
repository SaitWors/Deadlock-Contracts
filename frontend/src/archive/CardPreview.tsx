import { RANKS, type Card } from "./types"
import "./card-preview.css"

export default function CardPreview({
  card,
}: {
  card: Pick<Card, "rank" | "title" | "hero_name" | "image_url" | "crop_x" | "crop_y" | "zoom">
}) {
  const tier = RANKS.indexOf(card.rank)
  return (
    <figure
      className="archive-card"
      data-rank={card.rank}
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
              objectPosition: `${card.crop_x}% ${card.crop_y}%`,
              transform: `scale(${card.zoom})`,
            }}
          />
        ) : (
          <span className="archive-art-placeholder" aria-hidden="true">
            ✧
          </span>
        )}
      </div>
      <svg className="archive-card-frame" viewBox="0 0 400 600" fill="none" aria-hidden="true">
        <path
          d="M48 7H352L393 48V552L352 593H48L7 552V48Z"
          stroke="currentColor"
          strokeWidth={tier > 5 ? 5 : 2}
        />
        <path d="M55 18H345L382 55V545L345 582H55L18 545V55Z" stroke="currentColor" opacity=".55" />
        {[false, true].map((flip) => (
          <g key={String(flip)} transform={flip ? "translate(400 600) rotate(180)" : undefined}>
            <path
              d="M24 104V58L58 24H128M35 78V64L64 35H92"
              stroke="currentColor"
              strokeWidth="3"
            />
            {tier >= 2 && (
              <path
                d="M33 116L47 103L33 90L20 103ZM150 17L163 30L176 17"
                fill="currentColor"
                opacity=".8"
              />
            )}
            {tier >= 4 && (
              <path
                d="M21 178Q62 162 37 131Q55 149 21 155M89 22Q111 57 140 32Q120 50 119 22"
                stroke="currentColor"
                strokeWidth="2"
              />
            )}
            {!flip && tier >= 6 && (
              <path
                d="M130 6L160 19L200 3L240 19L270 6M165 32L200 16L235 32L200 49Z"
                stroke="currentColor"
                strokeWidth="3"
              />
            )}
            {!flip && tier >= 7 && <circle cx="200" cy="33" r="8" fill="currentColor" />}
            {!flip && tier === 8 && (
              <path
                d="M172 61L200 49L228 61M187 68L200 88L213 68"
                stroke="currentColor"
                strokeWidth="3"
              />
            )}
          </g>
        ))}
        <path d="M24 444H376M50 450H350" stroke="currentColor" opacity=".65" />
      </svg>
      <span className="archive-rank">{card.rank}</span>
      <figcaption>
        <small>{card.hero_name || "DEADLOCK CONTRACTS"}</small>
        <strong>{card.title || "…"}</strong>
      </figcaption>
    </figure>
  )
}
