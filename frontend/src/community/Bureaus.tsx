import { useRef, useState } from "react"
import Regalia from "../regalia/Regalia"
import { useLanguage } from "../i18n"
import { request, useResource } from "./api"
import { LoadState, PageHead } from "./Shared"
import Operations from "./Operations"
import BureauSafety from "./BureauSafety"
import type { BureauSummary, Theme } from "./types"

type Settings = Pick<BureauSummary, "name" | "tagline" | "language" | "theme" | "recruitment"> & {
  description: string
  rules: string
}
type Member = {
  id: string | null
  display_name: string | null
  avatar_url: string | null
  profile_url: string | null
  role: string
  is_me: boolean
}
type Bureau = BureauSummary &
  Settings & {
    my_ban?: { reason: string } | null
    bans?: { id: string; display_name: string; reason: string }[]
    members: Member[]
    my_role: string | null
    can_manage: boolean
    can_edit: boolean
    application_pending: boolean
    applications: { id: string; display_name: string; message: string }[]
    journal: {
      action: string
      actor: string
      at: string
      data: { reason?: string; action?: string }
    }[]
  }
type Directory = {
  items: BureauSummary[]
  total: number
  my_bureau: BureauSummary | null
  pending_slugs: string[]
}
const EMPTY: Settings & { slug: string } = {
  name: "Deadlock ",
  slug: "",
  tagline: "",
  description: "",
  rules: "",
  language: "ru",
  theme: "DOSSIER",
  recruitment: "APPLICATION",
}
function BureauEditor({
  initial,
  create = false,
  busy,
  onSave,
  onCancel,
}: {
  initial: Settings & { slug?: string }
  create?: boolean
  busy: boolean
  onSave: (value: Settings & { slug?: string }) => void
  onCancel: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [draft, setDraft] = useState(initial)
  const field = (key: keyof typeof draft, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }))
  return (
    <form
      className="bureau-editor"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(draft)
      }}
    >
      <h2>
        {create
          ? ru
            ? "Открыть своё бюро"
            : "Found your bureau"
          : ru
            ? "Настройки бюро"
            : "Bureau settings"}
      </h2>
      <fieldset disabled={busy}>
        <div className="community-form-grid">
          <label>
            {ru ? "Название · со словом Deadlock" : "Name · include the word Deadlock"}
            <input
              required
              minLength={10}
              maxLength={64}
              value={draft.name}
              onChange={(event) => field("name", event.target.value)}
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
                onChange={(event) => field("slug", event.target.value.toLowerCase())}
              />
            </label>
          )}
          <label className="span-two">
            {ru ? "Девиз" : "Tagline"}
            <input
              maxLength={120}
              value={draft.tagline}
              onChange={(event) => field("tagline", event.target.value)}
            />
          </label>
          <label>
            {ru ? "О бюро" : "About the bureau"}
            <textarea
              rows={4}
              maxLength={1200}
              value={draft.description}
              onChange={(event) => field("description", event.target.value)}
            />
          </label>
          <label>
            {ru ? "Правила вступления" : "Membership rules"}
            <textarea
              rows={4}
              maxLength={1200}
              value={draft.rules}
              onChange={(event) => field("rules", event.target.value)}
            />
          </label>
          <label>
            {ru ? "Набор" : "Recruitment"}
            <select
              value={draft.recruitment}
              onChange={(event) => field("recruitment", event.target.value)}
            >
              <option value="OPEN">{ru ? "Свободное вступление" : "Open membership"}</option>
              <option value="APPLICATION">{ru ? "По заявкам" : "By application"}</option>
              <option value="CLOSED">{ru ? "Закрыт" : "Closed"}</option>
            </select>
          </label>
          <label>
            {ru ? "Язык общения" : "Language"}
            <select
              value={draft.language}
              onChange={(event) => field("language", event.target.value)}
            >
              <option value="ru">Русский</option>
              <option value="en">English</option>
              <option value="any">{ru ? "Любой" : "Any"}</option>
            </select>
          </label>
          <label>
            {ru ? "Обложка" : "Cover"}
            <select
              value={draft.theme}
              onChange={(event) => field("theme", event.target.value as Theme)}
            >
              <option value="DOSSIER">DOSSIER</option>
              <option value="NOIR">NOIR</option>
              <option value="SIGNAL">SIGNAL</option>
            </select>
          </label>
        </div>
        <p className="community-muted">
          {ru
            ? "До 25 участников. Одно бюро на игрока. Имена и аватары видны своим участникам; для остальных действуют настройки профиля."
            : "Up to 25 members. One bureau per player. Names and avatars are visible to fellow members; profile privacy applies to everyone else."}
        </p>
        <div className="community-actions">
          <button className="dc-primary" type="submit">
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
          <button className="dc-ghost" type="button" onClick={onCancel}>
            {ru ? "Отмена" : "Cancel"}
          </button>
        </div>
      </fieldset>
    </form>
  )
}

