import React, { useState, useEffect, useRef, useCallback } from "react"
import logoImage from "@/imports/ChatGPT_Image_2____._2026__.__01_38_03_1_.png"
import { LanguageSwitch, MCGCredit, t, useLanguage } from "./i18n"

type ContractCategory = "COMFORT" | "GROWTH" | "HERO" | "VARIETY" | "EVENT"
type GameMode = "STANDARD" | "RANKED" | "STREET BRAWL"
type LeaderScope = "all_time" | "today" | "rare" | "mastery"
type PublicPage = "home" | "contracts" | "how" | "campaigns" | "leaderboards"

const NAV_ITEMS: Array<{
  id: Exclude<PublicPage, "home">
  label: string
}> = [
  { id: "contracts", label: "CONTRACTS" },
  { id: "how", label: "HOW IT WORKS" },
  { id: "campaigns", label: "CAMPAIGNS · SOON" },
  { id: "leaderboards", label: "LEADERBOARD" },
]

interface LeaderboardRow {
  rank: number
  slug: string
  display_name: string
  avatar_url: string | null
  level: number
  score: number
  verified_xp: number
  contracts_completed: number
}

interface LeaderboardPayload {
  scope: LeaderScope
  generated_at: string
  reset_at: string | null
  scoring: {
    label: string
    description: string
  }
  eligibility: string
  rows: LeaderboardRow[]
}

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

const FAQ_ITEMS = [
  {
    q: "Когда фиксируется контракт?",
    a: "До начала матча. После фиксации условия нельзя изменить; сервис ждёт следующий подходящий матч.",
  },
  {
    q: "Как проверяется результат?",
    a: "После матча сервис получает итоговую статистику и отдельно проверяет каждое условие.",
  },
  {
    q: "Что будет, если данных не хватает?",
    a: "Сервис не засчитывает это как поражение. Он автоматически создаёт внутренний запрос на разбор; игроку не нужно загружать скриншоты или доказательства.",
  },
  {
    q: "Какие режимы поддерживаются?",
    a: "Доступны Standard, Ranked и Street Brawl. Для каждого режима — свой набор и отдельное дело до трёх контрактов.",
  },
  {
    q: "Нужно ли что-то устанавливать?",
    a: "Ничего обязательного устанавливать не нужно. Компаньон через GEP ускоряет обнаружение матча и позже позволит показывать прогресс во время игры.",
  },
]

const TIMELINE_STEPS = [
  {
    time: "18:42:08",
    label: "Контракты зафиксированы",
    detail: "Надёжный партнёр · 10 содействий, ≤7 смертей",
    success: false,
  },
  {
    time: "19:17:41",
    label: "Матч найден",
    detail: "Mode confirmed · STANDARD ✓",
    success: false,
  },
  {
    time: "19:48:16",
    label: "Статистика получена",
    detail: "От поставщика статистики",
    success: false,
  },
  {
    time: "19:48:17",
    label: "Условия проверены",
    detail: "Содействия: 13 ≥ 10 ✓   Смерти: 5 ≤ 7 ✓",
    success: false,
  },
  {
    time: "19:48:17",
    label: "Контракт выполнен",
    detail: "+120 XP credited",
    success: true,
  },
]

const CURATOR_MESSAGES = [
  "Контракт ещё не зафиксирован.",
  "Жду ваш выбор.",
  "Выберите цель до матча.",
  "Статистика не лжёт.",
  "Куратор наблюдает.",
  "Условия зафиксированы. Ждём матч.",
]

const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  id: i,
  left: `${4 + ((i * 4.3) % 92)}%`,
  bottom: `${(i * 6) % 38}%`,
  delay: `${(i * 0.37) % 6}s`,
  dur: `${3.2 + ((i * 0.28) % 3.5)}s`,
  drift: `${-18 + (i % 7) * 7}px`,
  opacity: 0.25 + (i % 5) * 0.14,
  size: 2 + (i % 3),
  type: i % 5 === 0 ? "ember" : i % 7 === 0 ? "spark" : "",
}))

// ─── Custom cursor ─────────────────────────────────────────────────
function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const active = useRef(false)

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return
    active.current = true
    document.body.classList.add("custom-cursor")

    let mx = -200,
      my = -200,
      rx = -200,
      ry = -200
    let rafId: number
    let isDown = false
    let isHover = false

    const setDot = () => {
      if (!dotRef.current) return
      dotRef.current.style.left = `${mx}px`
      dotRef.current.style.top = `${my}px`
      dotRef.current.style.transform = `translate(-50%,-50%) scale(${
        isDown ? 0.5 : isHover ? 1.8 : 1
      })`
      dotRef.current.style.boxShadow = isHover
        ? "0 0 16px #7AB384, 0 0 32px rgba(122,179,132,0.7)"
        : "0 0 8px #7AB384, 0 0 16px rgba(122,179,132,0.4)"
    }

    const move = (e: MouseEvent) => {
      mx = e.clientX
      my = e.clientY
      setDot()
      const el = e.target as HTMLElement
      isHover = !!(
        el.closest("button") ||
        el.closest("a") ||
        el.closest(".contract-card") ||
        el.closest(".result-card")
      )
      if (ringRef.current) {
        ringRef.current.style.width = isHover ? "44px" : "28px"
        ringRef.current.style.height = isHover ? "44px" : "28px"
        ringRef.current.style.borderColor = isHover
          ? "rgba(122,179,132,0.8)"
          : "rgba(122,179,132,0.45)"
        ringRef.current.style.boxShadow = isHover
          ? "0 0 12px rgba(122,179,132,0.3)"
          : "0 0 6px rgba(122,179,132,0.12)"
      }
    }
    const down = () => {
      isDown = true
      setDot()
    }
    const up = () => {
      isDown = false
      setDot()
    }

    const animate = () => {
      const speed = isHover ? 0.14 : 0.1
      rx += (mx - rx) * speed
      ry += (my - ry) * speed
      if (ringRef.current) {
        ringRef.current.style.left = `${rx}px`
        ringRef.current.style.top = `${ry}px`
      }
      rafId = requestAnimationFrame(animate)
    }

    document.addEventListener("mousemove", move, { passive: true })
    document.addEventListener("mousedown", down)
    document.addEventListener("mouseup", up)
    rafId = requestAnimationFrame(animate)

    return () => {
      document.body.classList.remove("custom-cursor")
      document.removeEventListener("mousemove", move)
      document.removeEventListener("mousedown", down)
      document.removeEventListener("mouseup", up)
      cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <>
      <div
        ref={dotRef}
        style={{
          position: "fixed",
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: "#7AB384",
          pointerEvents: "none",
          zIndex: 99999,
          boxShadow: "0 0 8px #7AB384, 0 0 16px rgba(122,179,132,0.4)",
          transition: "transform 0.12s ease, box-shadow 0.2s ease",
        }}
      />
      <div
        ref={ringRef}
        style={{
          position: "fixed",
          width: "28px",
          height: "28px",
          border: "1px solid rgba(122,179,132,0.45)",
          borderRadius: "50%",
          pointerEvents: "none",
          zIndex: 99998,
          transform: "translate(-50%,-50%)",
          boxShadow: "0 0 6px rgba(122,179,132,0.12)",
          transition: "width 0.2s ease, height 0.2s ease, border-color 0.2s, box-shadow 0.2s",
        }}
      />
    </>
  )
}

