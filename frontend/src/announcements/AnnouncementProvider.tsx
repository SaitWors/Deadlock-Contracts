import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useLanguage } from "../i18n"
import { fetchActiveAnnouncements, postAnnouncementReceipt } from "./announcement-api"
import type {
  Announcement,
  AnnouncementReceiptAction,
  SiteAnnouncementSurface,
} from "./announcement-types"

type AnnouncementContextValue = {
  items: Announcement[]
  surface: SiteAnnouncementSurface
  centerOpen: boolean
  setCenterOpen: (open: boolean) => void
  configureSession: (authenticated: boolean, csrf: string | null, userId: string | null) => void
  setSurface: (surface: SiteAnnouncementSurface) => void
  dismiss: (item: Announcement) => void
  acknowledge: (item: Announcement) => void
  serverNow: () => number
  refresh: () => void
}

const AnnouncementContext = createContext<AnnouncementContextValue | null>(null)
const PENDING_RECEIPTS_KEY = "dc.announcement.receipts.pending.v1"

type PendingReceipt = {
  userId: string
  announcementId: string
  revision: number
  surface: SiteAnnouncementSurface
  action: AnnouncementReceiptAction
}

function dismissedKey(item: Announcement) {
  return `dc.announcement.dismissed.${item.id}.${item.revision}`
}

function isLocallyDismissed(item: Announcement) {
  try {
    return Boolean(window.localStorage.getItem(dismissedKey(item)))
  } catch {
    return false
  }
}

function storeLocalDismiss(item: Announcement) {
  try {
    window.localStorage.setItem(dismissedKey(item), new Date().toISOString())
  } catch {
    // Storage can be unavailable in privacy mode. Optimistic state still hides it.
  }
}

function pendingReceiptKey(item: PendingReceipt) {
  return `${item.userId}:${item.surface}:${item.announcementId}:${item.revision}:${item.action}`
}

function readPendingReceipts(): PendingReceipt[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_RECEIPTS_KEY) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is PendingReceipt =>
          item &&
          typeof item.userId === "string" &&
          item.userId.length > 0 &&
          item.userId.length <= 64 &&
          typeof item.announcementId === "string" &&
          item.announcementId.length > 0 &&
          item.announcementId.length <= 64 &&
          Number.isInteger(item.revision) &&
          item.revision > 0 &&
          ["SITE_PUBLIC", "SITE_DASHBOARD"].includes(item.surface) &&
          ["SEEN", "DISMISSED", "ACKNOWLEDGED"].includes(item.action),
      )
      .slice(-100)
  } catch {
    return []
  }
}

function writePendingReceipts(items: PendingReceipt[]) {
  try {
    window.localStorage.setItem(PENDING_RECEIPTS_KEY, JSON.stringify(items.slice(-100)))
  } catch {
    // Receipt delivery remains best-effort when local storage is unavailable.
  }
}

function queuePendingReceipt(item: PendingReceipt) {
  const current = readPendingReceipts()
  const key = pendingReceiptKey(item)
  if (!current.some((candidate) => pendingReceiptKey(candidate) === key)) current.push(item)
  writePendingReceipts(current)
}

function removePendingReceipt(item: PendingReceipt) {
  const key = pendingReceiptKey(item)
  writePendingReceipts(
    readPendingReceipts().filter((candidate) => pendingReceiptKey(candidate) !== key),
  )
}

function initialSurface(): SiteAnnouncementSurface {
  return window.location.pathname.startsWith("/admin") ? "SITE_DASHBOARD" : "SITE_PUBLIC"
}

