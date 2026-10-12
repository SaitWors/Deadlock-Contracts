import { BureauEmblem, appearanceOf } from "./community/BureauIdentity"
import type { BureauSummary } from "./community/types"
import Icon from "./icons/Icon"
import { useEffect, useId, useRef, useState } from "react"
import { request, useResource } from "./community/api"
import { useLanguage } from "./i18n"
import type { Wallet } from "./archive/types"
import "./account-menu.css"

export default function AccountMenu({
  user,
  level,
  csrf,
  revision,
  onNavigate,
  onOpenGuide,
}: {
  user: { display_name: string; avatar_url: string | null; xp: number; is_staff: boolean }
  level: number
  csrf: string
  revision: number
  onNavigate: (tab: string) => void
  onOpenGuide?: () => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const panelId = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  const wallet = useResource<Wallet>(`/api/archive/wallet?view=${revision}`)
  const bureau = useResource<{ my_bureau: BureauSummary | null }>(
    `/api/bureaus?menu=${open ? "open" : "closed"}`,
  )
  useEffect(() => {
    const refresh = () => wallet.reload()
    window.addEventListener("dc-archive-wallet", refresh)
    return () => window.removeEventListener("dc-archive-wallet", refresh)
  }, [])
  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    const route = () => setOpen(false)
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    window.addEventListener("hashchange", route)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
      window.removeEventListener("hashchange", route)
    }
  }, [open])
  const go = (tab: string) => {
    setOpen(false)
    trigger.current?.focus()
    onNavigate(tab)
  }
  return (
    <div
      className="bureau-profile-menu"
      ref={root}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false)
      }}
    >
      <button
        ref={trigger}
        className="bureau-profile-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ru ? "Меню аккаунта" : "Account menu"}
        onClick={() => setOpen((value) => !value)}
      >
        {user.avatar_url ? <img src={user.avatar_url} alt="" /> : <span>DC</span>}
        <span>
          <b>{user.display_name}</b>
          <small>
            LVL {level} · <Icon name="coins" size={14} />{" "}
            {wallet.data
              ? (wallet.data.available_balance ?? wallet.data.balance).toLocaleString(locale)
              : "—"}
          </small>
        </span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <section
          id={panelId}
          className="bureau-profile-popover"
          aria-label={ru ? "Личное досье" : "Account dossier"}
        >
          <header>
            <small>{ru ? "Личное досье" : "Personal dossier"}</small>
            <strong>{user.display_name}</strong>
            <span>
              LVL {level} · {user.xp.toLocaleString(locale)} XP
            </span>
          </header>
          <div className="bureau-wallet-strip">
            <div>
              <small>{ru ? "Монеты бюро" : "Bureau coins"}</small>
              <b>
                <Icon name="coins" />{" "}
                {wallet.data
                  ? (wallet.data.available_balance ?? wallet.data.balance).toLocaleString(locale)
                  : "—"}
              </b>
              {!!wallet.data?.debt && (
                <small>
                  {ru ? "Долг" : "Debt"}: {wallet.data.debt.toLocaleString(locale)}
                </small>
              )}
            </div>
            <button ref={first} onClick={() => go("archive")}>
              {ru ? "Заработать" : "Earn coins"}
            </button>
          </div>
          {wallet.error && (
            <p role="alert">
              {ru ? "Не удалось обновить баланс." : "Could not refresh balance."}
              <button onClick={wallet.reload}>{ru ? "Повторить" : "Retry"}</button>
            </p>
          )}
          <div className="bureau-profile-links">
            <button onClick={() => go("arena")}>
              {ru ? "Арена бюро" : "Bureau arena"}
              <Icon name="swords" />
            </button>
            <button onClick={() => go("profile")}>
              {ru ? "Мой профиль и настройки" : "Profile & settings"}
              <Icon name="arrow-up-right" />
            </button>
            <button onClick={() => go("leaderboard")}>
              {ru ? "Моё место в рейтинге" : "My leaderboard position"}
              <Icon name="arrow-up-right" />
            </button>
            <button onClick={() => go("achievements")}>
              {ru ? "Достижения" : "Achievements"}
              <Icon name="medal" />
            </button>
          </div>
          <div className="bureau-profile-section">
            <small>{ru ? "МОЁ БЮРО" : "MY BUREAU"}</small>
            <button
              className={`accent-${appearanceOf(bureau.data?.my_bureau || {}).accent.toLowerCase()}`}
              onClick={() => {
                go("bureaus")
                if (bureau.data?.my_bureau?.slug)
                  window.location.hash = `bureaus/${bureau.data.my_bureau.slug}`
              }}
            >
              {bureau.data?.my_bureau && <BureauEmblem item={bureau.data.my_bureau} />}
              {bureau.data?.my_bureau?.name || (ru ? "Найти своё бюро" : "Find a bureau")}
              <Icon name="arrow-up-right" />
            </button>
          </div>
          <button className="bureau-studio-callout" onClick={() => go("studio")}>
            <small>CARD STUDIO</small>
            <b>{ru ? "Создать карточку" : "Create a card"}</b>
            <span>F · E · D · C · B · A · S · SS · SSS</span>
          </button>
          <div className="bureau-profile-links">
            <button onClick={() => go("packs")}>
              {ru ? "Конверты архива" : "Archive envelopes"}
              <Icon name="mail" />
            </button>
            <button onClick={() => go("collection")}>
              {ru ? "Моя коллекция" : "My collection"}
              <Icon name="layers" />
            </button>
            <button onClick={() => go("studio")}>
              {ru ? "Мои карточки и заявки" : "My designs & submissions"}
              <Icon name="layers" />
            </button>
            <button onClick={() => go("wallet")}>
              {ru ? "История монет" : "Coin history"}
              <Icon name="coins" />
            </button>
            <button onClick={() => go("history")}>
              {ru ? "История контрактов" : "Contract history"}
              <Icon name="arrow-up-right" />
            </button>
            {user.is_staff && (
              <button onClick={() => go("admin")}>
                {ru ? "Панель сотрудников" : "Staff desk"}
                <Icon name="arrow-up-right" />
              </button>
            )}
          </div>
          {onOpenGuide && (
            <div className="bureau-profile-links">
              <button
                onClick={() => {
                  setOpen(false)
                  trigger.current?.focus()
                  onOpenGuide()
                }}
              >
                {ru ? "Как работает бюро · 3 шага" : "How the bureau works · 3 steps"}
                <Icon name="info" />
              </button>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <button
            className="bureau-profile-logout"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError("")
              try {
                await request("/api/auth/logout", csrf, { method: "POST" })
                location.assign("/")
              } catch (reason) {
                setError((reason as Error).message)
                setBusy(false)
              }
            }}
          >
            {ru ? "Выйти" : "Sign out"}
          </button>
        </section>
      )}
    </div>
  )
}