// ─── Scramble text ─────────────────────────────────────────────────
const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^"

function ScrambleText({
  lines,
  className = "",
  style = {},
}: {
  lines: Array<{
    text: string
    accent?: boolean
  }>
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!ref.current || started.current) return
    started.current = true
    const el = ref.current
    const fullText = lines.map((l) => l.text).join("\n")
    let frame = 0
    const FRAMES = 55

    const interval = setInterval(() => {
      frame++
      const progress = frame / FRAMES
      let charIdx = 0
      const html = lines
        .map((line, li) => {
          const chars = line.text
            .split("")
            .map((ch) => {
              charIdx++
              const reveal = charIdx / fullText.length
              if (ch === " ") return " "
              if (reveal < progress) return ch
              return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
            })
            .join("")
          const color = line.accent ? "#7AB384" : "#F1E4C8"
          const shadow = line.accent
            ? "0 0 16px rgba(122,179,132,1), 0 0 40px rgba(122,179,132,0.6)"
            : "none"
          return `<span style="color:${color};text-shadow:${shadow}">${chars}</span>${
            li < lines.length - 1 ? "<br/>" : ""
          }`
        })
        .join("")
      el.innerHTML = html
      if (frame >= FRAMES) {
        clearInterval(interval)
        el.innerHTML = lines
          .map((line, li) => {
            const color = line.accent ? "#7AB384" : "#F1E4C8"
            const shadow = line.accent
              ? "0 0 16px rgba(122,179,132,1), 0 0 40px rgba(122,179,132,0.6)"
              : "none"
            return `<span class="${
              line.accent ? "neon-text" : ""
            }" style="color:${color};text-shadow:${shadow}">${line.text}</span>${
              li < lines.length - 1 ? "<br/>" : ""
            }`
          })
          .join("")
      }
    }, 28)

    return () => clearInterval(interval)
  }, [])

  return (
    <h1 ref={ref} className={className} style={style}>
      {lines.map((line, i) => (
        <span key={i} style={{ color: line.accent ? "#7AB384" : "#F1E4C8" }}>
          {line.text}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </h1>
  )
}

// ─── Animated counter ──────────────────────────────────────────────
function AnimatedCounter({
  target,
  prefix = "",
  suffix = "",
  duration = 2200,
}: {
  target: number
  prefix?: string
  suffix?: string
  duration?: number
}) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const started = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true
          el.classList.add("counted")
          let startTime = 0
          const animate = (ts: number) => {
            if (!startTime) startTime = ts
            const p = Math.min((ts - startTime) / duration, 1)
            const ease = 1 - Math.pow(1 - p, 3)
            setCount(Math.floor(ease * target))
            if (p < 1) requestAnimationFrame(animate)
            else setCount(target)
          }
          requestAnimationFrame(animate)
        }
      },
      { threshold: 0.5 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [target, duration])

  return (
    <span ref={ref} className="stat-counter">
      {prefix}
      {count.toLocaleString()}
      {suffix}
    </span>
  )
}

// ─── Curator typer ─────────────────────────────────────────────────
function CuratorTyper() {
  const { language } = useLanguage()
  const messages = CURATOR_MESSAGES.map((message) => t(language, message))
  const [text, setText] = useState("")
  const [msgIdx, setMsgIdx] = useState(0)
  const [phase, setPhase] = useState<"typing" | "waiting" | "erasing">("typing")
  const visible = useReveal()

  useEffect(() => {
    if (!visible) return
    const msg = messages[msgIdx]

    if (phase === "typing") {
      let i = 0
      const t = setInterval(() => {
        i++
        setText(msg.slice(0, i))
        if (i >= msg.length) {
          clearInterval(t)
          setTimeout(() => setPhase("waiting"), 2200)
        }
      }, 45)
      return () => clearInterval(t)
    }
    if (phase === "waiting") {
      const t = setTimeout(() => setPhase("erasing"), 100)
      return () => clearTimeout(t)
    }
    if (phase === "erasing") {
      const msg2 = messages[msgIdx]
      let len = msg2.length
      const t = setInterval(() => {
        len--
        setText(msg2.slice(0, len))
        if (len <= 0) {
          clearInterval(t)
          setMsgIdx((p) => (p + 1) % messages.length)
          setPhase("typing")
        }
      }, 28)
      return () => clearInterval(t)
    }
  }, [phase, msgIdx, visible, language])

  return (
    <span style={{ color: "#7AB384", textShadow: "0 0 10px rgba(122,179,132,0.5)" }}>
      {text}
      <span className="typer-cursor" />
    </span>
  )
}

// ─── Section reveal hook ───────────────────────────────────────────
function useReveal(threshold = 0.12): boolean {
  const [visible, setVisible] = useState(false)
  const ref = useRef<Element | null>(null)

  const setRef = useCallback(
    (el: Element | null) => {
      ref.current = el
      if (!el) return
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setVisible(true)
            obs.disconnect()
          }
        },
        { threshold },
      )
      obs.observe(el)
    },
    [threshold],
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return visible as any
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

// ─── Ripple button handler ─────────────────────────────────────────
function useRipple() {
  return useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget
    const rect = btn.getBoundingClientRect()
    const span = document.createElement("span")
    span.className = "ripple-span"
    span.style.left = `${e.clientX - rect.left}px`
    span.style.top = `${e.clientY - rect.top}px`
    btn.appendChild(span)
    setTimeout(() => span.remove(), 700)
  }, [])
}

