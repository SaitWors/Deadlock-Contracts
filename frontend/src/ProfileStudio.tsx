import { useEffect, useMemo, useState } from "react"
import { apiLanguage, contractTitle, localizeServerText, t, useLanguage } from "./i18n"

type Mode = "STANDARD" | "RANKED" | "STREET_BRAWL"
type BadgeId =
  | "CREATOR"
  | "ADMIN"
  | "DEVELOPER"
  | "STREAMER"
  | "EARLY_TESTER"
  | "TESTER"
  | "CONTRIBUTOR"
  | "PLAYER"
type User = {
  display_name: string
  avatar_url: string | null
  xp: number
  badges: BadgeId[]
}
type Progression = {
  level: number
  contracts_completed: number
  mode_stats: Record<
    Mode,
    {
      completed: number
      failed: number
      attempted: number
      xp: number
    }
  >
}
type ShowcaseItem = {
  id: string
  title: string
  title_i18n?: Partial<Record<"ru" | "en", string>>
  mode: Mode
  difficulty: string
  rarity: string
  reward_xp: number
  explanation: string | null
  match_id: string | null
}
type PublicProfile = {
  slug: string
  headline: string
  bio: string
  theme: "DOSSIER" | "NOIR" | "SIGNAL"
  is_public: boolean
  show_stats: boolean
  show_showcase: boolean
  show_links: boolean
  links: Record<string, string>
  public_url: string | null
  showcase: ShowcaseItem[]
}
type LoadPayload = {
  profile: PublicProfile | null
  suggested_slug: string
  defaults?: Omit<PublicProfile, "slug" | "public_url" | "showcase">
}

type Props = {
  csrf: string
  user: User
  progression: Progression | null
  onNotice: (value: string) => void
  onError: (value: string) => void
}

const MODE_NAME: Record<Mode, string> = {
  STANDARD: "Standard",
  RANKED: "Ranked",
  STREET_BRAWL: "Street Brawl",
}
const THEME_LABEL: Record<
  PublicProfile["theme"],
  {
    title: string
    caption: string
  }
> = {
  DOSSIER: { title: "DOSSIER", caption: "Основной стиль" },
  NOIR: { title: "NOIR", caption: "Сдержанный архив" },
  SIGNAL: { title: "SIGNAL", caption: "Больше tech-акцента" },
}

