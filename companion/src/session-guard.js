(function installSessionGuard(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCSessionGuard = api
})(typeof window !== 'undefined' ? window : globalThis, function createSessionGuard() {
  const POST_FINAL_GHOST_PHASES = new Set([
    'Init',
    'WaitingForPlayersToJoin',
    'PreGameWait',
    'GameInProgress',
  ])

  function matchId(value) {
    const number = Number(value)
    return Number.isSafeInteger(number) && number > 0 ? number : null
  }

  function sameMatch(left, right) {
    const a = matchId(left)
    const b = matchId(right)
    return !!(a && b && a === b)
  }

  function shouldSuppressLifecycle({ finalizedMatchId, currentMatchId, nextPhase }) {
    return sameMatch(finalizedMatchId, currentMatchId)
      && POST_FINAL_GHOST_PHASES.has(String(nextPhase || ''))
  }

  function shouldSuppressModeUpdate({ finalizedMatchId, currentMatchId }) {
    return sameMatch(finalizedMatchId, currentMatchId)
  }

  function hasTerminalGameplayProof({
    matchClockS,
    elapsedSeconds,
  }) {
    const clock = Number(matchClockS)

    if (
      Number.isFinite(clock)
      && clock > 0
    ) {
      return true
    }

    const elapsed = Number(elapsedSeconds)

    return (
      Number.isFinite(elapsed)
      && elapsed >= 60
    )
  }

  function finalUploadKey(payload) {
    const id = matchId(payload?.match_id)
    const session = String(payload?.session_id || '').trim()
    return id && session ? `${id}:${session}` : null
  }

  function shouldQueueFinalUpload({ finalized, queue, payload }) {
    const key = finalUploadKey(payload)
    if (!key) return true
    if (
      sameMatch(finalized?.match_id, payload.match_id)
      && String(finalized?.upload_key || '') === key
      && finalized?.upload_queued_at
    ) return false
    return !(Array.isArray(queue) && queue.some(item => (
      item?.event_type === 'match_ended'
      && finalUploadKey(item.payload) === key
    )))
  }

  return {
    POST_FINAL_GHOST_PHASES,
    sameMatch,
    shouldSuppressLifecycle,
    shouldSuppressModeUpdate,
    hasTerminalGameplayProof,
    finalUploadKey,
    shouldQueueFinalUpload,
  }
})
