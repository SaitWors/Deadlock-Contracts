import Icon from "./icons/Icon"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { AppearanceButton } from "./Appearance"
import { LanguageSwitch, useLanguage } from "./i18n"

type HeaderItem = { id: string; label: string; badge?: string; href?: string }

export default function BureauHeader({
  items,
  active,
  onNavigate,
  actions,
  mobileActions,
  mobileItems,
  homeHref,
}: {
  items: HeaderItem[]
  active: string
  onNavigate: (id: string) => void
  actions: ReactNode
  mobileActions?: ReactNode
  mobileItems?: HeaderItem[]
  homeHref?: string
}) {
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        toggle.current?.focus()
      }
    }
    document.addEventListener("keydown", escape)
    return () => document.removeEventListener("keydown", escape)
  }, [open])
  useEffect(() => {
    setOpen(false)
  }, [active])
  const navigate = (id: string) => {
    if (open) toggle.current?.focus()
    onNavigate(id)
    setOpen(false)
  }
  const itemLink = (item: HeaderItem) =>
    item.href ? (
      <a key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined}>
        {item.label}
        {item.badge && <small>{item.badge}</small>}
      </a>
    ) : (
      <button
        key={item.id}
        aria-current={active === item.id ? "page" : undefined}
        onClick={() => navigate(item.id)}
      >
        {item.label}
        {item.badge && <small>{item.badge}</small>}
      </button>
    )
  return (
    <header className="bureau-header">
      <div className="bureau-header-inner">
        {homeHref ? (
          <a
            className="bureau-brand"
            href={homeHref}
            aria-label={
              language === "ru" ? "Deadlock Contracts — главная" : "Deadlock Contracts — home"
            }
          >
            <span className="ns-brand-icon">
              <Icon name="eye" size={23} />
            </span>
            <span className="ns-brand-wordmark">
              DEADLOCK<small>CONTRACTS</small>
            </span>
          </a>
        ) : (
          <button
            className="bureau-brand"
            onClick={() => navigate("home")}
            aria-label={
              language === "ru" ? "Deadlock Contracts — главная" : "Deadlock Contracts — home"
            }
          >
            <span className="ns-brand-icon">
              <Icon name="eye" size={23} />
            </span>
            <span className="ns-brand-wordmark">
              DEADLOCK<small>CONTRACTS</small>
            </span>
          </button>
        )}
        <nav
          className="bureau-nav"
          aria-label={language === "ru" ? "Основная навигация" : "Main navigation"}
        >
          {items.map(itemLink)}
        </nav>
        <div className="bureau-account">
          <AppearanceButton />
          <LanguageSwitch compact />
          {actions}
        </div>
        <button
          ref={toggle}
          className="bureau-menu-toggle"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={
            language === "ru"
              ? open
                ? "Закрыть меню"
                : "Открыть меню"
              : open
                ? "Close menu"
                : "Open menu"
          }
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? "x" : "menu"} size={24} />
        </button>
      </div>
      {open && (
        <nav
          className="bureau-mobile-nav"
          id={menuId}
          aria-label={language === "ru" ? "Мобильная навигация" : "Mobile navigation"}
        >
          {(mobileItems || items).map(itemLink)}
          <div className="bureau-mobile-preferences">
            <LanguageSwitch />
            {mobileActions}
          </div>
        </nav>
      )}
    </header>
  )
}
