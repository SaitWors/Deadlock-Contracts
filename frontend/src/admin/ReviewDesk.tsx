import { useAdminCopy } from "./admin-copy"
import "./review-stage3.css"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AdminApiError, adminApi } from "./admin-api"
import type {
  AdminReview,
  AdminReviewDecisionPreview,
  AdminReviewListResponse,
  AdminReviewReasonCode,
  AdminReviewVerdict,
} from "./admin-types"

const PAGE_SIZE = 20

const REASON_OPTIONS: Array<[AdminReviewReasonCode, string]> = [
  ["NOT_COMPLETED", "Не выполнено"],
  ["INSUFFICIENT_EVIDENCE", "Недостаточно достоверных данных"],
  ["INVALID_MATCH", "Матч не подходит для проверки"],
  ["IDENTITY_MISMATCH", "Несовпадение игрока / Steam identity"],
  ["DATA_CONFLICT", "Конфликт источников данных"],
  ["POLICY_VIOLATION", "Нарушение правил проверки"],
  ["OTHER", "Другая причина"],
]

function reviewIdFromPath(): string | null {
  const match = window.location.pathname.match(
    /^\/admin\/reviews\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i,
  )
  return match?.[1] || null
}

function claimRemaining(review: AdminReview, nowMs: number) {
  const expires = review.claim.expires_at ? new Date(review.claim.expires_at).getTime() : 0
  if (!review.claim.active || !Number.isFinite(expires)) return 0
  return Math.max(0, Math.floor((expires - nowMs) / 1000))
}

type Props = {
  initialItems: AdminReview[]
  csrf: string
  currentUserId: string
  canForceClaim: boolean
  setError: (value: string) => void
  setNotice: (value: string) => void
  reloadAll: () => Promise<void>
}

