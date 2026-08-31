(function attachGepSettlementClient(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCGepSettlement = api
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const ELIGIBLE = new Set(['ISSUED_ACTIVE', 'ISSUED_QUEUED'])
  const MODES = new Set(['STANDARD', 'RANKED', 'STREET_BRAWL'])
  const TEAMS = new Set(['AMBER', 'SAPPHIRE'])
  const LIVE_FIELDS = ['hero_id','kills','deaths','assists','hero_damage','object_damage','healing','souls']
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))

  function emptyState() {
    return { current: null, pending_finalizes: [], last_result: null, last_error: null, updated_at: null }
  }
  function restore(value) {
    const source = value && typeof value === 'object' ? value : {}
    return {
      current: source.current && typeof source.current === 'object' ? clone(source.current) : null,
      pending_finalizes: Array.isArray(source.pending_finalizes)
        ? source.pending_finalizes.filter(item => item && typeof item === 'object').slice(-8).map(clone) : [],
      last_result: source.last_result && typeof source.last_result === 'object' ? clone(source.last_result) : null,
      last_error: source.last_error && typeof source.last_error === 'object' ? clone(source.last_error) : null,
      updated_at: source.updated_at || null,
    }
  }
  function cleanSessionId(value) {
    const text = String(value || '').trim()
    return /^[A-Za-z0-9._:-]{8,80}$/.test(text) ? text : null
  }
  function steamId(value) {
    const text = String(value ?? '').trim()
    return /^\d{16,20}$/.test(text) ? text : null
  }
  function mode(value) {
    const text = String(value || '').trim().toUpperCase()
    return MODES.has(text) ? text : null
  }
  function team(value) {
    const text = String(value || '').trim().toUpperCase()
    return TEAMS.has(text) ? text : null
  }
  function positiveInt(value) {
    const number = Number(value)
    return Number.isSafeInteger(number) && number > 0 ? number : null
  }
  function liveStats(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const out = {}
    for (const field of LIVE_FIELDS) {
      const raw = value[field]
      if (raw === null || raw === undefined || raw === '') continue
      const number = Number(raw)
      if (Number.isFinite(number) && number >= 0) out[field] = Math.trunc(number)
    }
    return Object.keys(out).length ? out : null
  }
  function buildStartPayload({session, steamId: steam, gameMode, matchId = null, version} = {}) {
    const sessionId = cleanSessionId(session?.session_id)
    const sid = steamId(steam)
    const resolvedMode = mode(gameMode || session?.mode)
    const resolvedMatch = positiveInt(matchId ?? session?.match_id)
    if (!sessionId) return {ok:false, code:'SESSION_ID_REQUIRED'}
    if (!sid) return {ok:false, code:'STEAM_ID_REQUIRED'}
    if (!resolvedMode) return {ok:false, code:'MODE_REQUIRED'}
    return {ok:true, payload:{
      session_id: sessionId,
      steam_id64: sid,
      game_match_mode: resolvedMode,
      match_id: resolvedMatch,
      version: String(version || '').slice(0,32) || null,
    }}
  }
  function applyStartResponse(state, response, {sessionId, now = new Date().toISOString()} = {}) {
    const next = restore(state)
    const source = response && typeof response === 'object' ? response : {}
    const status = String(source.status || 'UNKNOWN').toUpperCase()
    const resolvedSession = cleanSessionId(source.session_id || sessionId)
    next.current = {
      session_id: resolvedSession,
      enabled: source.enabled === true,
      policy_version: source.policy_version || null,
      status,
      reason: source.reason || null,
      eligible: source.eligible === true && ELIGIBLE.has(status),
      queued: source.queued === true || status === 'ISSUED_QUEUED',
      lease_id: source.lease_id || null,
      board_id: source.board_id || null,
      match_id: positiveInt(source.match_id),
      attempt_nonce: ELIGIBLE.has(status) ? String(source.attempt_nonce || '') || null : null,
      expires_at: source.expires_at || null,
      issued_at: source.issued_at || null,
      server_first_seen_at: source.server_first_seen_at || null,
      updated_at: now,
    }
    next.last_error = null
    next.updated_at = now
    return next
  }
  function markStartError(state, {sessionId, code, message, now = new Date().toISOString()} = {}) {
    const next = restore(state)
    const current = next.current?.session_id === sessionId ? next.current : {session_id:cleanSessionId(sessionId)}
    next.current = {
      ...current,
      status: current?.eligible ? current.status : 'START_RETRY',
      start_error: {code:String(code || 'START_FAILED'), message:String(message || 'Start request failed').slice(0,300), at:now},
      updated_at: now,
    }
    next.last_error = clone(next.current.start_error)
    next.updated_at = now
    return next
  }
  function canFinalize(current) {
    const status = String(current?.status || '').toUpperCase()
    return !!current && ELIGIBLE.has(status) && !!current.lease_id
      && !!current.attempt_nonce && !!cleanSessionId(current.session_id)
  }
  function buildFinalizePayload({
    current, session, terminalType, steamId: steam, matchId, matchClockS,
    finalSequence, evidence, localTeam, winningTeam, version,
  } = {}) {
    if (!canFinalize(current)) return {ok:false, code:'LEASE_NOT_ELIGIBLE'}
    if (String(terminalType || '') !== 'match_end') return {ok:false, code:'EXPLICIT_MATCH_END_REQUIRED'}
    const sessionId = cleanSessionId(session?.session_id || current.session_id)
    if (!sessionId || sessionId !== current.session_id) return {ok:false, code:'SESSION_MISMATCH'}
    const sid = steamId(steam)
    if (!sid) return {ok:false, code:'STEAM_ID_REQUIRED'}
    const resolvedMatch = positiveInt(matchId ?? session?.match_id ?? current.match_id)
    if (!resolvedMatch) return {ok:false, code:'MATCH_ID_REQUIRED'}
    const clock = positiveInt(matchClockS ?? session?.match_clock_s)
    if (!clock || clock > 21600) return {ok:false, code:'MATCH_CLOCK_REQUIRED'}
    const sequence = positiveInt(finalSequence)
    if (!sequence) return {ok:false, code:'FINAL_SEQUENCE_REQUIRED'}
    const stats = liveStats(evidence)
    if (!stats) return {ok:false, code:'FINAL_STATS_REQUIRED'}
    const local = team(localTeam)
    const winner = team(winningTeam)
    const teamsComplete = !!local && !!winner
    return {ok:true, payload:{
      session_id: sessionId,
      attempt_nonce: current.attempt_nonce,
      steam_id64: sid,
      match_id: resolvedMatch,
      terminal_signal: 'match_end',
      match_clock_s: clock,
      final_sequence: sequence,
      live_stats: stats,
      local_team: teamsComplete ? local : null,
      winning_team: teamsComplete ? winner : null,
      version: String(version || '').slice(0,32) || null,
    }}
  }
  function stageFinalize(state, payload, now = new Date().toISOString()) {
    const next = restore(state)
    const key = `${payload?.session_id || ''}:${payload?.match_id || ''}`
    const item = {key, payload:clone(payload), attempts:0, created_at:now, next_attempt_at:now, last_error:null}
    const index = next.pending_finalizes.findIndex(entry => entry?.key === key)
    if (index >= 0) next.pending_finalizes[index] = item
    else next.pending_finalizes.push(item)
    next.pending_finalizes = next.pending_finalizes.slice(-8)
    next.updated_at = now
    return next
  }
  function markFinalizeError(state, key, {code, message, now = new Date().toISOString(), retryMs = 15000} = {}) {
    const next = restore(state)
    next.pending_finalizes = next.pending_finalizes.map(item => item.key !== key ? item : ({
      ...item,
      attempts: Math.max(0, Number(item.attempts) || 0) + 1,
      last_error: {code:String(code || 'FINALIZE_FAILED'), message:String(message || 'Finalize request failed').slice(0,300), at:now},
      next_attempt_at: new Date(Date.parse(now) + Math.max(1000, Number(retryMs) || 15000)).toISOString(),
    }))
    next.last_error = {code:String(code || 'FINALIZE_FAILED'), message:String(message || 'Finalize request failed').slice(0,300), at:now}
    next.updated_at = now
    return next
  }
  function acknowledgeFinalize(state, key, response, now = new Date().toISOString()) {
    const next = restore(state)
    const item = next.pending_finalizes.find(entry => entry?.key === key)
    next.pending_finalizes = next.pending_finalizes.filter(entry => entry?.key !== key)
    next.last_result = {
      session_id: response?.session_id || item?.payload?.session_id || null,
      match_id: positiveInt(response?.match_id || item?.payload?.match_id),
      status: String(response?.status || 'SETTLED').toUpperCase(),
      queued: response?.queued === true,
      integrity_status: response?.integrity_status || null,
      settlement_source: response?.settlement_source || null,
      evidence_id: response?.evidence_id || null,
      settled_at: response?.server_finalized_at || now,
      idempotent: response?.idempotent === true,
    }
    if (next.current?.session_id === next.last_result.session_id) {
      next.current = {...next.current, status:next.last_result.status, eligible:false, attempt_nonce:null, settled_at:next.last_result.settled_at, updated_at:now}
    }
    next.last_error = null
    next.updated_at = now
    return next
  }
  function dueFinalizes(state, nowMs = Date.now()) {
    return restore(state).pending_finalizes.filter(item => {
      const at = Date.parse(item?.next_attempt_at || item?.created_at || '')
      return !Number.isFinite(at) || at <= nowMs
    }).slice(0,3).map(clone)
  }
  function publicState(state) {
    const source = restore(state)
    const current = source.current ? {...source.current} : null
    if (current) delete current.attempt_nonce
    return {
      current,
      pending_finalizes: source.pending_finalizes.map(item => ({
        key:item.key, session_id:item.payload?.session_id || null, match_id:item.payload?.match_id || null,
        attempts:item.attempts || 0, created_at:item.created_at || null, next_attempt_at:item.next_attempt_at || null,
        last_error:clone(item.last_error),
      })),
      last_result:clone(source.last_result),
      last_error:clone(source.last_error),
      updated_at:source.updated_at,
    }
  }
  return {
    ELIGIBLE, emptyState, restore, cleanSessionId, steamId, mode, team, liveStats,
    buildStartPayload, applyStartResponse, markStartError, canFinalize, buildFinalizePayload,
    stageFinalize, markFinalizeError, acknowledgeFinalize, dueFinalizes, publicState,
  }
})
