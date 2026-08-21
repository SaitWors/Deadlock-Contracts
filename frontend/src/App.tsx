import { useEffect, useState } from "react"
import Landing from "./Landing"
import Dashboard from "./Dashboard"
import PublicDossier from "./PublicDossier"
import { LanguageProvider, useLanguage } from "./i18n"

type SessionPayload = {
  authenticated: boolean
  user: null | {
    id: string
    display_name: string
    avatar_url: string | null
    xp: number
    status: string
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
  const { language } = useLanguage()
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/me", {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<SessionPayload>
      })
      .then(setSession)
      .catch((error) => {
        if (error?.name !== "AbortError") setFailed(true)
      })
    return () => controller.abort()
  }, [])

  if (failed) return <Landing />
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
