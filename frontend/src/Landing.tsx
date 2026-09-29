import Icon from "./icons/Icon"
import React, { Suspense, useState, useEffect, useRef } from "react"
import BureauHeader from "./BureauHeader"
import Leaderboard from "./community/Leaderboard"
import ContractSigning from "./ContractSigning"
import { useRipple, useTilt } from "./motion"
import logoImage from "@/imports/brand-hero.webp"
import Mascot from "./Mascot"
import { WorldGallery } from "./nightshift-layout"
import { MCGCredit, t, useLanguage } from "./i18n"
import PublicContent, { readPublicCopy } from "./PublicContent"
import { publicUrl, resolvePublicRoute, legacyPublicUrl, type PublicPage } from "./publicRoutes"

type ContractCategory = "COMFORT" | "GROWTH" | "HERO" | "VARIETY" | "EVENT"
type GameMode = "STANDARD" | "RANKED" | "STREET BRAWL"

const GuestCipher = React.lazy(() => import("./archive/GuestCipher"))

const NAV_ITEMS: Array<{
  id: Exclude<PublicPage, "home" | "try">
  label: string
}> = [
  { id: "contracts", label: "Contracts" },
  { id: "how", label: "How it works" },
  { id: "cards", label: "Cards" },
  { id: "about", label: "About" },
  { id: "campaigns", label: "Campaigns · soon" },
  { id: "leaderboards", label: "Leaderboard" },
]

interface Contract {
  id: number
  category: ContractCategory
  difficulty: string
  title: string
  condition: string
  meta: string
  xp: number
  recommendation?: string
}

const CONTRACTS: Contract[] = [
  {
    id: 1,
    category: "COMFORT",
    difficulty: "RELIABLE",
    title: "Надёжный партнёр",
    condition: "Совершите не менее 10 содействий и умрите не более 7 раз.",
    meta: "STANDARD · 1 MATCH · FINAL STATS",
    xp: 120,
    recommendation: "В последних матчах вы часто помогали команде.",
  },
  {
    id: 2,
    category: "GROWTH",
    difficulty: "FOCUSED",
    title: "Убедительные доказательства",
    condition: "Нанесите героям не менее 28 000 урона.",
    meta: "STANDARD · 1 MATCH · FINAL STATS",
    xp: 120,
    recommendation: "Сильный урон героям — понятная и проверяемая цель.",
  },
  {
    id: 3,
    category: "HERO",
    difficulty: "SKILL",
    title: "Специалист: Haze",
    condition: "Сыграйте на Haze и войдите в верхнюю половину команды по урону героям.",
    meta: "STANDARD · 1 MATCH · FINAL STATS",
    xp: 200,
    recommendation: "Вы давно не играли на Haze.",
  },
  {
    id: 4,
    category: "VARIETY",
    difficulty: "LIGHT",
    title: "Новые горизонты",
    condition: "Сыграйте на герое, которого не выбирали последние 5 матчей.",
    meta: "STANDARD · 1 MATCH · FINAL STATS",
    xp: 150,
  },
  {
    id: 5,
    category: "EVENT",
    difficulty: "TEAM",
    title: "Согласованный удар",
    condition: "В группе из 3+ игроков совместно возьмите не менее 2 объектов.",
    meta: "STANDARD · PARTY · FINAL STATS",
    xp: 280,
    recommendation: "Сезонное задание с повышенной наградой.",
  },
  {
    id: 6,
    category: "GROWTH",
    difficulty: "HARD",
    title: "Чистое досье",
    condition: "Завершите матч с соотношением убийств и смертей не ниже 2.0.",
    meta: "STANDARD · 1 MATCH · FINAL STATS",
    xp: 220,
    recommendation: "Редкие задания дают больше опыта.",
  },
]

const CATEGORY_LABEL: Record<ContractCategory, string> = {
  COMFORT: "STABILITY",
  GROWTH: "GROWTH",
  HERO: "HERO",
  VARIETY: "VARIETY",
  EVENT: "EVENT",
}

const CATEGORY_COLOR: Record<ContractCategory, string> = {
  COMFORT: "#7297A6",
  GROWTH: "#7AB384",
  HERO: "#C49A57",
  VARIETY: "#8A78AE",
  EVENT: "#B65E58",
}

// ─── Curator typer ─────────────────────────────────────────────────
function CuratorTyper() {
  const { language } = useLanguage()
  return <span style={{ color: "#94C28F" }}>{t(language, "Выберите цель до матча.")}</span>
}

