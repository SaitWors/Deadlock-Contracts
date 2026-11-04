import { lazy, Suspense, useEffect, useState } from "react"
import Landing from "./Landing"
import { AppearanceProvider } from "./Appearance"
import { legacyPublicUrl, resolvePublicRoute } from "./publicRoutes"
const Dashboard = lazy(() => import("./Dashboard"))
const PublicDossier = lazy(() => import("./PublicDossier"))
import { apiLanguage, LanguageProvider, useLanguage } from "./i18n"
import AnnouncementLayer from "./announcements/AnnouncementLayer"
import { AnnouncementProvider, useAnnouncements } from "./announcements/AnnouncementProvider"
import { PublicNavigationProvider, usePublicNavigation } from "./public-navigation"

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
    access_role: "OWNER" | "ADMIN" | "MODERATOR" | "TESTER" | "PLAYER"
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
    is_staff: boolean
    permissions: string[]
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

function SessionApp({ onSession }: { onSession: (authenticated: boolean) => void }) {
  const { pathname } = usePublicNavigation()
  const discoverSession = ["/", "/admin/reviews", "/admin/announcements"].includes(pathname)
  const { language, setServerDefault } = useLanguage()
  const { configureSession, setSurface } = useAnnouncements()
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!discoverSession) return
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
          const authenticated = Boolean(payload.authenticated && payload.user && payload.csrf_token)
          onSession(authenticated)
          setSession(payload)
          if (!authenticated && window.location.pathname === "/") {
            const legacy = legacyPublicUrl(window.location.hash, "ru")
            if (legacy) window.location.replace(legacy)
          }
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
  }, [attempt, setServerDefault, onSession, discoverSession])

  useEffect(() => {
    const authenticated = Boolean(
      discoverSession && session?.authenticated && session.user && session.csrf_token,
    )
    configureSession(
      authenticated,
      authenticated ? session?.csrf_token || null : null,
      authenticated ? session?.user?.id || null : null,
    )
    setSurface(authenticated ? "SITE_DASHBOARD" : "SITE_PUBLIC")
  }, [configureSession, session, setSurface, discoverSession])

  if (!discoverSession || !session?.authenticated || !session.user || !session.csrf_token) {
    return (
      <>
        {discoverSession && failed && (
          <aside className="public-session-notice" role="alert">
            <p>
              {language === "ru"
                ? "Не удалось проверить вход. Публичные страницы доступны."
                : "Could not check your session. Public pages are still available."}
            </p>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {language === "ru" ? "ПОВТОРИТЬ" : "TRY AGAIN"}
            </button>
            <a href="/status">{language === "ru" ? "Статус" : "Status"}</a>
            <a href="/support">{language === "ru" ? "Поддержка" : "Support"}</a>
          </aside>
        )}
        <Landing />
      </>
    )
  }
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
function AppRoutes({ onSession }: { onSession: (authenticated: boolean) => void }) {
  const { pathname } = usePublicNavigation()
  const match = pathname.match(/^\/u\/([a-z0-9-]{3,32})\/?$/)
  if (match) return <PublicDossier slug={match[1]} />
  const route = resolvePublicRoute(pathname)
  if (route || ["/admin/reviews", "/admin/announcements"].includes(pathname))
    return <SessionApp onSession={onSession} />
  return (
    <main className="public-document">
      <h1>404</h1>
      <a href="/ru/">На главную</a> · <a href="/en/">Home</a>
    </main>
  )
}

function AppContent() {
  const { pathname } = usePublicNavigation()
  const [privateSession, setPrivateSession] = useState(false)
  const route = resolvePublicRoute(pathname)
  const publicRoute = pathname === "/" && privateSession ? undefined : route || undefined
  return (
    <LanguageProvider publicRoute={publicRoute}>
      <AppearanceProvider>
        <AnnouncementProvider>
          <AnnouncementLayer />
          <Suspense
            fallback={
              <main className="community-page" role="status">
                <div className="dc-loader" />
              </main>
            }
          >
            <AppRoutes onSession={setPrivateSession} />
          </Suspense>
        </AnnouncementProvider>
      </AppearanceProvider>
    </LanguageProvider>
  )
}

export default function App() {
  return (
    <PublicNavigationProvider>
      <AppContent />
    </PublicNavigationProvider>
  )
}
