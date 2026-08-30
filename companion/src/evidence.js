(function attachEvidence(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCEvidence = api
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function finite(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function correlationKey(session) {
    const id = session?.session_id
    return id ? String(id) : null
  }

  function mergeMetric(current, incoming, { monotonic = true } = {}) {
    if (incoming === null || incoming === undefined || incoming === '') {
      return {
        accepted: false,
        changed: false,
        value: current ?? null,
        reason: 'MISSING_PARTIAL_UPDATE',
      }
    }

    const nextRaw = finite(incoming)
    if (nextRaw === null) {
      return {
        accepted: false,
        changed: false,
        value: current ?? null,
        reason: 'NON_NUMERIC_UPDATE',
      }
    }

    const previous = finite(current)
    const value = monotonic && previous !== null
      ? Math.max(previous, nextRaw)
      : nextRaw

    return {
      accepted: true,
      changed: previous === null || previous !== value,
      previous,
      value,
      reason: previous !== null && monotonic && nextRaw < previous
        ? 'LOWER_SAMPLE_IGNORED'
        : 'ACCEPTED',
    }
  }

  return { finite, correlationKey, mergeMetric }
})