// ─── Reveal wrapper ────────────────────────────────────────────────
function Reveal({
  children,
  className = "",
  delay = 0,
  stagger = false,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  stagger?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { threshold: 0.1 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`${stagger ? "stagger-children" : "reveal-section"} ${
        visible ? "visible" : ""
      } ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : {}}
    >
      {children}
    </div>
  )
}

// ─── Atoms ─────────────────────────────────────────────────────────
function SteamIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z" />
    </svg>
  )
}

function AnimatedEyeLogo() {
  return <Icon name="eye" size={22} />
}

function SteamButton({
  large = false,
  compact = false,
  secondary = false,
  onClick,
}: {
  large?: boolean
  compact?: boolean
  secondary?: boolean
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const ripple = useRipple()
  const { language } = useLanguage()
  return (
    <button
      className={`bureau-steam-button ${secondary ? "btn-ghost" : "btn-primary"} ${compact ? "is-compact" : ""} ${large ? "is-large" : ""}`}
      aria-label={language === "ru" ? "Войти через Steam" : "Sign in with Steam"}
      type="button"
      onClick={(e) => {
        ripple(e)

        if (onClick) {
          onClick(e)
          return
        }

        window.location.assign("/auth/steam")
      }}
    >
      <SteamIcon />
      {compact
        ? language === "ru"
          ? "Войти"
          : "Sign in"
        : language === "ru"
          ? "Войти через Steam"
          : "Sign in with Steam"}
    </button>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-semibold tracking-[0.28em] uppercase mb-3"
      style={{ color: "#7AB384" }}
    >
      {children}
    </p>
  )
}

function SectionHeading({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h2
      className={`font-bold leading-tight ${className}`}
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "clamp(28px, 4vw, 42px)",
        color: "#F1E4C8",
      }}
    >
      {children}
    </h2>
  )
}

// ─── App ───────────────────────────────────────────────────────────
// ─── Landing ───────────────────────────────────────────────────────
export default function Landing() {
  const { language } = useLanguage()
  const route = resolvePublicRoute(window.location.pathname) || {
    page: "home" as PublicPage,
    language,
  }
  const page = route.page
  const copy = readPublicCopy({ page, language })
  const [selected, setSelected] = useState<number[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [gameMode, setGameMode] = useState<GameMode>("STANDARD")
  const xpRef = useRef<HTMLSpanElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const [spotlight, setSpotlight] = useState({ x: 50, y: 50 })
  const ripple = useRipple()
  const cardTilt = useTilt(2)

  useEffect(() => {
    // Root hashes may belong to an authenticated dashboard. SessionApp resolves
    // those only after it knows the visitor is a guest.
    if (window.location.pathname !== "/") {
      const legacy = legacyPublicUrl(window.location.hash, language)
      if (legacy && legacy !== window.location.pathname) window.location.replace(legacy)
    }
  }, [language])

  const navigate = (next: PublicPage) => window.location.assign(publicUrl(next, language))

  const toggleContract = (id: number) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 3) return prev
      return [...prev, id]
    })
    if (xpRef.current) {
      xpRef.current.classList.remove("xp-pop")
      void xpRef.current.offsetWidth
      xpRef.current.classList.add("xp-pop")
    }
  }

  const contracts = CONTRACTS.map((contract) => ({
    ...contract,
    title: t(language, contract.title),
    condition: t(language, contract.condition),
    recommendation: contract.recommendation ? t(language, contract.recommendation) : undefined,
  }))
  const totalXP = selected.reduce(
    (sum, id) => sum + (contracts.find((contract) => contract.id === id)?.xp ?? 0),
    0,
  )

  const handleBoardMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setSpotlight({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    })
  }

  return (
    <div className="bureau-public min-h-screen">
      {previewOpen && (
        <ContractSigning
          preview
          mode={gameMode}
          operator={language === "ru" ? "Гость бюро" : "Bureau guest"}
          options={contracts
            .filter((contract) => selected.includes(contract.id))
            .map((contract) => ({
              id: String(contract.id),
              title: contract.title,
              description: contract.condition,
              reward: contract.xp,
            }))}
          changed={false}
          onClose={() => setPreviewOpen(false)}
          onSignIn={() => window.location.assign("/auth/steam")}
        />
      )}
      <BureauHeader
        active={page}
        homeHref={publicUrl("home", language)}
        items={NAV_ITEMS.map((item) => ({
          id: item.id,
          href: publicUrl(item.id, language),
          label:
            language === "ru"
              ? {
                  contracts: "Контракты",
                  how: "Как это работает",
                  cards: "Карточки",
                  about: "О проекте",
                  campaigns: "Кампании · скоро",
                  leaderboards: "Рейтинг",
                }[item.id]
              : item.label,
        }))}
        onNavigate={(id) => navigate(id as PublicPage)}
        actions={<SteamButton compact />}
      />
      {page !== "home" && page !== "try" && <PublicContent copy={copy} />}
      {page === "home" && (
        <>
          <section className="bureau-welcome" aria-labelledby="welcome-title">
            <div className="bureau-welcome-copy">
              <p className="bureau-welcome-eyebrow">
                DEADLOCK CONTRACTS · {language === "ru" ? "ОТКРЫТОЕ БЮРО" : "OPEN BUREAU"}
              </p>
              <h1 id="welcome-title">
                {copy?.heading ||
                  (language === "ru"
                    ? "Deadlock Contracts: у каждого матча своя цель"
                    : "Deadlock Contracts: give every match a goal")}
              </h1>
              <p className="bureau-welcome-lead">
                {copy?.intro ||
                  (language === "ru"
                    ? "Выбирайте контракты, собирайте карточки и найдите своё бюро. Начать можно прямо здесь — с небольшого шифра в браузере."
                    : "Choose contracts, collect cards and find your bureau. Start right here with a short cipher in your browser.")}
              </p>
              <div className="bureau-welcome-actions">
                <a className="btn-primary" href={publicUrl("try", language)}>
                  {language === "ru" ? "Попробовать без входа" : "Try without signing in"}
                  <Icon name="chevron-right" size={18} />
                </a>
                <SteamButton secondary />
              </div>
              <p className="bureau-welcome-trust">
                <Icon name="shield-check" size={18} />
                {language === "ru"
                  ? "Авторизация проходит на стороне Steam; сайт не запрашивает ваш пароль Steam."
                  : "Authorization happens on Steam; this site never asks for your Steam password."}
              </p>
            </div>
            <div className="bureau-welcome-art">
              <Mascot initialPose="idle" priority />
            </div>
            <a className="bureau-welcome-file" href={publicUrl("contracts", language)}>
              <Icon name="file-text" size={26} />
              <div>
                <small>{language === "ru" ? "БЮРО ПРИНИМАЕТ ДЕЛА" : "THE BUREAU IS OPEN"}</small>
                <b>
                  {language === "ru" ? "Следующий матч — с целью." : "Your next match. A new goal."}
                </b>
              </div>
              <Icon name="arrow-up-right" size={22} />
            </a>
          </section>
          <section
            className="bureau-paths"
            aria-label={language === "ru" ? "Чем заняться в бюро" : "Explore the bureau"}
          >
            <article>
              <Icon name="file-text" size={26} />
              <div>
                <h2>
                  {language === "ru" ? "Следующий матч — с целью" : "Give your next match a goal"}
                </h2>
                <p>
                  {language === "ru"
                    ? "Зафиксируйте до трёх контрактов до матча. Сервис проверит итоговую статистику; выполненные условия принесут XP."
                    : "Lock up to three contracts before a match. The service checks final stats; completed objectives earn XP."}
                </p>
                <a href={publicUrl("contracts", language)}>
                  {language === "ru" ? "Попробовать подписание" : "Preview a contract"}
                  <Icon name="chevron-right" size={16} />
                </a>
              </div>
            </article>
            <article>
              <Icon name="images" size={26} />
              <div>
                <h2>
                  {language === "ru" ? "Коллекция между матчами" : "A collection between matches"}
                </h2>
                <p>
                  {language === "ru"
                    ? "Решайте шифры, получайте жетоны архива и открывайте карточки. Жетоны и матчевый XP считаются отдельно. Компаньон не нужен."
                    : "Solve ciphers, earn archive tokens and open cards. Tokens are separate from match XP. No companion required."}
                </p>
                <a href={publicUrl("try", language)}>
                  {language === "ru" ? "Разгадать первый шифр" : "Try your first cipher"}
                  <Icon name="chevron-right" size={16} />
                </a>
              </div>
            </article>
          </section>
          <WorldGallery />
        </>
      )}
      {page === "contracts" && (
        <>
          {/* ── INTERACTIVE BOARD ── */}
          <section
            className="bureau-contract-preview pt-32 pb-24 px-6 lg:px-8 relative overflow-hidden"
            ref={boardRef}
            onMouseMove={handleBoardMouseMove}
          >
            {/* Mouse spotlight */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(circle 350px at ${spotlight.x}% ${spotlight.y}%, rgba(122,179,132,0.055) 0%, transparent 60%)`,
                transition: "background 0.05s",
              }}
            />
            <div
              className="absolute pointer-events-none"
              style={{
                width: "600px",
                height: "400px",
                background: "radial-gradient(ellipse, rgba(38,84,61,0.07) 0%, transparent 70%)",
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%)",
              }}
            />

            <div className="relative max-w-[1320px] mx-auto">
              <Reveal>
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-10">
                  <div>
                    <Eyebrow>
                      {language === "ru"
                        ? "ПРОБНОЕ ПОДПИСАНИЕ · НЕ СОХРАНЯЕТСЯ"
                        : "INTERACTIVE PREVIEW / NOT SAVED"}
                    </Eyebrow>
                    <SectionHeading>
                      {t(language, "Выберите цель на следующий матч")}
                    </SectionHeading>
                    <p
                      className="text-xs leading-relaxed mt-3 max-w-[620px]"
                      style={{ color: "#7F8478" }}
                    >
                      {t(
                        language,
                        "Интерактивный пример. Выбор ниже не сохраняется и не создаёт настоящий контракт. Реальные контракты доступны после входа в кабинете.",
                      )}
                    </p>
                  </div>
                  <div
                    className="flex rounded overflow-hidden shrink-0"
                    style={{
                      border: "1px solid #3B5145",
                      boxShadow: "0 0 14px rgba(59,81,69,0.2)",
                    }}
                  >
                    {(["STANDARD", "RANKED", "STREET BRAWL"] as GameMode[]).map((mode, i) => (
                      <button
                        type="button"
                        key={mode}
                        onClick={(e) => {
                          setGameMode(mode)
                          setSelected([])
                          ripple(e)
                        }}
                        className={`px-5 py-2 text-sm font-semibold transition-all duration-200 ${
                          gameMode === mode ? "mode-tab-active" : ""
                        }`}
                        aria-pressed={gameMode === mode}
                        style={{
                          backgroundColor: gameMode === mode ? "#1A2F22" : "transparent",
                          color: gameMode === mode ? "#94C28F" : "#7F8478",
                          borderRight: i < 2 ? "1px solid #3B5145" : "none",
                          fontFamily: "var(--font-body)",
                          letterSpacing: "0.06em",
                          textShadow: gameMode === mode ? "0 0 10px rgba(122,179,132,0.5)" : "none",
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              </Reveal>

              <Reveal stagger>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  {contracts.map((c) => {
                    const isSelected = selected.includes(c.id)
                    const catColor = CATEGORY_COLOR[c.category]
                    return (
                      <button
                        type="button"
                        key={c.id}
                        className={`contract-card border p-4 flex flex-col cursor-pointer select-none text-left w-full ${
                          isSelected ? "selected" : ""
                        }`}
                        style={{
                          backgroundColor: "var(--color-panel)",
                          borderColor: isSelected ? "#7AB384" : "#26352E",
                          borderRadius: "16px",
                        }}
                        onClick={() => toggleContract(c.id)}
                        aria-pressed={isSelected}
                        disabled={!isSelected && selected.length >= 3}
                        aria-label={`${c.title}: ${c.condition}`}
                        onMouseMove={cardTilt.onMouseMove}
                        onMouseLeave={cardTilt.onMouseLeave}
                      >
                        <div className="holo-overlay" />
                        {isSelected && (
                          <div
                            className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold"
                            style={{
                              backgroundColor: "#7AB384",
                              color: "#05070E",
                              boxShadow: "0 0 12px rgba(122,179,132,0.8)",
                              zIndex: 2,
                            }}
                          >
                            <Icon name="check" size={14} />
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-2 pr-6">
                          <span
                            className="text-[10px] font-bold tracking-widest"
                            style={{
                              color: catColor,
                              fontFamily: "var(--font-body)",
                              textShadow: "none",
                            }}
                          >
                            {CATEGORY_LABEL[c.category]}
                          </span>
                        </div>
                        <span
                          className="text-[10px] font-semibold tracking-wider mb-2 self-start px-1.5 py-0.5"
                          style={{
                            backgroundColor: "#151D19",
                            color: "#7F8478",
                            borderRadius: "2px",
                            border: "1px solid #1A2520",
                          }}
                        >
                          {c.difficulty}
                        </span>
                        <h3
                          className="font-bold mb-2 flex-1"
                          style={{
                            fontFamily: "var(--font-body)",
                            fontSize: "20px",
                            color: "var(--color-cream)",
                            lineHeight: 1.35,
                          }}
                        >
                          {c.title}
                        </h3>
                        <p
                          className="text-xs mb-4 flex-1 leading-relaxed"
                          style={{ color: "#B6AC94" }}
                        >
                          {c.condition}
                        </p>
                        <div className="mt-auto pt-3" style={{ borderTop: "1px solid #1A2520" }}>
                          <div className="text-[10px] mb-1.5" style={{ color: "#7F8478" }}>
                            {gameMode} · 1 MATCH · AUTO VERIFY
                          </div>
                          <div
                            className="font-bold"
                            style={{
                              color: "#7AB384",
                              fontFamily: "var(--font-body)",
                              fontSize: "16px",
                              textShadow: isSelected ? "0 0 12px rgba(122,179,132,0.7)" : "none",
                            }}
                          >
                            +{c.xp} XP
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </Reveal>

              {/* Selection tray */}
              <Reveal>
                <div
                  className="border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all duration-300"
                  style={{
                    backgroundColor: selected.length > 0 ? "#0C1510" : "#080C0B",
                    borderColor: selected.length > 0 ? "#3B5145" : "#1A2520",
                    borderRadius: "16px",
                    boxShadow: selected.length > 0 ? "0 0 24px rgba(69,127,91,0.14)" : "none",
                  }}
                >
                  <div className="min-w-0">
                    <div
                      className="font-bold mb-1.5"
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "18px",
                        color: "#F1E4C8",
                      }}
                    >
                      {selected.length} / 3 SELECTED
                    </div>
                    {selected.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selected.map((id) => {
                          const c = contracts.find((x) => x.id === id)!
                          return (
                            <span
                              key={id}
                              className="text-xs px-2.5 py-1"
                              style={{
                                backgroundColor: "#151D19",
                                color: "#B6AC94",
                                borderRadius: "3px",
                                border: "1px solid #26352E",
                              }}
                            >
                              {c.title}{" "}
                              <span
                                style={{
                                  color: "#7AB384",
                                  textShadow: "0 0 6px rgba(122,179,132,0.4)",
                                }}
                              >
                                +{c.xp} XP
                              </span>
                            </span>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: "#7F8478" }}>
                        {language === "ru"
                          ? "Выберите до 3 из 6 предложений. В реальном кабинете пул меняется по режиму."
                          : "Choose up to 3 of 6 offers. In the live dashboard, the pool changes by mode."}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {selected.length > 0 && (
                      <>
                        <span
                          ref={xpRef}
                          className="xp-pop font-bold"
                          style={{
                            fontFamily: "var(--font-body)",
                            fontSize: "22px",
                            color: "#7AB384",
                            textShadow:
                              "0 0 16px rgba(122,179,132,0.8), 0 0 35px rgba(122,179,132,0.4)",
                          }}
                        >
                          +{totalXP} XP
                        </span>
                        <button
                          onClick={(e) => {
                            setSelected([])
                            ripple(e)
                          }}
                          className="text-xs px-3 py-2"
                          style={{
                            color: "#7F8478",
                            border: "1px solid #26352E",
                            borderRadius: "4px",
                            transition: "color 0.2s, border-color 0.2s",
                            position: "relative",
                            overflow: "hidden",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "#B6AC94"
                            e.currentTarget.style.borderColor = "#3B5145"
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "#7F8478"
                            e.currentTarget.style.borderColor = "#26352E"
                          }}
                        >
                          {t(language, "Сбросить")}
                        </button>
                      </>
                    )}
                    <button
                      className="btn-primary text-sm font-bold px-5 py-2.5"
                      style={{
                        backgroundColor: selected.length > 0 ? "#457F5B" : "#151D19",
                        color: selected.length > 0 ? "#F1E4C8" : "#7F8478",
                        border: `1px solid ${selected.length > 0 ? "#7AB384" : "#26352E"}`,
                        borderRadius: "4px",
                        fontFamily: "var(--font-body)",
                        letterSpacing: "0.05em",
                        boxShadow: selected.length > 0 ? "0 0 14px rgba(122,179,132,0.3)" : "none",
                      }}
                      disabled={selected.length === 0}
                      onClick={() => setPreviewOpen(true)}
                    >
                      {t(language, "ПРЕДПРОСМОТР · НЕ СОХРАНЯЕТСЯ")}
                    </button>
                  </div>
                </div>
              </Reveal>
            </div>
          </section>

          <div className="flame-divider" />
        </>
      )}
      {page === "try" && (
        <Suspense
          fallback={
            <main className="guest-cipher" role="status">
              {language === "ru" ? "Открываем учебный шифр…" : "Opening the teaching cipher…"}
            </main>
          }
        >
          <GuestCipher onHome={() => navigate("home")} />
        </Suspense>
      )}
      {page === "leaderboards" && (
        <div className="public-leaderboard">
          <Leaderboard />
        </div>
      )}
      {page === "home" && <PublicContent copy={copy} heading={false} />}
      {/* ── FOOTER ── */}
      <footer
        className="px-6 lg:px-8 py-12 relative"
        style={{
          borderTop: "1px solid #26352E",
          backgroundColor: "#05070E",
          boxShadow: "inset 0 1px 0 rgba(122,179,132,0.04)",
        }}
      >
        <div className="max-w-[1320px] mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          <div className="sm:col-span-2 lg:col-span-2">
            <img
              src={logoImage}
              alt="Deadlock Contracts"
              className="logo-container"
              style={{ height: "38px", width: "auto", marginBottom: "14px" }}
            />
            <p className="text-xs leading-relaxed mb-5 max-w-[260px]" style={{ color: "#7F8478" }}>
              {t(
                language,
                "Неофициальный проект для игроков Deadlock. Не связан с Valve Corporation.",
              )}
            </p>
            <div className="flex flex-wrap gap-5">
              {[
                {
                  label: language === "ru" ? "Поддержка" : "Support",
                  href: `/${language}/support`,
                },
                {
                  label: language === "ru" ? "Статус" : "Status",
                  href: `/${language}/status`,
                },
                {
                  label: language === "ru" ? "Изменения" : "Changelog",
                  href: `/${language}/changelog`,
                },
                {
                  label: language === "ru" ? "Источники данных" : "Data sources",
                  href: `/${language}/data-sources`,
                },
              ].map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="text-xs nav-link transition-colors hover:text-[#7AB384]"
                  style={{ color: "#7F8478" }}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
          <div>
            <div
              className="text-[10px] font-bold tracking-widest uppercase mb-4"
              style={{
                color: "#7F8478",
                fontFamily: "var(--font-body)",
              }}
            >
              PLATFORM
            </div>
            {[
              {
                label: "CONTRACTS",
                href: publicUrl("contracts", language),
              },
              {
                label: language === "ru" ? "Карточки" : "Cards",
                href: publicUrl("cards", language),
              },
              {
                label: language === "ru" ? "О проекте" : "About",
                href: publicUrl("about", language),
              },
              {
                label: "HOW IT WORKS",
                href: publicUrl("how", language),
              },
              {
                label: "CAMPAIGNS · SOON",
                href: publicUrl("campaigns", language),
              },
              {
                label: "LEADERBOARD",
                href: publicUrl("leaderboards", language),
              },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="nav-link block text-xs mb-3 transition-colors hover:text-[#7AB384]"
                style={{ color: "#B6AC94" }}
              >
                {t(language, item.label)}
              </a>
            ))}
          </div>
          <div>
            <div
              className="text-[10px] font-bold tracking-widest uppercase mb-4"
              style={{
                color: "#7F8478",
                fontFamily: "var(--font-body)",
              }}
            >
              DOCUMENTS
            </div>
            {[
              {
                label: language === "ru" ? "Данные" : "Privacy",
                href: `/${language}/privacy`,
              },
              {
                label: language === "ru" ? "Условия" : "Terms",
                href: `/${language}/terms`,
              },
              {
                label: language === "ru" ? "Источники данных" : "Data sources",
                href: `/${language}/data-sources`,
              },
              {
                label: language === "ru" ? "Контакт" : "Contact",
                href: `/${language}/support`,
              },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="nav-link block text-xs mb-3 transition-colors hover:text-[#7AB384]"
                style={{ color: "#B6AC94" }}
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
        <div
          className="max-w-[1320px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-6"
          style={{ borderTop: "1px solid #1A2520" }}
        >
          <p className="text-[10px]" style={{ color: "#7F8478" }}>
            © 2026 Deadlock Contracts · Community Project
          </p>
          <MCGCredit language={language} compact />
          <div className="flex items-center gap-2">
            <AnimatedEyeLogo />
            <p className="text-[10px]" style={{ color: "#7F8478" }}>
              {t(language, "Данные матчей предоставляют сторонние источники")}
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
