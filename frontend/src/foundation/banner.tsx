import { createContext, useContext, useEffect, useReducer, useState, type ReactNode } from "react"
import { ApiError, request } from "../community/api"

export const bannerPath = "/api/foundation/banner"
const preferenceEvent = "dc:banner-preference"
const dayMs = 86_400_000

export type BannerMode = "favorite_hero" | "collection" | "selected_card" | "random_hero" | "off"
export type BannerCard = {
  id: string
  hero_key: string
  hero_name: string
  title: string
  artist: string
  image_url: string
  crop_x: number
  crop_y: number
}
export type BannerAccount = { id: string; csrf: string }

type Banner = {
  account_key: string
  mode: BannerMode
  card: BannerCard | null
  refreshing: boolean
}
type BannerState = {
  accountId: string
  card: BannerCard | null
  loading: boolean
  error: boolean
}

const AccountContext = createContext<BannerAccount | null>(null)

export function BannerAccountProvider({
  account,
  children,
}: {
  account: BannerAccount | null
  children: ReactNode
}) {
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>
}

export function useBannerAccount() {
  return useContext(AccountContext)
}

export function bannerPreferenceChanged() {
  window.dispatchEvent(new Event(preferenceEvent))
}

export function useFoundationBanner(accountId: string | null, enabled = true) {
  const [state, setState] = useState<BannerState | null>(null)
  const [revision, retry] = useReducer((value: number) => value + 1, 0)

  useEffect(() => {
    if (!accountId || !enabled) return
    let active = true
    let current: AbortController | null = null
    let timer: number | undefined
    let attempts = 0

    const load = async () => {
      if (!active || current || document.hidden) return
      window.clearTimeout(timer)
      const controller = new AbortController()
      current = controller
      const timeout = window.setTimeout(() => controller.abort(), 8000)
      try {
        const data = await request<Banner>(bannerPath, "", { signal: controller.signal })
        if (!active || current !== controller) return
        if (data.account_key !== accountId) {
          setState({ accountId, card: null, loading: false, error: false })
          return
        }
        setState({ accountId, card: data.card, loading: false, error: false })
        const nextDay = dayMs - (Date.now() % dayMs) + 1000
        const poll = data.refreshing ? [2500, 6000, 12_000, 24_000][attempts++] : undefined
        if (!data.refreshing) attempts = 0
        const delay = poll ?? (data.card ? Math.min(nextDay, 300_000) : nextDay)
        timer = window.setTimeout(() => void load(), delay)
      } catch (error) {
        if (active && current === controller) {
          const sessionEnded = error instanceof ApiError && [401, 403].includes(error.status)
          setState((old) => ({
            accountId,
            card: !sessionEnded && old?.accountId === accountId ? old.card : null,
            loading: false,
            error: true,
          }))
        }
      } finally {
        window.clearTimeout(timeout)
        if (current === controller) current = null
      }
    }
    const onFocus = () => {
      attempts = 0
      void load()
    }
    const onPreferenceChange = () => {
      current?.abort()
      current = null
      onFocus()
    }

    void load()
    document.addEventListener("visibilitychange", onFocus)
    window.addEventListener("focus", onFocus)
    window.addEventListener("online", onFocus)
    window.addEventListener(preferenceEvent, onPreferenceChange)
    return () => {
      active = false
      current?.abort()
      window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", onFocus)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("online", onFocus)
      window.removeEventListener(preferenceEvent, onPreferenceChange)
    }
  }, [accountId, enabled, revision])

  const displayed = enabled && state?.accountId === accountId ? state : null
  return {
    card: displayed?.card ?? null,
    loading: enabled && accountId !== null && (displayed?.loading ?? true),
    error: displayed?.error ?? false,
    retry,
  }
}
