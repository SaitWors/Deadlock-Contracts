import Icon from "./icons/Icon"
import { useLanguage } from "./i18n"
import { BureauNavigationStatus, type BureauNavigationBadges } from "./bureau-navigation"

const items = [
  ["home", "Обзор", "Overview", "house"],
  ["quests", "Контракты", "Contracts", "file-text"],
  ["collection", "Карточки", "Collection", "layers"],
  ["packs", "Конверт", "Daily pack", "mail"],
  ["profile", "Профиль", "Profile", "user-round"],
] as const
export default function BureauBottomNav({
  active,
  badges = {},
  onNavigate,
}: {
  active: string
  badges?: BureauNavigationBadges
  onNavigate: (tab: string) => void
}) {
  const { language } = useLanguage()
  const section =
    active === "all-collection"
      ? "collection"
      : active === "active" || active === "history"
        ? "quests"
        : active
  const caseStatus = [badges.active, badges.history].filter(Boolean).join(". ")
  return (
    <nav
      className="dc-mobile-bottom-nav"
      aria-label={language === "ru" ? "Основная мобильная навигация" : "Main mobile navigation"}
    >
      {items.map(([id, ru, en, path]) => (
        <button
          key={id}
          type="button"
          aria-current={active === id ? "page" : section === id ? "location" : undefined}
          className={section === id ? "active" : ""}
          onClick={() => onNavigate(id)}
        >
          <Icon name={path} className="dc-icon" />
          <span>{language === "ru" ? ru : en}</span>
          <BureauNavigationStatus
            label={id === "packs" ? badges.packs : id === "quests" ? caseStatus : undefined}
          />
        </button>
      ))}
    </nav>
  )
}
