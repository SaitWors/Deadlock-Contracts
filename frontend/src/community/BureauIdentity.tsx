import { useState } from "react"
import { useLanguage } from "../i18n"
import Icon from "../icons/Icon"
import type { BureauAppearance, BureauSummary } from "./types"

export const DEFAULT_APPEARANCE: BureauAppearance = {
  accent: "SAGE",
  cover: "AURORA",
  emblem: "compass",
  avatar_shape: "ROUNDED",
  roster_layout: "CARDS",
  cover_position: 50,
}
export function appearanceOf(item: { appearance?: BureauAppearance }): BureauAppearance {
  return { ...DEFAULT_APPEARANCE, ...item.appearance }
}
function Artwork({ src, position = 50 }: { src: string; position?: number }) {
  const [failed, setFailed] = useState(false)
  return failed ? null : (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      style={{ objectPosition: `50% ${position}%` }}
      onError={() => setFailed(true)}
    />
  )
}
export function BureauEmblem({ item }: { item: Pick<BureauSummary, "appearance" | "avatar_url"> }) {
  const style = appearanceOf(item)
  return (
    <span className={`guild-emblem shape-${style.avatar_shape.toLowerCase()}`}>
      <Icon name={style.emblem} size={48} />
      {item.avatar_url && <Artwork key={item.avatar_url} src={item.avatar_url} />}
    </span>
  )
}
export function BureauCover({ item }: { item: Pick<BureauSummary, "appearance" | "cover_url"> }) {
  const style = appearanceOf(item)
  return (
    <div className={`guild-cover cover-${style.cover.toLowerCase()}`} aria-hidden="true">
      <span className="guild-cover-motif">
        <Icon name={style.emblem} size={180} />
      </span>
      {item.cover_url && (
        <Artwork key={item.cover_url} src={item.cover_url} position={style.cover_position} />
      )}
    </div>
  )
}
export function recruitmentLabel(value: string, ru: boolean) {
  return (
    (
      {
        OPEN: ru ? "Открытый набор" : "Open membership",
        APPLICATION: ru ? "По заявкам" : "By application",
        CLOSED: ru ? "Набор закрыт" : "Recruitment closed",
      } as Record<string, string>
    )[value] || value
  )
}
export function BureauHero({
  item,
  children,
}: {
  item: BureauSummary
  children?: React.ReactNode
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  return (
    <header className={`guild-hero accent-${appearanceOf(item).accent.toLowerCase()}`}>
      <BureauCover item={item} />
      <div className="guild-identity">
        <BureauEmblem item={item} />
        <div className="guild-identity-copy">
          <p className="guild-kicker">
            {ru ? "Бюро игроков" : "Player bureau"} <span>/{item.slug}</span>
          </p>
          <h1>{item.name}</h1>
          {item.tagline && <p className="guild-tagline">{item.tagline}</p>}
        </div>
        <div className="guild-hero-actions">{children}</div>
      </div>
      <div className="guild-facts">
        <span>
          <Icon name="users" />{" "}
          <b>
            {item.member_count} / {item.capacity}
          </b>{" "}
          {ru ? "участников" : "members"}
        </span>
        <span>
          <Icon name={item.recruitment === "CLOSED" ? "lock-keyhole" : "globe"} />{" "}
          {recruitmentLabel(item.recruitment, ru)}
        </span>
        <span>
          <Icon name="message-circle" />{" "}
          {item.language === "any"
            ? ru
              ? "Любой язык"
              : "Any language"
            : item.language === "ru"
              ? "Русский"
              : "English"}
        </span>
      </div>
    </header>
  )
}
