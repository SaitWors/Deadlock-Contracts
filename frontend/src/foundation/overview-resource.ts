import { useCallback, useEffect, useState } from "react"
import { request } from "../community/api"

export type OverviewSummary = {
  completed_cases: number
  weekly: { date: string; cases: number; contracts: number; xp: number }[]
  collection: { items: number; designs: number }
  bureau: {
    slug: string
    name: string
    status: string
    operation: { title: { ru: string; en: string }; progress: number; target: number } | null
  } | null
  has_signed_case: boolean
  has_verified_result: boolean
  has_claimed_daily_pack: boolean
}

export type DailyOverview = {
  available: boolean
  next_reset_at: string
  claimed_at: string | null
  operation_id: string | null
  pack: { title: string } | null
}

export function useOverviewResource<T>(
  accountId: string,
  url: string,
  revision: number,
  watching: boolean,
) {
  const [result, setResult] = useState<{
    accountId: string
    data: T | null
    error: boolean
  } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    request<T>(url, "", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
    })
      .then((data) => {
        if (active) setResult({ accountId, data, error: false })
      })
      .catch(() => {
        if (!active) return
        setResult((previous) => ({
          accountId,
          data: previous?.accountId === accountId ? previous.data : null,
          error: true,
        }))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [accountId, url, revision, attempt, watching])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") retry()
    }
    const timer = watching ? window.setInterval(refresh, 60_000) : undefined
    window.addEventListener("online", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("online", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [retry, watching])
  const current = result?.accountId === accountId ? result : null
  return { data: current?.data ?? null, error: current?.error ?? false, loading: !current, retry }
}