async function request<T>(url: string, csrf: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  headers.set("Accept-Language", apiLanguage())
  if (init.body) headers.set("Content-Type", "application/json")
  if (!["GET", "HEAD"].includes((init.method || "GET").toUpperCase()))
    headers.set("X-CSRF-Token", csrf)
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
  })
  const data = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`)
  return data as T
}

function emptyProfile(slug: string, defaults?: LoadPayload["defaults"]): PublicProfile {
  return {
    slug,
    headline: defaults?.headline || "Deadlock Contract Runner",
    bio: defaults?.bio || "",
    theme: defaults?.theme || "DOSSIER",
    is_public: defaults?.is_public || false,
    show_stats: defaults?.show_stats ?? true,
    show_showcase: defaults?.show_showcase ?? true,
    show_links: defaults?.show_links ?? true,
    links: defaults?.links || {},
    public_url: null,
    showcase: [],
  }
}

export default function ProfileStudio({ csrf, user, progression, onNotice, onError }: Props) {
  const { language, locale } = useLanguage()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [draft, setDraft] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    request<LoadPayload>("/api/profile/public", csrf)
      .then((data) => {
        if (!alive) return
        const value = data.profile || emptyProfile(data.suggested_slug, data.defaults)
        setProfile(value)
        setDraft(value)
      })
      .catch((reason) => alive && onError(localizeServerText((reason as Error).message, language)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [csrf, onError, language])

  const dirty = useMemo(() => JSON.stringify(profile) !== JSON.stringify(draft), [profile, draft])
  if (loading || !draft)
    return (
      <article className="dc-public-studio dc-system-card">
        <p className="dc-eyebrow">PUBLIC DOSSIER</p>
        <h2>Profile Studio</h2>
        <p className="dc-public-studio-muted">
          {t(language, "Загружаем настройки публичного профиля…")}
        </p>
      </article>
    )

  const patch = <K extends keyof PublicProfile>(key: K, value: PublicProfile[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  const patchLink = (key: string, value: string) => patch("links", { ...draft.links, [key]: value })
  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        slug: draft.slug.trim().toLowerCase(),
        headline: draft.headline.trim(),
        bio: draft.bio.trim(),
        theme: draft.theme,
        is_public: draft.is_public,
        show_stats: draft.show_stats,
        show_showcase: draft.show_showcase,
        show_links: draft.show_links,
        links: Object.fromEntries(
          Object.entries(draft.links)
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => value),
        ),
      }
      const data = await request<{ profile: PublicProfile }>("/api/profile/public", csrf, {
        method: "PUT",
        body: JSON.stringify(payload),
      })
      setProfile(data.profile)
      setDraft(data.profile)
      onNotice(
        t(
          language,
          data.profile.is_public
            ? "Public dossier сохранён и опубликован"
            : "Public dossier сохранён как private",
        ),
      )
    } catch (reason) {
      onError(localizeServerText((reason as Error).message, language))
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className={`dc-public-studio theme-${draft.theme.toLowerCase()}`}>
      <div className="dc-public-studio-head">
        <div>
          <p className="dc-eyebrow">PUBLIC PROFILE / ESSENTIALS</p>
          <h2>Public dossier</h2>
          <p>
            {t(
              language,
              "Минимальный public profile: handle, bio, social links и showcase реальных контрактов. Без custom HTML, лишних widgets и отдельного визуального языка.",
            )}
          </p>
        </div>
        <label className="dc-profile-publish">
          <input
            type="checkbox"
            checked={draft.is_public}
            onChange={(event) => patch("is_public", event.target.checked)}
          />
          <span>{draft.is_public ? "PUBLIC" : "PRIVATE"}</span>
        </label>
      </div>

      <div className="dc-public-studio-grid">
        <div className="dc-public-editor">
          <label>
            <span>PUBLIC HANDLE</span>
            <input
              value={draft.slug}
              maxLength={32}
              onChange={(event) =>
                patch(
                  "slug",
                  event.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "")
                    .replace(/--+/g, "-"),
                )
              }
            />
            <small>deadlock-contracts.online/u/{draft.slug || "handle"}</small>
          </label>
          <label>
            <span>HEADLINE</span>
            <input
              value={draft.headline}
              maxLength={96}
              placeholder="Support main · Contract runner"
              onChange={(event) => patch("headline", event.target.value)}
            />
          </label>
          <label>
            <span>BIO</span>
            <textarea
              value={draft.bio}
              maxLength={360}
              rows={4}
              placeholder={t(language, "Пара строк о стиле игры, героях или целях")}
              onChange={(event) => patch("bio", event.target.value)}
            />
            <small>{draft.bio.length}/360</small>
          </label>

          <div className="dc-profile-theme-picker">
            <span>THEME</span>
            <div>
              {(Object.keys(THEME_LABEL) as PublicProfile["theme"][]).map((theme) => (
                <button
                  type="button"
                  key={theme}
                  className={draft.theme === theme ? "active" : ""}
                  onClick={() => patch("theme", theme)}
                >
                  <b>{THEME_LABEL[theme].title}</b>
                  <small>{t(language, THEME_LABEL[theme].caption)}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="dc-profile-links">
            <span>SOCIAL LINKS</span>
            {(
              [
                ["twitch", "Twitch", "https://twitch.tv/username"],
                ["youtube", "YouTube", "https://youtube.com/@channel"],
                ["telegram", "Telegram", "https://t.me/username"],
                ["discord", "Discord", "https://discord.gg/invite"],
              ] as const
            ).map(([key, label, placeholder]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  value={draft.links[key] || ""}
                  placeholder={placeholder}
                  onChange={(event) => patchLink(key, event.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="dc-profile-visibility">
            <span>VISIBLE BLOCKS</span>
            <label>
              <input
                type="checkbox"
                checked={draft.show_stats}
                onChange={(event) => patch("show_stats", event.target.checked)}
              />
              {language === "ru" ? "Stats / статистика" : "Stats"}
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.show_showcase}
                onChange={(event) => patch("show_showcase", event.target.checked)}
              />
              {language === "ru" ? "Contract showcase / витрина" : "Contract showcase"}
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.show_links}
                onChange={(event) => patch("show_links", event.target.checked)}
              />
              {language === "ru" ? "Social links / ссылки" : "Social links"}
            </label>
          </div>

          <div className="dc-profile-editor-actions">
            <button
              className="dc-primary"
              type="button"
              disabled={saving || !dirty || draft.slug.length < 3}
              onClick={() => void save()}
            >
              {saving ? (language === "ru" ? "СОХРАНЯЕМ…" : "SAVING…") : "SAVE DOSSIER"}
            </button>
            {profile?.public_url ? (
              <a className="dc-ghost" href={profile.public_url} target="_blank" rel="noreferrer">
                {language === "ru" ? "ОТКРЫТЬ PUBLIC PAGE ↗" : "OPEN PUBLIC PAGE ↗"}
              </a>
            ) : null}
          </div>
        </div>

        <div className="dc-profile-live-preview">
          <div className="dc-profile-preview-stamp">LIVE PREVIEW / {draft.theme}</div>
          <div className="dc-profile-preview-identity">
            {user.avatar_url ? <img src={user.avatar_url} alt="" /> : <div>DC</div>}
            <div>
              <p>LEVEL {progression?.level || 1}</p>
              <h3>{user.display_name}</h3>
              <span>{draft.headline || "Deadlock Contract Runner"}</span>
            </div>
          </div>
          {draft.bio ? (
            <p className="dc-profile-preview-bio">{draft.bio}</p>
          ) : (
            <p className="dc-profile-preview-bio muted">
              {language === "ru" ? "Предпросмотр bio" : "Bio preview"}
            </p>
          )}
          {draft.show_stats && (
            <div className="dc-profile-preview-stats">
              <div>
                <span>XP</span>
                <b>{user.xp.toLocaleString(locale)}</b>
              </div>
              <div>
                <span>COMPLETED</span>
                <b>{progression?.contracts_completed || 0}</b>
              </div>
              <div>
                <span>MODES</span>
                <b>3</b>
              </div>
            </div>
          )}
          {draft.show_showcase && (
            <div className="dc-profile-preview-showcase">
              <span>CONTRACT SHOWCASE</span>
              {(draft.showcase || []).slice(0, 3).map((item) => (
                <div key={item.id}>
                  <p>
                    <b>{item.title_i18n?.[language] || contractTitle(item.title, language)}</b>
                    <small>
                      {MODE_NAME[item.mode]} · {item.rarity}
                    </small>
                  </p>
                  <em>+{item.reward_xp} XP</em>
                </div>
              ))}
              {!draft.showcase?.length && (
                <small>
                  {t(language, "Лучшие completed contracts появятся после первого сохранения")}
                </small>
              )}
            </div>
          )}
          {draft.show_links && Object.values(draft.links).some(Boolean) ? (
            <div className="dc-profile-preview-links">
              {Object.entries(draft.links)
                .filter(([, value]) => value)
                .map(([key]) => (
                  <span key={key}>{key.toUpperCase()}</span>
                ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
