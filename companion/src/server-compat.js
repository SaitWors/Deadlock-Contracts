(function attachServerCompat(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCServerCompat = api
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const PRODUCTION_WEB_VERSION = '0.10.1-alpha.11'
  const PRODUCTION_BOOTSTRAP_SCHEMA = 1
  const SUPPORTED_BOOTSTRAP_SCHEMAS = Object.freeze([1, 2])
  const SERVER_EVENTS = new Set(['heartbeat','game_started','game_stopped','match_started','match_ended','phase_changed'])
  const LIVE_FIELDS = ['hero_id','kills','deaths','assists','hero_damage','object_damage','healing','souls']

  function hash32(text, seed = 0x811c9dc5) {
    let value = seed >>> 0
    for (const ch of String(text || '')) {
      value ^= ch.charCodeAt(0)
      value = Math.imul(value, 0x01000193) >>> 0
    }
    return value.toString(16).padStart(8, '0')
  }

  function compactClientEventId(payload) {
    const key = String(payload?.idempotency_key || `${payload?.session_id || 'none'}:${payload?.event_type || 'heartbeat'}:${payload?.sequence || 0}:${payload?.observed_at || ''}`)
    const event = String(payload?.event_type || 'heartbeat').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 18) || 'heartbeat'
    const sequence = Math.max(0, Number(payload?.sequence) || 0)
    return `a9-${hash32(key)}${hash32(key, 0x9e3779b9)}-${event}-${sequence}`.slice(0, 80)
  }

  function serverEventType(eventType) {
    const event = String(eventType || 'heartbeat')
    if (event === 'interrupted') return 'game_stopped'
    return SERVER_EVENTS.has(event) ? event : 'heartbeat'
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

  function text(value, max) {
    if (value === null || value === undefined || value === '') return null
    return String(value).slice(0, max)
  }

  function int(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isSafeInteger(number) && number > 0 ? number : null
  }

  function terminalEndReason(payload) {
    if (payload?.event_type === 'interrupted') return 'interrupted'
    if (payload?.event_type !== 'match_ended') return null
    const type = String(payload?.terminal_proof?.type || '')
    return type.includes('postgame') ? 'phase_postgame' : 'match_end'
  }

  function toHeartbeatV1(payload) {
    const source = payload && typeof payload === 'object' ? payload : {}
    const eventType = serverEventType(source.event_type)
    const terminal = source.event_type === 'match_ended'
    const interrupted = source.event_type === 'interrupted'
    const endedAt = terminal || interrupted
      ? text(source.terminal_proof?.observed_at || source.observed_at, 64)
      : null
    const outcomeEventMatchId = int(source.match_outcome_event_match_id)

    // IMPORTANT: this is an explicit allow-list matching the production
    // CompanionHeartbeatRequest on web 0.10.1-alpha.10. Alpha.9 safety fields
    // remain in the local queue, while only fields accepted by the deployed
    // StrictModel are sent over the wire.
    return {
      client_event_id: compactClientEventId(source),
      game_running: source.game_running === true,
      steam_id64: source.steam_id64 == null ? null : String(source.steam_id64),
      phase: text(source.phase, 64),
      game_mode: source.game_mode && typeof source.game_mode === 'object' ? source.game_mode : text(source.game_mode, 256),
      match_id: int(source.match_id),
      gep_version: text(source.gep_version, 64),
      version: text(source.version || source.client_version, 32),
      live_stats: liveStats(source.live_stats),
      session_id: text(source.session_id, 96),
      session_started_at: text(source.session_started_at, 64),
      session_ended_at: endedAt,
      session_start_reason: text(source.session_start_reason, 64),
      session_end_reason: text(terminalEndReason(source), 64),
      match_clock_s: source.match_clock_s == null ? null : Math.max(0, Math.min(21600, Math.trunc(Number(source.match_clock_s) || 0))),
      match_clock_observed_at: text(source.match_clock_observed_at, 64),
      local_team: ['AMBER','SAPPHIRE'].includes(String(source.local_team || '').toUpperCase()) ? String(source.local_team).toUpperCase() : null,
      match_outcome: ['AMBER','SAPPHIRE'].includes(String(source.match_outcome || '').toUpperCase()) ? String(source.match_outcome).toUpperCase() : null,
      match_outcome_event_at: text(source.match_outcome_event_at, 64),
      match_outcome_event_match_id: outcomeEventMatchId,
      event_type: eventType,
    }
  }

  return {
    PRODUCTION_WEB_VERSION,
    PRODUCTION_BOOTSTRAP_SCHEMA,
    SUPPORTED_BOOTSTRAP_SCHEMAS,
    SERVER_EVENTS,
    compactClientEventId,
    serverEventType,
    toHeartbeatV1,
  }
})