// ─── 3D tilt ───────────────────────────────────────────────────────
function useTilt(intensity = 10) {
  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const el = e.currentTarget
      const rect = el.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2
      el.style.transform = `perspective(700px) rotateY(${x * intensity}deg) rotateX(${-y * intensity}deg) translateZ(8px) scale(1.02)`
      el.style.transition = "transform 0.1s ease"
    },
    [intensity],
  )

  const onMouseLeave = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.transform = ""
    e.currentTarget.style.transition = "transform 0.45s cubic-bezier(0.34,1.2,0.64,1)"
  }, [])

  return { onMouseMove, onMouseLeave }
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
  return (
    <div className="eye-glow" style={{ display: "inline-flex" }}>
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <g className="eye-spin" style={{ transformOrigin: "11px 11px" }}>
          <path
            d="M11 1 L21 11 L11 21 L1 11 Z"
            stroke="#7AB384"
            strokeWidth="1.2"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M11 4 L18 11 L11 18 L4 11 Z"
            stroke="rgba(122,179,132,0.3)"
            strokeWidth="0.8"
            fill="none"
          />
        </g>
        <circle cx="11" cy="11" r="3.5" fill="#7AB384" />
        <circle cx="11" cy="11" r="1.5" fill="#05070E" />
        <circle cx="11" cy="11" r="0.6" fill="#94C28F" />
      </svg>
    </div>
  )
}

