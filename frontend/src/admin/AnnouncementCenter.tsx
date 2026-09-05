import { useCallback, useEffect, useMemo, useState } from "react"
import {
  cancelAnnouncement,
  changeAnnouncementEndTime,
  createAnnouncement,
  duplicateAnnouncement,
  getAnnouncement,
  getAnnouncementMetrics,
  listAnnouncements,
  publishAnnouncement,
  replaceAnnouncement,
  updateAnnouncement,
} from "./announcement-api"
import type {
  AdminAnnouncement,
  AdminAnnouncementDraft,
  AnnouncementAudience,
  AnnouncementListResponse,
  AnnouncementMetrics,
  AnnouncementPhase,
  AnnouncementSurface,
} from "./announcement-types"
import "./announcement-center.css"

const SEVERITIES: AdminAnnouncementDraft["severity"][] = [
  "INFO",
  "SUCCESS",
  "WARNING",
  "MAINTENANCE",
  "CRITICAL",
  "EVENT",
]
const PRESENTATIONS: AdminAnnouncementDraft["presentation"][] = ["BANNER", "TOAST", "MODAL"]
const EFFECTS: AdminAnnouncementDraft["effect"][] = [
  "NONE",
  "FADE_SLIDE",
  "STAMP_IN",
  "SOFT_GLOW",
  "SCANLINE_ONCE",
  "CONFETTI_ONCE",
]
const DISMISS_POLICIES: AdminAnnouncementDraft["dismiss_policy"][] = [
  "DISMISSIBLE",
  "ACK_REQUIRED",
  "NON_DISMISSIBLE",
]
const SURFACES: AnnouncementSurface[] = [
  "SITE_PUBLIC",
  "SITE_DASHBOARD",
  "COMPANION_DESKTOP",
  "COMPANION_OVERLAY",
]
const AUDIENCES: AnnouncementAudience[] = [
  "ALL",
  "ANONYMOUS",
  "AUTHENTICATED",
  "PLAYERS",
  "TESTERS",
  "STAFF",
]
const PHASES: Array<"ALL" | AnnouncementPhase> = [
  "ALL",
  "ACTIVE",
  "SCHEDULED",
  "DRAFT",
  "EXPIRED",
  "CANCELLED",
  "ARCHIVED",
]

function emptyDraft(): AdminAnnouncementDraft {
  return {
    severity: "INFO",
    presentation: "BANNER",
    effect: "NONE",
    dismiss_policy: "DISMISSIBLE",
    title_ru: "",
    body_ru: "",
    title_en: "",
    body_en: "",
    cta_label_ru: "",
    cta_label_en: "",
    cta_url: "",
    surfaces: ["SITE_DASHBOARD"],
    audiences: ["STAFF"],
    priority: 50,
    show_countdown: false,
  }
}

function draftFrom(item: AdminAnnouncement): AdminAnnouncementDraft {
  return {
    severity: item.severity,
    presentation: item.presentation,
    effect: item.effect,
    dismiss_policy: item.dismiss_policy,
    title_ru: item.title_ru || "",
    body_ru: item.body_ru || "",
    title_en: item.title_en || "",
    body_en: item.body_en || "",
    cta_label_ru: item.cta_label_ru || "",
    cta_label_en: item.cta_label_en || "",
    cta_url: item.cta_url || "",
    surfaces: item.surfaces,
    audiences: item.audiences,
    priority: item.priority,
    show_countdown: item.show_countdown,
  }
}

