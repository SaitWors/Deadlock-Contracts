import { useEffect, useState } from "react"
import Landing from "./Landing"
import Dashboard from "./Dashboard"
import PublicDossier from "./PublicDossier"
import { apiLanguage, LanguageProvider, useLanguage } from "./i18n"

type SessionPayload = {
  authenticated: boolean
  user: null | {
    id: string
    display_name: string
    avatar_url: string | null
    xp: number
    status: string
    locale: "ru" | "en"
    timezone: string
    access_role: "OWNER" | "ADMIN" | "TESTER" | "PLAYER"
    badges: Array<
      | "CREATOR"
      | "ADMIN"
      | "DEVELOPER"
      | "STREAMER"
      | "EARLY_TESTER"
      | "TESTER"
      | "CONTRIBUTOR"
      | "PLAYER"
    >
    created_at: string | null
    is_admin: boolean
    can_manage_roles: boolean
  }
  csrf_token: string | null
  release: {
    version: string
    label: string
    post_match_only: boolean
    modes: Array<"STANDARD" | "RANKED" | "STREET_BRAWL">
    manual_verification: boolean
  }
}

function SessionApp() {
  const { language, setServerDefault } = useLanguage()
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let timedOut = false
    setFailed(false)
    setSession(null)
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 12_000)

    fetch("/api/me", {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json", "Accept-Language": apiLanguage() },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<SessionPayload>
      })
      .then((payload) => {
        if (active) {
          setServerDefault(
            payload.user?.locale === "ru" || payload.user?.locale === "en"
              ? payload.user.locale
              : null,
          )
          setSession(payload)
        }
      })
      .catch((error) => {
        if (active && (timedOut || error?.name !== "AbortError")) setFailed(true)
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [attempt, setServerDefault])

  if (failed) {
    return (
      <main
        className="min-h-screen grid place-items-center px-6"
        style={{ backgroundColor: "#080C0B", color: "#F1E4C8" }}
      >
        <section
          role="alert"
          className="w-full max-w-lg border p-7 text-center"
          style={{ backgroundColor: "#0E1512", borderColor: "#3B5145", borderRadius: "6px" }}
        >
          <p
            className="text-xs font-semibold tracking-[0.22em] uppercase mb-3"
            style={{ color: "#7AB384" }}
          >
            {language === "ru" ? "СЕРВИС ВРЕМЕННО НЕДОСТУПЕН" : "SERVICE TEMPORARILY UNAVAILABLE"}
          </p>
          <h1 className="text-2xl font-bold mb-3">
            {language === "ru" ? "Не удалось открыть ваше дело" : "We could not open your case"}
          </h1>
          <p className="text-sm leading-relaxed mb-6" style={{ color: "#B6AC94" }}>
            {language === "ru"
              ? "Проверьте соединение и попробуйте ещё раз. Если ошибка повторяется, загляните на страницу статуса."
              : "Check your connection and try again. If the error continues, check the status page."}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              className="btn-primary px-5 py-2.5 text-sm font-bold"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {language === "ru" ? "ПОВТОРИТЬ" : "TRY AGAIN"}
            </button>
            <a className="btn-ghost px-5 py-2.5 text-sm" href="/status">
              {language === "ru" ? "СТАТУС" : "STATUS"}
            </a>
            <a className="btn-ghost px-5 py-2.5 text-sm" href="/support">
              {language === "ru" ? "ПОДДЕРЖКА" : "SUPPORT"}
            </a>
          </div>
        </section>
      </main>
    )
  }
  if (!session) {
    return (
      <main
        className="min-h-screen grid place-items-center"
        style={{ backgroundColor: "#080C0B", color: "#F1E4C8" }}
      >
        <div className="text-center">
          <div className="dc-loader mx-auto mb-4" />
          <p className="text-xs tracking-[0.28em] uppercase" style={{ color: "#7AB384" }}>
            {language === "ru" ? "ОТКРЫВАЕМ ВАШЕ ДЕЛО" : "OPENING YOUR CASE"}
          </p>
        </div>
      </main>
    )
  }
  if (!session.authenticated || !session.user || !session.csrf_token) return <Landing />
  return (
    <Dashboard
      initialSession={{
        ...session,
        user: session.user,
        csrf_token: session.csrf_token,
      }}
    />
  )
}
function AppRoutes() {
  const match = window.location.pathname.match(/^\/u\/([a-z0-9-]{3,32})\/?$/)
  if (match) return <PublicDossier slug={match[1]} />
  return <SessionApp />
}

export default function App() {
  return (
    <LanguageProvider>
      <AppRoutes />
    </LanguageProvider>
  )
}