function SteamButton({
  large = false,
  onClick,
}: {
  large?: boolean
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const ripple = useRipple()
  const { language } = useLanguage()
  return (
    <button
      className="btn-primary inline-flex items-center gap-2.5 font-bold"
      style={{
        padding: large ? "14px 32px" : "10px 20px",
        fontSize: large ? "16px" : "14px",
        backgroundColor: "#457F5B",
        color: "#F1E4C8",
        border: "1px solid #7AB384",
        borderRadius: "5px",
        fontFamily: large ? "Roboto Condensed, Barlow Condensed, sans-serif" : "Inter, sans-serif",
        letterSpacing: large ? "0.07em" : "0",
        boxShadow: "0 0 14px rgba(122,179,132,0.3)",
      }}
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
      {language === "ru" ? "ВОЙТИ ЧЕРЕЗ STEAM" : "SIGN IN WITH STEAM"}
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
      className={`glitch-hover font-bold leading-tight ${className}`}
      style={{
        fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
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
  const pageFromHash = (): PublicPage => {
    const value = window.location.hash.replace("#", "") as PublicPage
    return ["home", "contracts", "how", "campaigns", "leaderboards"].includes(value)
      ? value
      : "home"
  }

  const [page, setPage] = useState<PublicPage>(pageFromHash)
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [gameMode, setGameMode] = useState<GameMode>("STANDARD")
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [leaderScope, setLeaderScope] = useState<LeaderScope>("all_time")
  const [leaderboard, setLeaderboard] = useState<LeaderboardPayload | null>(null)
  const [leaderLoading, setLeaderLoading] = useState(false)
  const [leaderError, setLeaderError] = useState<string | null>(null)
  const xpRef = useRef<HTMLSpanElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const [spotlight, setSpotlight] = useState({ x: 50, y: 50 })
  const ripple = useRipple()
  const tilt = useTilt(8)
  const cardTilt = useTilt(10)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 32)
    window.addEventListener("scroll", handler, { passive: true })
    return () => window.removeEventListener("scroll", handler)
  }, [])

  useEffect(() => {
    const handler = () => {
      setPage(pageFromHash())
      setMobileOpen(false)
      window.scrollTo({ top: 0 })
    }
    window.addEventListener("hashchange", handler)
    return () => window.removeEventListener("hashchange", handler)
  }, [])

  useEffect(() => {
    if (page !== "leaderboards") return
    const controller = new AbortController()
    setLeaderLoading(true)
    setLeaderError(null)
    fetch(`/api/public/leaderboard?scope=${leaderScope}&limit=50`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<LeaderboardPayload>
      })
      .then((payload) => setLeaderboard(payload))
      .catch((error) => {
        if (error?.name !== "AbortError")
          setLeaderError(t(language, "Не удалось загрузить таблицу лидеров."))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLeaderLoading(false)
      })
    return () => controller.abort()
  }, [page, leaderScope, language])

  const navigate = (next: PublicPage) => {
    if (window.location.hash !== `#${next}`) window.location.hash = next
    else {
      setPage(next)
      setMobileOpen(false)
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

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
  const timelineSteps = TIMELINE_STEPS.map((step) => ({
    ...step,
    label: t(language, step.label),
    detail: t(language, step.detail),
  }))
  const faqItems = FAQ_ITEMS.map((item) => ({
    q: t(language, item.q),
    a: t(language, item.a),
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
    <div className="min-h-screen" style={{ backgroundColor: "#080C0B", color: "#F1E4C8" }}>
      <CustomCursor />

      {/* ── HEADER ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          height: "72px",
          backgroundColor: scrolled ? "rgba(8,12,11,0.92)" : "transparent",
          borderBottom: scrolled ? "1px solid #26352E" : "1px solid transparent",
          backdropFilter: scrolled ? "blur(18px)" : "none",
          boxShadow: scrolled
            ? "0 4px 40px rgba(0,0,0,0.6), 0 0 40px rgba(122,179,132,0.04)"
            : "none",
        }}
      >
        <div className="max-w-[1320px] mx-auto px-6 lg:px-8 h-full flex items-center justify-between gap-6">
          <a
            href="#home"
            onClick={(event) => {
              event.preventDefault()
              navigate("home")
            }}
            className="flex items-center gap-3 shrink-0"
          >
            <img
              src={logoImage}
              alt="Deadlock Contracts"
              className="header-logo"
              style={{ height: "42px", width: "auto" }}
            />
            <span
              className="hidden sm:block text-[10px] font-semibold tracking-[0.22em] uppercase"
              style={{ color: "#7F8478" }}
            >
              COMMUNITY PROJECT
            </span>
          </a>

          <nav className="hidden lg:flex items-center gap-7">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(event) => {
                  event.preventDefault()
                  navigate(item.id)
                }}
                aria-current={page === item.id ? "page" : undefined}
                className={`nav-link text-sm font-medium transition-colors hover:text-[#7AB384] ${
                  page === item.id ? "is-active" : ""
                }`}
                style={{ color: page === item.id ? "#7AB384" : "#B6AC94" }}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <LanguageSwitch compact />
            <div className="hidden sm:block">
              <SteamButton />
            </div>
            <button
              className="lg:hidden p-2"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={t(language, "Открыть меню")}
              style={{ color: "#B6AC94", transition: "color 0.2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#7AB384")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#B6AC94")}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                {mobileOpen ? (
                  <>
                    <line x1="4" y1="4" x2="16" y2="16" />
                    <line x1="16" y1="4" x2="4" y2="16" />
                  </>
                ) : (
                  <>
                    <line x1="3" y1="6" x2="17" y2="6" />
                    <line x1="3" y1="10" x2="17" y2="10" />
                    <line x1="3" y1="14" x2="17" y2="14" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div
            className="lg:hidden px-6 py-4 flex flex-col gap-2"
            style={{
              backgroundColor: "rgba(8,12,11,0.98)",
              borderBottom: "1px solid #26352E",
            }}
          >
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(event) => {
                  event.preventDefault()
                  navigate(item.id)
                }}
                aria-current={page === item.id ? "page" : undefined}
                className="py-2.5 text-sm border-b"
                style={{
                  color: page === item.id ? "#7AB384" : "#B6AC94",
                  borderColor: "#1A2520",
                }}
              >
                {item.label}
              </a>
            ))}
            <div className="pt-3 flex items-center gap-3">
              <LanguageSwitch />
              <SteamButton />
            </div>
          </div>
        )}
      </header>
      {page === "home" && (
        <>
          {/* ── HERO ── */}
          <section
            className="relative pt-[72px] overflow-hidden"
            style={{ minHeight: "800px", backgroundColor: "#05070E" }}
          >
            <div
              className="hero-grid absolute inset-0 pointer-events-none opacity-[0.038]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(122,179,132,1) 1px, transparent 1px), linear-gradient(90deg, rgba(122,179,132,1) 1px, transparent 1px)",
                backgroundSize: "52px 52px",
              }}
            />

            {/* Radar pings */}
            {[0, 1.5, 3].map((delay, i) => (
              <div
                key={i}
                className="radar-ring"
                style={{
                  width: "400px",
                  height: "400px",
                  top: "50%",
                  left: "68%",
                  transform: "translate(-50%,-50%)",
                  animationDelay: `${delay}s`,
                }}
              />
            ))}

            {/* Atmosphere */}
            <div
              className="orb orb-1"
              style={{
                width: "500px",
                height: "500px",
                background: "radial-gradient(circle, rgba(69,127,91,0.22) 0%, transparent 70%)",
                top: "5%",
                left: "44%",
              }}
            />
            <div
              className="orb orb-2"
              style={{
                width: "320px",
                height: "320px",
                background: "radial-gradient(circle, rgba(38,84,61,0.28) 0%, transparent 70%)",
                bottom: "8%",
                left: "6%",
              }}
            />
            <div
              className="orb orb-3"
              style={{
                width: "220px",
                height: "220px",
                background: "radial-gradient(circle, rgba(148,194,143,0.1) 0%, transparent 70%)",
                top: "18%",
                right: "4%",
              }}
            />

            {/* Particles */}
            {PARTICLES.map((p) => (
              <div
                key={p.id}
                className={`particle ${p.type}`}
                style={
                  {
                    left: p.left,
                    bottom: p.bottom,
                    opacity: p.opacity,
                    width: `${p.size}px`,
                    height: `${p.size}px`,
                    animationDelay: p.delay,
                    animationDuration: p.dur,
                    "--drift": p.drift,
                  } as React.CSSProperties
                }
              />
            ))}
            <div className="scanline-overlay" />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse 100% 100% at 50% 0%, transparent 55%, rgba(5,7,14,0.75) 100%)",
              }}
            />

            <div
              className="relative max-w-[1320px] mx-auto px-6 lg:px-8 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center"
              style={{ minHeight: "calc(800px - 72px)" }}
            >
              <div>
                <div
                  className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 border"
                  style={{
                    borderColor: "#26543D",
                    backgroundColor: "rgba(38,84,61,0.22)",
                    backdropFilter: "blur(8px)",
                    borderRadius: "4px",
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      backgroundColor: "#7AB384",
                      boxShadow: "0 0 6px #7AB384",
                      animation: "dot-ping 2s ease infinite",
                    }}
                  />
                  <span
                    className="text-[11px] font-semibold tracking-[0.28em] uppercase"
                    style={{ color: "#7AB384" }}
                  >
                    VERIFIABLE CONTRACTS FOR DEADLOCK
                  </span>
                </div>

                <ScrambleText
                  lines={[
                    { text: "CHOOSE A CONTRACT" },
                    { text: "PLAY THE MATCH" },
                    { text: "CLOSE THE CASE", accent: true },
                  ]}
                  className="font-extrabold leading-none mb-6"
                  style={{
                    fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                    fontSize: "clamp(52px, 6.5vw, 76px)",
                    letterSpacing: "-0.01em",
                    display: "block",
                  }}
                />

                <p
                  className="text-base leading-relaxed mb-8 max-w-[420px]"
                  style={{ color: "#B6AC94" }}
                >
                  {t(
                    language,
                    "Зафиксируйте 1–3 задания до матча. После игры сервис найдёт нужный матч, проверит статистику и сохранит результат.",
                  )}
                </p>
                <div className="flex flex-wrap gap-3 mb-5">
                  <SteamButton large />
                  <button
                    className="btn-ghost px-6 py-3.5 text-sm font-medium inline-flex items-center gap-2"
                    style={{
                      backgroundColor: "transparent",
                      color: "#B6AC94",
                      border: "1px solid #3B5145",
                      borderRadius: "5px",
                    }}
                    onClick={(event) => {
                      ripple(event)
                      navigate("contracts")
                    }}
                  >
                    CONTRACT PREVIEW <span className="arrow-bounce">↓</span>
                  </button>
                </div>
                <p className="text-xs" style={{ color: "#7F8478" }}>
                  STANDARD · RANKED · STREET BRAWL · AUTO VERIFY
                </p>
              </div>

              {/* Right */}
              <div className="flex flex-col items-center lg:items-end gap-6">
                <img
                  src={logoImage}
                  alt="Deadlock Contracts"
                  className="logo-glow drop-shadow-2xl"
                  style={{
                    maxHeight: "300px",
                    width: "auto",
                    maxWidth: "100%",
                    objectFit: "contain",
                  }}
                />

                {/* Example card with 3D tilt + neon border trace */}
                <div
                  className="neon-border-card w-full max-w-[360px]"
                  style={{ borderRadius: "6px" }}
                >
                  <div
                    className="border p-5 relative overflow-hidden"
                    style={{
                      backgroundColor: "#0E1512",
                      borderColor: "#3B5145",
                      borderRadius: "6px",
                      boxShadow: "0 0 30px rgba(69,127,91,0.12)",
                      willChange: "transform",
                    }}
                    onMouseMove={tilt.onMouseMove}
                    onMouseLeave={tilt.onMouseLeave}
                  >
                    <div className="holo-overlay" style={{ opacity: 0.5 }} />
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(122,179,132,0.04) 0%, transparent 50%)",
                      }}
                    />
                    <div className="flex justify-between items-start mb-3 relative">
                      <span
                        className="text-[10px] font-bold tracking-widest"
                        style={{
                          color: "#7AB384",
                          fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                          textShadow: "0 0 8px rgba(122,179,132,0.5)",
                        }}
                      >
                        STABILITY
                      </span>
                      <span
                        className="text-[10px] px-2 py-0.5 font-semibold tracking-wider"
                        style={{
                          backgroundColor: "#151D19",
                          color: "#7F8478",
                          borderRadius: "3px",
                          border: "1px solid #26352E",
                        }}
                      >
                        RELIABLE
                      </span>
                    </div>
                    <h3
                      className="font-bold mb-2 relative"
                      style={{
                        fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                        fontSize: "20px",
                        color: "#F1E4C8",
                      }}
                    >
                      {t(language, "Надёжный партнёр")}
                    </h3>
                    <p
                      className="text-sm mb-4 leading-relaxed relative"
                      style={{ color: "#B6AC94" }}
                    >
                      {t(language, "Совершите не менее 10 содействий и умрите не более 7 раз.")}
                    </p>
                    <div
                      className="flex justify-between items-center pt-3 relative"
                      style={{ borderTop: "1px solid #26352E" }}
                    >
                      <span className="text-[11px]" style={{ color: "#7F8478" }}>
                        STANDARD · 1 MATCH · AUTO VERIFY
                      </span>
                      <span
                        className="font-bold text-sm"
                        style={{
                          color: "#7AB384",
                          fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                          textShadow: "0 0 8px rgba(122,179,132,0.4)",
                        }}
                      >
                        +120 XP
                      </span>
                    </div>
                    <div className="mt-3 pt-3 relative" style={{ borderTop: "1px solid #1A2520" }}>
                      <p
                        className="italic"
                        style={{
                          color: "#7F8478",
                          fontFamily: "Cormorant Garamond, serif",
                          fontSize: "14px",
                          lineHeight: 1.5,
                        }}
                      >
                        “{t(language, "В последних матчах вы часто помогали команде.")}”
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── FLAME DIVIDER ── */}
          <div className="flame-divider" />

          {/* ── TRUST STRIP ── */}
          <Reveal>
            <div
              style={{
                borderBottom: "1px solid #26352E",
                backgroundColor: "#0C1410",
              }}
            >
              <div className="max-w-[1320px] mx-auto px-6 lg:px-8 py-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { icon: "✓", text: "LOCKED BEFORE MATCH" },
                  { icon: "◎", text: "FINAL STATS VERIFIED" },
                  { icon: "◇", text: "MISSING DATA ≠ FAILURE" },
                  { icon: "↻", text: "IDEMPOTENT XP REWARD" },
                ].map(({ icon, text }) => (
                  <div key={text} className="flex items-center gap-3">
                    <span
                      className="trust-icon text-base shrink-0 font-bold cursor-default"
                      style={{ color: "#7AB384" }}
                    >
                      {icon}
                    </span>
                    <span className="text-xs font-medium" style={{ color: "#B6AC94" }}>
                      {text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* ── STATS ROW ── */}
          <Reveal>
            <div
              style={{
                borderBottom: "1px solid #1A2520",
                backgroundColor: "#08100D",
              }}
            >
              <div className="max-w-[1320px] mx-auto px-6 lg:px-8 py-10 grid grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { target: 3, suffix: "", label: "SUPPORTED MODES" },
                  { target: 6, suffix: "", label: "OFFERS / MODE" },
                  { target: 3, suffix: "", label: "SELECT / MODE" },
                  { target: 1, suffix: "", label: "FREE REROLL / DAY" },
                ].map(({ target, suffix, label }) => (
                  <div key={label} className="text-center">
                    <div
                      className="font-extrabold mb-1"
                      style={{
                        fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                        fontSize: "clamp(28px,3.5vw,42px)",
                        color: "#7AB384",
                        textShadow: "0 0 16px rgba(122,179,132,0.4)",
                      }}
                    >
                      <AnimatedCounter target={target} suffix={suffix} />
                    </div>
                    <div className="text-xs font-medium" style={{ color: "#7F8478" }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </>
      )}
      {page === "contracts" && (
        <>
          {/* ── INTERACTIVE BOARD ── */}
          <section
            className="pt-32 pb-24 px-6 lg:px-8 relative overflow-hidden"
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
                    <Eyebrow>INTERACTIVE PREVIEW / NOT SAVED</Eyebrow>
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
                        key={mode}
                        onClick={(e) => {
                          setGameMode(mode)
                          ripple(e)
                        }}
                        className={`px-5 py-2 text-sm font-semibold transition-all duration-200 ${
                          gameMode === mode ? "mode-tab-active" : ""
                        }`}
                        style={{
                          backgroundColor: gameMode === mode ? "#1A2F22" : "transparent",
                          color: gameMode === mode ? "#94C28F" : "#7F8478",
                          borderRight: i < 2 ? "1px solid #3B5145" : "none",
                          fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
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
                      <div
                        key={c.id}
                        className={`contract-card border p-4 flex flex-col cursor-pointer select-none ${
                          isSelected ? "selected" : ""
                        }`}
                        style={{
                          backgroundColor: "#0E1512",
                          borderColor: isSelected ? "#7AB384" : "#26352E",
                          borderRadius: "6px",
                        }}
                        onClick={() => toggleContract(c.id)}
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
                            ✓
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-2 pr-6">
                          <span
                            className="text-[10px] font-bold tracking-widest"
                            style={{
                              color: catColor,
                              fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                              textShadow: `0 0 8px ${catColor}99`,
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
                            fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                            fontSize: "18px",
                            color: "#F1E4C8",
                            lineHeight: 1.2,
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
                              fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                              fontSize: "16px",
                              textShadow: isSelected ? "0 0 12px rgba(122,179,132,0.7)" : "none",
                            }}
                          >
                            +{c.xp} XP
                          </div>
                        </div>
                      </div>
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
                    borderRadius: "6px",
                    boxShadow: selected.length > 0 ? "0 0 24px rgba(69,127,91,0.14)" : "none",
                  }}
                >
                  <div className="min-w-0">
                    <div
                      className="font-bold mb-1.5"
                      style={{
                        fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
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
                            fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
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
                        fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                        letterSpacing: "0.05em",
                        boxShadow: selected.length > 0 ? "0 0 14px rgba(122,179,132,0.3)" : "none",
                      }}
                      disabled
                      aria-disabled="true"
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
      {page === "how" && (
        <>
          {/* ── VERIFICATION TIMELINE ── */}
          <section
            className="pt-32 pb-24 px-6 lg:px-8 relative overflow-hidden"
            style={{ backgroundColor: "#060A08" }}
          >
            <div
              className="absolute pointer-events-none"
              style={{
                width: "400px",
                height: "400px",
                background: "radial-gradient(circle, rgba(114,151,166,0.06) 0%, transparent 70%)",
                top: "20%",
                right: "-5%",
              }}
            />
            <div className="relative max-w-[1320px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-20 items-start">
              <Reveal>
                <div>
                  <Eyebrow>VERIFICATION PIPELINE</Eyebrow>
                  <SectionHeading className="mb-4">
                    {t(language, "Каждый шаг виден пользователю")}
                  </SectionHeading>
                  <p
                    className="text-sm leading-relaxed mb-6"
                    style={{ color: "#B6AC94", maxWidth: "400px" }}
                  >
                    {t(
                      language,
                      "Сервис находит подходящий матч, получает итоговую статистику и проверяет каждое условие. Если данных недостаточно, он сам создаёт внутренний запрос на разбор — игроку ничего загружать не нужно.",
                    )}
                  </p>
                  <a
                    href="#how"
                    className="text-sm font-medium inline-flex items-center gap-1.5"
                    style={{
                      color: "#7AB384",
                      textShadow: "0 0 8px rgba(122,179,132,0.3)",
                    }}
                  >
                    {t(language, "Как проходит проверка")} <span className="arrow-bounce">→</span>
                  </a>
                </div>
              </Reveal>

              <Reveal delay={150}>
                <div
                  className="border p-6 relative overflow-hidden"
                  style={{
                    backgroundColor: "#0E1512",
                    borderColor: "#26352E",
                    borderRadius: "6px",
                    boxShadow: "0 0 30px rgba(0,0,0,0.4), inset 0 1px 0 rgba(122,179,132,0.06)",
                  }}
                  onMouseMove={tilt.onMouseMove}
                  onMouseLeave={tilt.onMouseLeave}
                >
                  <div
                    className="absolute top-0 right-0 w-16 h-16 pointer-events-none"
                    style={{
                      background:
                        "radial-gradient(circle at top right, rgba(122,179,132,0.08) 0%, transparent 70%)",
                    }}
                  />
                  <div className="flex items-center justify-between mb-6">
                    <span
                      className="text-[11px] font-bold tracking-widest"
                      style={{
                        fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                        color: "#7F8478",
                      }}
                    >
                      {t(language, "МАТЧ #48291031")}
                    </span>
                    <span
                      className="badge-verified text-[10px] px-2 py-0.5 font-bold tracking-widest"
                      style={{
                        backgroundColor: "#0A1A10",
                        color: "#7AB384",
                        border: "1px solid #26543D",
                        borderRadius: "3px",
                      }}
                    >
                      {t(language, "ОБЫЧНЫЙ")}
                    </span>
                  </div>
                  {timelineSteps.map((step, i) => (
                    <div key={i} className="flex gap-4">
                      <div className="flex flex-col items-center shrink-0">
                        <div className="relative mt-[5px] shrink-0">
                          <div
                            className={`w-2.5 h-2.5 rounded-full ${
                              step.success ? "timeline-dot" : ""
                            }`}
                            style={{
                              backgroundColor: step.success
                                ? "#7AB384"
                                : i <= 3
                                  ? "#457F5B"
                                  : "#3B5145",
                              boxShadow: step.success
                                ? "0 0 12px rgba(122,179,132,0.9), 0 0 24px rgba(122,179,132,0.5)"
                                : i <= 3
                                  ? "0 0 6px rgba(69,127,91,0.5)"
                                  : "none",
                            }}
                          />
                        </div>
                        {i < timelineSteps.length - 1 && (
                          <div
                            className="w-px flex-1 my-1"
                            style={{
                              background: "linear-gradient(to bottom, #3B5145, #26352E)",
                              minHeight: "24px",
                            }}
                          />
                        )}
                      </div>
                      <div className="pb-5 last:pb-0">
                        <div className="flex flex-wrap items-baseline gap-x-3 mb-0.5">
                          <span className="text-[11px] font-mono" style={{ color: "#7F8478" }}>
                            {step.time}
                          </span>
                          <span
                            className="text-sm font-semibold"
                            style={{
                              color: step.success ? "#7AB384" : "#F1E4C8",
                              textShadow: step.success ? "0 0 10px rgba(122,179,132,0.6)" : "none",
                            }}
                          >
                            {step.label}
                          </span>
                        </div>
                        <p className="text-[11px]" style={{ color: "#7F8478" }}>
                          {step.detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>
          </section>

          {/* ── CURATOR SECTION ── */}
          <section
            className="py-20 px-6 lg:px-8 relative overflow-hidden"
            style={{
              borderTop: "1px solid #1A2520",
              borderBottom: "1px solid #1A2520",
              backgroundColor: "#060D0A",
            }}
          >
            <div
              className="orb orb-2 absolute"
              style={{
                width: "350px",
                height: "280px",
                background: "radial-gradient(ellipse, rgba(69,127,91,0.1) 0%, transparent 70%)",
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%)",
              }}
            />
            <Reveal>
              <div className="relative max-w-[800px] mx-auto text-center">
                <div className="mb-6 flex justify-center">
                  <div
                    className="eye-glow p-4 border rounded-full"
                    style={{
                      borderColor: "#26543D",
                      backgroundColor: "rgba(38,84,61,0.2)",
                    }}
                  >
                    <AnimatedEyeLogo />
                  </div>
                </div>
                <p
                  className="text-xs font-semibold tracking-[0.28em] uppercase mb-4"
                  style={{ color: "#7F8478" }}
                >
                  CURATOR SIGNAL
                </p>
                <div
                  className="font-bold"
                  style={{
                    fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                    fontSize: "clamp(24px,3.5vw,38px)",
                    minHeight: "1.3em",
                  }}
                >
                  <CuratorTyper />
                </div>
                <p
                  className="text-sm mt-4"
                  style={{
                    color: "#7F8478",
                    fontFamily: "Cormorant Garamond, serif",
                    fontStyle: "italic",
                    fontSize: "16px",
                  }}
                >
                  {t(language, '"Контракт — не наказание, а цель"')}
                </p>
              </div>
            </Reveal>
          </section>
          {/* ── FAQ ── */}
          <section
            className="py-24 px-6 lg:px-8 relative overflow-hidden"
            style={{ backgroundColor: "#060A08" }}
          >
            <div
              className="absolute pointer-events-none"
              style={{
                width: "300px",
                height: "300px",
                background: "radial-gradient(circle, rgba(138,120,174,0.07) 0%, transparent 70%)",
                top: "30%",
                left: "-5%",
              }}
            />
            <div className="relative max-w-[700px] mx-auto">
              <Reveal>
                <div className="text-center mb-10">
                  <Eyebrow>FAQ / SYSTEM</Eyebrow>
                  <SectionHeading>{t(language, "Частые вопросы")}</SectionHeading>
                </div>
              </Reveal>

              <Reveal stagger>
                <div className="space-y-2">
                  {faqItems.map((item, i) => (
                    <div
                      key={i}
                      className="border overflow-hidden"
                      style={{
                        backgroundColor: "#0E1512",
                        borderColor: openFaq === i ? "#3B5145" : "#26352E",
                        borderRadius: "6px",
                        boxShadow: openFaq === i ? "0 0 16px rgba(122,179,132,0.09)" : "none",
                        transition: "border-color 0.2s, box-shadow 0.2s",
                      }}
                    >
                      <button
                        className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left"
                        onClick={() => setOpenFaq(openFaq === i ? null : i)}
                      >
                        <span className="font-semibold text-sm" style={{ color: "#F1E4C8" }}>
                          {item.q}
                        </span>
                        <span
                          className="text-xl leading-none shrink-0 font-light"
                          style={{
                            color: "#7AB384",
                            textShadow: "0 0 8px rgba(122,179,132,0.5)",
                            transform: openFaq === i ? "rotate(45deg)" : "none",
                            transition: "transform 0.28s cubic-bezier(0.34,1.56,0.64,1)",
                            display: "inline-block",
                          }}
                        >
                          +
                        </span>
                      </button>
                      <div
                        style={{
                          maxHeight: openFaq === i ? "200px" : "0px",
                          overflow: "hidden",
                          transition: "max-height 0.35s cubic-bezier(0.16,1,0.3,1)",
                        }}
                      >
                        <div className="px-5 pb-5">
                          <p className="text-sm leading-relaxed" style={{ color: "#B6AC94" }}>
                            {item.a}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>
          </section>
        </>
      )}
      {page === "campaigns" && (
        <section
          className="pt-32 pb-28 px-6 lg:px-8 relative overflow-hidden"
          style={{ minHeight: "680px", backgroundColor: "#060A08" }}
        >
          <div className="max-w-[900px] mx-auto text-center relative">
            <Reveal>
              <Eyebrow>CAMPAIGNS · SOON</Eyebrow>
              <SectionHeading>{t(language, "Большие серии дел готовятся")}</SectionHeading>
              <p
                className="text-sm leading-relaxed mt-5 mx-auto max-w-[620px]"
                style={{ color: "#B6AC94" }}
              >
                {t(
                  language,
                  "Сначала доводим daily boards для Standard, Ranked и Street Brawl. Кампании появятся отдельным обновлением.",
                )}
              </p>
              <div
                className="mt-8 inline-flex items-center gap-2 px-4 py-2 border text-xs font-bold tracking-widest"
                style={{
                  borderColor: "#5A4D35",
                  color: "#C49A57",
                  backgroundColor: "#15120D",
                  borderRadius: "4px",
                }}
              >
                IN DEVELOPMENT · SOON
              </div>
            </Reveal>
          </div>
        </section>
      )}
      {page === "leaderboards" && (
        <section
          className="pt-32 pb-28 px-6 lg:px-8 relative overflow-hidden"
          style={{ minHeight: "760px", backgroundColor: "#060A08" }}
        >
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.025]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(122,179,132,1) 1px, transparent 1px), linear-gradient(90deg, rgba(122,179,132,1) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />
          <div className="max-w-[1080px] mx-auto relative">
            <Reveal>
              <div className="text-center mb-8">
                <Eyebrow>VERIFIED LEADERBOARD</Eyebrow>
                <SectionHeading>{t(language, "Лучшие агенты бюро")}</SectionHeading>
                <p
                  className="text-sm leading-relaxed mt-4 mx-auto max-w-[720px]"
                  style={{ color: "#B6AC94" }}
                >
                  {t(
                    language,
                    "Только серверно подтверждённые результаты Deadlock Contracts. Официальный рейтинг Deadlock сюда не входит.",
                  )}
                </p>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <div className="flex flex-wrap justify-center gap-2 mb-7">
                {(
                  [
                    ["all_time", "ALL TIME"],
                    ["today", "TODAY"],
                    ["rare", "RARE"],
                    ["mastery", "MASTERY"],
                  ] as Array<[LeaderScope, string]>
                ).map(([scope, label]) => (
                  <button
                    key={scope}
                    onClick={() => setLeaderScope(scope)}
                    className="px-4 py-2 text-xs font-bold tracking-[0.14em] border transition-all"
                    style={{
                      color: leaderScope === scope ? "#F1E4C8" : "#7F8478",
                      borderColor: leaderScope === scope ? "#457F5B" : "#26352E",
                      backgroundColor: leaderScope === scope ? "#0A1510" : "#0A0F0D",
                      boxShadow: leaderScope === scope ? "0 0 16px rgba(122,179,132,0.12)" : "none",
                      borderRadius: "4px",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div
                className="border overflow-hidden"
                style={{
                  backgroundColor: "#0A100D",
                  borderColor: "#26352E",
                  borderRadius: "6px",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
                }}
              >
                <div
                  className="px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-2"
                  style={{
                    borderBottom: "1px solid #26352E",
                    backgroundColor: "#0D1511",
                  }}
                >
                  <div>
                    <div
                      className="text-[10px] font-bold tracking-[0.2em]"
                      style={{ color: "#7AB384" }}
                    >
                      {leaderboard?.scoring.label || "VERIFIED XP"}
                    </div>
                    <div className="text-xs mt-1" style={{ color: "#7F8478" }}>
                      {leaderboard?.scoring.description ||
                        t(language, "Загружаем правила подсчёта…")}
                    </div>
                  </div>
                  <div className="text-[10px] tracking-[0.14em]" style={{ color: "#5F685F" }}>
                    {t(language, "Публичный профиль и статистика должны быть включены")}
                  </div>
                </div>

                {leaderLoading && (
                  <div className="px-5 py-16 text-center text-sm" style={{ color: "#7F8478" }}>
                    {t(language, "Загружаем таблицу лидеров…")}
                  </div>
                )}
                {!leaderLoading && leaderError && (
                  <div className="px-5 py-16 text-center text-sm" style={{ color: "#B65E58" }}>
                    {leaderError}
                  </div>
                )}
                {!leaderLoading && !leaderError && leaderboard?.rows.length === 0 && (
                  <div className="px-5 py-16 text-center">
                    <div className="text-sm font-semibold mb-2" style={{ color: "#F1E4C8" }}>
                      {t(language, "Пока никто не квалифицировался")}
                    </div>
                    <div className="text-xs" style={{ color: "#7F8478" }}>
                      {t(
                        language,
                        "Нужен публичный профиль с открытой статистикой и хотя бы один результат для выбранной таблицы.",
                      )}
                    </div>
                  </div>
                )}
                {!leaderLoading && !leaderError && leaderboard && leaderboard.rows.length > 0 && (
                  <div>
                    <div
                      className="grid grid-cols-[54px_1fr_90px_100px] md:grid-cols-[64px_1fr_90px_120px_120px] gap-3 px-4 md:px-5 py-3 text-[9px] font-bold tracking-[0.18em] uppercase"
                      style={{
                        color: "#5F685F",
                        borderBottom: "1px solid #1A2520",
                      }}
                    >
                      <span>#</span>
                      <span>PLAYER</span>
                      <span>LEVEL</span>
                      <span className="hidden md:block">CASES</span>
                      <span className="text-right">SCORE</span>
                    </div>
                    {leaderboard.rows.map((row) => (
                      <a
                        key={row.slug}
                        href={`/u/${row.slug}`}
                        className="grid grid-cols-[54px_1fr_90px_100px] md:grid-cols-[64px_1fr_90px_120px_120px] gap-3 px-4 md:px-5 py-3.5 items-center transition-colors"
                        style={{
                          borderBottom: "1px solid #152019",
                          color: "#F1E4C8",
                        }}
                        onMouseEnter={(event) =>
                          (event.currentTarget.style.backgroundColor = "#0D1712")
                        }
                        onMouseLeave={(event) =>
                          (event.currentTarget.style.backgroundColor = "transparent")
                        }
                      >
                        <span
                          className="font-bold text-sm"
                          style={{
                            color: row.rank <= 3 ? "#C9AE72" : "#7F8478",
                            fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                          }}
                        >
                          {String(row.rank).padStart(2, "0")}
                        </span>
                        <span className="flex items-center gap-3 min-w-0">
                          {row.avatar_url ? (
                            <img
                              src={row.avatar_url}
                              alt=""
                              className="w-8 h-8 rounded-sm object-cover border"
                              style={{ borderColor: "#26352E" }}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span
                              className="w-8 h-8 border grid place-items-center text-[10px]"
                              style={{
                                borderColor: "#26352E",
                                color: "#7AB384",
                                backgroundColor: "#0E1512",
                              }}
                            >
                              DC
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold truncate">
                              {row.display_name}
                            </span>
                            <span
                              className="block text-[10px] truncate"
                              style={{ color: "#5F685F" }}
                            >
                              @{row.slug}
                            </span>
                          </span>
                        </span>
                        <span className="text-sm font-bold" style={{ color: "#B6AC94" }}>
                          LVL {row.level}
                        </span>
                        <span className="hidden md:block text-sm" style={{ color: "#7F8478" }}>
                          {row.contracts_completed}
                        </span>
                        <span
                          className="text-right text-base font-bold"
                          style={{
                            color: "#7AB384",
                            fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
                            textShadow: "0 0 10px rgba(122,179,132,0.18)",
                          }}
                        >
                          {row.score.toLocaleString(language === "ru" ? "ru-RU" : "en-US")}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </Reveal>

            <p
              className="text-[10px] leading-relaxed text-center mt-5 mx-auto max-w-[760px]"
              style={{ color: "#5F685F" }}
            >
              {t(
                language,
                "Leaderboard использует только награды за подтверждённые контракты. Административные корректировки XP не влияют на позицию.",
              )}
            </p>
          </div>
        </section>
      )}
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
                  href: "/support",
                },
                {
                  label: language === "ru" ? "Статус" : "Status",
                  href: "/status",
                },
                {
                  label: language === "ru" ? "Изменения" : "Changelog",
                  href: "/changelog",
                },
                {
                  label: language === "ru" ? "Источники данных" : "Data sources",
                  href: "/data-sources",
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
                fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
              }}
            >
              PLATFORM
            </div>
            {[
              {
                label: "CONTRACTS",
                href: "#contracts",
              },
              {
                label: "HOW IT WORKS",
                href: "#how",
              },
              {
                label: "CAMPAIGNS · SOON",
                href: "#campaigns",
              },
              {
                label: "LEADERBOARD",
                href: "#leaderboards",
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
                fontFamily: "Roboto Condensed, Barlow Condensed, sans-serif",
              }}
            >
              DOCUMENTS
            </div>
            {[
              {
                label: language === "ru" ? "Данные" : "Privacy",
                href: "/privacy",
              },
              {
                label: language === "ru" ? "Условия" : "Terms",
                href: "/terms",
              },
              {
                label: language === "ru" ? "Источники данных" : "Data sources",
                href: "/data-sources",
              },
              {
                label: language === "ru" ? "Контакт" : "Contact",
                href: "/support",
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
