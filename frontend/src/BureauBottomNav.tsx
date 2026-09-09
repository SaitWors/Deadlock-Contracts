import Icon from "./icons/Icon"
import { useLanguage } from "./i18n"

const items = [
  ["home", "Главная", "Home", "house"],
  ["quests", "Контракты", "Contracts", "file-text"],
  ["active", "Дело", "Case", "briefcase-business"],
  ["leaderboard", "Рейтинг", "Ranking", "chart-no-axes-column-increasing"],
  ["profile", "Профиль", "Profile", "user-round"],
] as const
export default function BureauBottomNav({
  active,
  onNavigate,
}: {
  active: string
  onNavigate: (tab: string) => void
}) {
  const { language } = useLanguage()
  return (
    <nav
      className="dc-mobile-bottom-nav"
      aria-label={language === "ru" ? "Основная мобильная навигация" : "Main mobile navigation"}
    >
      {items.map(([id, ru, en, path]) => (
        <button
          key={id}
          type="button"
          aria-current={active === id ? "page" : undefined}
          className={active === id ? "active" : ""}
          onClick={() => onNavigate(id)}
        >
          <Icon name={path} className="dc-icon" />
          <span>{language === "ru" ? ru : en}</span>
        </button>
      ))}
    </nav>
  )
}