function localInput(value: string | null, fallbackHours: number) {
  const date = value ? new Date(value) : new Date(Date.now() + fallbackHours * 3_600_000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function toIso(value: string) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ""
}

function fmt(value: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—"
}

function hasPermission(permissions: string[], permission: string) {
  return permissions.includes("*") || permissions.includes(permission)
}

function phaseLabel(phase: string) {
  const labels: Record<string, string> = {
    DRAFT: "Черновик",
    SCHEDULED: "Запланировано",
    ACTIVE: "Активно",
    EXPIRED: "Истекло",
    CANCELLED: "Отменено",
    ARCHIVED: "Архив",
  }
  return labels[phase] || phase
}

function durationText(start: string, end: string) {
  const duration = Date.parse(end) - Date.parse(start)
  if (!Number.isFinite(duration) || duration <= 0) return "Некорректный интервал"
  const hours = duration / 3_600_000
  return hours < 48 ? `${hours.toFixed(hours % 1 ? 1 : 0)} ч` : `${(hours / 24).toFixed(1)} дн`
}

export default function AnnouncementCenter({
  csrf,
  permissions,
  setError,
  setNotice,
}: {
  csrf: string
  permissions: string[]
  setError: (value: string) => void
  setNotice: (value: string) => void
}) {
  const [data, setData] = useState<AnnouncementListResponse | null>(null)
  const [phase, setPhase] = useState("ALL")
  const [severity, setSeverity] = useState("ALL")
  const [surface, setSurface] = useState("ALL")
  const [author, setAuthor] = useState("")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<AdminAnnouncement | null>(null)
  const [draft, setDraft] = useState<AdminAnnouncementDraft>(emptyDraft)
  const [startsAt, setStartsAt] = useState(() => localInput(null, 0))
  const [endsAt, setEndsAt] = useState(() => localInput(null, 4))
  const [reason, setReason] = useState("")
  const [confirmText, setConfirmText] = useState("")
  const [previewLocale, setPreviewLocale] = useState<"ru" | "en">("ru")
  const [previewDevice, setPreviewDevice] = useState<
    "desktop" | "mobile" | "companion" | "overlay"
  >("desktop")
  const [reducedMotion, setReducedMotion] = useState(false)
  const [metrics, setMetrics] = useState<AnnouncementMetrics | null>(null)
  const [busy, setBusy] = useState(false)

  const canManage = hasPermission(permissions, "announcements.drafts.manage")
  const canPublish = hasPermission(permissions, "announcements.publish")
  const canCancel = hasPermission(permissions, "announcements.cancel")
  const canReadMetrics = hasPermission(permissions, "announcements.metrics.read")
  const locked = Boolean(selected && selected.status !== "DRAFT")
  const draftDirty = Boolean(
    selected && JSON.stringify(draft) !== JSON.stringify(draftFrom(selected)),
  )
  const hasUnsavedDraft = selected
    ? draftDirty
    : JSON.stringify(draft) !== JSON.stringify(emptyDraft())

  const load = useCallback(async () => {
    try {
      setData(await listAnnouncements(csrf, { phase, severity, surface, author, query }))
    } catch (error) {
      setError((error as Error).message)
    }
  }, [author, csrf, phase, query, setError, severity, surface])

  useEffect(() => {
    void load()
  }, [load])

  const choose = useCallback((item: AdminAnnouncement) => {
    setSelected(item)
    setDraft(draftFrom(item))
    setStartsAt(localInput(item.starts_at, 0))
    setEndsAt(localInput(item.ends_at, 4))
    setReason("")
    setConfirmText("")
    setMetrics(null)
  }, [])

  useEffect(() => {
    const match = window.location.pathname.match(
      /^\/admin\/announcements\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i,
    )
    if (!match) return
    let active = true
    void getAnnouncement(csrf, match[1])
      .then((response) => {
        if (active) choose(response.item)
      })
      .catch((error) => {
        if (active) setError((error as Error).message)
      })
    return () => {
      active = false
    }
  }, [choose, csrf, setError])

  const startNew = () => {
    if (
      hasUnsavedDraft &&
      !window.confirm("Несохранённые изменения будут потеряны. Создать новый черновик?")
    ) {
      return
    }
    setSelected(null)
    setDraft(emptyDraft())
    setStartsAt(localInput(null, 0))
    setEndsAt(localInput(null, 4))
    setReason("")
    setConfirmText("")
    setMetrics(null)
  }

  const save = async () => {
    if (!canManage || locked) return
    if (selected && !draftDirty) return
    if (draft.title_ru.trim().length < 3 || draft.body_ru.trim().length < 3) {
      setError("Русские заголовок и текст должны содержать минимум 3 символа.")
      return
    }
    setBusy(true)
    try {
      const response = selected
        ? await updateAnnouncement(csrf, selected, draft)
        : await createAnnouncement(csrf, draft)
      choose(response.item)
      setNotice(selected ? "Черновик сохранён." : "Черновик создан.")
      await load()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const publicationInput = () => {
    const starts_at = toIso(startsAt)
    const ends_at = toIso(endsAt)
    if (!starts_at || !ends_at || Date.parse(ends_at) <= Date.parse(starts_at)) {
      setError("Окончание показа должно быть позже начала.")
      return null
    }
    if (reason.trim().length < 3) {
      setError("Укажите причину публикации минимум из 3 символов.")
      return null
    }
    if (confirmText !== "PUBLISH") {
      setError("Для публикации введите PUBLISH.")
      return null
    }
    return { starts_at, ends_at, reason: reason.trim() }
  }

  const publish = async (asReplacement: boolean) => {
    if (!selected || selected.status !== "DRAFT" || !canPublish) return
    if (draftDirty) {
      setError("Сначала сохраните изменения черновика, затем публикуйте проверенную версию.")
      return
    }
    const input = publicationInput()
    if (!input) return
    setBusy(true)
    try {
      if (asReplacement) {
        const previous = selected.supersedes_id
          ? (await getAnnouncement(csrf, selected.supersedes_id)).item
          : null
        if (!previous || previous.status !== "PUBLISHED") {
          setError("Исходное опубликованное уведомление не найдено в текущем списке.")
          return
        }
        const response = await replaceAnnouncement(csrf, previous, selected, input)
        choose(response.replacement)
        setNotice("Старое уведомление отменено, исправленная версия опубликована.")
      } else {
        const response = await publishAnnouncement(csrf, selected, input)
        choose(response.item)
        setNotice("Уведомление опубликовано или поставлено в расписание.")
      }
      await load()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!selected || selected.status !== "PUBLISHED" || !canCancel) return
    if (reason.trim().length < 3) {
      setError("Укажите причину отмены минимум из 3 символов.")
      return
    }
    if (!window.confirm(`Отменить «${selected.title_ru}» немедленно?`)) return
    setBusy(true)
    try {
      const response = await cancelAnnouncement(csrf, selected, reason.trim())
      choose(response.item)
      setNotice("Уведомление отменено.")
      await load()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const duplicate = async () => {
    if (!selected || !canManage) return
    setBusy(true)
    try {
      const response = await duplicateAnnouncement(csrf, selected)
      choose(response.item)
      setNotice("Создана редактируемая копия. После проверки её можно опубликовать как замену.")
      await load()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const changeEnd = async () => {
    if (!selected || selected.status !== "PUBLISHED" || !canCancel) return
    const ends_at = toIso(endsAt)
    if (!ends_at || reason.trim().length < 3) {
      setError("Проверьте новое окончание и укажите причину.")
      return
    }
    setBusy(true)
    try {
      const response = await changeAnnouncementEndTime(csrf, selected, ends_at, reason.trim())
      choose(response.item)
      setNotice("Время окончания изменено.")
      await load()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const loadMetrics = async () => {
    if (!selected || !canReadMetrics) return
    try {
      setMetrics(await getAnnouncementMetrics(csrf, selected.id))
    } catch (error) {
      setError((error as Error).message)
    }
  }

  const toggleSurface = (value: AnnouncementSurface) => {
    setDraft((current) => ({
      ...current,
      surfaces: current.surfaces.includes(value)
        ? current.surfaces.filter((item) => item !== value)
        : [...current.surfaces, value],
    }))
  }

  const toggleAudience = (value: AnnouncementAudience) => {
    setDraft((current) => {
      if (value === "ALL") return { ...current, audiences: ["ALL"] }
      const withoutAll = current.audiences.filter((item) => item !== "ALL")
      return {
        ...current,
        audiences: withoutAll.includes(value)
          ? withoutAll.filter((item) => item !== value)
          : [...withoutAll, value],
      }
    })
  }

  const previewTitle =
    previewLocale === "en" && draft.title_en.trim() ? draft.title_en : draft.title_ru
  const previewBody = previewLocale === "en" && draft.body_en.trim() ? draft.body_en : draft.body_ru
  const phaseCounts = data?.phase_counts || {}
  const canReplace = Boolean(selected?.supersedes_id)
  const startTimestamp = Date.parse(startsAt)
  const startsInPast =
    (!selected || selected.status === "DRAFT") &&
    Number.isFinite(startTimestamp) &&
    startTimestamp < Date.now() - 60_000
  const summary = useMemo(
    () => ({
      audience: draft.audiences.join(", ") || "не выбрана",
      surfaces: draft.surfaces.join(", ") || "не выбраны",
      duration: durationText(startsAt, endsAt),
    }),
    [draft.audiences, draft.surfaces, endsAt, startsAt],
  )

  return (
    <section className="dc-announcement-admin">
      <header className="dc-announcement-admin__head">
        <div>
          <p className="dc-eyebrow">SYSTEM ANNOUNCEMENTS / CONTROL PLANE</p>
          <h2>Центр уведомлений</h2>
          <p>Черновики, расписание, безопасный preview, аудит публикаций и базовые метрики.</p>
        </div>
        {canManage && (
          <button className="dc-primary" type="button" onClick={startNew}>
            + СОЗДАТЬ УВЕДОМЛЕНИЕ
          </button>
        )}
      </header>

      {data && (!data.feature_flags.enabled || !data.feature_flags.site) && (
        <div className="dc-announcement-admin__flag-warning" role="status">
          Публичный показ выключен feature flags: записи сохраняются, но сайт их пока не отдаёт.
        </div>
      )}

      <div className="dc-announcement-admin__counters">
        {(["ACTIVE", "SCHEDULED", "DRAFT", "EXPIRED"] as AnnouncementPhase[]).map((key) => (
          <button type="button" key={key} onClick={() => setPhase(key)}>
            <span>{phaseLabel(key)}</span>
            <b>{phaseCounts[key] || 0}</b>
          </button>
        ))}
      </div>

      <div className="dc-announcement-admin__filters">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Заголовок, текст или ID"
        />
        <input
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          placeholder="Автор или ID автора"
        />
        <select value={phase} onChange={(event) => setPhase(event.target.value)}>
          {PHASES.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
          <option>ALL</option>
          {SEVERITIES.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select value={surface} onChange={(event) => setSurface(event.target.value)}>
          <option>ALL</option>
          {SURFACES.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <button className="dc-ghost" type="button" onClick={() => void load()}>
          ОБНОВИТЬ
        </button>
      </div>

      <div className="dc-announcement-admin__workspace">
        <aside className="dc-announcement-admin__list" aria-label="Список уведомлений">
          <small>{data?.total || 0} записей</small>
          {data?.items.map((item) => (
            <button
              type="button"
              key={item.id}
              className={selected?.id === item.id ? "active" : ""}
              onClick={() => {
                if (
                  hasUnsavedDraft &&
                  !window.confirm("Несохранённые изменения будут потеряны. Открыть другую запись?")
                ) {
                  return
                }
                choose(item)
              }}
            >
              <span className={`phase phase-${item.phase.toLowerCase()}`}>
                {phaseLabel(item.phase)}
              </span>
              <b>{item.title_ru}</b>
              <em>
                {item.severity} · {item.presentation} · P{item.priority}
              </em>
              <small>
                {fmt(item.starts_at)} → {fmt(item.ends_at)}
              </small>
              <small>
                {item.effect} · {item.surfaces.join(", ")} · {item.audiences.join(", ")}
              </small>
              <small>
                {item.created_by?.display_name || "—"} · rev {item.revision}
              </small>
            </button>
          ))}
          {!data?.items.length && <div className="dc-admin-empty">Ничего не найдено.</div>}
        </aside>

        <div className="dc-announcement-admin__editor">
          <div className="dc-announcement-admin__form">
            <section>
              <header>
                <span>01</span>
                <h3>Содержание</h3>
              </header>
              <label>
                <span>Заголовок RU *</span>
                <input
                  maxLength={160}
                  disabled={locked}
                  value={draft.title_ru}
                  onChange={(event) => setDraft({ ...draft, title_ru: event.target.value })}
                />
              </label>
              <label>
                <span>Текст RU *</span>
                <textarea
                  rows={5}
                  maxLength={2000}
                  disabled={locked}
                  value={draft.body_ru}
                  onChange={(event) => setDraft({ ...draft, body_ru: event.target.value })}
                />
              </label>
              <div className="dc-announcement-admin__two">
                <label>
                  <span>Заголовок EN</span>
                  <input
                    maxLength={160}
                    disabled={locked}
                    value={draft.title_en}
                    onChange={(event) => setDraft({ ...draft, title_en: event.target.value })}
                  />
                </label>
                <label>
                  <span>CTA URL</span>
                  <input
                    maxLength={500}
                    disabled={locked}
                    placeholder="/status или HTTPS текущего сайта"
                    value={draft.cta_url}
                    onChange={(event) => setDraft({ ...draft, cta_url: event.target.value })}
                  />
                </label>
              </div>
              <label>
                <span>Текст EN</span>
                <textarea
                  rows={4}
                  maxLength={2000}
                  disabled={locked}
                  value={draft.body_en}
                  onChange={(event) => setDraft({ ...draft, body_en: event.target.value })}
                />
              </label>
              <div className="dc-announcement-admin__two">
                <label>
                  <span>CTA RU</span>
                  <input
                    maxLength={64}
                    disabled={locked}
                    value={draft.cta_label_ru}
                    onChange={(event) => setDraft({ ...draft, cta_label_ru: event.target.value })}
                  />
                </label>
                <label>
                  <span>CTA EN</span>
                  <input
                    maxLength={64}
                    disabled={locked}
                    value={draft.cta_label_en}
                    onChange={(event) => setDraft({ ...draft, cta_label_en: event.target.value })}
                  />
                </label>
              </div>
            </section>

            <section>
              <header>
                <span>02</span>
                <h3>Вид и поведение</h3>
              </header>
              <div className="dc-announcement-admin__three">
                <label>
                  <span>Severity</span>
                  <select
                    disabled={locked}
                    value={draft.severity}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        severity: event.target.value as AdminAnnouncementDraft["severity"],
                      })
                    }
                  >
                    {SEVERITIES.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Presentation</span>
                  <select
                    disabled={locked}
                    value={draft.presentation}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        presentation: event.target.value as AdminAnnouncementDraft["presentation"],
                      })
                    }
                  >
                    {PRESENTATIONS.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Effect</span>
                  <select
                    disabled={locked}
                    value={draft.effect}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        effect: event.target.value as AdminAnnouncementDraft["effect"],
                      })
                    }
                  >
                    {EFFECTS.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="dc-announcement-admin__two">
                <label>
                  <span>Закрытие</span>
                  <select
                    disabled={locked}
                    value={draft.dismiss_policy}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        dismiss_policy: event.target
                          .value as AdminAnnouncementDraft["dismiss_policy"],
                      })
                    }
                  >
                    {DISMISS_POLICIES.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Priority: {draft.priority}</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    disabled={locked}
                    value={draft.priority}
                    onChange={(event) =>
                      setDraft({ ...draft, priority: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <label className="dc-announcement-admin__check">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={draft.show_countdown}
                  onChange={(event) => setDraft({ ...draft, show_countdown: event.target.checked })}
                />
                <span>Показывать обратный отсчёт</span>
              </label>
            </section>

            <section>
              <header>
                <span>03</span>
                <h3>Кому и где</h3>
              </header>
              <p className="dc-announcement-admin__label">Поверхности</p>
              <div className="dc-announcement-admin__checks">
                {SURFACES.map((value) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={draft.surfaces.includes(value)}
                      onChange={() => toggleSurface(value)}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
              <p className="dc-announcement-admin__label">Аудитории</p>
              <div className="dc-announcement-admin__checks">
                {AUDIENCES.map((value) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={draft.audiences.includes(value)}
                      onChange={() => toggleAudience(value)}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
              <small>
                Фильтрация выполняется сервером: STAFF/TESTERS никогда не отдаются посторонним
                клиентам.
              </small>
            </section>

            <section>
              <header>
                <span>04</span>
                <h3>Расписание и подтверждение</h3>
              </header>
              <div className="dc-announcement-admin__two">
                <label>
                  <span>Начало (ваше локальное время)</span>
                  <input
                    type="datetime-local"
                    disabled={selected?.status === "PUBLISHED"}
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </label>
                <label>
                  <span>Окончание (ваше локальное время)</span>
                  <input
                    type="datetime-local"
                    value={endsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                  />
                </label>
              </div>
              <div className="dc-announcement-admin__utc">
                <span>
                  UTC: {toIso(startsAt) || "—"} → {toIso(endsAt) || "—"}
                </span>
                <b>{summary.duration}</b>
              </div>
              <label>
                <span>Причина для AuditLog *</span>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              {selected?.status === "DRAFT" && canPublish && (
                <label>
                  <span>Введите PUBLISH</span>
                  <input
                    autoComplete="off"
                    value={confirmText}
                    onChange={(event) => setConfirmText(event.target.value)}
                  />
                </label>
              )}
              <div className="dc-announcement-admin__summary">
                <b>Проверка перед публикацией</b>
                <span>Увидят: {summary.audience}</span>
                <span>Поверхности: {summary.surfaces}</span>
                <span>
                  Формат: {draft.severity} / {draft.presentation} / {draft.effect}
                </span>
                <span>Закрытие: {draft.dismiss_policy}</span>
                {startsInPast && (
                  <strong>
                    Начало уже прошло — после публикации сообщение станет активным сразу.
                  </strong>
                )}
                {draftDirty && (
                  <strong>Есть несохранённые изменения — публикация заблокирована.</strong>
                )}
              </div>
            </section>

            <div className="dc-announcement-admin__actions">
              {!locked && canManage && (
                <button
                  className="dc-primary"
                  disabled={busy || Boolean(selected && !draftDirty)}
                  type="button"
                  onClick={() => void save()}
                >
                  {selected ? "СОХРАНИТЬ ЧЕРНОВИК" : "СОЗДАТЬ ЧЕРНОВИК"}
                </button>
              )}
              {selected?.status === "DRAFT" && canPublish && (
                <button
                  className="dc-primary"
                  disabled={busy || confirmText !== "PUBLISH" || draftDirty}
                  type="button"
                  onClick={() => void publish(false)}
                >
                  ОПУБЛИКОВАТЬ
                </button>
              )}
              {selected?.status === "DRAFT" && canPublish && canReplace && (
                <button
                  className="dc-danger"
                  disabled={busy || confirmText !== "PUBLISH" || draftDirty}
                  type="button"
                  onClick={() => void publish(true)}
                >
                  ОПУБЛИКОВАТЬ КАК ЗАМЕНУ
                </button>
              )}
              {selected && canManage && (
                <button
                  className="dc-ghost"
                  disabled={busy}
                  type="button"
                  onClick={() => void duplicate()}
                >
                  СОЗДАТЬ КОПИЮ
                </button>
              )}
              {selected?.status === "PUBLISHED" && canCancel && (
                <button
                  className="dc-ghost"
                  disabled={busy}
                  type="button"
                  onClick={() => void changeEnd()}
                >
                  ИЗМЕНИТЬ ОКОНЧАНИЕ
                </button>
              )}
              {selected?.status === "PUBLISHED" && canCancel && (
                <button
                  className="dc-danger"
                  disabled={busy}
                  type="button"
                  onClick={() => void cancel()}
                >
                  ОТМЕНИТЬ
                </button>
              )}
            </div>
          </div>

          <aside className="dc-announcement-admin__preview-column">
            <div className="dc-announcement-admin__preview-controls">
              <select
                value={previewDevice}
                onChange={(event) => setPreviewDevice(event.target.value as typeof previewDevice)}
              >
                <option value="desktop">Desktop site</option>
                <option value="mobile">Mobile site</option>
                <option value="companion">Companion desktop</option>
                <option value="overlay">Overlay</option>
              </select>
              <button
                type="button"
                className={previewLocale === "ru" ? "active" : ""}
                onClick={() => setPreviewLocale("ru")}
              >
                RU
              </button>
              <button
                type="button"
                className={previewLocale === "en" ? "active" : ""}
                onClick={() => setPreviewLocale("en")}
              >
                EN
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={reducedMotion}
                  onChange={(event) => setReducedMotion(event.target.checked)}
                />{" "}
                Reduced motion
              </label>
            </div>
            <div
              className={`dc-announcement-admin__preview is-${previewDevice} ${reducedMotion ? "reduce-motion" : ""}`}
            >
              <div
                className={`notice severity-${draft.severity.toLowerCase()} effect-${draft.effect.toLowerCase()}`}
              >
                <span>{draft.severity}</span>
                <h3>{previewTitle || "Заголовок уведомления"}</h3>
                <p>{previewBody || "Здесь появится безопасный текстовый preview."}</p>
                {draft.cta_url && (
                  <button type="button">
                    {previewLocale === "en"
                      ? draft.cta_label_en || draft.cta_label_ru
                      : draft.cta_label_ru || "Подробнее"}
                  </button>
                )}
              </div>
            </div>
            {selected && (
              <div className="dc-announcement-admin__meta">
                <span>ID</span>
                <code>{selected.id}</code>
                <span>Revision</span>
                <b>{selected.revision}</b>
                <span>Статус</span>
                <b>{selected.phase}</b>
                <span>Создал</span>
                <b>{selected.created_by?.display_name || "—"}</b>
                <span>Обновлено</span>
                <b>{fmt(selected.updated_at)}</b>
              </div>
            )}
            {selected && canReadMetrics && (
              <button className="dc-ghost" type="button" onClick={() => void loadMetrics()}>
                ЗАГРУЗИТЬ МЕТРИКИ
              </button>
            )}
            {metrics && (
              <div className="dc-announcement-admin__metrics">
                <article>
                  <span>Увидели</span>
                  <b>{metrics.totals.seen_users}</b>
                </article>
                <article>
                  <span>Показы</span>
                  <b>{metrics.totals.impressions}</b>
                </article>
                <article>
                  <span>Закрыли</span>
                  <b>{metrics.totals.dismissed_users}</b>
                </article>
                <article>
                  <span>Подтвердили</span>
                  <b>{metrics.totals.acknowledged_users}</b>
                </article>
                <p>
                  ACK rate: <b>{metrics.acknowledgement_rate}%</b>
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  )
}