export function AnnouncementProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage()
  const [surface, setSurface] = useState<SiteAnnouncementSurface>(initialSurface)
  const [items, setItems] = useState<Announcement[]>([])
  const [centerOpen, setCenterOpen] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const sessionRef = useRef({
    authenticated: false,
    csrf: null as string | null,
    userId: null as string | null,
  })
  const serverOffsetRef = useRef(0)
  const seenRef = useRef(new Set<string>())
  const pollRef = useRef(60_000)
  const flushingReceiptsRef = useRef(false)

  const configureSession = useCallback(
    (authenticated: boolean, csrf: string | null, userId: string | null) => {
      const previous = sessionRef.current
      sessionRef.current = { authenticated, csrf, userId }
      if (
        previous.authenticated !== authenticated ||
        previous.csrf !== csrf ||
        previous.userId !== userId
      ) {
        setRefreshVersion((value) => value + 1)
      }
    },
    [],
  )

  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), [])

  const sendReceipt = useCallback(
    (item: Announcement, action: AnnouncementReceiptAction) => {
      const session = sessionRef.current
      if (!session.authenticated || !session.csrf || !session.userId) return
      const pending = {
        userId: session.userId,
        announcementId: item.id,
        revision: item.revision,
        surface,
        action,
      }
      queuePendingReceipt(pending)
      void postAnnouncementReceipt(item.id, item.revision, surface, action, session.csrf)
        .then(() => removePendingReceipt(pending))
        .catch(() => undefined)
    },
    [surface],
  )

  const flushPendingReceipts = useCallback(async () => {
    const session = sessionRef.current
    if (!session.authenticated || !session.csrf || !session.userId || flushingReceiptsRef.current) {
      return
    }
    flushingReceiptsRef.current = true
    try {
      const actionOrder: Record<AnnouncementReceiptAction, number> = {
        SEEN: 0,
        DISMISSED: 1,
        ACKNOWLEDGED: 1,
      }
      const pending = readPendingReceipts()
        .filter((item) => item.userId === session.userId)
        .sort((left, right) => actionOrder[left.action] - actionOrder[right.action])
      for (const item of pending) {
        try {
          await postAnnouncementReceipt(
            item.announcementId,
            item.revision,
            item.surface,
            item.action,
            session.csrf,
          )
          removePendingReceipt(item)
        } catch {
          // Keep the item for the next focus/online/session retry.
        }
      }
    } finally {
      flushingReceiptsRef.current = false
    }
  }, [])

  useEffect(() => {
    const flush = () => void flushPendingReceipts()
    flush()
    window.addEventListener("online", flush)
    window.addEventListener("focus", flush)
    return () => {
      window.removeEventListener("online", flush)
      window.removeEventListener("focus", flush)
    }
  }, [flushPendingReceipts, refreshVersion])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let timer = 0
    let requestVersion = 0

    const load = async () => {
      const currentRequest = ++requestVersion
      window.clearTimeout(timer)
      try {
        const payload = await fetchActiveAnnouncements(surface, controller.signal)
        if (!active || currentRequest !== requestVersion) return
        const serverTime = Date.parse(payload.server_time)
        if (Number.isFinite(serverTime)) serverOffsetRef.current = serverTime - Date.now()
        pollRef.current = Math.max(15, Math.min(3600, payload.poll_after_seconds || 60)) * 1000
        const valid = (payload.items || []).filter((item) => {
          const end = Date.parse(item.ends_at)
          return Number.isFinite(end) && end > Date.now() + serverOffsetRef.current
        })
        setItems(valid.filter((item) => !isLocallyDismissed(item)))
      } catch (error) {
        if (
          active &&
          currentRequest === requestVersion &&
          (error as Error)?.name !== "AbortError"
        ) {
          setItems((previous) =>
            previous.filter(
              (item) => Date.parse(item.ends_at) > Date.now() + serverOffsetRef.current,
            ),
          )
        }
      } finally {
        if (active && currentRequest === requestVersion) {
          timer = window.setTimeout(load, pollRef.current)
        }
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timer)
        void load()
      }
    }
    const refreshNow = () => {
      window.clearTimeout(timer)
      void load()
    }

    void load()
    window.addEventListener("focus", refreshNow)
    window.addEventListener("online", refreshNow)
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
      window.removeEventListener("focus", refreshNow)
      window.removeEventListener("online", refreshNow)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [language, refreshVersion, surface])

  useEffect(() => {
    for (const item of items) {
      const key = `${surface}:${item.id}:${item.revision}`
      if (seenRef.current.has(key)) continue
      seenRef.current.add(key)
      sendReceipt(item, "SEEN")
    }
  }, [items, sendReceipt, surface])

  const hide = useCallback(
    (item: Announcement, action: AnnouncementReceiptAction) => {
      storeLocalDismiss(item)
      setItems((previous) =>
        previous.filter(
          (candidate) => candidate.id !== item.id || candidate.revision !== item.revision,
        ),
      )
      sendReceipt(item, action)
    },
    [sendReceipt],
  )

  const value = useMemo<AnnouncementContextValue>(
    () => ({
      items,
      surface,
      centerOpen,
      setCenterOpen,
      configureSession,
      setSurface,
      dismiss: (item) => hide(item, "DISMISSED"),
      acknowledge: (item) => hide(item, "ACKNOWLEDGED"),
      serverNow: () => Date.now() + serverOffsetRef.current,
      refresh,
    }),
    [centerOpen, configureSession, hide, items, refresh, surface],
  )

  return <AnnouncementContext.Provider value={value}>{children}</AnnouncementContext.Provider>
}

export function useAnnouncements() {
  const value = useContext(AnnouncementContext)
  if (!value) throw new Error("useAnnouncements must be used inside AnnouncementProvider")
  return value
}
