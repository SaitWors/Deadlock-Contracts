(function installQueuePolicy(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCQueuePolicy = api
})(typeof window !== 'undefined' ? window : globalThis, function createQueuePolicy() {
  const DEFAULT_LIMIT = 60
  const MAX_RETRY_DELAY_MS = 5 * 60 * 1000
  const PINNED_TYPES = new Set(['match_ended'])
  const TRANSITION_TYPES = new Set([
    'game_started',
    'game_stopped',
    'match_started',
    'match_ended',
    'phase_changed',
  ])

  function eventType(item) {
    return String(item?.event_type || '').toLowerCase()
  }

  function isPinned(item) {
    return PINNED_TYPES.has(eventType(item))
  }

  function isTransition(item) {
    return TRANSITION_TYPES.has(eventType(item))
  }

  // Keep terminal evidence even when localStorage is under pressure. Replaceable
  // heartbeats are evicted first, then ordinary telemetry, then old transitions.
  // If the queue contains only terminal events it is intentionally allowed to
  // exceed the soft limit rather than silently lose a final match upload.
  function trim(queue, limit = DEFAULT_LIMIT) {
    const output = Array.isArray(queue) ? [...queue] : []
    const softLimit = Math.max(1, Number(limit) || DEFAULT_LIMIT)
    while (output.length > softLimit) {
      let index = output.findIndex(item => eventType(item) === 'heartbeat')
      if (index < 0) index = output.findIndex(item => !isPinned(item) && !isTransition(item))
      if (index < 0) index = output.findIndex(item => !isPinned(item))
      if (index < 0) break
      output.splice(index, 1)
    }
    return output
  }

  function retryDelayMs(attempts, random = Math.random) {
    const count = Math.max(1, Math.trunc(Number(attempts) || 1))
    const exponential = Math.min(MAX_RETRY_DELAY_MS, 5000 * (2 ** Math.min(6, count - 1)))
    const jitter = Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * 1000)
    return Math.min(MAX_RETRY_DELAY_MS, exponential + jitter)
  }

  function isDue(item, now = Date.now()) {
    const due = Date.parse(item?.next_attempt_at || '')
    return !Number.isFinite(due) || due <= now
  }

  return {
    DEFAULT_LIMIT,
    MAX_RETRY_DELAY_MS,
    PINNED_TYPES,
    TRANSITION_TYPES,
    isPinned,
    isTransition,
    trim,
    retryDelayMs,
    isDue,
  }
})
