import { useCallback, useEffect, useRef, useState } from "react"
import type { MatchMode } from "../ModeSelector"
import type { PersonalProgressData, ProgressGoal, ProgressIntent } from "./types"

type ProgressError = "request" | "changed" | "unauthorized"
type ProgressState = {
  key: string
  data: PersonalProgressData | null
  loading: boolean
  error: ProgressError | null
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)
const count = (value: unknown) => finite(value) && value >= 0
const nullableNumber = (value: unknown) => value === null || finite(value)
function validText(value: unknown) {
  if (!value || typeof value !== "object") return false
  const text = value as { ru?: unknown; en?: unknown }
  return (
    (typeof text.ru === "string" || typeof text.en === "string") &&
    (text.ru === undefined || typeof text.ru === "string") &&
    (text.en === undefined || typeof text.en === "string")
  )
}
function validSources(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every((source) => source && typeof source.kind === "string" && count(source.count))
  )
}

function validGoal(goal: unknown): goal is ProgressGoal {
  if (!goal || typeof goal !== "object") return false
  const value = goal as ProgressGoal
  return (
    typeof value.option_id === "string" &&
    typeof value.status === "string" &&
    validText(value.title_i18n) &&
    validText(value.description_i18n) &&
    validText(value.reason) &&
    count(value.reward_xp) &&
    typeof value.personalized === "boolean" &&
    Array.isArray(value.conditions) &&
    value.conditions.every(
      (condition) =>
        condition &&
        typeof condition.metric === "string" &&
        typeof condition.operator === "string" &&
        finite(condition.target),
    ) &&
    Array.isArray(value.basis) &&
    value.basis.every(
      (basis) =>
        basis &&
        typeof basis === "object" &&
        (basis.metric === undefined || typeof basis.metric === "string") &&
        (basis.median === undefined || nullableNumber(basis.median)),
    )
  )
}
function validProgress(
  value: unknown,
  mode: MatchMode,
  intent: ProgressIntent,
): value is PersonalProgressData {
  if (!value || typeof value !== "object") return false
  const data = value as PersonalProgressData
  return (
    data.version === "personal-progress-1" &&
    data.mode === mode &&
    data.intent === intent &&
    count(data.sample_size) &&
    finite(data.minimum_sample_size) &&
    data.minimum_sample_size > 0 &&
    ["COLD_START", "LOW", "MEDIUM", "HIGH"].includes(data.confidence) &&
    validSources(data.sources) &&
    (data.goal === null || validGoal(data.goal)) &&
    Array.isArray(data.alternatives) &&
    data.alternatives.every(validGoal) &&
    (data.board === null ||
      (!!data.board &&
        typeof data.board.id === "string" &&
        typeof data.board.status === "string" &&
        count(data.board.generation))) &&
    (data.debrief === null ||
      (!!data.debrief &&
        typeof data.debrief.match_id === "string" &&
        nullableNumber(data.debrief.hero_id) &&
        (data.debrief.played_at === null || typeof data.debrief.played_at === "string") &&
        typeof data.debrief.source === "string" &&
        count(data.debrief.baseline_sample_size) &&
        ["SAME_HERO", "SAME_MODE", "NONE"].includes(data.debrief.baseline_scope) &&
        count(data.debrief.xp_granted) &&
        Array.isArray(data.debrief.comparisons) &&
        data.debrief.comparisons.every(
          (comparison) =>
            comparison &&
            typeof comparison.metric === "string" &&
            nullableNumber(comparison.current) &&
            nullableNumber(comparison.median) &&
            nullableNumber(comparison.delta) &&
            count(comparison.n) &&
            typeof comparison.improved === "boolean",
        ) &&
        Array.isArray(data.debrief.contracts) &&
        data.debrief.contracts.every(
          (contract) =>
            contract &&
            typeof contract.assignment_id === "string" &&
            validText(contract.title_i18n) &&
            typeof contract.status === "string" &&
            count(contract.reward_granted_xp) &&
            (contract.explanation === null || typeof contract.explanation === "string"),
        ))) &&
    Array.isArray(data.heroes) &&
    data.heroes.every(
      (hero) =>
        !!hero &&
        finite(hero.hero_id) &&
        count(hero.matches) &&
        count(hero.contracts_completed) &&
        Array.isArray(hero.records) &&
        hero.records.every(
          (record) => record && typeof record.metric === "string" && nullableNumber(record.value),
        ) &&
        validSources(hero.sources),
    )
  )
}

export function usePersonalProgress({
  accountId,
  mode,
  intent,
  reloadKey,
}: {
  accountId: string
  mode: MatchMode
  intent: ProgressIntent
  reloadKey: string | number
}) {
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify([accountId, mode, intent, reloadKey, revision])
  const request = useRef(0)
  const [state, setState] = useState<ProgressState>({
    key: "",
    data: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    const current = ++request.current
    const controller = new AbortController()
    const active = () => current === request.current && !controller.signal.aborted
    setState({ key, data: null, loading: true, error: null })
    const load = async () => {
      let kind: ProgressError = "request"
      try {
        const query = new URLSearchParams({ mode, intent })
        const response = await fetch(`/api/personal-progress?${query}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        })
        if (response.status === 401 || response.status === 403) {
          kind = "unauthorized"
          throw new Error("Private session unavailable")
        }
        if (!response.ok) throw new Error("Progress request failed")
        const next: unknown = await response.json()
        if (!validProgress(next, mode, intent)) {
          kind = "changed"
          throw new Error("Progress response changed")
        }
        if (active()) setState({ key, data: next, loading: false, error: null })
      } catch {
        if (active()) setState({ key, data: null, loading: false, error: kind })
      }
    }
    void load()
    return () => {
      request.current++
      controller.abort()
    }
  }, [accountId, mode, intent, key])

  // A new account/query must stop displaying private data during the render
  // before the corresponding effect has had a chance to abort the old request.
  const current = state.key === key ? state : { data: null, loading: true, error: null }
  return { ...current, retry: useCallback(() => setRevision((value) => value + 1), []) }
}
