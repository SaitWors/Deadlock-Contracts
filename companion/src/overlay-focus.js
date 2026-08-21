(function attachOverlayFocus(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCOverlayFocus = api
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const SWITCH_DELAY_MS = 3000
  const ACTIVE_SUPPRESSION_MS = 2200

  const PRIORITY = {
    'player.kills': 100,
    'player.kda': 94,
    'player.assists': 90,
    'player.deaths': 86,
    'match.win': 82,
    'player.object_damage': 74,
    'player.hero_damage': 68,
    'player.healing': 62,
    'player.scoreboard_healing': 62,
    'player.net_worth.final': 34,
    'match.duration_s': 16,
  }

  const finite = value => Number.isFinite(Number(value)) ? Number(value) : null

  function metricPriority(metric) {
    return PRIORITY[String(metric || '')] || 24
  }

  function candidateKey(option, condition, index) {
    return `${String(option?.id || 'option')}::${String(condition?.metric || 'metric')}::${index}`
  }

  function buildCandidates(activeCase, snapshot, progressOf) {
    const output = []
    for (const [optionIndex, option] of (activeCase?.options || []).entries()) {
      const conditions = Array.isArray(option?.conditions) && option.conditions.length
        ? option.conditions
        : option?.metric
          ? [{ metric: option.metric, operator: option.operator || 'gte', target: option.target }]
          : []
      for (const [conditionIndex, condition] of conditions.entries()) {
        const progress = progressOf(condition, snapshot)
        output.push({
          key: candidateKey(option, condition, conditionIndex),
          option,
          optionIndex,
          condition,
          conditionIndex,
          progress,
          priority: metricPriority(condition.metric),
        })
      }
    }
    return output
  }

  function eventMagnitude(candidate, previous) {
    const current = finite(candidate?.progress?.value)
    const before = finite(previous)
    if (current === null || before === null || current === before) return 0
    const delta = Math.abs(current - before)
    const target = Math.max(1, Math.abs(finite(candidate?.progress?.target) || 1))
    return Math.min(1, delta / target)
  }

  function betterEvent(left, right) {
    if (!left) return right
    if (!right) return left
    if (right.priority !== left.priority) return right.priority > left.priority ? right : left
    if (right.magnitude !== left.magnitude) return right.magnitude > left.magnitude ? right : left
    return right.at >= left.at ? right : left
  }

  function initialCandidate(candidates) {
    const known = candidates.filter(candidate => candidate?.progress?.supported && candidate?.progress?.known)
    const source = known.length ? known : candidates
    return [...source].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.optionIndex - b.optionIndex || a.conditionIndex - b.conditionIndex
    })[0] || null
  }

  function createRouter(options = {}) {
    const switchDelayMs = Math.max(500, Number(options.switchDelayMs ?? SWITCH_DELAY_MS))
    const activeSuppressionMs = Math.max(0, Number(options.activeSuppressionMs ?? ACTIVE_SUPPRESSION_MS))
    let contextKey = null
    let activeKey = null
    let activeSince = 0
    let activeActivityAt = 0
    let pending = null
    const lastValues = new Map()

    function reset(nextContext = null) {
      contextKey = nextContext
      activeKey = null
      activeSince = 0
      activeActivityAt = 0
      pending = null
      lastValues.clear()
    }

    function update({ activeCase, snapshot, live, context, now = Date.now(), progressOf }) {
      const nextContext = String(context || '')
      if (contextKey !== nextContext) reset(nextContext)
      const candidates = buildCandidates(activeCase, snapshot, progressOf)
      if (!candidates.length) {
        reset(nextContext)
        return { candidate: null, pending: null, switched: false }
      }
      const byKey = new Map(candidates.map(candidate => [candidate.key, candidate]))
      let switched = false

      if (!activeKey || !byKey.has(activeKey)) {
        const first = initialCandidate(candidates)
        activeKey = first?.key || null
        activeSince = now
        activeActivityAt = Number.NEGATIVE_INFINITY
        pending = null
        switched = true
      }

      let bestOtherEvent = null
      let activeChanged = false
      for (const candidate of candidates) {
        const current = finite(candidate?.progress?.value)
        const previous = lastValues.get(candidate.key)
        if (current !== null && previous !== undefined && current !== previous) {
          const event = {
            key: candidate.key,
            priority: candidate.priority,
            magnitude: eventMagnitude(candidate, previous),
            at: now,
          }
          if (candidate.key === activeKey) activeChanged = true
          else bestOtherEvent = betterEvent(bestOtherEvent, event)
        }
        if (current !== null) lastValues.set(candidate.key, current)
      }

      if (activeChanged) activeActivityAt = now
      const active = byKey.get(activeKey)
      if (activeChanged && pending && (active?.priority || 0) >= pending.priority) pending = null

      if (live && bestOtherEvent) {
        const higherSignal = bestOtherEvent.priority > (active?.priority || 0)
        const activeQuiet = now - activeActivityAt >= activeSuppressionMs
        if (higherSignal || activeQuiet) {
          if (!pending) {
            pending = { ...bestOtherEvent, since: now }
          } else {
            const best = betterEvent(pending, bestOtherEvent)
            pending = best.key === pending.key
              ? { ...pending, priority: best.priority, magnitude: best.magnitude, at: best.at }
              : { ...best, since: pending.since }
          }
        }
      }

      if (!live) pending = null

      if (pending && now - pending.since >= switchDelayMs) {
        if (byKey.has(pending.key) && pending.key !== activeKey) {
          activeKey = pending.key
          activeSince = now
          activeActivityAt = pending.at
          switched = true
        }
        pending = null
      }

      return {
        candidate: byKey.get(activeKey) || initialCandidate(candidates),
        pending: pending ? { ...pending, remaining_ms: Math.max(0, switchDelayMs - (now - pending.since)) } : null,
        switched,
        active_since: activeSince,
      }
    }

    return { update, reset }
  }

  return {
    SWITCH_DELAY_MS,
    ACTIVE_SUPPRESSION_MS,
    metricPriority,
    buildCandidates,
    createRouter,
  }
})
