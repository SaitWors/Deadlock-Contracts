import { useEffect, useState } from "react"
import logoImage from "@/imports/logo-horizontal.svg"
import markImage from "@/imports/mark.svg"
import { contractTitle, LanguageSwitch, localizeServerText, MCGCredit, useLanguage } from "./i18n"

type Mode = "STANDARD" | "RANKED" | "STREET_BRAWL"
type Showcase = {
  id: string
  title: string
  mode: Mode
  rarity: string
  difficulty: string
  reward_xp: number
  explanation: string | null
  match_id: number | null
}
type Profile = {
  slug: string
  headline: string
  bio: string
  theme: "DOSSIER" | "NOIR" | "SIGNAL"
  is_public: boolean
  links: Record<string, string>
  player: {
    display_name: string
    avatar_url: string | null
    badges: string[]
    level: number
    xp: number | null
    joined_at: string | null
  }
  stats: null | {
    contracts_completed: number
    contracts_failed: number
    mode_stats: Record<
      Mode,
      {
        completed: number
        failed: number
        attempted: number
        xp: number
      }
    >
    hardest_completed: {
      title: string
      difficulty: string
      reward_xp: number
    } | null
  }
  showcase: Showcase[]
}

const MODE_NAME: Record<Mode, string> = {
  STANDARD: "STANDARD",
  RANKED: "RANKED",
  STREET_BRAWL: "STREET BRAWL",
}
const LINK_NAME: Record<string, string> = {
  twitch: "TWITCH",
  youtube: "YOUTUBE",
  telegram: "TELEGRAM",
  discord: "DISCORD",
}

export default function PublicDossier({ slug }: { slug: string }) {
  const { language, locale } = useLanguage()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/public/profiles/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json()
      })
      .then((data) => setProfile(data.profile as Profile))
      .catch((error) => {
        if (error?.name !== "AbortError") setMissing(true)
      })
    return () => controller.abort()
  }, [slug])

  if (missing)
    return (
      <main className="dc-public-page dc-public-missing">
        <div className="dc-public-missing-tools">
          <img src={logoImage} alt="Deadlock Contracts" />
          <LanguageSwitch compact />
        </div>
        <p>PUBLIC DOSSIER / 404</p>
        <h1>{language === "ru" ? "Public dossier не найден" : "Public dossier not found"}</h1>
        <a href="/">{language === "ru" ? "НА ГЛАВНУЮ" : "BACK TO HOME"}</a>
        <MCGCredit language={language} />
      </main>
    )
  if (!profile)
    return (
      <main className="dc-public-page dc-public-missing">
        <div className="dc-loader" />
        <p>{language === "ru" ? "ОТКРЫВАЕМ PUBLIC DOSSIER" : "OPENING PUBLIC DOSSIER"}</p>
      </main>
    )

  return (
    <div className={`dc-public-page theme-${profile.theme.toLowerCase()}`}>
      <header className="dc-public-topbar">
        <a href="/">
          <img src={logoImage} alt="Deadlock Contracts" />
        </a>
        <div className="dc-public-topbar-actions">
          <span>PUBLIC DOSSIER / @{profile.slug}</span>
          <LanguageSwitch compact />
        </div>
      </header>
      <main className="dc-public-shell">
        <section className="dc-public-hero">
          <img className="dc-public-watermark" src={markImage} alt="" />
          <div className="dc-public-identity">
            {profile.player.avatar_url ? (
              <img src={profile.player.avatar_url} alt="" />
            ) : (
              <div className="dc-public-avatar">DC</div>
            )}
            <div>
              <p>CONTRACT RUNNER / LEVEL {profile.player.level}</p>
              <h1>{profile.player.display_name}</h1>
              <span>{profile.headline || "Deadlock Contract Runner"}</span>
              <div className="dc-public-badges">
                {profile.player.badges.map((item) => (
                  <b key={item}>{item}</b>
                ))}
              </div>
            </div>
          </div>
          {profile.bio && <p className="dc-public-bio">{profile.bio}</p>}
        </section>

        {profile.stats && (
          <section className="dc-public-stats">
            <article>
              <span>TOTAL XP</span>
              <b>{(profile.player.xp ?? 0).toLocaleString(locale)}</b>
            </article>
            <article>
              <span>COMPLETED</span>
              <b>{profile.stats.contracts_completed}</b>
            </article>
            <article>
              <span>FAILED</span>
              <b>{profile.stats.contracts_failed}</b>
            </article>
            <article>
              <span>LEVEL</span>
              <b>{profile.player.level}</b>
            </article>
          </section>
        )}

        {profile.stats && (
          <section className="dc-public-panel">
            <div className="dc-public-section-title">
              <span>01</span>
              <h2>{language === "ru" ? "Mode record / результаты" : "Mode record"}</h2>
            </div>
            <div className="dc-public-mode-grid">
              {(["STANDARD", "RANKED", "STREET_BRAWL"] as Mode[]).map((mode) => {
                const stat = profile.stats!.mode_stats[mode]
                return (
                  <article key={mode}>
                    <span>{MODE_NAME[mode]}</span>
                    <b>
                      {stat?.completed || 0}
                      <small>{language === "ru" ? " выполнено" : " completed"}</small>
                    </b>
                    <p>
                      {stat?.attempted || 0} {language === "ru" ? "попыток" : "attempts"} · +
                      {stat?.xp || 0} XP
                    </p>
                  </article>
                )
              })}
            </div>
          </section>
        )}

        {profile.showcase.length > 0 && (
          <section className="dc-public-panel">
            <div className="dc-public-section-title">
              <span>02</span>
              <h2>{language === "ru" ? "Contract showcase / витрина" : "Contract showcase"}</h2>
            </div>
            <div className="dc-public-showcase">
              {profile.showcase.map((item) => (
                <article key={item.id}>
                  <div>
                    <span>
                      {MODE_NAME[item.mode]} / {item.rarity}
                    </span>
                    <h3>{contractTitle(item.title, language)}</h3>
                    <p>
                      {item.explanation
                        ? localizeServerText(item.explanation, language)
                        : language === "ru"
                          ? "Проверенный результат контракта"
                          : "Verified contract result"}
                    </p>
                  </div>
                  <strong>+{item.reward_xp} XP</strong>
                </article>
              ))}
            </div>
          </section>
        )}

        {Object.keys(profile.links).length > 0 && (
          <section className="dc-public-links">
            <span>SOCIAL SIGNALS</span>
            <div>
              {Object.entries(profile.links).map(([key, href]) => (
                <a key={key} href={href} target="_blank" rel="noreferrer">
                  {LINK_NAME[key] || key.toUpperCase()} ↗
                </a>
              ))}
            </div>
          </section>
        )}
      </main>
      <footer className="dc-public-footer">
        <div>
          <span>
            {language === "ru"
              ? "DEADLOCK CONTRACTS / COMMUNITY PROJECT"
              : "DEADLOCK CONTRACTS / COMMUNITY PROJECT"}
          </span>
          <span>
            {language === "ru"
              ? "VERIFIED PROGRESSION / SAFE PROFILE LAYOUT"
              : "VERIFIED PROGRESSION / SAFE PROFILE LAYOUT"}
          </span>
        </div>
        <MCGCredit language={language} />
      </footer>
    </div>
  )
}
