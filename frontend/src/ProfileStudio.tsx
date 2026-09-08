import { useEffect, useRef, useState } from "react"
import { useLanguage } from "./i18n"
import DossierView, { visibleProfile } from "./community/DossierView"
import { request, useResource } from "./community/api"
import { LoadState } from "./community/Shared"
import type { Module, Profile, Theme } from "./community/types"

type Props = {
  csrf: string
  onNotice: (value: string) => void
  onError: (value: string) => void
  onRefresh: () => Promise<void>
  onBureau: (slug: string) => void
}
export default function ProfileStudio({ csrf, onNotice, onError, onRefresh, onBureau }: Props) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const resource = useResource<{ profile: Profile | null; draft?: Profile }>("/api/profile/public")
  const [draft, setDraft] = useState<Profile | null>(null)
  const [editing, setEditing] = useState(false)
  const [guest, setGuest] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const editor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (resource.data) setDraft(resource.data.profile || resource.data.draft || null)
  }, [resource.data])
  if (resource.loading || resource.error || !draft)
    return <LoadState error={resource.error} retry={resource.reload} />
  const patch = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous))
  const names: Record<Module, string> = {
    contracts: ru ? "Дела" : "Cases",
    achievements: ru ? "Печати" : "Seals",
    bureau: ru ? "Бюро" : "Bureau",
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
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
      setDraft(result.profile)
      setEditing(false)
      onNotice(ru ? "Профиль сохранён" : "Profile saved")
    } catch (error) {
      onError((error as Error).message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const selected = draft.pinned_contract_ids || []
  const preview = {
    ...draft,
    showcase: selected.length
      ? selected
          .map(
            (id) =>
              (draft.available_contracts || []).find((item) => item.id === id) ||
              draft.showcase.find((item) => item.id === id),
          )
          .filter((item) => item !== undefined)
      : (draft.available_contracts || draft.showcase).slice(0, 3),
  }
  return (
    <section className="community-page profile-studio">
      <div className="profile-studio-heading">
        <p className="community-eyebrow">{ru ? "ВАШЕ ЛИЧНОЕ ДЕЛО" : "YOUR PERSONAL FILE"}</p>
        <span>
          {draft.is_public
            ? ru
              ? "Публичный профиль"
              : "Public profile"
            : ru
              ? "Профиль скрыт"
              : "Private profile"}
        </span>
      </div>
      {editing && (
        <div className="profile-editor" ref={editor}>
          <form onSubmit={(event) => void save(event)}>
            <div className="community-section-title">
              <h2>{ru ? "Оформление профиля" : "Profile settings"}</h2>
              <button
                type="button"
                className="dc-ghost"
                disabled={saving}
                onClick={() => {
                  setEditing(false)
                  resource.reload()
                }}
              >
                {ru ? "Отменить изменения" : "Discard changes"}
              </button>
            </div>
            <fieldset disabled={saving}>
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
                    <i />
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
              <div className="community-form-grid">
                <section>
                  <h3>{ru ? "Витрины и главная награда" : "Showcases and featured award"}</h3>
                  <ol className="profile-module-order">
                    {draft.showcase_order.map((key, index) => (
                      <li key={key}>
                        <span>
                          {index + 1}. {names[key]}
                        </span>
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
                          ↑
                        </button>
                      </li>
                    ))}
                  </ol>
                  <label>
                    {ru ? "Главная награда" : "Featured award"}
                    <select
                      value={draft.featured_achievement || ""}
                      onChange={(event) =>
                        patch("featured_achievement", event.target.value || null)
                      }
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
                  <h3>{ru ? "Кто видит мой профиль" : "Profile visibility"}</h3>
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
              </div>
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
                          {item.mode} · +{item.reward_xp} XP
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
              <div className="community-actions">
                <button type="submit" className="dc-primary">
                  {saving
                    ? ru
                      ? "Сохраняем…"
                      : "Saving…"
                    : ru
                      ? "Сохранить профиль"
                      : "Save profile"}
                </button>
                <span className="community-muted">
                  {ru ? "Ниже — предпросмотр оформления." : "Your design preview is below."}
                </span>
              </div>
            </fieldset>
          </form>
        </div>
      )}
      {guest && (
        <p className="profile-preview-note" role="status">
          {ru
            ? "Вид для посетителя после публикации. Несохранённые изменения видите только вы."
            : "Visitor preview after publishing. Only you can see unsaved changes."}
        </p>
      )}
      <DossierView
        profile={guest ? visibleProfile(preview) : preview}
        onBureau={onBureau}
        toolbar={
          <>
            <button
              className="dc-primary"
              onClick={() => {
                setEditing(!editing)
                window.scrollTo({ top: 0, behavior: "instant" })
              }}
            >
              {editing
                ? ru
                  ? "Закрыть редактор"
                  : "Close editor"
                : ru
                  ? "Редактировать профиль"
                  : "Edit profile"}
            </button>
            <button className="dc-ghost" aria-pressed={guest} onClick={() => setGuest(!guest)}>
              {guest
                ? ru
                  ? "Вернуться к своему виду"
                  : "Back to owner view"
                : ru
                  ? "Посмотреть глазами гостя"
                  : "Preview as visitor"}
            </button>
            <button
              className="dc-ghost"
              disabled={saving || editing}
              onClick={async () => {
                if (savingRef.current) return
                savingRef.current = true
                setSaving(true)
                try {
                  await onRefresh()
                  resource.reload()
                } catch (error) {
                  onError((error as Error).message)
                } finally {
                  setSaving(false)
                  savingRef.current = false
                }
              }}
            >
              {ru ? "Обновить из Steam" : "Refresh from Steam"}
            </button>
            {!editing && draft.public_url && (
              <a className="dc-ghost" href={draft.public_url}>
                {ru ? "Открыть публичный профиль ↗" : "Open public profile ↗"}
              </a>
            )}
          </>
        }
      />
    </section>
  )
}
