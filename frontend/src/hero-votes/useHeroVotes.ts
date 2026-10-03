import { useCallback, useEffect, useRef, useState } from "react"
import { adminApi } from "../admin/admin-api"
import type { PublicVotes } from "./types"

export function useHeroVotes() {
  const [data, setData] = useState<PublicVotes | null>(null)
  const [error, setError] = useState(false)
  const reload = useRef<() => void>(() => {})
  useEffect(() => {
    let stopped = false
    let pending = false
    let lastAttempt = 0
    const controller = new AbortController()
    const load = async (force = false) => {
      if (pending || (!force && Date.now() - lastAttempt < 30000)) return
      pending = true
      lastAttempt = Date.now()
      try {
        const next = await adminApi<PublicVotes>("/api/public/hero-votes", "", {
          signal: controller.signal,
        })
        if (
          typeof next?.enabled !== "boolean" ||
          (next.enabled && (!next.campaign || !Array.isArray(next.campaign.sources)))
        ) {
          throw new Error("Invalid poll response")
        }
        if (!stopped) {
          setData(next)
          setError(false)
        }
      } catch {
        if (!stopped) setError(true)
      } finally {
        pending = false
      }
    }
    reload.current = () => void load(true)
    const onFocus = () => {
      if (!document.hidden) void load()
    }
    void load(true)
    const timer = window.setInterval(onFocus, 60000)
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    const onChanged = () => void load(true)
    window.addEventListener("dc:hero-votes-changed", onChanged)
    return () => {
      stopped = true
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
      window.removeEventListener("dc:hero-votes-changed", onChanged)
      reload.current = () => {}
    }
  }, [])
  return { data, error, reload: useCallback(() => reload.current(), []) }
}
