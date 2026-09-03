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

function fmt(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("ru-RU", {
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
  if (seconds < 60) return `${seconds}с`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}м`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}ч`
  return `${Math.floor(seconds / 86400)}д`
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
  return labels[metric] || metric
}

function conditionText(metric: string, operator: string, target: number) {
  const symbol = operator === "lte" ? "≤" : operator === "eq" ? "=" : "≥"
  if (metric === "match.duration_s") {
    const minutes = Math.floor(target / 60)
    const seconds = Math.floor(target % 60)
    return `${metricLabel(metric)} ${symbol} ${minutes}:${String(seconds).padStart(2, "0")}`
  }
  if (metric === "match.win") return `${metricLabel(metric)} = WIN`
  return `${metricLabel(metric)} ${symbol} ${target.toLocaleString("ru-RU")}`
}

function actualText(metric: string, value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—"
  if (metric === "match.duration_s") {
    const total = Number(value)
    return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, "0")}`
  }
  if (metric === "match.win") return Number(value) === 1 ? "WIN" : "LOSS"
  if (metric === "player.kda") return Number(value).toFixed(2)
  return Number(value).toLocaleString("ru-RU")
}

function claimRemaining(review: AdminReview, nowMs: number) {
  const expires = review.claim.expires_at ? new Date(review.claim.expires_at).getTime() : 0
  if (!review.claim.active || !Number.isFinite(expires)) return 0
  return Math.max(0, Math.floor((expires - nowMs) / 1000))
}

function claimTimeLabel(seconds: number) {
  if (seconds <= 0) return "истёк"
  const minutes = Math.floor(seconds / 60)
  const tail = seconds % 60
  return `${minutes}:${String(tail).padStart(2, "0")}`
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
      setNotice(force ? "Заявка принудительно перехвачена." : "Заявка взята в работу на 10 минут.")
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
      setNotice("Claim освобождён.")
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const markNeedsInfo = async () => {
    if (!selected) return
    if (!isMine) {
      setError("Сначала возьмите заявку в работу.")
      return
    }
    if (reviewerNote.trim().length < 5) {
      setError("Для NEEDS_INFO добавьте пояснение минимум из 5 символов.")
      return
    }
    try {
      setLoading(true)
      await adminApi(`/api/admin/auto-reviews/${selected.id}/needs-info`, csrf, {
        method: "POST",
        body: JSON.stringify({ note: reviewerNote.trim() }),
      })
      const data = await loadInbox(0)
      setNotice("Заявка отмечена как NEEDS_INFO и освобождена.")
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
      setError("Сначала возьмите заявку в работу.")
      return null
    }
    if (selectedPending.some((item) => !decisions[item.id])) {
      setError("Выберите решение для каждого REVIEW_REQUIRED контракта.")
      return null
    }

    const hasNegative = selectedPending.some((item) =>
      ["FAILED", "VOID"].includes(decisions[item.id]),
    )
    if (hasNegative && !reasonCode) {
      setError("Для FAILED/VOID обязательно выберите причину.")
      return null
    }
    if (reasonCode === "OTHER" && reviewerNote.trim().length < 5) {
      setError("Для OTHER добавьте пояснение минимум из 5 символов.")
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
          `Для COMPLETED по «${item.title}» укажите факт: автоматическое значение отсутствует.`,
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
      setNotice(`Review закрыт. В очередь наград отправлено +${preview.reward_xp_total} XP.`)
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
      setNotice("Прямая ссылка на Review скопирована.")
    } catch {
      setError(url)
    }
  }

  return (
    <section className="dc-review3">
      <header className="dc-review3-head">
        <div>
          <p className="dc-eyebrow">REVIEW INBOX / MODERATION DESK</p>
          <h1>Internal Review</h1>
          <p>
            Claim координирует работу модераторов. Финальное решение всё равно фиксируется
            транзакционно через ModerationService.
          </p>
        </div>
        <div className="dc-review3-summary">
          <b>{total}</b>
          <span>в текущем фильтре</span>
        </div>
      </header>

      <div className="dc-review3-filters">
        <input
          value={query}
          placeholder="Review ID, Match ID, Board ID, игрок"
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
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="OPEN">OPEN</option>
          <option value="PENDING">PENDING</option>
          <option value="NEEDS_INFO">NEEDS_INFO</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="REJECTED">REJECTED</option>
        </select>
        <select value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="ALL">Все режимы</option>
          <option value="STANDARD">STANDARD</option>
          <option value="RANKED">RANKED</option>
          <option value="STREET_BRAWL">STREET BRAWL</option>
        </select>
        <select value={claim} onChange={(event) => setClaim(event.target.value)}>
          <option value="ALL">Все claims</option>
          <option value="FREE">Свободные</option>
          <option value="MINE">Мои</option>
          <option value="CLAIMED">В работе</option>
        </select>
        <select value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="ALL">Любой settlement</option>
          <option value="OVERWOLF_GEP">OVERWOLF_GEP</option>
          <option value="DEADLOCK_API">DEADLOCK_API</option>
          <option value="LEGACY">LEGACY</option>
        </select>
        <select value={auditStatus} onChange={(event) => setAuditStatus(event.target.value)}>
          <option value="ALL">Любой audit</option>
          <option value="NOT_REQUESTED">NOT_REQUESTED</option>
          <option value="PENDING">PENDING</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="MISMATCH">MISMATCH</option>
          <option value="UNAVAILABLE">UNAVAILABLE</option>
        </select>
        <select value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="ALL">Любой приоритет</option>
          <option value="HIGH">Высокий ≤ 25</option>
          <option value="NORMAL">Обычный &gt; 25</option>
        </select>
        <select value={age} onChange={(event) => setAge(event.target.value)}>
          <option value="ALL">Любой возраст</option>
          <option value="15M">Старше 15 минут</option>
          <option value="1H">Старше часа</option>
          <option value="6H">Старше 6 часов</option>
          <option value="24H">Старше суток</option>
        </select>
        <input
          value={reason}
          placeholder="Причина Review"
          onChange={(event) => setReason(event.target.value)}
        />
        <input
          value={claimant}
          placeholder="Модератор claim"
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
          ОБНОВИТЬ
        </button>
      </div>

      <div className={`dc-review3-layout ${selected ? "has-detail" : ""}`}>
        <aside className="dc-review3-inbox">
          {items.length === 0 && <div className="dc-admin-empty">Очередь пуста.</div>}
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
                  {review.mode} · P{review.priority} · {ageLabel(review.created_at)}
                </small>
                <small>
                  {review.match_summary.settlement_source || review.match_summary.provider || "—"} ·{" "}
                  {review.match_summary.audit_status || "—"}
                </small>
                <em className={mine ? "mine" : review.claim.active ? "claimed" : "free"}>
                  {mine
                    ? `МОЙ CLAIM · ${claimTimeLabel(claimRemaining(review, nowMs))}`
                    : review.claim.active
                      ? `В РАБОТЕ · ${review.claim.claimed_by?.display_name || "staff"}`
                      : "СВОБОДНО"}
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
              Выберите Review слева или откройте прямую ссылку /admin/reviews/&lt;id&gt;.
            </div>
          ) : (
            <>
              <button className="dc-admin-mobile-back" type="button" onClick={closeDetail}>
                ← К очереди
              </button>

              <div className="dc-review3-detail-head">
                <div>
                  <p className="dc-eyebrow">
                    REVIEW #{selected.id.slice(0, 8)} / BOARD {selected.board_id.slice(0, 8)}
                  </p>
                  <h2>Матч #{selected.match_id || "—"}</h2>
                  <p>
                    {selected.player.display_name} · создан {fmt(selected.created_at)}
                  </p>
                </div>
                <div className="dc-review3-head-actions">
                  <button className="dc-ghost" onClick={() => void copyDeepLink()}>
                    СКОПИРОВАТЬ ССЫЛКУ
                  </button>
                  {!selected.claim.active &&
                    ["PENDING", "NEEDS_INFO"].includes(selected.status) && (
                      <button
                        className="dc-primary"
                        disabled={loading}
                        onClick={() => void claimSelected(false)}
                      >
                        ВЗЯТЬ В РАБОТУ
                      </button>
                    )}
                  {isMine && (
                    <>
                      <button
                        className="dc-ghost"
                        disabled={loading}
                        onClick={() => void claimSelected(false)}
                      >
                        +10 МИН
                      </button>
                      <button
                        className="dc-ghost"
                        disabled={loading}
                        onClick={() => void releaseSelected(false)}
                      >
                        ОСВОБОДИТЬ
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
                        ПЕРЕХВАТИТЬ
                      </button>
                      <button
                        className="dc-ghost"
                        disabled={loading}
                        onClick={() => void releaseSelected(true)}
                      >
                        СНЯТЬ CLAIM
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="dc-review3-claimbar">
                <span className={isMine ? "mine" : selected.claim.active ? "claimed" : "free"}>
                  {isMine
                    ? `МОЙ CLAIM · осталось ${claimTimeLabel(claimRemaining(selected, nowMs))}`
                    : selectedClaimActive
                      ? `В работе у ${selected.claim.claimed_by?.display_name || "staff"} · ${claimTimeLabel(
                          claimRemaining(selected, nowMs),
                        )}`
                      : "Заявка свободна"}
                </span>
                <b>
                  {selected.status} · PRIORITY {selected.priority}
                </b>
              </div>

              <div className="dc-review3-facts">
                <div>
                  <span>K / D / A</span>
                  <b>
                    {selected.match_summary.kills ?? "—"} / {selected.match_summary.deaths ?? "—"} /{" "}
                    {selected.match_summary.assists ?? "—"}
                  </b>
                </div>
                <div>
                  <span>SOULS</span>
                  <b>{selected.match_summary.net_worth?.toLocaleString("ru-RU") ?? "—"}</b>
                </div>
                <div>
                  <span>HERO DAMAGE</span>
                  <b>{selected.match_summary.hero_damage?.toLocaleString("ru-RU") ?? "—"}</b>
                </div>
                <div>
                  <span>OBJECT DAMAGE</span>
                  <b>{selected.match_summary.object_damage?.toLocaleString("ru-RU") ?? "—"}</b>
                </div>
                <div>
                  <span>HEALING</span>
                  <b>{selected.match_summary.healing?.toLocaleString("ru-RU") ?? "—"}</b>
                </div>
                <div>
                  <span>DURATION</span>
                  <b>
                    {selected.match_summary.duration_s
                      ? actualText("match.duration_s", selected.match_summary.duration_s)
                      : "—"}
                  </b>
                </div>
              </div>

              <div className="dc-review3-trust">
                <div>
                  <span>SETTLEMENT</span>
                  <b>{selected.match_summary.settlement_source || "—"}</b>
                </div>
                <div>
                  <span>INTEGRITY</span>
                  <b>{selected.match_summary.integrity_status || "—"}</b>
                </div>
                <div>
                  <span>AUDIT</span>
                  <b>{selected.match_summary.audit_status || "—"}</b>
                </div>
                <div>
                  <span>MODE CONFIDENCE</span>
                  <b>{selected.match_summary.mode_confidence || "—"}</b>
                </div>
              </div>

              <section className="dc-review3-reasons">
                <h3>Почему создан Review</h3>
                {selected.reasons.length ? (
                  selected.reasons.map((reason, index) => (
                    <div key={`${reason.option_id}-${index}`}>
                      <b>{reason.title || reason.option_id}</b>
                      <span>{reason.reason}</span>
                    </div>
                  ))
                ) : (
                  <p>Причина не указана.</p>
                )}
              </section>

              <section className="dc-review3-contract-table">
                <div className="dc-review3-contract-head">
                  <span>Контракт / требовалось</span>
                  <span>Получено</span>
                  <span>Capability / источник</span>
                  <span>Решение</span>
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
                      <em>+{contract.reward_xp} XP</em>
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
                          ? `MISSING: ${contract.missing_capabilities.join(", ")}`
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
                                  {value}
                                </button>
                              ),
                            )}
                          </div>
                          <input
                            inputMode="decimal"
                            placeholder={
                              contract.actual === null
                                ? "Ручной факт"
                                : `Факт сервера: ${contract.actual}`
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
                        <summary>Предыдущие Evaluation · {contract.evaluations.length}</summary>
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
                      Причина FAILED / VOID
                      <select
                        value={reasonCode}
                        onChange={(event) => {
                          setReasonCode(event.target.value as AdminReviewReasonCode | "")
                          setPreview(null)
                        }}
                      >
                        <option value="">Не требуется / не выбрана</option>
                        {REASON_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {value} — {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Заметка модератора
                      <textarea
                        rows={3}
                        value={reviewerNote}
                        placeholder="Короткое пояснение решения или запрос данных"
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
                      НУЖНЫ ДАННЫЕ
                    </button>
                    <button
                      className="dc-primary"
                      disabled={loading}
                      onClick={() => void previewDecision()}
                    >
                      ПРЕДПРОСМОТР РЕШЕНИЯ
                    </button>
                  </div>
                </section>
              )}

              {preview && (
                <section className="dc-review3-preview">
                  <header>
                    <div>
                      <p className="dc-eyebrow">DECISION PREVIEW / NO WRITE YET</p>
                      <h3>Что будет изменено</h3>
                    </div>
                    <b>+{preview.reward_xp_total} XP</b>
                  </header>
                  {preview.settled_options.map((item) => {
                    const contract = selected.contracts.find((value) => value.id === item.option_id)
                    return (
                      <div key={item.option_id}>
                        <span>{contract?.title || item.option_id}</span>
                        <b>REVIEW_REQUIRED → {item.status}</b>
                        <em>{item.reward_xp ? `+${item.reward_xp} XP` : "0 XP"}</em>
                      </div>
                    )
                  })}
                  <footer>
                    <span>
                      Board → {preview.board_status_after}
                      {preview.resume_discovery ? " · discovery будет возобновлён" : ""}
                    </span>
                    <button
                      className="dc-primary"
                      disabled={loading}
                      onClick={() => void confirmDecision()}
                    >
                      ПОДТВЕРДИТЬ И ЗАКРЫТЬ
                    </button>
                  </footer>
                </section>
              )}

              {selected.history.length > 0 && (
                <details className="dc-review3-history">
                  <summary>История Review · {selected.history.length}</summary>
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
                <summary>Технические данные</summary>
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
