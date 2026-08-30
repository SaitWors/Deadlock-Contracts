(function attachFocusSelector(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCFocusSelector = api
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const ACTIVITY_WINDOW_MS = 6000
  const STICKY_MS = 3200
  const COMPLETE_STICKY_MS = 4200

  function number(value, fallback = 0) {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  function isLiveCandidate(candidate) {
    return !!candidate?.condition && String(candidate.condition.metric || '') !== 'match.win'
  }

  function activityScore(candidate, now) {
    const activity = candidate?.activity
    if (!activity) return null
    const at = number(activity.at, 0)
    if (!at || now - at > ACTIVITY_WINDOW_MS) return null
    const priority = number(activity.priority_until, 0) > now ? 2 : 1
    return { priority, at }
  }

  function choose(candidates, {
    now = Date.now(),
    stickyKey = null,
    stickyUntil = 0,
  } = {}) {
    const list = Array.isArray(candidates) ? candidates.filter(Boolean) : []
    if (!list.length) return { candidate: null, reason: 'none', sticky_key: null, sticky_until: 0 }

    if (stickyKey && stickyUntil > now) {
      const sticky = list.find(item => item.key === stickyKey)
      if (sticky) return { candidate: sticky, reason: 'sticky', sticky_key: stickyKey, sticky_until: stickyUntil }
    }

    const active = list
      .filter(item => isLiveCandidate(item) && item.progress?.known)
      .map(item => ({ item, score: activityScore(item, now) }))
      .filter(entry => entry.score)
      .sort((a, b) => b.score.priority - a.score.priority || b.score.at - a.score.at)

    if (active.length) {
      const candidate = active[0].item
      const complete = candidate.progress?.allow_completion_animation === true
      return {
        candidate,
        reason: 'recent_activity',
        sticky_key: candidate.key,
        sticky_until: now + (complete ? COMPLETE_STICKY_MS : STICKY_MS),
      }
    }

    const live = list
      .filter(item => isLiveCandidate(item) && item.progress?.known)
      .sort((a, b) => {
        const aComplete = a.progress?.allow_completion_animation === true ? 1 : 0
        const bComplete = b.progress?.allow_completion_animation === true ? 1 : 0
        if (aComplete !== bComplete) return aComplete - bComplete
        return number(b.progress?.percent, 0) - number(a.progress?.percent, 0)
      })

    if (live.length) {
      const candidate = live[0]
      return { candidate, reason: 'live_progress', sticky_key: candidate.key, sticky_until: now + STICKY_MS }
    }

    const pendingWin = list.find(item => String(item?.condition?.metric || '') === 'match.win')
    const candidate = pendingWin || list[0]
    return { candidate, reason: pendingWin ? 'post_match_pending' : 'fallback', sticky_key: candidate.key, sticky_until: now + STICKY_MS }
  }

  return { ACTIVITY_WINDOW_MS, STICKY_MS, COMPLETE_STICKY_MS, choose }
})
