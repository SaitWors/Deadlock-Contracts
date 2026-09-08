import { useLanguage } from "./i18n"

const items = [
  ["home", "Главная", "Home", "M4 20V9l8-6 8 6v11h-6v-7h-4v7z"],
  ["quests", "Контракты", "Contracts", "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7"],
  ["active", "Дело", "Case", "M3 7h18v14H3z M8 7V3h8v4 M9 12h6"],
  ["leaderboard", "Рейтинг", "Ranking", "M4 21V11h5v10 M9 21V4h6v17 M15 21V8h5v13"],
  ["profile", "Профиль", "Profile", "M7 7a5 5 0 1 0 10 0a5 5 0 1 0-10 0 M3 22v-2a9 9 0 0 1 18 0v2"],
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
          <svg
            className="dc-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={path} />
          </svg>
          <span>{language === "ru" ? ru : en}</span>
        </button>
      ))}
    </nav>
  )
}
