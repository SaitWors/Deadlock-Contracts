(function attachUploadQueue(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCUploadQueue = api
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const ITEM_STATE = Object.freeze({
    PENDING: 'PENDING',
    IN_FLIGHT: 'IN_FLIGHT',
    ACKNOWLEDGED: 'ACKNOWLEDGED',
    RETRY_WAIT: 'RETRY_WAIT',
    DEAD_LETTER: 'DEAD_LETTER',
  })
  const QUEUE_MAX_ITEMS = 200
  const QUEUE_MAX_BYTES = 1_000_000
  const DEAD_LETTER_MAX_ITEMS = 20
  const MAX_RETRIES = 8
  const CRITICAL = new Set(['match_started', 'match_ended'])

  function byteSize(value) {
    try { return new TextEncoder().encode(JSON.stringify(value)).length } catch (_) { return Infinity }
  }
  function classifyUploadError(error) {
    const status = Number(error?.status || 0)
    const code = String(error?.code || '')
    if (status === 401 || ['TOKEN_EXPIRED', 'TOKEN_REVOKED', 'AUTH_REQUIRED'].includes(code)) return 'AUTH'
    if (!status || status === 408 || status === 429 || status >= 500) return 'RETRY'
    return 'DEAD_LETTER'
  }
  function retryDelayMs(attempts, random = Math.random) {
    const count = Math.max(1, Number(attempts) || 1)
    const base = Math.min(300000, 5000 * (2 ** Math.min(6, count - 1)))
    return Math.min(300000, base + Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * 1000))
  }
  function sessionKey(payload) {
    const sessionId = String(payload?.session_id || '').trim()
    if (!sessionId) {
      const error = new Error('SESSION_ID_REQUIRED')
      error.code = 'SESSION_ID_REQUIRED'
      throw error
    }
    return `session:${sessionId}`
  }
  function idempotencyKey(payload, eventType, schemaVersion = 8) {
    return `${sessionKey(payload)}:event:${String(eventType)}:schema:${schemaVersion}`
  }

  function createUploadQueue({ items = [], deadLetter = [], now = Date.now, random = Math.random } = {}) {
    let queue = Array.isArray(items) ? items.map(item => ({ ...item })) : []
    let rejected = Array.isArray(deadLetter) ? deadLetter.map(item => ({ ...item })) : []
    const inFlight = new Set()
    let serial = 0

    function snapshot() {
      return {
        schema_version: 3,
        items: queue.map(item => ({ ...item })),
        dead_letter: rejected.map(item => ({ ...item })),
      }
    }
    function totals() {
      return { items: queue.length, bytes: byteSize(queue), dead_letter: rejected.length }
    }
    function compactHeartbeat(key) {
      const matching = queue
        .filter(item => item.session_key === key && item.event_type === 'heartbeat' && ![ITEM_STATE.IN_FLIGHT, ITEM_STATE.ACKNOWLEDGED, ITEM_STATE.DEAD_LETTER].includes(item.state))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      if (matching.length <= 1) return
      const keep = matching[0].id
      queue = queue.filter(item => item.event_type !== 'heartbeat' || item.session_key !== key || item.id === keep)
    }
    function freeSpace() {
      queue = queue.filter(item => item.state !== ITEM_STATE.ACKNOWLEDGED)
      if (queue.length <= QUEUE_MAX_ITEMS && byteSize(queue) <= QUEUE_MAX_BYTES) return true
      const replaceable = queue.filter(item => item.event_type === 'heartbeat').sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      for (const item of replaceable) {
        queue = queue.filter(candidate => candidate.id !== item.id)
        if (queue.length <= QUEUE_MAX_ITEMS && byteSize(queue) <= QUEUE_MAX_BYTES) return true
      }
      return queue.length <= QUEUE_MAX_ITEMS && byteSize(queue) <= QUEUE_MAX_BYTES
    }
    function enqueue(payload, { eventType = payload?.event_type, sequence = null, idempotencyKey: key = null, sessionKey: sessionKeyValue = null, createdAt = null } = {}) {
      const event = String(eventType || 'heartbeat')
      const session_key = sessionKeyValue || sessionKey(payload)
      const seq = Number.isInteger(sequence) ? sequence : (Number(payload?.sequence) || ++serial)
      const idempotency_key = key || payload?.idempotency_key || idempotencyKey(payload, event, payload?.schema_version || 8)
      const duplicate = queue.find(item => item.idempotency_key === idempotency_key) || rejected.find(item => item.idempotency_key === idempotency_key)
      if (duplicate) return { ok: true, duplicate: true, item: { ...duplicate } }
      const item = {
        id: `upload-${Date.now()}-${++serial}`,
        idempotency_key,
        session_key,
        sequence: seq,
        event_type: event,
        state: ITEM_STATE.PENDING,
        created_at: createdAt || new Date(now()).toISOString(),
        attempts: 0,
        next_attempt_at: null,
        last_error: null,
        payload: { ...payload, idempotency_key, sequence: seq },
        byte_size: 0,
      }
      item.byte_size = byteSize(item.payload)
      queue.push(item)
      if (event === 'heartbeat') compactHeartbeat(session_key)
      if (!freeSpace()) {
        queue = queue.filter(candidate => candidate.id !== item.id)
        return CRITICAL.has(event)
          ? { ok: false, code: 'LOCAL_STORAGE_FULL', critical: true }
          : { ok: false, code: 'QUEUE_CAPACITY_EXCEEDED' }
      }
      return { ok: true, item: { ...item } }
    }
    function hasRejectedPrior(key, sequence) {
      return rejected.some(item => item.session_key === key && Number(item.sequence) < Number(sequence))
    }
    function allPriorAcknowledged(key, sequence) {
      if (hasRejectedPrior(key, sequence)) return false
      return !queue.some(item => item.session_key === key && item.sequence < sequence && item.state !== ITEM_STATE.ACKNOWLEDGED)
    }
    function isDue(item, time = now()) {
      if (item.state === ITEM_STATE.PENDING) return true
      if (item.state !== ITEM_STATE.RETRY_WAIT) return false
      const due = Date.parse(item.next_attempt_at || '')
      return !Number.isFinite(due) || due <= time
    }
    function nextDue({ time = now(), prerequisite = null } = {}) {
      const sorted = queue
        .filter(item => isDue(item, time) && !inFlight.has(item.idempotency_key) && item.state !== ITEM_STATE.DEAD_LETTER)
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.sequence - b.sequence)
      for (const item of sorted) {
        // A final can never bypass a rejected causal predecessor. Isolate the
        // final too instead of leaving it permanently pending or sending an
        // untrustworthy terminal event after a rejected start/phase.
        if (item.event_type === 'match_ended' && hasRejectedPrior(item.session_key, item.sequence)) {
          deadLetterItem(item.id, { code: 'PREREQUISITE_REJECTED' })
          continue
        }
        const allowed = prerequisite
          ? prerequisite(item)
          : item.event_type !== 'match_ended' || allPriorAcknowledged(item.session_key, item.sequence)
        if (allowed) return { ...item }
      }
      return null
    }
    function markInFlight(id) {
      const item = queue.find(candidate => candidate.id === id)
      if (!item) return null
      item.state = ITEM_STATE.IN_FLIGHT
      inFlight.add(item.idempotency_key)
      return { ...item }
    }
    function acknowledge(id, meta = {}) {
      const item = queue.find(candidate => candidate.id === id)
      if (!item) return false
      item.state = ITEM_STATE.ACKNOWLEDGED
      item.acknowledged_at = new Date(now()).toISOString()
      item.ack = meta
      inFlight.delete(item.idempotency_key)
      return true
    }
    function deadLetterItem(id, reason = {}) {
      const index = queue.findIndex(candidate => candidate.id === id)
      if (index < 0) return { ok: false }
      const [item] = queue.splice(index, 1)
      inFlight.delete(item.idempotency_key)
      item.state = ITEM_STATE.DEAD_LETTER
      item.dead_letter_at = new Date(now()).toISOString()
      item.last_error = { ...(item.last_error || {}), ...reason }
      rejected.push(item)
      if (rejected.length > DEAD_LETTER_MAX_ITEMS) rejected = rejected.slice(-DEAD_LETTER_MAX_ITEMS)
      return { ok: true, item: { ...item } }
    }
    function retry(id, error = {}) {
      const item = queue.find(candidate => candidate.id === id)
      if (!item) return { ok: false }
      inFlight.delete(item.idempotency_key)
      item.attempts = (item.attempts || 0) + 1
      item.last_error = {
        status: error?.status || null,
        code: error?.code || null,
        request_id: error?.requestId || error?.request_id || null,
        message: String(error?.message || error),
      }
      if (item.attempts >= MAX_RETRIES) return deadLetterItem(id, { code: 'MAX_RETRIES', error: item.last_error })
      item.state = ITEM_STATE.RETRY_WAIT
      item.next_attempt_at = new Date(now() + retryDelayMs(item.attempts, random)).toISOString()
      return { ok: true, item: { ...item } }
    }
    function removeAcknowledged() { queue = queue.filter(item => item.state !== ITEM_STATE.ACKNOWLEDGED) }
    function migrateLegacy(legacy = []) {
      const sorted = (Array.isArray(legacy) ? legacy : []).slice().sort((a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0))
      const seqBySession = new Map()
      for (const old of sorted) {
        const payload = old?.payload || {}
        if (!payload.match_id || !payload.session_id) {
          rejected.push({ ...old, state: ITEM_STATE.DEAD_LETTER, last_error: { code: 'LEGACY_UNCORRELATED' }, dead_letter_at: new Date(now()).toISOString() })
          continue
        }
        const key = sessionKey(payload)
        const seq = (seqBySession.get(key) || 0) + 1
        seqBySession.set(key, seq)
        const event = String(old.event_type || payload.event_type || 'heartbeat')
        if (event === 'match_ended') {
          rejected.push({ ...old, idempotency_key: idempotencyKey(payload, event, payload.schema_version || 7), session_key: key, sequence: seq, state: ITEM_STATE.DEAD_LETTER, last_error: { code: 'LEGACY_ALPHA8_TERMINAL_REVIEW' }, dead_letter_at: new Date(now()).toISOString() })
          continue
        }
        enqueue(payload, { eventType: event, sequence: seq, sessionKey: key, createdAt: old.created_at })
      }
      if (rejected.length > DEAD_LETTER_MAX_ITEMS) rejected = rejected.slice(-DEAD_LETTER_MAX_ITEMS)
      return snapshot()
    }
    function clear({ deadLetters = false } = {}) {
      queue = []
      inFlight.clear()
      if (deadLetters) rejected = []
    }
    function replace(data = {}) {
      inFlight.clear()
      const restoredDead = Array.isArray(data.dead_letter) ? data.dead_letter.map(item => ({ ...item })) : []
      const restored = []
      for (const raw of Array.isArray(data.items) ? data.items : []) {
        const item = { ...raw, payload: { ...(raw?.payload || {}) } }
        let causalKey
        try {
          causalKey = sessionKey(item.payload)
        } catch (_) {
          restoredDead.push({
            ...item,
            state: ITEM_STATE.DEAD_LETTER,
            dead_letter_at: new Date(now()).toISOString(),
            last_error: { ...(item.last_error || {}), code: 'RECOVERED_SESSION_ID_REQUIRED' },
          })
          continue
        }

        // Queue schema v3 changes only the causal scheduling key. Preserve the
        // existing idempotency key because an IN_FLIGHT request may already have
        // reached the server before the Companion crashed and lost its ACK.
        item.session_key = causalKey
        if (item.state === ITEM_STATE.IN_FLIGHT) {
          item.state = ITEM_STATE.RETRY_WAIT
          item.next_attempt_at = new Date(now()).toISOString()
          item.last_error = {
            ...(item.last_error || {}),
            code: 'RECOVERED_UNKNOWN_IN_FLIGHT',
          }
        }
        restored.push(item)
      }
      queue = restored
      rejected = restoredDead.slice(-DEAD_LETTER_MAX_ITEMS)
      return snapshot()
    }

    return {
      ITEM_STATE,
      enqueue,
      nextDue,
      markInFlight,
      acknowledge,
      retry,
      deadLetter: deadLetterItem,
      allPriorAcknowledged,
      hasRejectedPrior,
      removeAcknowledged,
      migrateLegacy,
      clear,
      replace,
      snapshot,
      totals,
    }
  }

  return {
    ITEM_STATE,
    QUEUE_MAX_ITEMS,
    QUEUE_MAX_BYTES,
    DEAD_LETTER_MAX_ITEMS,
    MAX_RETRIES,
    classifyUploadError,
    retryDelayMs,
    sessionKey,
    idempotencyKey,
    createUploadQueue,
  }
})
