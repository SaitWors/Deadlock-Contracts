import { useEffect, useId, useRef, useState } from "react"
import { useLanguage } from "./i18n"
import Icon from "./icons/Icon"
import DossierView, { dossierMode, visibleProfile } from "./community/DossierView"
import { request, useResource } from "./community/api"
import { LoadState } from "./community/Shared"
import type { Module, Profile, Theme } from "./community/types"

type Props = {
  csrf: string
  onNotice: (value: string) => void
  onBureau: (slug: string) => void
  onCollection?: () => void
  identity?: Pick<Profile["player"], "display_name" | "avatar_url" | "badges">
  progression?: {
    level: number
    total_xp: number
    level_xp: number
    next_level_xp: number
  } | null
}

export default function ProfileStudio({
  csrf,
  onNotice,
  onBureau,
  onCollection,
  identity,
  progression,
}: Props) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const resource = useResource<{ profile: Profile | null; draft?: Profile }>(
    "/api/profile/public",
    { reloadOnLanguageChange: false },
  )
  const [draft, setDraft] = useState<Profile | null>(null)
  const [guest, setGuest] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [sharing, setSharing] = useState(false)
  const [copyStatus, setCopyStatus] = useState("")
  const savingRef = useRef(false)
  const shareInput = useRef<HTMLInputElement>(null)
  const editorHeading = useRef<HTMLHeadingElement>(null)
  const visitorHeading = useRef<HTMLButtonElement>(null)
  const shareId = useId()
  const editing = draft !== null

  useEffect(() => {
    if (guest) visitorHeading.current?.focus()
    else if (editing) editorHeading.current?.focus()
  }, [editing, guest])

  const saved = resource.data?.profile ?? resource.data?.draft
  if (!saved) return <LoadState error={resource.error} retry={resource.reload} />

  const profile = draft ?? saved
  const patch = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous))
  const names: Record<Module, string> = {
    contracts: ru ? "Контракты" : "Contracts",
    achievements: ru ? "Печати" : "Seals",
    bureau: ru ? "Бюро" : "Bureau",
  }
  const beginEdit = () => {
    setSharing(false)
    setGuest(false)
    setSaveError("")
    setDraft(saved)
  }
  const closeEditor = () => {
    setDraft(null)
    setSaveError("")
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError("")
    try {
      const {
        slug,
        headline,
        bio,
        theme,
        is_public,
        show_stats,
        show_showcase,
        show_links,
        show_achievements,
        show_bureau,
        showcase_order,
        featured_achievement,
      } = draft
      const result = await request<{ profile: Profile }>("/api/profile/public", csrf, {
        method: "PUT",
        body: JSON.stringify({
          slug,
          headline,
          bio,
          theme,
          is_public,
          show_stats,
          show_showcase,
          show_links,
          show_achievements,
          show_bureau,
          showcase_order,
          featured_achievement,
          pinned_contract_ids: draft.pinned_contract_ids || [],
          links: Object.fromEntries(
            Object.entries(draft.links).filter(([, value]) => value.trim()),
          ),
        }),
      })
      resource.setData({ profile: result.profile })
      setDraft(null)
      setGuest(false)
      onNotice(ru ? "Профиль сохранён" : "Profile saved")
    } catch (error) {
      setSaveError((error as Error).message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const selected = profile.pinned_contract_ids || []
  const preview = {
    ...profile,
    player: {
      ...profile.player,
      ...identity,
      ...(progression && {
        level: progression.level,
        xp: progression.total_xp,
        level_xp: progression.level_xp,
        next_level_xp: progression.next_level_xp,
      }),
    },
    showcase: selected.length
      ? selected
          .map(
            (id) =>
              (profile.available_contracts || []).find((item) => item.id === id) ||
              profile.showcase.find((item) => item.id === id),
          )
          .filter((item) => item !== undefined)
      : (profile.available_contracts || profile.showcase).slice(0, 3),
  }
  const publicUrl = saved.is_public ? saved.public_url : null
  const shareUrl = publicUrl ? new URL(publicUrl, window.location.origin).href : ""
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyStatus(ru ? "Ссылка скопирована" : "Link copied")
    } catch {
      shareInput.current?.focus()
      shareInput.current?.select()
      setCopyStatus(ru ? "Скопируйте выделенную ссылку" : "Copy the selected link")
    }
  }

  return (
    <section className="community-page profile-studio">
      {draft && !guest ? (
        <div className="profile-editor">
          <h1 ref={editorHeading} tabIndex={-1}>
            {ru ? "Редактировать профиль" : "Edit profile"}
          </h1>
          <form onSubmit={(event) => void save(event)}>
            <fieldset disabled={saving}>
              <section>
                <h2>{ru ? "Основное" : "Basics"}</h2>
                <div className="community-form-grid">
                  <label>
                    {ru ? "Адрес профиля" : "Profile address"}
                    <input
                      required
                      minLength={3}
                      maxLength={32}
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      value={draft.slug}
                      onChange={(event) => patch("slug", event.target.value.toLowerCase())}
                    />
                    <small>/u/{draft.slug}</small>
                  </label>
                  <label>
                    {ru ? "Коротко о себе" : "Headline"}
                    <input
                      maxLength={96}
                      value={draft.headline}
                      onChange={(event) => patch("headline", event.target.value)}
                    />
                  </label>
                  <label className="span-two">
                    {ru ? "О себе" : "About me"}
                    <textarea
                      maxLength={360}
                      rows={3}
                      value={draft.bio}
                      onChange={(event) => patch("bio", event.target.value)}
                    />
                  </label>
                </div>
                <div
                  className="profile-theme-options"
                  role="group"
                  aria-label={ru ? "Обложка профиля" : "Profile cover"}
                >
                  {(["DOSSIER", "NOIR", "SIGNAL"] as Theme[]).map((theme) => (
                    <button
                      type="button"
                      key={theme}
                      className={`theme-${theme.toLowerCase()}`}
                      aria-pressed={draft.theme === theme}
                      onClick={() => patch("theme", theme)}
                    >
                      <i aria-hidden="true" />
                      {theme === "DOSSIER"
                        ? ru
                          ? "Зелёный архив"
                          : "Green archive"
                        : theme === "NOIR"
                          ? ru
                            ? "Ночной город"
                            : "Night city"
                          : ru
                            ? "Сапфировый сигнал"
                            : "Sapphire signal"}
                    </button>
                  ))}
                </div>
                <details>
                  <summary>{ru ? "Ссылки на мои страницы" : "My social links"}</summary>
                  <div className="community-form-grid">
                    {["twitch", "youtube", "telegram", "discord"].map((key) => (
                      <label key={key}>
                        {key}
                        <input
                          type="url"
                          maxLength={240}
                          placeholder={
                            key === "telegram"
                              ? "https://t.me/username"
                              : key === "discord"
                                ? "https://discord.gg/invite"
                                : `https://${key}.com/username`
                          }
                          value={draft.links[key] || ""}
                          onChange={(event) =>
                            patch("links", { ...draft.links, [key]: event.target.value })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </details>
              </section>
              <section>
                <h2>{ru ? "Витрины" : "Showcases"}</h2>
                <details>
                  <summary>
                    {ru
                      ? `Закреплённые дела · ${selected.length}/3`
                      : `Pinned cases · ${selected.length}/3`}
                  </summary>
                  <p className="community-muted">
                    {ru
                      ? "Выберите до трёх. Без выбора показываем лучшие дела автоматически."
                      : "Choose up to three. Leave empty to feature your best cases automatically."}
                  </p>
                  <div className="profile-pin-list">
                    {(draft.available_contracts || []).map((item) => (
                      <label key={item.id} className="community-check">
                        <input
                          type="checkbox"
                          checked={selected.includes(item.id)}
                          disabled={!selected.includes(item.id) && selected.length === 3}
                          onChange={() =>
                            patch(
                              "pinned_contract_ids",
                              selected.includes(item.id)
                                ? selected.filter((id) => id !== item.id)
                                : [...selected, item.id],
                            )
                          }
                        />
                        <span>
                          {item.title_i18n?.[language] || item.title}
                          <small>
                            {dossierMode(item.mode)} · +{item.reward_xp} XP
                          </small>
                        </span>
                      </label>
                    ))}
                    {!draft.available_contracts?.length && (
                      <p>
                        {ru
                          ? "Здесь появятся ваши завершённые контракты с наградой."
                          : "Your completed, awarded contracts will appear here."}
                      </p>
                    )}
                  </div>
                </details>
                <h3>{ru ? "Порядок витрин" : "Showcase order"}</h3>
                <ol className="profile-module-order">
                  {draft.showcase_order.map((key, index) => (
                    <li key={key}>
                      <span>{names[key]}</span>
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`${ru ? "Поднять" : "Move up"}: ${names[key]}`}
                        onClick={() => {
                          const order = [...draft.showcase_order]
                          ;[order[index - 1], order[index]] = [order[index], order[index - 1]]
                          patch("showcase_order", order)
                        }}
                      >
                        <Icon name="arrow-up" size={16} />
                      </button>
                    </li>
                  ))}
                </ol>
                <label>
                  {ru ? "Главная награда" : "Featured award"}
                  <select
                    value={draft.featured_achievement || ""}
                    onChange={(event) => patch("featured_achievement", event.target.value || null)}
                  >
                    <option value="">{ru ? "Без главной награды" : "No featured award"}</option>
                    {draft.achievements
                      .filter((item) => item.earned)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title[language]}
                        </option>
                      ))}
                  </select>
                </label>
              </section>
              <section>
                <h2>{ru ? "Приватность" : "Privacy"}</h2>
                {(
                  [
                    ["is_public", ru ? "Опубликовать профиль" : "Publish profile"],
                    [
                      "show_stats",
                      ru
                        ? "Статистика и участие в рейтинге"
                        : "Stats and leaderboard participation",
                    ],
                    ["show_showcase", ru ? "Витрина контрактов" : "Contract showcase"],
                    [
                      "show_achievements",
                      ru ? "Печати (при открытой статистике)" : "Seals (with public stats)",
                    ],
                    [
                      "show_bureau",
                      ru
                        ? "Моё бюро и имя в его открытом составе"
                        : "My bureau and my name on its public roster",
                    ],
                    ["show_links", ru ? "Ссылки" : "Social links"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="community-check" key={key}>
                    <input
                      type="checkbox"
                      checked={draft[key]}
                      onChange={(event) => patch(key, event.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </section>
              {saveError && (
                <p className="community-error" role="alert">
                  {saveError}
                </p>
              )}
              <div className="community-actions profile-editor-actions">
                <button type="submit" className="dc-primary">
                  {saving
                    ? ru
                      ? "Сохраняем…"
                      : "Saving…"
                    : ru
                      ? "Сохранить профиль"
                      : "Save profile"}
                </button>
                <button type="button" className="dc-ghost" onClick={closeEditor}>
                  {ru ? "Отмена" : "Cancel"}
                </button>
                <button type="button" className="dc-ghost" onClick={() => setGuest(true)}>
                  {ru ? "Вид для гостя" : "Preview as visitor"}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      ) : (
        <>
          {guest && (
            <div className="profile-preview-note">
              <p>
                {ru
                  ? "Так выглядит профиль для посетителя после публикации."
                  : "This is how the profile looks to a visitor after publishing."}
              </p>
              <button
                type="button"
                ref={visitorHeading}
                className="dc-ghost"
                onClick={() => setGuest(false)}
              >
                {editing
                  ? ru
                    ? "Вернуться к редактированию"
                    : "Back to editing"
                  : ru
                    ? "Вернуться к профилю"
                    : "Back to profile"}
              </button>
            </div>
          )}
          <DossierView
            profile={guest ? visibleProfile(preview) : preview}
            onBureau={guest ? undefined : onBureau}
            onCollection={guest ? undefined : onCollection}
            toolbar={
              !guest && (
                <>
                  <button type="button" className="dc-primary" onClick={beginEdit}>
                    {ru ? "Редактировать профиль" : "Edit profile"}
                  </button>
                  <button type="button" className="dc-ghost" onClick={() => setGuest(true)}>
                    {ru ? "Вид для гостя" : "Preview as visitor"}
                  </button>
                  {publicUrl && (
                    <button
                      type="button"
                      className="dc-ghost"
                      aria-expanded={sharing}
                      aria-controls={sharing ? shareId : undefined}
                      onClick={() => {
                        setCopyStatus("")
                        setSharing(!sharing)
                      }}
                    >
                      {ru ? "Поделиться" : "Share"}
                    </button>
                  )}
                  <span className="profile-visibility">
                    {saved.is_public
                      ? ru
                        ? "Публичный профиль"
                        : "Public profile"
                      : ru
                        ? "Профиль скрыт"
                        : "Private profile"}
                  </span>
                  {sharing && publicUrl && (
                    <div id={shareId} className="dossier-share">
                      <label>
                        {ru ? "Ссылка на профиль" : "Profile link"}
                        <input ref={shareInput} readOnly value={shareUrl} />
                      </label>
                      <button type="button" className="dc-ghost" onClick={() => void copyLink()}>
                        {ru ? "Копировать ссылку" : "Copy link"}
                      </button>
                      <a className="dc-ghost" href={publicUrl}>
                        {ru ? "Открыть профиль" : "Open public profile"}
                      </a>
                      {copyStatus && <span role="status">{copyStatus}</span>}
                    </div>
                  )}
                </>
              )
            }
          />
        </>
      )}
    </section>
  )
}
