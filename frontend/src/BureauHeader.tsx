import Icon from "./icons/Icon"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import logo from "@/imports/logo-horizontal.svg"
import { LanguageSwitch, useLanguage } from "./i18n"

export default function BureauHeader({
  items,
  active,
  onNavigate,
  actions,
  mobileActions,
  mobileItems,
}: {
  items: { id: string; label: string; badge?: string }[]
  active: string
  onNavigate: (id: string) => void
  actions: ReactNode
  mobileActions?: ReactNode
  mobileItems?: { id: string; label: string; badge?: string }[]
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
  return (
    <header className="bureau-header">
      <div className="bureau-header-inner">
        <button
          className="bureau-brand"
          onClick={() => navigate("home")}
          aria-label={
            language === "ru" ? "Deadlock Contracts — главная" : "Deadlock Contracts — home"
          }
        >
          <img src={logo} alt="Deadlock Contracts" width="144" height="44" />
        </button>
        <nav
          className="bureau-nav"
          aria-label={language === "ru" ? "Основная навигация" : "Main navigation"}
        >
          {items.map((item) => (
            <button
              key={item.id}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              {item.label}
              {item.badge && <small>{item.badge}</small>}
            </button>
          ))}
        </nav>
        <div className="bureau-account">
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
          {(mobileItems || items).map((item) => (
            <button
              key={item.id}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              {item.label}
              {item.badge && <small>{item.badge}</small>}
            </button>
          ))}
          <div className="bureau-mobile-preferences">
            <LanguageSwitch />
            {mobileActions}
          </div>
        </nav>
      )}
    </header>
  )
}
