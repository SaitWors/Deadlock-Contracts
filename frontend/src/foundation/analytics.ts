export type FoundationEvent =
  | "session_started"
  | "onboarding_started"
  | "onboarding_skipped"
  | "onboarding_completed"
  | "contract_board_viewed"
  | "contract_selected"
  | "completion_viewed"
  | "collection_viewed"
  | "community_viewed"

const SESSION_GAP_MS = 30 * 60_000
const SAME_ACTION_MS = 750
let account: {
  userId: string
  csrf: string
  at: number
  last: Map<FoundationEvent, number>
} | null = null
let queue: Promise<void> = Promise.resolve()

export function trackFoundationEvent(userId: string, csrf: string, name: FoundationEvent): void {
  if (!userId || !csrf || document.visibilityState !== "visible" || !globalThis.crypto?.randomUUID)
    return

  const now = Date.now()
  if (account?.userId !== userId || csrf !== account.csrf) {
    account = { userId, csrf, at: 0, last: new Map() }
  }
  if (now - account.at >= SESSION_GAP_MS) account.last.clear()
  account.at = now

  const events: FoundationEvent[] = []
  if (!account.last.has("session_started")) events.push("session_started")
  if (name !== "session_started" && now - (account.last.get(name) ?? 0) >= SAME_ACTION_MS)
    events.push(name)

  for (const event of events) {
    account.last.set(event, now)
    const current = account
    const body = JSON.stringify({ event_id: crypto.randomUUID(), name: event })
    queue = queue.then(async () => {
      if (account !== current) return
      try {
        await fetch("/api/foundation/events", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body,
          keepalive: true,
          signal: AbortSignal.timeout(5_000),
        })
      } catch {
        // Product telemetry is best-effort and never blocks the action.
      }
    })
  }
}