export default function Bureaus({
  csrf,
  slug,
  onSelect,
}: {
  csrf: string
  slug: string
  onSelect: (slug: string) => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const resource = useResource<Directory>(
    `/api/bureaus?q=${encodeURIComponent(search)}&offset=${offset}`,
  )
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const guard = useRef(false)
  const create = async (payload: Settings & { slug?: string }) => {
    if (guard.current) return
    guard.current = true
    setBusy(true)
    setError("")
    try {
      const result = await request<{ bureau: Bureau }>("/api/bureaus", csrf, {
        method: "POST",
        body: JSON.stringify(payload),
      })
      setCreating(false)
      resource.reload()
      onSelect(result.bureau.slug)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      guard.current = false
      setBusy(false)
    }
  }
  if (slug)
    return (
      <BureauDetail
        key={slug}
        slug={slug}
        csrf={csrf}
        myBureau={resource.data?.my_bureau || null}
        onBack={() => {
          onSelect("")
          resource.reload()
        }}
        onChanged={resource.reload}
      />
    )
  return (
    <section className="community-page">
      <PageHead
        number="04 / PLAYER BUREAUS"
        title={ru ? "Свои люди. Общее дело." : "Your people. A shared purpose."}
        text={
          ru
            ? "Найдите людей с похожим стилем игры или откройте собственное бюро. Город достаточно большой для всех."
            : "Find players who share your style, or establish your own bureau. There is room for everyone in this city."
        }
      >
        {resource.data?.my_bureau ? (
          <button className="dc-primary" onClick={() => onSelect(resource.data!.my_bureau!.slug)}>
            {ru ? "Моё бюро ↗" : "My bureau ↗"}
          </button>
        ) : (
          <button
            className="dc-primary"
            disabled={resource.loading || !!resource.error}
            onClick={() => setCreating(!creating)}
          >
            {ru ? "Основать бюро" : "Found a bureau"}
          </button>
        )}
      </PageHead>
      <BureauSafety />
      {error && (
        <p role="alert" className="community-error">
          {error}
        </p>
      )}
      {creating && (
        <BureauEditor
          initial={EMPTY}
          create
          busy={busy}
          onSave={(value) => void create(value)}
          onCancel={() => setCreating(false)}
        />
      )}
      <form
        className="bureau-search"
        onSubmit={(event) => {
          event.preventDefault()
          setOffset(0)
          setSearch(query)
        }}
      >
        <label htmlFor="bureau-search">{ru ? "Поиск бюро" : "Find a bureau"}</label>
        <div>
          <input
            id="bureau-search"
            maxLength={64}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ru ? "Название или адрес" : "Name or address"}
          />
          <button className="dc-ghost" type="submit">
            {ru ? "Найти" : "Search"}
          </button>
        </div>
      </form>
      {resource.loading || resource.error || !resource.data ? (
        <LoadState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          <div className="bureau-directory">
            {resource.data.items.map((item) => (
              <button
                key={item.slug}
                className={`bureau-directory-card theme-${item.theme.toLowerCase()}`}
                onClick={() => onSelect(item.slug)}
              >
                <div className="bureau-card-cover">
                  <Regalia id="seal-witness" />
                  <span>{item.language.toUpperCase()}</span>
                </div>
                <div className="bureau-card-copy">
                  <p className="community-eyebrow">
                    {resource.data?.my_bureau?.slug === item.slug
                      ? ru
                        ? "ВАШЕ БЮРО"
                        : "YOUR BUREAU"
                      : resource.data?.pending_slugs.includes(item.slug)
                        ? ru
                          ? "ЗАЯВКА ОТПРАВЛЕНА"
                          : "APPLICATION SENT"
                        : item.recruitment === "OPEN"
                          ? ru
                            ? "ОТКРЫТЫЙ НАБОР"
                            : "OPEN MEMBERSHIP"
                          : item.recruitment === "APPLICATION"
                            ? ru
                              ? "ПО ЗАЯВКАМ"
                              : "BY APPLICATION"
                            : ru
                              ? "НАБОР ЗАКРЫТ"
                              : "CLOSED"}
                  </p>
                  <h2>{item.name}</h2>
                  <p>
                    {item.tagline ||
                      (ru ? "Новое объединение оперативников" : "A new community of operatives")}
                  </p>
                  <footer>
                    <span>
                      {item.member_count} / {item.capacity} {ru ? "участников" : "members"}
                    </span>
                    <span>↗</span>
                  </footer>
                </div>
              </button>
            ))}
          </div>
          {!resource.data.items.length && (
            <div className="community-empty">
              <h2>
                {search
                  ? ru
                    ? "Бюро не найдено"
                    : "No bureau found"
                  : ru
                    ? "Первая вывеска может быть вашей"
                    : "The first sign could be yours"}
              </h2>
              <p>
                {search
                  ? ru
                    ? "Попробуйте другое название."
                    : "Try another name."
                  : ru
                    ? "Основать бюро можно уже сейчас."
                    : "You can found a bureau today."}
              </p>
            </div>
          )}
          <div className="community-pagination">
            <button
              className="dc-ghost"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 24))}
            >
              {ru ? "Назад" : "Previous"}
            </button>
            <span>
              {resource.data.total
                ? `${offset + 1}–${Math.min(offset + 24, resource.data.total)} / ${resource.data.total}`
                : "0"}
            </span>
            <button
              className="dc-ghost"
              disabled={offset + 24 >= resource.data.total}
              onClick={() => setOffset(offset + 24)}
            >
              {ru ? "Дальше" : "Next"}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function BureauDetail({
  slug,
  csrf,
  myBureau,
  onBack,
  onChanged,
}: {
  slug: string
  csrf: string
  myBureau: BureauSummary | null
  onBack: () => void
  onChanged: () => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const resource = useResource<{ bureau: Bureau }>(`/api/bureaus/${encodeURIComponent(slug)}`)
  const [busy, setBusy] = useState(false)
  const guard = useRef(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [editing, setEditing] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [message, setMessage] = useState("")
  const [reason, setReason] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [liftBan, setLiftBan] = useState("")
  const [memberAction, setMemberAction] = useState<{ member: Member; action: string } | null>(null)
  const roles: Record<string, string> = {
    DIRECTOR: ru ? "Директор" : "Director",
    MODERATOR: ru ? "Модератор бюро" : "Bureau moderator",
    OPERATIVE: ru ? "Оперативник" : "Operative",
  }
  const actionNames: Record<string, string> = {
    PROMOTE: ru ? "Назначить модератором" : "Make moderator",
    DEMOTE: ru ? "Снять полномочия" : "Remove moderator role",
    BAN: ru ? "Исключить и запретить вступление" : "Remove and ban rejoining",
    REMOVE: ru ? "Исключить" : "Remove member",
    TRANSFER: ru ? "Передать руководство" : "Transfer leadership",
    FREEZE: ru ? "Бюро приостановлено" : "Bureau paused",
    RESTORE: ru ? "Бюро восстановлено" : "Bureau restored",
    WARN: ru ? "Предупреждение бюро" : "Bureau warning",
    LIFT_BAN: ru ? "Запрет вступления снят" : "Membership ban lifted",
  }
  const mutate = async (path: string, body: unknown = {}, method = "POST") => {
    if (guard.current) return
    guard.current = true
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const result = await request<{ bureau?: Bureau; deleted?: boolean; left?: boolean }>(
        `/api/bureaus/${encodeURIComponent(slug)}${path}`,
        csrf,
        { method, body: JSON.stringify(body) },
      )
      if (result.deleted || result.left) {
        onBack()
        return
      }
      if (result.bureau) resource.setData({ bureau: result.bureau })
      setEditing(false)
      setMemberAction(null)
      setLiftBan("")
      setReason("")
      setNotice(ru ? "Изменения сохранены" : "Changes saved")
      onChanged()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      guard.current = false
      setBusy(false)
    }
  }
  const bureau = resource.data?.bureau
  const otherBureau = myBureau && myBureau.slug !== slug
  return (
    <section className="community-page bureau-detail">
      <button className="community-back" onClick={onBack}>
        ← {ru ? "Все бюро" : "All bureaus"}
      </button>
      {resource.loading || resource.error || !bureau ? (
        <LoadState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          <div className={`bureau-detail-cover theme-${bureau.theme.toLowerCase()}`}>
            <Regalia id="seal-witness" />
            <div>
              <p className="community-eyebrow">
                {ru ? "БЮРО ИГРОКОВ" : "PLAYER BUREAU"} / {bureau.language.toUpperCase()}
              </p>
              <h1>{bureau.name}</h1>
              <p>{bureau.tagline}</p>
              <span>
                {bureau.member_count} / {bureau.capacity} {ru ? "участников" : "members"}
              </span>
            </div>
          </div>
          {error && (
            <p role="alert" className="community-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="community-notice">
              {notice}
            </p>
          )}
          <div className="community-actions">
            {bureau.my_role && <span className="bureau-role">{roles[bureau.my_role]}</span>}
            {bureau.can_edit && (
              <button className="dc-ghost" onClick={() => setEditing(!editing)}>
                {ru ? "Настроить бюро" : "Bureau settings"}
              </button>
            )}
          </div>
          {bureau.moderation_note && (
            <p role="status" className="community-error">
              {bureau.status === "FROZEN"
                ? ru
                  ? "Работа бюро приостановлена. "
                  : "Bureau paused. "
                : ""}
              {bureau.moderation_note}
            </p>
          )}
          <BureauSafety
            slug={slug}
            csrf={csrf}
            banned={!!bureau.my_ban}
            appeal={bureau.can_edit && bureau.status === "FROZEN"}
          />
          {bureau.my_role && (
            <Operations
              slug={slug}
              csrf={csrf}
              manager={bureau.can_manage}
              director={bureau.can_edit}
              frozen={bureau.status === "FROZEN"}
            />
          )}
          {editing && (
            <BureauEditor
              initial={{
                name: bureau.name,
                tagline: bureau.tagline,
                description: bureau.description,
                rules: bureau.rules,
                language: bureau.language,
                theme: bureau.theme,
                recruitment: bureau.recruitment,
              }}
              busy={busy}
              onSave={(value) => void mutate("", value, "PUT")}
              onCancel={() => setEditing(false)}
            />
          )}
          <div className="bureau-content-grid">
            <div>
              <section className="community-panel">
                <h2>{ru ? "Наше дело" : "Our purpose"}</h2>
                <p className="community-prose">
                  {bureau.description ||
                    (ru
                      ? "История этого бюро только начинается."
                      : "This bureau's story is just beginning.")}
                </p>
                <h3>{ru ? "Правила бюро" : "Bureau rules"}</h3>
                <p className="community-prose">
                  {bureau.rules ||
                    (ru
                      ? "Уважайте друг друга и правила сообщества."
                      : "Respect each other and the community rules.")}
                </p>
              </section>
              <section className="community-panel">
                <h2>
                  {ru ? "Состав бюро" : "Bureau roster"} <small>{bureau.member_count}</small>
                </h2>
                <ul className="bureau-members">
                  {bureau.members.map((member, index) => (
                    <li key={member.id || index}>
                      {member.avatar_url ? (
                        <img src={member.avatar_url} alt="" />
                      ) : (
                        <span className="community-avatar">DC</span>
                      )}
                      <div>
                        {member.profile_url ? (
                          <a href={member.profile_url}>{member.display_name}</a>
                        ) : (
                          <b>
                            {member.display_name || (ru ? "Скрытый профиль" : "Private profile")}
                          </b>
                        )}
                        <small>
                          {roles[member.role]}
                          {member.is_me ? (ru ? " · ВЫ" : " · YOU") : ""}
                        </small>
                      </div>
                      {bureau.can_manage &&
                        !member.is_me &&
                        member.role !== "DIRECTOR" &&
                        (bureau.can_edit || member.role === "OPERATIVE") && (
                          <select
                            aria-label={`${ru ? "Действие с участником" : "Member action"}: ${member.display_name}`}
                            disabled={busy}
                            value=""
                            onChange={(event) =>
                              setMemberAction({ member, action: event.target.value })
                            }
                          >
                            <option value="">{ru ? "Управление" : "Manage"}</option>
                            {bureau.can_edit && (
                              <>
                                <option value={member.role === "MODERATOR" ? "DEMOTE" : "PROMOTE"}>
                                  {actionNames[member.role === "MODERATOR" ? "DEMOTE" : "PROMOTE"]}
                                </option>
                                <option value="TRANSFER">{actionNames.TRANSFER}</option>
                              </>
                            )}
                            <option value="REMOVE">{actionNames.REMOVE}</option>
                            <option value="BAN">{actionNames.BAN}</option>
                          </select>
                        )}
                    </li>
                  ))}
                </ul>
                {!bureau.my_role && (
                  <p className="community-footnote">
                    {ru
                      ? "Скрытые профили видны только участникам бюро."
                      : "Private profiles are visible only to fellow bureau members."}
                  </p>
                )}
              </section>
              {memberAction && (
                <form
                  className="community-panel bureau-action-panel"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void mutate(`/members/${memberAction.member.id}`, {
                      action: memberAction.action,
                      reason,
                    })
                  }}
                >
                  <h3>
                    {actionNames[memberAction.action]}: {memberAction.member.display_name}
                  </h3>
                  {memberAction.action === "TRANSFER" && (
                    <p>
                      {ru
                        ? "Вы передадите управление бюро этому игроку и станете оперативником."
                        : "This player will take over the bureau. You will become an operative."}
                    </p>
                  )}
                  {["REMOVE", "BAN"].includes(memberAction.action) && (
                    <label>
                      {ru
                        ? "Причина · при блокировке также видна игроку"
                        : "Reason · also visible to the player when banned"}
                      <textarea
                        required
                        minLength={3}
                        maxLength={300}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                  )}
                  <div className="community-actions">
                    <button className="dc-primary" disabled={busy}>
                      {ru ? "Подтвердить действие" : "Confirm action"}
                    </button>
                    <button
                      type="button"
                      className="dc-ghost"
                      disabled={busy}
                      onClick={() => setMemberAction(null)}
                    >
                      {ru ? "Отмена" : "Cancel"}
                    </button>
                  </div>
                </form>
              )}
              {bureau.can_manage && (
                <section className="community-panel">
                  <h2>
                    {ru ? "Заявки на вступление" : "Membership applications"}{" "}
                    <small>{bureau.applications.length}</small>
                  </h2>
                  {bureau.applications.length ? (
                    bureau.applications.map((item) => (
                      <article className="bureau-application" key={item.id}>
                        <h3>{item.display_name}</h3>
                        <p className="community-prose">
                          {item.message || (ru ? "Без сообщения" : "No message")}
                        </p>
                        <div className="community-actions">
                          <button
                            disabled={
                              busy ||
                              bureau.status === "FROZEN" ||
                              bureau.member_count >= bureau.capacity
                            }
                            className="dc-primary"
                            onClick={() =>
                              void mutate(`/applications/${item.id}`, { decision: "ACCEPT" })
                            }
                          >
                            {ru ? "Принять" : "Accept"}
                          </button>
                          <button
                            disabled={busy}
                            className="dc-ghost"
                            onClick={() =>
                              void mutate(`/applications/${item.id}`, { decision: "REJECT" })
                            }
                          >
                            {ru ? "Отклонить" : "Decline"}
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="community-muted">
                      {ru ? "Новых заявок пока нет." : "No pending applications."}
                    </p>
                  )}
                </section>
              )}
            </div>
            <aside>
              <section className="community-panel bureau-join">
                <p className="community-eyebrow">{ru ? "ПРИЁМНАЯ" : "RECEPTION"}</p>
                <h2>
                  {bureau.my_role
                    ? ru
                      ? "Вы среди своих"
                      : "You belong here"
                    : bureau.recruitment === "CLOSED"
                      ? ru
                        ? "Набор закрыт"
                        : "Recruitment closed"
                      : ru
                        ? "Присоединиться к бюро"
                        : "Join this bureau"}
                </h2>
                {bureau.my_role ? (
                  <p>
                    {ru
                      ? "Ваши контракты и достижения остаются вашими. Бюро не меняет награды и результаты."
                      : "Your contracts and achievements stay yours. The bureau cannot change rewards or results."}
                  </p>
                ) : bureau.my_ban ? (
                  <p className="community-error">
                    {ru ? "Вступление заблокировано: " : "Membership banned: "}
                    {bureau.my_ban.reason}{" "}
                    {ru
                      ? "Апелляцию можно отправить через форму выше."
                      : "You can appeal using the form above."}
                  </p>
                ) : bureau.application_pending ? (
                  <>
                    <p>
                      {ru
                        ? "Заявка отправлена. Руководство рассмотрит её в приёмной бюро."
                        : "Application sent. Bureau management will review it here."}
                    </p>
                    <button
                      disabled={busy}
                      className="dc-ghost"
                      onClick={() => void mutate("/application", {}, "DELETE")}
                    >
                      {ru ? "Отозвать заявку" : "Withdraw application"}
                    </button>
                  </>
                ) : otherBureau ? (
                  <p>
                    {ru
                      ? "Вы уже состоите в другом бюро. Сначала покиньте его."
                      : "You already belong to another bureau. Leave it before joining."}
                  </p>
                ) : bureau.recruitment !== "CLOSED" && bureau.member_count < bureau.capacity ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void mutate("/join", { agree_rules: agreed, message })
                    }}
                  >
                    {bureau.recruitment === "APPLICATION" && (
                      <label>
                        {ru ? "Несколько слов о себе" : "A few words about yourself"}
                        <textarea
                          rows={3}
                          maxLength={500}
                          value={message}
                          onChange={(event) => setMessage(event.target.value)}
                        />
                      </label>
                    )}
                    <p className="community-footnote">
                      {ru
                        ? "После вступления участники увидят ваше имя Steam и аватар. В открытом составе имя видно только с вашего согласия в профиле."
                        : "After joining, members can see your Steam name and avatar. Your name appears on the public roster only if enabled in your profile."}
                    </p>
                    <label className="community-check">
                      <input
                        type="checkbox"
                        required
                        checked={agreed}
                        onChange={(event) => setAgreed(event.target.checked)}
                      />
                      {ru ? "Принимаю правила бюро" : "I agree to the bureau rules"}
                    </label>
                    <button className="dc-primary" disabled={busy || !agreed}>
                      {bureau.recruitment === "OPEN"
                        ? ru
                          ? "Вступить в бюро"
                          : "Join bureau"
                        : ru
                          ? "Отправить заявку"
                          : "Send application"}
                    </button>
                  </form>
                ) : (
                  <p>
                    {bureau.member_count >= bureau.capacity
                      ? ru
                        ? "Сейчас все места заняты."
                        : "All places are currently filled."
                      : ru
                        ? "Загляните позже: приём может открыться снова."
                        : "Check back later: recruitment may reopen."}
                  </p>
                )}
              </section>
              {bureau.my_role && bureau.my_role !== "DIRECTOR" && (
                <details className="community-panel">
                  <summary>{ru ? "Покинуть бюро" : "Leave bureau"}</summary>
                  <p>
                    {ru
                      ? "Вы выйдете из состава. Контракты и достижения сохранятся."
                      : "You will leave the roster. Your contracts and achievements remain."}
                  </p>
                  <button
                    className="dc-ghost"
                    disabled={busy}
                    onClick={() => void mutate("/leave")}
                  >
                    {ru ? "Подтвердить выход" : "Confirm leave"}
                  </button>
                </details>
              )}
              {bureau.can_edit && (
                <details className="community-panel">
                  <summary>{ru ? "Распустить бюро" : "Disband bureau"}</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void mutate("", { confirmation }, "DELETE")
                    }}
                  >
                    <p>
                      {ru
                        ? "Состав, заявки и страница бюро будут удалены. Для выхода с сохранением бюро передайте руководство участнику."
                        : "The roster, applications and bureau page will be deleted. Transfer leadership to leave while keeping the bureau."}
                    </p>
                    <label>
                      {ru ? `Введите ${bureau.slug}` : `Type ${bureau.slug}`}
                      <input
                        required
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                      />
                    </label>
                    <button className="dc-ghost" disabled={busy || confirmation !== bureau.slug}>
                      {ru ? "Распустить окончательно" : "Disband permanently"}
                    </button>
                  </form>
                </details>
              )}
              {bureau.can_manage && !!bureau.bans?.length && (
                <details className="community-panel">
                  <summary>{ru ? "Запреты вступления" : "Membership bans"}</summary>
                  {bureau.bans.map((ban) => (
                    <article className="bureau-application" key={ban.id}>
                      <b>{ban.display_name}</b>
                      <p className="community-prose">{ban.reason}</p>
                      {bureau.can_edit && (
                        <button
                          className="dc-ghost"
                          disabled={busy}
                          onClick={() => {
                            setLiftBan(ban.id)
                            setReason("")
                          }}
                        >
                          {ru ? "Снять блокировку…" : "Lift ban…"}
                        </button>
                      )}
                    </article>
                  ))}
                  {liftBan && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        void mutate(`/bans/${liftBan}/lift`, { reason })
                      }}
                    >
                      <label>
                        {ru ? "Причина снятия" : "Reason for lifting"}
                        <textarea
                          required
                          minLength={3}
                          maxLength={300}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                      <div className="community-actions">
                        <button className="dc-primary" disabled={busy}>
                          {ru ? "Подтвердить снятие" : "Confirm lifting"}
                        </button>
                        <button
                          type="button"
                          className="dc-ghost"
                          disabled={busy}
                          onClick={() => setLiftBan("")}
                        >
                          {ru ? "Отмена" : "Cancel"}
                        </button>
                      </div>
                    </form>
                  )}
                </details>
              )}
              {bureau.can_manage && (
                <details className="community-panel">
                  <summary>{ru ? "Журнал управления" : "Management log"}</summary>
                  <ul className="bureau-journal">
                    {bureau.journal.map((item, index) => (
                      <li key={index}>
                        <b>{item.actor}</b>
                        <span>
                          {item.data.action
                            ? actionNames[item.data.action]
                            : (
                                {
                                  "bureau.operation_started": ru
                                    ? "Начал совместную операцию"
                                    : "Started a joint operation",
                                  "bureau.operation_cancelled": ru
                                    ? "Отменил операцию"
                                    : "Cancelled an operation",
                                  "bureau.ban_lifted": ru
                                    ? "Снял запрет вступления"
                                    : "Lifted a membership ban",
                                  "bureau.created": ru ? "Основал бюро" : "Founded bureau",
                                  "bureau.updated": ru ? "Изменил настройки" : "Updated settings",
                                  "bureau.joined": ru ? "Вступил в бюро" : "Joined bureau",
                                  "bureau.left": ru ? "Покинул бюро" : "Left bureau",
                                  "bureau.applied": ru ? "Подал заявку" : "Applied",
                                  "bureau.application_decided": ru
                                    ? "Рассмотрел заявку"
                                    : "Reviewed application",
                                } as Record<string, string>
                              )[item.action] || (ru ? "Изменение состава" : "Roster updated")}
                        </span>
                        {item.data.reason && <p>{item.data.reason}</p>}
                        <small>{new Date(item.at).toLocaleString(locale)}</small>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  )
}
