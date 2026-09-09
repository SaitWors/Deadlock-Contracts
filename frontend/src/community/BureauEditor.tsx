import { useRef, useState } from "react"
import Icon, { type IconName } from "../icons/Icon"
import { useLanguage } from "../i18n"
import { prepareImage } from "../image-upload"
import { appearanceOf, BureauHero } from "./BureauIdentity"
import type { BureauSettings, BureauSummary, BureauAppearance } from "./types"

const EMPTY_TITLES = { DIRECTOR: "", MODERATOR: "", OPERATIVE: "" }
const EMBLEMS: [BureauAppearance["emblem"], string, string][] = [
  ["compass", "Компас", "Compass"],
  ["swords", "Клинки", "Blades"],
  ["shield", "Щит", "Shield"],
  ["crown", "Корона", "Crown"],
  ["eye", "Глаз", "Eye"],
  ["moon", "Луна", "Moon"],
  ["feather", "Перо", "Feather"],
  ["flask-conical", "Колба", "Flask"],
  ["book-open", "Архив", "Archive"],
  ["handshake", "Союз", "Alliance"],
  ["gem", "Кристалл", "Gem"],
  ["building-2", "Город", "City"],
]
export default function BureauEditor({
  initial,
  create = false,
  busy,
  onSave,
  onCancel,
}: {
  initial: BureauSettings
  create?: boolean
  busy: boolean
  onSave: (value: BureauSettings) => void
  onCancel: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [draft, setDraft] = useState<BureauSettings>(() => ({
    ...initial,
    appearance: appearanceOf(initial),
    role_titles: { ...EMPTY_TITLES, ...initial.role_titles },
    listed: initial.listed ?? true,
    welcome: initial.welcome || "",
  }))
  const [section, setSection] = useState("basic")
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState("")
  const uploadGuard = useRef(false)
  const field = <K extends keyof BureauSettings>(key: K, value: BureauSettings[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }))
  const appearance = <K extends keyof BureauAppearance>(key: K, value: BureauAppearance[K]) =>
    setDraft((previous) => ({
      ...previous,
      appearance: { ...appearanceOf(previous), [key]: value },
    }))
  const style = appearanceOf(draft)
  const sections: [string, IconName, string, string][] = [
    [
      "basic",
      "file-text",
      ru ? "Основные" : "Basics",
      ru ? "Название, девиз и правила" : "Name, tagline & rules",
    ],
    [
      "appearance",
      "palette",
      ru ? "Оформление" : "Appearance",
      ru ? "Обложка, эмблема, цвета" : "Cover, emblem & colours",
    ],
    [
      "ranks",
      "crown",
      ru ? "Звания" : "Rank names",
      ru ? "Свой характер для состава" : "Give your roster an identity",
    ],
    [
      "privacy",
      "lock-keyhole",
      ru ? "Приём и приватность" : "Admission & privacy",
      ru ? "Набор и приветствие" : "Recruitment & welcome",
    ],
  ]
  const media = (kind: "avatar" | "cover") =>
    draft[`${kind}_image`] === "" ? null : draft[`${kind}_image`] || draft[`${kind}_url`] || null
  const preview: BureauSummary = {
    ...draft,
    slug: initial.slug || "your-bureau",
    member_count: 1,
    capacity: 25,
    avatar_url: media("avatar"),
    cover_url: media("cover"),
  }
  const upload = async (kind: "avatar" | "cover", file?: File) => {
    if (!file || uploadGuard.current) return
    uploadGuard.current = true
    setPreparing(true)
    setError("")
    try {
      field(`${kind}_image`, await prepareImage(file))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      uploadGuard.current = false
      setPreparing(false)
    }
  }
  return (
    <form
      className={`bureau-editor guild-editor accent-${style.accent.toLowerCase()} ${create ? "guild-create" : ""}`}
      onInvalidCapture={() => setSection("basic")}
      onSubmit={(event) => {
        event.preventDefault()
        if (preparing || busy) return
        const { avatar_url, cover_url, slug, ...payload } = draft
        if (create) {
          onSave({
            name: draft.name,
            slug: draft.slug,
            tagline: draft.tagline,
            description: draft.description,
            rules: draft.rules,
            language: draft.language,
            theme: draft.theme,
            recruitment: draft.recruitment,
          })
        } else
          onSave({
            ...payload,
            avatar_image: payload.avatar_image?.split(",").pop(),
            cover_image: payload.cover_image?.split(",").pop(),
          })
      }}
    >
      <header className="guild-editor-heading">
        <Icon name={create ? "plus" : "settings"} size={28} />
        <div>
          <h2>
            {create
              ? ru
                ? "Открыть своё бюро"
                : "Found your bureau"
              : ru
                ? "Настройки бюро"
                : "Bureau settings"}
          </h2>
          <p>
            {ru
              ? "Соберите место, которое ваши люди узнают с первого взгляда."
              : "Make a place your people will recognise at a glance."}
          </p>
        </div>
      </header>
      {error && (
        <p className="community-error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy || preparing}>
        {!create && (
          <nav
            className="guild-settings-nav"
            aria-label={ru ? "Разделы настроек бюро" : "Bureau settings sections"}
          >
            {sections.map(([id, icon, title, text]) => (
              <button
                type="button"
                key={id}
                aria-pressed={section === id}
                onClick={() => setSection(id)}
              >
                <Icon name={icon} size={24} />
                <span>
                  <b>{title}</b>
                  <small>{text}</small>
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            ))}
          </nav>
        )}
        <div className="guild-editor-body">
          <section hidden={section !== "basic"} className="guild-settings-panel">
            <h3>{ru ? "О вашем бюро" : "About your bureau"}</h3>
            <div className="community-form-grid">
              <label>
                {ru ? "Название · со словом Deadlock" : "Name · include the word Deadlock"}
                <input
                  required
                  minLength={10}
                  maxLength={64}
                  value={draft.name}
                  onChange={(e) => field("name", e.target.value)}
                />
              </label>
              {create && (
                <label>
                  {ru
                    ? "Адрес · латиница, цифры, дефис"
                    : "Address · lowercase letters, numbers, hyphens"}
                  <input
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    value={draft.slug || ""}
                    onChange={(e) => field("slug", e.target.value.toLowerCase())}
                  />
                </label>
              )}
              <label>
                {ru ? "Девиз" : "Tagline"}
                <input
                  maxLength={120}
                  value={draft.tagline}
                  onChange={(e) => field("tagline", e.target.value)}
                />
              </label>
              <label className="span-two">
                {ru ? "Описание бюро" : "Bureau description"}
                <textarea
                  rows={5}
                  maxLength={1200}
                  value={draft.description}
                  onChange={(e) => field("description", e.target.value)}
                />
              </label>
              <label className="span-two">
                {ru ? "Правила бюро" : "Bureau rules"}
                <textarea
                  rows={4}
                  maxLength={1200}
                  value={draft.rules}
                  onChange={(e) => field("rules", e.target.value)}
                />
              </label>
            </div>
            {create && (
              <p className="community-muted">
                {ru
                  ? "До 25 участников, одно бюро на игрока. После создания откроются оформление, свои звания и настройки набора. Первые заявки будут ждать вашего решения."
                  : "Up to 25 members, one bureau per player. After creation you can customise artwork, rank names and recruitment. Initial applications require your approval."}
              </p>
            )}
          </section>
          {!create && (
            <>
              <section hidden={section !== "appearance"} className="guild-settings-panel">
                <h3>{ru ? "Ваше оформление" : "Your visual identity"}</h3>
                <div className="guild-upload-grid">
                  {(["cover", "avatar"] as const).map((kind) => (
                    <div className="guild-upload" key={kind}>
                      <Icon name={kind === "cover" ? "images" : "user-round"} size={28} />
                      <label>
                        {kind === "cover"
                          ? ru
                            ? "Загрузить обложку"
                            : "Upload cover"
                          : ru
                            ? "Загрузить эмблему"
                            : "Upload emblem"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(e) => {
                            void upload(kind, e.target.files?.[0])
                            e.target.value = ""
                          }}
                        />
                      </label>
                      <small>
                        {kind === "cover"
                          ? ru
                            ? "Рекомендуем 1440 × 480 px"
                            : "Suggested: 1440 × 480 px"
                          : ru
                            ? "Рекомендуем 512 × 512 px"
                            : "Suggested: 512 × 512 px"}
                      </small>
                      {media(kind) && (
                        <button
                          type="button"
                          className="dc-ghost"
                          onClick={() => field(`${kind}_image`, "")}
                        >
                          <Icon name="x" size={16} />
                          {ru ? "Убрать изображение" : "Remove image"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="community-footnote">
                  {ru
                    ? "PNG, JPEG или WebP до 8 МБ. Файлы сжимаются перед отправкой. Используйте свои изображения или материалы с разрешением автора. Оформление видно посетителям страницы и в публичных профилях участников."
                    : "PNG, JPEG or WebP up to 8 MB. Files are compressed before upload. Use your own artwork or work you have permission to use. Artwork is visible to page visitors and in members’ public profiles."}
                </p>
                {media("cover") && (
                  <label>
                    {ru ? "Положение обложки" : "Cover position"}
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={style.cover_position}
                      onChange={(e) => appearance("cover_position", +e.target.value)}
                    />
                  </label>
                )}
                <fieldset className="guild-choice-group">
                  <legend>{ru ? "Акцентный цвет" : "Accent colour"}</legend>
                  <div className="guild-swatches">
                    {(
                      [
                        ["SAGE", "Шалфей", "Sage"],
                        ["BRASS", "Латунь", "Brass"],
                        ["OCEAN", "Океан", "Ocean"],
                        ["PLUM", "Слива", "Plum"],
                        ["EMBER", "Уголь и медь", "Ember"],
                      ] as const
                    ).map(([key, ruName, enName]) => (
                      <button
                        type="button"
                        className={`accent-${key.toLowerCase()}`}
                        key={key}
                        aria-pressed={style.accent === key}
                        onClick={() => appearance("accent", key)}
                      >
                        <span aria-hidden="true">
                          {style.accent === key && <Icon name="check" size={16} />}
                        </span>
                        {ru ? ruName : enName}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="guild-choice-group">
                  <legend>{ru ? "Фон без изображения" : "Cover without an image"}</legend>
                  <div className="guild-cover-options">
                    {(
                      [
                        ["AURORA", "Сияние", "Aurora"],
                        ["GRID", "Кварталы", "Districts"],
                        ["ARCHIVE", "Архив", "Archive"],
                        ["PLAIN", "Чистый", "Plain"],
                      ] as const
                    ).map(([key, ruName, enName]) => (
                      <button
                        type="button"
                        className={`cover-${key.toLowerCase()}`}
                        key={key}
                        aria-pressed={style.cover === key}
                        onClick={() => appearance("cover", key)}
                      >
                        {ru ? ruName : enName}
                        {style.cover === key && <Icon name="check" size={16} />}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="guild-choice-group">
                  <legend>{ru ? "Символ без изображения" : "Emblem without an image"}</legend>
                  <div className="guild-emblem-options">
                    {EMBLEMS.map(([key, ruName, enName]) => (
                      <button
                        type="button"
                        key={key}
                        aria-pressed={style.emblem === key}
                        onClick={() => appearance("emblem", key)}
                      >
                        <Icon name={key} size={24} />
                        <span>{ru ? ruName : enName}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="community-form-grid">
                  <label>
                    {ru ? "Форма эмблемы" : "Emblem shape"}
                    <select
                      value={style.avatar_shape}
                      onChange={(e) =>
                        appearance(
                          "avatar_shape",
                          e.target.value as BureauAppearance["avatar_shape"],
                        )
                      }
                    >
                      <option value="ROUNDED">
                        {ru ? "Скруглённый квадрат" : "Rounded square"}
                      </option>
                      <option value="CIRCLE">{ru ? "Круг" : "Circle"}</option>
                      <option value="SHIELD">{ru ? "Щит" : "Shield"}</option>
                    </select>
                  </label>
                  <label>
                    {ru ? "Вид состава" : "Roster layout"}
                    <select
                      value={style.roster_layout}
                      onChange={(e) =>
                        appearance(
                          "roster_layout",
                          e.target.value as BureauAppearance["roster_layout"],
                        )
                      }
                    >
                      <option value="CARDS">{ru ? "Карточки участников" : "Member cards"}</option>
                      <option value="LIST">{ru ? "Компактный список" : "Compact list"}</option>
                    </select>
                  </label>
                </div>
                <details className="guild-preview" open>
                  <summary>
                    {ru ? "Предпросмотр · пример состава" : "Preview · sample roster count"}
                  </summary>
                  <BureauHero item={preview} />
                </details>
              </section>
              <section hidden={section !== "ranks"} className="guild-settings-panel">
                <h3>{ru ? "Как обращаться к своим" : "Names for your people"}</h3>
                <p>
                  {ru
                    ? "Звания отображаются рядом с настоящей ролью. Они не дают новых прав на сайте. Пустое поле оставляет стандартное название."
                    : "Custom titles appear alongside the actual role. They grant no new site permissions. Leave a field empty to use its default name."}
                </p>
                <div className="guild-rank-fields">
                  {(
                    [
                      ["DIRECTOR", "Директор", "Director", "crown"],
                      ["MODERATOR", "Модератор бюро", "Bureau moderator", "shield-check"],
                      ["OPERATIVE", "Оперативник", "Operative", "user-round"],
                    ] as const
                  ).map(([key, ruName, enName, icon]) => (
                    <label key={key}>
                      <Icon name={icon} size={24} />
                      <span>
                        {ru ? ruName : enName}
                        <input
                          maxLength={24}
                          value={draft.role_titles?.[key] || ""}
                          placeholder={ru ? ruName : enName}
                          onChange={(e) =>
                            field("role_titles", {
                              ...EMPTY_TITLES,
                              ...draft.role_titles,
                              [key]: e.target.value,
                            })
                          }
                        />
                      </span>
                    </label>
                  ))}
                </div>
              </section>
              <section hidden={section !== "privacy"} className="guild-settings-panel">
                <h3>{ru ? "Кому здесь рады" : "Who can join"}</h3>
                <div className="community-form-grid">
                  <label>
                    {ru ? "Набор" : "Recruitment"}
                    <select
                      value={draft.recruitment}
                      onChange={(e) =>
                        field("recruitment", e.target.value as BureauSettings["recruitment"])
                      }
                    >
                      <option value="OPEN">
                        {ru ? "Свободное вступление" : "Open membership"}
                      </option>
                      <option value="APPLICATION">{ru ? "По заявкам" : "By application"}</option>
                      <option value="CLOSED">{ru ? "Закрыт" : "Closed"}</option>
                    </select>
                  </label>
                  <label>
                    {ru ? "Язык общения" : "Language"}
                    <select
                      value={draft.language}
                      onChange={(e) =>
                        field("language", e.target.value as BureauSettings["language"])
                      }
                    >
                      <option value="ru">Русский</option>
                      <option value="en">English</option>
                      <option value="any">{ru ? "Любой" : "Any"}</option>
                    </select>
                  </label>
                </div>
                <label className="community-check">
                  <input
                    type="checkbox"
                    checked={draft.listed}
                    onChange={(e) => field("listed", e.target.checked)}
                  />
                  {ru ? "Показывать бюро в каталоге" : "Show bureau in the directory"}
                </label>
                <p className="community-footnote">
                  {ru
                    ? "Скрытое из каталога бюро всё ещё доступно по прямой ссылке и через публичные профили. Имена в составе регулируются личными настройками участников."
                    : "An unlisted bureau remains accessible by direct link and through public profiles. Members’ personal settings control identity visibility in the roster."}
                </p>
                <label>
                  {ru ? "Приветствие · только для участников" : "Welcome message · members only"}
                  <textarea
                    rows={5}
                    maxLength={500}
                    value={draft.welcome}
                    onChange={(e) => field("welcome", e.target.value)}
                    placeholder={
                      ru
                        ? "Как собраться на игру, где общаемся, кому написать…"
                        : "Where to meet, how to find a game, who to contact…"
                    }
                  />
                </label>
              </section>
            </>
          )}
        </div>
        <footer className="guild-editor-footer">
          <p role="status">
            {preparing
              ? ru
                ? "Готовим изображение…"
                : "Preparing image…"
              : ru
                ? "Изменения появятся после сохранения"
                : "Changes go live after saving"}
          </p>
          <button className="dc-ghost" type="button" onClick={onCancel}>
            {ru ? "Отмена" : "Cancel"}
          </button>
          <button className="dc-primary" type="submit">
            <Icon name="check" size={18} />
            {busy
              ? ru
                ? "Сохраняем…"
                : "Saving…"
              : create
                ? ru
                  ? "Создать бюро"
                  : "Create bureau"
                : ru
                  ? "Сохранить"
                  : "Save"}
          </button>
        </footer>
      </fieldset>
    </form>
  )
}