export default function ReviewDesk({
  initialItems,
  csrf,
  currentUserId,
  canForceClaim,
  setError,
  setNotice,
  reloadAll,
}: Props) {
  const { copy, locale } = useAdminCopy()
  function fmt(value: string | null | undefined) {
    if (!value) return "—"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "—"
    return date.toLocaleString(locale, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  function ageLabel(value: string) {
    const created = new Date(value).getTime()
    if (!Number.isFinite(created)) return "—"
    const seconds = Math.max(0, Math.floor((Date.now() - created) / 1000))
    if (seconds < 60) return copy("{0}с", { 0: seconds })
    if (seconds < 3600) return copy("{0}м", { 0: Math.floor(seconds / 60) })
    if (seconds < 86400) return copy("{0}ч", { 0: Math.floor(seconds / 3600) })
    return copy("{0}д", { 0: Math.floor(seconds / 86400) })
  }

  function metricLabel(metric: string) {
    const labels: Record<string, string> = {
      "player.kills": "Kills",
      "player.deaths": "Deaths",
      "player.assists": "Assists",
      "player.kda": "KDA",
      "player.net_worth.final": "Souls",
      "player.hero_damage": "Hero damage",
      "player.object_damage": "Object damage",
      "player.healing": "Healing",
      "player.scoreboard_healing": "Scoreboard healing",
      "match.duration_s": "Duration",
      "match.win": "Win",
    }
    return copy(labels[metric] || metric)
  }

  function conditionText(metric: string, operator: string, target: number) {
    const symbol = operator === "lte" ? "≤" : operator === "eq" ? "=" : "≥"
    if (metric === "match.duration_s") {
      const minutes = Math.floor(target / 60)
      const seconds = Math.floor(target % 60)
      return `${metricLabel(metric)} ${symbol} ${minutes}:${String(seconds).padStart(2, "0")}`
    }
    if (metric === "match.win") return `${metricLabel(metric)} = ${copy("WIN")}`
    return `${metricLabel(metric)} ${symbol} ${target.toLocaleString(locale)}`
  }

  function actualText(metric: string, value: number | null) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—"
    if (metric === "match.duration_s") {
      const total = Number(value)
      return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, "0")}`
    }
    if (metric === "match.win") return copy(Number(value) === 1 ? "WIN" : "LOSS")
    if (metric === "player.kda") return Number(value).toFixed(2)
    return Number(value).toLocaleString(locale)
  }

  function claimTimeLabel(seconds: number) {
    if (seconds <= 0) return copy("истёк")
    const minutes = Math.floor(seconds / 60)
    const tail = seconds % 60
    return `${minutes}:${String(tail).padStart(2, "0")}`
  }

  const [items, setItems] = useState<AdminReview[]>(initialItems)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState("OPEN")
  const [mode, setMode] = useState("ALL")
  const [claim, setClaim] = useState("ALL")
  const [source, setSource] = useState("ALL")
  const [auditStatus, setAuditStatus] = useState("ALL")
  const [priority, setPriority] = useState("ALL")
  const [reason, setReason] = useState("")
  const [age, setAge] = useState("ALL")
  const [claimant, setClaimant] = useState("")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<AdminReview | null>(null)
  const [loading, setLoading] = useState(false)
  const [decisions, setDecisions] = useState<Record<string, AdminReviewVerdict>>({})
  const [manualValues, setManualValues] = useState<Record<string, string>>({})
  const [reasonCode, setReasonCode] = useState<AdminReviewReasonCode | "">("")
  const [reviewerNote, setReviewerNote] = useState("")
  const [preview, setPreview] = useState<AdminReviewDecisionPreview | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const loadInbox = useCallback(
    async (nextOffset: number) => {
      const params = new URLSearchParams({
        status,
        mode,
        claim,
        settlement_source: source,
        audit_status: auditStatus,
        priority,
        reason: reason.trim(),
        age,
        claimed_by: claimant.trim(),
        query: query.trim(),
        offset: String(nextOffset),
        limit: String(PAGE_SIZE),
      })
      const data = await adminApi<AdminReviewListResponse>(
        `/api/admin/auto-reviews?${params.toString()}`,
        csrf,
      )
      setItems(data.items)
      setTotal(data.total)
      setOffset(data.offset)
      return data
    },
    [age, auditStatus, claim, claimant, csrf, mode, priority, query, reason, source, status],
  )

  const loadReview = useCallback(
    async (reviewId: string) => {
      const data = await adminApi<{ review: AdminReview }>(
        `/api/admin/auto-reviews/${reviewId}`,
        csrf,
      )
      setSelected(data.review)
      setDecisions({})
      setManualValues({})
      setReasonCode("")
      setReviewerNote(data.review.reviewer_note || "")
      setPreview(null)
      return data.review
    },
    [csrf],
  )

  useEffect(() => {
    setLoading(true)
    loadInbox(0)
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setLoading(false))
  }, [status, mode, claim, source, auditStatus, priority, age]) // text filters apply on Enter/Refresh

  useEffect(() => {
    const initial = reviewIdFromPath()
    if (initial) {
      loadReview(initial).catch((reason) => setError((reason as Error).message))
    }

    const onPop = () => {
      const value = reviewIdFromPath()
      if (value) {
        loadReview(value).catch((reason) => setError((reason as Error).message))
      } else {
        setSelected(null)
      }
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [loadReview, setError])

  const openReview = async (reviewId: string, replace = false) => {
    try {
      setLoading(true)
      await loadReview(reviewId)
      const url = `/admin/reviews/${reviewId}`
      if (replace) window.history.replaceState({}, "", url)
      else window.history.pushState({}, "", url)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const closeDetail = () => {
    setSelected(null)
    setPreview(null)
    window.history.pushState({}, "", "/admin/reviews")
  }

  const refreshSelected = async () => {
    if (!selected) return
    await loadReview(selected.id)
    await loadInbox(offset)
  }

  const selectedClaimActive = Boolean(
    selected?.claim.active && selected && claimRemaining(selected, nowMs) > 0,
  )
  const isMine = Boolean(
    selectedClaimActive && selected?.claim.claimed_by_user_id === currentUserId,
  )
  const claimedByOther = Boolean(
    selectedClaimActive && selected?.claim.claimed_by_user_id !== currentUserId,
  )

  const claimSelected = async (force = false) => {
    if (!selected) return
    try {
      setLoading(true)
      await adminApi(`/api/admin/auto-reviews/${selected.id}/claim`, csrf, {
        method: "POST",
        body: JSON.stringify({ force }),
      })
      await refreshSelected()
      setNotice(
        force
          ? copy("Заявка принудительно перехвачена.")
          : copy("Заявка взята в работу на 10 минут."),
      )
    } catch (reason) {
      setError((reason as Error).message)
      if (reason instanceof AdminApiError && reason.status === 409) {
        await refreshSelected().catch(() => undefined)
      }
    } finally {
      setLoading(false)
    }
  }

  const releaseSelected = async (force = false) => {
    if (!selected) return
    try {
      setLoading(true)
      await adminApi(`/api/admin/auto-reviews/${selected.id}/release`, csrf, {
        method: "POST",
        body: JSON.stringify({ force }),
      })
      await refreshSelected()
      setNotice(copy("Claim освобождён."))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const markNeedsInfo = async () => {
    if (!selected) return
    if (!isMine) {
      setError(copy("Сначала возьмите заявку в работу."))
      return
    }
    if (reviewerNote.trim().length < 5) {
      setError(copy("Для NEEDS_INFO добавьте пояснение минимум из 5 символов."))
      return
    }
    try {
      setLoading(true)
      await adminApi(`/api/admin/auto-reviews/${selected.id}/needs-info`, csrf, {
        method: "POST",
        body: JSON.stringify({ note: reviewerNote.trim() }),
      })
      const data = await loadInbox(0)
      setNotice(copy("Заявка отмечена как NEEDS_INFO и освобождена."))
      const next = data.items.find((item) => item.id !== selected.id)
      if (next) await openReview(next.id, true)
      else closeDetail()
      await reloadAll()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const selectedPending = useMemo(
    () => selected?.contracts.filter((item) => item.status === "REVIEW_REQUIRED") || [],
    [selected],
  )

  const buildDecisionPayload = () => {
    if (!selected) return null
    if (!isMine) {
      setError(copy("Сначала возьмите заявку в работу."))
      return null
    }
    if (selectedPending.some((item) => !decisions[item.id])) {
      setError(copy("Выберите решение для каждого REVIEW_REQUIRED контракта."))
      return null
    }

    const hasNegative = selectedPending.some((item) =>
      ["FAILED", "VOID"].includes(decisions[item.id]),
    )
    if (hasNegative && !reasonCode) {
      setError(copy("Для FAILED/VOID обязательно выберите причину."))
      return null
    }
    if (reasonCode === "OTHER" && reviewerNote.trim().length < 5) {
      setError(copy("Для OTHER добавьте пояснение минимум из 5 символов."))
      return null
    }

    const options = selectedPending.map((item) => {
      const verdict = decisions[item.id]
      const raw = (manualValues[item.id] || "").trim()
      const parsed = raw ? Number(raw.replace(",", ".")) : null
      const manual = parsed !== null && Number.isFinite(parsed) ? parsed : null
      const fact = manual ?? item.actual

      if (verdict === "COMPLETED" && fact === null) {
        throw new Error(
          copy("Для COMPLETED по «{0}» укажите факт: автоматическое значение отсутствует.", {
            0: item.title,
          }),
        )
      }

      return {
        option_id: item.id,
        status: verdict,
        progress_current: verdict === "VOID" ? null : fact,
        explanation:
          verdict === "VOID"
            ? "Контракт аннулирован: достоверных данных для проверки недостаточно."
            : verdict === "COMPLETED"
              ? `Выполнение подтверждено внутренней проверкой. Факт: ${fact}.`
              : `Выполнение не подтверждено внутренней проверкой${fact !== null ? `. Факт: ${fact}.` : "."}`,
      }
    })

    return {
      status: "RESOLVED",
      reason_code: hasNegative ? reasonCode : null,
      reviewer_note: reviewerNote.trim(),
      options,
    }
  }

  const previewDecision = async () => {
    if (!selected) return
    try {
      const payload = buildDecisionPayload()
      if (!payload) return
      setLoading(true)
      const data = await adminApi<{ decision: AdminReviewDecisionPreview }>(
        `/api/admin/auto-reviews/${selected.id}/decision-preview`,
        csrf,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      )
      setPreview(data.decision)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const confirmDecision = async () => {
    if (!selected || !preview) return
    try {
      const payload = buildDecisionPayload()
      if (!payload) return
      setLoading(true)
      await adminApi(`/api/admin/auto-reviews/${selected.id}/decision`, csrf, {
        method: "POST",
        body: JSON.stringify(payload),
      })

      const data = await loadInbox(0)
      setNotice(
        copy("Review закрыт. В очередь наград отправлено +{0} XP.", { 0: preview.reward_xp_total }),
      )
      setPreview(null)
      await reloadAll()

      const next = data.items.find((item) => item.id !== selected.id)
      if (next) await openReview(next.id, true)
      else closeDetail()
    } catch (reason) {
      setError((reason as Error).message)
      if (reason instanceof AdminApiError && reason.status === 409) {
        await refreshSelected().catch(() => undefined)
      }
    } finally {
      setLoading(false)
    }
  }

  const copyDeepLink = async () => {
    if (!selected) return
    const url = `${window.location.origin}/admin/reviews/${selected.id}`
    try {
      await navigator.clipboard.writeText(url)
      setNotice(copy("Прямая ссылка на Review скопирована."))
    } catch {
      setError(url)
    }
  }

  return (
    <section className="dc-review3">
      <header className="dc-review3-head">
        <div>
          <p className="dc-eyebrow">{copy("REVIEW INBOX / MODERATION DESK")}</p>
          <h1>{copy("Internal Review")}</h1>
          <p>
            {copy(
              "Claim координирует работу модераторов. Финальное решение всё равно фиксируется транзакционно через ModerationService.",
            )}
          </p>
        </div>
        <div className="dc-review3-summary">
          <b>{total}</b>
          <span>{copy("в текущем фильтре")}</span>
        </div>
      </header>

      <div className="dc-review3-filters">
        <input
          value={query}
          placeholder={copy("Review ID, Match ID, Board ID, игрок")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setLoading(true)
              loadInbox(0)
                .catch((reason) => setError((reason as Error).message))
                .finally(() => setLoading(false))
            }
          }}
        />
        <select
          aria-label={copy("Статус")}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="OPEN">{copy("OPEN")}</option>
          <option value="PENDING">{copy("PENDING")}</option>
          <option value="NEEDS_INFO">{copy("NEEDS_INFO")}</option>
          <option value="RESOLVED">{copy("RESOLVED")}</option>
          <option value="REJECTED">{copy("REJECTED")}</option>
        </select>
        <select
          aria-label={copy("Режимы матчей")}
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="ALL">{copy("Все режимы")}</option>
          <option value="STANDARD">{copy("STANDARD")}</option>
          <option value="RANKED">{copy("RANKED")}</option>
          <option value="STREET_BRAWL">{copy("STREET BRAWL")}</option>
        </select>
        <select
          aria-label={copy("Все claims")}
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
        >
          <option value="ALL">{copy("Все claims")}</option>
          <option value="FREE">{copy("Свободные")}</option>
          <option value="MINE">{copy("Мои")}</option>
          <option value="CLAIMED">{copy("В работе")}</option>
        </select>
        <select
          aria-label={copy("Любой settlement")}
          value={source}
          onChange={(event) => setSource(event.target.value)}
        >
          <option value="ALL">{copy("Любой settlement")}</option>
          <option value="OVERWOLF_GEP">{copy("OVERWOLF_GEP")}</option>
          <option value="DEADLOCK_API">{copy("DEADLOCK_API")}</option>
          <option value="LEGACY">{copy("LEGACY")}</option>
        </select>
        <select
          aria-label={copy("Любой audit")}
          value={auditStatus}
          onChange={(event) => setAuditStatus(event.target.value)}
        >
          <option value="ALL">{copy("Любой audit")}</option>
          <option value="NOT_REQUESTED">{copy("NOT_REQUESTED")}</option>
          <option value="PENDING">{copy("PENDING")}</option>
          <option value="CONFIRMED">{copy("CONFIRMED")}</option>
          <option value="MISMATCH">{copy("MISMATCH")}</option>
          <option value="UNAVAILABLE">{copy("UNAVAILABLE")}</option>
        </select>
        <select
          aria-label={copy("Любой приоритет")}
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          <option value="ALL">{copy("Любой приоритет")}</option>
          <option value="HIGH">{copy("Высокий ≤ 25")}</option>
          <option value="NORMAL">{copy("Обычный > 25")}</option>
        </select>
        <select
          aria-label={copy("Любой возраст")}
          value={age}
          onChange={(event) => setAge(event.target.value)}
        >
          <option value="ALL">{copy("Любой возраст")}</option>
          <option value="15M">{copy("Старше 15 минут")}</option>
          <option value="1H">{copy("Старше часа")}</option>
          <option value="6H">{copy("Старше 6 часов")}</option>
          <option value="24H">{copy("Старше суток")}</option>
        </select>
        <input
          value={reason}
          placeholder={copy("Причина Review")}
          onChange={(event) => setReason(event.target.value)}
        />
        <input
          value={claimant}
          placeholder={copy("Модератор claim")}
          onChange={(event) => setClaimant(event.target.value)}
        />
        <button
          className="dc-ghost"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            loadInbox(0)
              .catch((reason) => setError((reason as Error).message))
              .finally(() => setLoading(false))
          }}
        >
          {copy("ОБНОВИТЬ")}
        </button>
      </div>

      <div className={`dc-review3-layout ${selected ? "has-detail" : ""}`}>
        <aside className="dc-review3-inbox">
          {items.length === 0 && <div className="dc-admin-empty">{copy("Очередь пуста.")}</div>}
          {items.map((review) => {
            const mine = review.claim.active && review.claim.claimed_by_user_id === currentUserId
            return (
              <button
                key={review.id}
                className={selected?.id === review.id ? "active" : ""}
                onClick={() => void openReview(review.id)}
              >
                <header>
                  <b>#{review.match_id || "—"}</b>
                  <span className={`dc-badge ${review.status.toLowerCase()}`}>{review.status}</span>
                </header>
                <strong>{review.player.display_name}</strong>
                <small>
                  {review.mode} {copy(" · P")}
                  {review.priority} · {ageLabel(review.created_at)}
                </small>
                <small>
                  {review.match_summary.settlement_source || review.match_summary.provider || "—"} ·{" "}
                  {review.match_summary.audit_status || "—"}
                </small>
                <em className={mine ? "mine" : review.claim.active ? "claimed" : "free"}>
                  {mine
                    ? copy("МОЙ CLAIM · {0}", { 0: claimTimeLabel(claimRemaining(review, nowMs)) })
                    : review.claim.active
                      ? copy("В РАБОТЕ · {0}", {
                          0: review.claim.claimed_by?.display_name || "staff",
                        })
                      : copy("СВОБОДНО")}
                </em>
              </button>
            )
          })}
          <footer className="dc-review3-pagination">
            <button
              className="dc-ghost"
              disabled={offset <= 0 || loading}
              onClick={() => void loadInbox(Math.max(0, offset - PAGE_SIZE))}
            >
              ←
            </button>
            <span>
              {total === 0 ? 0 : offset + 1}–{Math.min(total, offset + PAGE_SIZE)} / {total}
            </span>
            <button
              className="dc-ghost"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => void loadInbox(offset + PAGE_SIZE)}
            >
              →
            </button>
          </footer>
        </aside>

        <main className="dc-review3-detail">
          {!selected ? (
            <div className="dc-admin-empty">
              {copy("Выберите Review слева или откройте прямую ссылку /admin/reviews/<id>.")}
            </div>
          ) : (
            <>
              <button className="dc-admin-mobile-back" type="button" onClick={closeDetail}>
                {copy("← К очереди")}
              </button>

              <div className="dc-review3-detail-head">
                <div>
                  <p className="dc-eyebrow">
                    {copy("REVIEW #")}
                    {selected.id.slice(0, 8)} {copy(" / BOARD ")}
                    {selected.board_id.slice(0, 8)}
                  </p>
                  <h2>
                    {copy("Матч #")}
                    {selected.match_id || "—"}
                  </h2>
                  <p>
                    {selected.player.display_name} {copy(" · создан ")}
                    {fmt(selected.created_at)}
                  </p>
                </div>
                <div className="dc-review3-head-actions">
                  <button className="dc-ghost" onClick={() => void copyDeepLink()}>
                    {copy("СКОПИРОВАТЬ ССЫЛКУ")}
                  </button>
                  {!selected.claim.active &&
                    ["PENDING", "NEEDS_INFO"].includes(selected.status) && (
                      <button
                        className="dc-primary"
                        disabled={loading}
                        onClick={() => void claimSelected(false)}
                      >
                        {copy("ВЗЯТЬ В РАБОТУ")}
                      </button>
                    )}
                  {isMine && (
                    <>
                      <button
                        className="dc-ghost"
                        disabled={loading}
                        onClick={() => void claimSelected(false)}
                      >
                        {copy("+10 МИН")}
                      </button>
                      <button
                        className="dc-ghost"
                        disabled={loading}
                        onClick={() => void releaseSelected(false)}
                      >
                        {copy("ОСВОБОДИТЬ")}
                      </button>
                    </>
                  )}
                  {claimedByOther && canForceClaim && (
                    <>
                      <button
                        className="dc-primary"
                        disabled={loading}
                        onClick={() => void claimSelected(true)}
                      >
                        {copy("ПЕРЕХВАТИТЬ")}
                      </button>
                      <button
                        className="dc-ghost"
                        disabled={loading}
                        onClick={() => void releaseSelected(true)}
                      >
                        {copy("СНЯТЬ CLAIM")}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="dc-review3-claimbar">
                <span className={isMine ? "mine" : selected.claim.active ? "claimed" : "free"}>
                  {isMine
                    ? copy("МОЙ CLAIM · осталось {0}", {
                        0: claimTimeLabel(claimRemaining(selected, nowMs)),
                      })
                    : selectedClaimActive
                      ? copy("В работе у {0} · {1}", {
                          0: selected.claim.claimed_by?.display_name || "staff",
                          1: claimTimeLabel(claimRemaining(selected, nowMs)),
                        })
                      : copy("Заявка свободна")}
                </span>
                <b>
                  {selected.status} {copy(" · PRIORITY ")}
                  {selected.priority}
                </b>
              </div>

              <div className="dc-review3-facts">
                <div>
                  <span>{copy("K / D / A")}</span>
                  <b>
                    {selected.match_summary.kills ?? "—"} / {selected.match_summary.deaths ?? "—"} /{" "}
                    {selected.match_summary.assists ?? "—"}
                  </b>
                </div>
                <div>
                  <span>{copy("SOULS")}</span>
                  <b>{selected.match_summary.net_worth?.toLocaleString(locale) ?? "—"}</b>
                </div>
                <div>
                  <span>{copy("HERO DAMAGE")}</span>
                  <b>{selected.match_summary.hero_damage?.toLocaleString(locale) ?? "—"}</b>
                </div>
                <div>
                  <span>{copy("OBJECT DAMAGE")}</span>
                  <b>{selected.match_summary.object_damage?.toLocaleString(locale) ?? "—"}</b>
                </div>
                <div>
                  <span>{copy("HEALING")}</span>
                  <b>{selected.match_summary.healing?.toLocaleString(locale) ?? "—"}</b>
                </div>
                <div>
                  <span>{copy("DURATION")}</span>
                  <b>
                    {selected.match_summary.duration_s
                      ? actualText("match.duration_s", selected.match_summary.duration_s)
                      : "—"}
                  </b>
                </div>
              </div>

              <div className="dc-review3-trust">
                <div>
                  <span>{copy("SETTLEMENT")}</span>
                  <b>{selected.match_summary.settlement_source || "—"}</b>
                </div>
                <div>
                  <span>{copy("INTEGRITY")}</span>
                  <b>{selected.match_summary.integrity_status || "—"}</b>
                </div>
                <div>
                  <span>{copy("AUDIT")}</span>
                  <b>{selected.match_summary.audit_status || "—"}</b>
                </div>
                <div>
                  <span>{copy("MODE CONFIDENCE")}</span>
                  <b>{selected.match_summary.mode_confidence || "—"}</b>
                </div>
              </div>

              <section className="dc-review3-reasons">
                <h3>{copy("Почему создан Review")}</h3>
                {selected.reasons.length ? (
                  selected.reasons.map((reason, index) => (
                    <div key={`${reason.option_id}-${index}`}>
                      <b>{reason.title || reason.option_id}</b>
                      <span>{reason.reason}</span>
                    </div>
                  ))
                ) : (
                  <p>{copy("Причина не указана.")}</p>
                )}
              </section>

              <section className="dc-review3-contract-table">
                <div className="dc-review3-contract-head">
                  <span>{copy("Контракт / требовалось")}</span>
                  <span>{copy("Получено")}</span>
                  <span>{copy("Capability / источник")}</span>
                  <span>{copy("Решение")}</span>
                </div>
                {selected.contracts.map((contract) => (
                  <article key={contract.id}>
                    <div>
                      <b>{contract.title}</b>
                      {(contract.conditions.length
                        ? contract.conditions
                        : [
                            {
                              metric: contract.metric,
                              operator: contract.operator,
                              target: contract.target,
                              capabilities: contract.required_capabilities,
                              missing_capabilities: contract.missing_capabilities,
                              actual: contract.actual,
                            },
                          ]
                      ).map((condition, index) => (
                        <small key={`${condition.metric}-${index}`}>
                          {conditionText(condition.metric, condition.operator, condition.target)}
                        </small>
                      ))}
                      <em>
                        +{contract.reward_xp} {copy(" XP")}
                      </em>
                    </div>

                    <div>
                      {(contract.conditions.length
                        ? contract.conditions
                        : [
                            {
                              metric: contract.metric,
                              operator: contract.operator,
                              target: contract.target,
                              capabilities: contract.required_capabilities,
                              missing_capabilities: contract.missing_capabilities,
                              actual: contract.actual,
                            },
                          ]
                      ).map((condition, index) => (
                        <b key={`${condition.metric}-${index}`}>
                          {metricLabel(condition.metric)}:{" "}
                          {actualText(condition.metric, condition.actual)}
                        </b>
                      ))}
                    </div>

                    <div>
                      <small>
                        {contract.missing_capabilities.length
                          ? `${copy("MISSING:")} ${contract.missing_capabilities.join(", ")}`
                          : contract.required_capabilities.join(", ") || "—"}
                      </small>
                      <b>
                        {selected.match_summary.settlement_source ||
                          selected.match_summary.provider ||
                          "—"}
                      </b>
                    </div>

                    <div className="dc-review3-verdict">
                      {contract.status === "REVIEW_REQUIRED" && isMine ? (
                        <>
                          <div>
                            {(["COMPLETED", "FAILED", "VOID"] as AdminReviewVerdict[]).map(
                              (value) => (
                                <button
                                  key={value}
                                  className={
                                    decisions[contract.id] === value
                                      ? `active ${value.toLowerCase()}`
                                      : ""
                                  }
                                  onClick={() => {
                                    setDecisions((previous) => ({
                                      ...previous,
                                      [contract.id]: value,
                                    }))
                                    setPreview(null)
                                  }}
                                >
                                  {copy(value)}
                                </button>
                              ),
                            )}
                          </div>
                          <input
                            inputMode="decimal"
                            placeholder={
                              contract.actual === null
                                ? copy("Ручной факт")
                                : copy("Факт сервера: {0}", { 0: contract.actual })
                            }
                            value={manualValues[contract.id] || ""}
                            onChange={(event) => {
                              setManualValues((previous) => ({
                                ...previous,
                                [contract.id]: event.target.value,
                              }))
                              setPreview(null)
                            }}
                          />
                        </>
                      ) : (
                        <b>{contract.status}</b>
                      )}
                    </div>

                    {contract.evaluations.length > 0 && (
                      <details>
                        <summary>
                          {copy("Предыдущие Evaluation · ")}
                          {contract.evaluations.length}
                        </summary>
                        <div className="dc-review3-evaluations">
                          {contract.evaluations.map((evaluation) => (
                            <p key={evaluation.id}>
                              <b>
                                #{evaluation.revision} · {evaluation.status} ·{" "}
                                {evaluation.evidence_level}
                              </b>
                              <span>{evaluation.explanation || "—"}</span>
                              <small>{fmt(evaluation.created_at)}</small>
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
                  </article>
                ))}
              </section>

              {isMine && ["PENDING", "NEEDS_INFO"].includes(selected.status) && (
                <section className="dc-review3-decision">
                  <div className="dc-review3-form">
                    <label>
                      {copy("Причина FAILED / VOID")}
                      <select
                        value={reasonCode}
                        onChange={(event) => {
                          setReasonCode(event.target.value as AdminReviewReasonCode | "")
                          setPreview(null)
                        }}
                      >
                        <option value="">{copy("Не требуется / не выбрана")}</option>
                        {REASON_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {value} — {copy(label)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {copy("Заметка модератора")}
                      <textarea
                        rows={3}
                        value={reviewerNote}
                        placeholder={copy("Короткое пояснение решения или запрос данных")}
                        onChange={(event) => {
                          setReviewerNote(event.target.value)
                          setPreview(null)
                        }}
                      />
                    </label>
                  </div>

                  <div className="dc-review3-decision-actions">
                    <button
                      className="dc-ghost"
                      disabled={loading}
                      onClick={() => void markNeedsInfo()}
                    >
                      {copy("НУЖНЫ ДАННЫЕ")}
                    </button>
                    <button
                      className="dc-primary"
                      disabled={loading}
                      onClick={() => void previewDecision()}
                    >
                      {copy("ПРЕДПРОСМОТР РЕШЕНИЯ")}
                    </button>
                  </div>
                </section>
              )}

              {preview && (
                <section className="dc-review3-preview">
                  <header>
                    <div>
                      <p className="dc-eyebrow">{copy("DECISION PREVIEW / NO WRITE YET")}</p>
                      <h3>{copy("Что будет изменено")}</h3>
                    </div>
                    <b>
                      +{preview.reward_xp_total} {copy(" XP")}
                    </b>
                  </header>
                  {preview.settled_options.map((item) => {
                    const contract = selected.contracts.find((value) => value.id === item.option_id)
                    return (
                      <div key={item.option_id}>
                        <span>{contract?.title || item.option_id}</span>
                        <b>
                          {copy("REVIEW_REQUIRED → ")}
                          {item.status}
                        </b>
                        <em>{item.reward_xp ? `+${item.reward_xp} XP` : "0 XP"}</em>
                      </div>
                    )
                  })}
                  <footer>
                    <span>
                      {copy("Board → ")}
                      {preview.board_status_after}
                      {preview.resume_discovery ? copy(" · discovery будет возобновлён") : ""}
                    </span>
                    <button
                      className="dc-primary"
                      disabled={loading}
                      onClick={() => void confirmDecision()}
                    >
                      {copy("ПОДТВЕРДИТЬ И ЗАКРЫТЬ")}
                    </button>
                  </footer>
                </section>
              )}

              {selected.history.length > 0 && (
                <details className="dc-review3-history">
                  <summary>
                    {copy("История Review · ")}
                    {selected.history.length}
                  </summary>
                  <div>
                    {selected.history.map((entry, index) => (
                      <p key={`${entry.action}-${entry.created_at}-${index}`}>
                        <b>{entry.action}</b>
                        <span>{fmt(entry.created_at)}</span>
                        <small>{JSON.stringify(entry.data)}</small>
                      </p>
                    ))}
                  </div>
                </details>
              )}

              <details className="dc-review3-tech">
                <summary>{copy("Технические данные")}</summary>
                <pre>
                  {JSON.stringify(
                    {
                      review_id: selected.id,
                      board_id: selected.board_id,
                      match_id: selected.match_id,
                      capabilities: selected.match_summary.capabilities,
                      gep_evidence: selected.match_summary.gep_evidence,
                      context: selected.context,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )}
        </main>
      </div>
    </section>
  )
}
