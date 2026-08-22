const FEATURES = ['gep_internal', 'game_info', 'match_info']
const VERSION = '0.5.2-alpha.4'
const EVIDENCE_SCHEMA_VERSION = 7
const BRIDGE_STATE_VERSION = 1
const GAME_ID = 24482
const HEARTBEAT_MS = 15000
const PRODUCT_REFRESH_MS = 60000
const POST_MATCH_PRODUCT_REFRESH_MS = [2500, 8000, 20000, 45000, 90000]
const HOTKEY_NAME = 'toggle_contract_overlay'
const DEFAULT_HOTKEY = 'Ctrl+Shift+C'
const INFO_POLL_MS = 5000
const GAME_POLL_MS = 5000
const LOG_LIMIT = 1200
const QUEUE_LIMIT = 60
const ALLOWED_SERVER_URLS = new Set(['https://deadlock-contracts.online'])
const CONFIRMED_SESSION_STARTS = new Set(['match_start', 'phase_game_in_progress', 'match_clock'])

const $ = id => document.getElementById(id)
const nowIso = () => new Date().toISOString()
const STORAGE = {
  serverUrl: 'dc.serverUrl',
  token: 'dc.token', // legacy plaintext key; migration removes it
  tokenEncrypted: 'dc.token.enc.v1',
  deviceId: 'dc.deviceId',
  queue: 'dc.queue.v2',
  session: 'dc.session.v2',
  bridgeState: 'dc.bridgeState.v1',
  finalized: 'dc.finalizedMatch.v1',
  product: 'dc.product.v1',
  overlayScale: 'dc.overlay.scale.v1',
  overlayLayout: 'dc.overlay.layout.v2',
}

const state = {
  gameRunning: false,
  steamId: null,
  phase: null,
  gameModeRaw: null,
  matchId: null,
  matchHistory: [],
  gepVersion: null,
  gepPublicVersion: null,
  gepUpdated: null,
  features: [],
  liveStats: null,
  lastRosterAt: null,
  lastInfoAt: null,
  lastEventAt: null,
  matchOutcome: null,
  matchOutcomeEventAt: null,
  matchOutcomeEventMatchId: null,
  teamScore: null,
  localTeam: null,
  matchClockS: null,
  matchClockObservedAt: null,
  serverUrl: ALLOWED_SERVER_URLS.has(cleanServerUrl(localStorage.getItem(STORAGE.serverUrl))) ? cleanServerUrl(localStorage.getItem(STORAGE.serverUrl)) : 'https://deadlock-contracts.online',
  token: '',
  deviceId: localStorage.getItem(STORAGE.deviceId) || '',
  account: null,
  lastSyncedAt: null,
  lastUploadStatus: '—',
  lastError: '',
  gameDetectedAt: null,
  lastObserved: { gameRunning: null, phase: null, matchId: null },
  eventCounts: { kills: 0, deaths: 0, assists: 0 },
  session: loadJson(STORAGE.session, null),
  finalized: loadJson(STORAGE.finalized, null),
  queue: loadJson(STORAGE.queue, []),
  product: window.DCProduct.emptyProductState(),
  hotkeyBinding: DEFAULT_HOTKEY,
}


let logLines = []
let syncTimer = 0
let flushInProgress = false
let recoveryTimers = []
let productRefreshInProgress = false
let postMatchProductTimers = []
let postMatchProductKey = null
const staleFinalizedNotices = new Set()

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (_) {
    return fallback
  }
}


function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch (_) {}
}

function restoreProductCache() {
  const cached = loadJson(STORAGE.product, null)
  if (!cached || cached.cache_version !== window.DCProduct.PRODUCT_CACHE_VERSION) return
  state.product = {
    ...window.DCProduct.emptyProductState('OFFLINE'),
    ...cached,
    status: 'OFFLINE',
    stale: true,
    last_error: null,
  }
}

function persistProduct() {
  if (!state.token || !state.product?.loaded_at) return
  saveJson(STORAGE.product, state.product)
}

function clearProduct(status = 'UNPAIRED') {
  state.product = window.DCProduct.emptyProductState(status)
  localStorage.removeItem(STORAGE.product)
  publishBridgeState()
}

function productErrorState(error) {
  const status = error?.status === 401
    ? 'UNPAIRED'
    : error?.status === 404 || error?.code === 'API_VERSION_MISMATCH'
      ? 'INCOMPATIBLE'
      : navigator.onLine === false
        ? 'OFFLINE'
        : 'DEGRADED'
  return {
    ...state.product,
    status,
    stale: !!state.product?.loaded_at,
    last_error: {
      code: error?.code || `HTTP_${error?.status || 0}`,
      message: String(error?.message || error || 'Desktop API unavailable'),
      status: error?.status || null,
      request_id: error?.requestId || null,
      retry_after: error?.retryAfter || null,
      at: nowIso(),
    },
  }
}

function isAllowedServerUrl(value) {
  return ALLOWED_SERVER_URLS.has(cleanServerUrl(value))
}

function clearStoredToken() {
  localStorage.removeItem(STORAGE.token)
  localStorage.removeItem(STORAGE.tokenEncrypted)
}

function encryptForCurrentUser(plaintext) {
  return new Promise((resolve, reject) => {
    if (typeof overwolf === 'undefined' || !overwolf.cryptography?.encryptForCurrentUser) {
      reject(new Error('Overwolf Cryptography API is unavailable'))
      return
    }
    overwolf.cryptography.encryptForCurrentUser(plaintext, result => {
      if (result?.success && result.ciphertext) resolve(result.ciphertext)
      else reject(new Error(result?.error || 'Unable to encrypt the pairing token'))
    })
  })
}

function decryptForCurrentUser(ciphertext) {
  return new Promise((resolve, reject) => {
    if (typeof overwolf === 'undefined' || !overwolf.cryptography?.decryptForCurrentUser) {
      reject(new Error('Overwolf Cryptography API is unavailable'))
      return
    }
    overwolf.cryptography.decryptForCurrentUser(ciphertext, result => {
      if (result?.success && result.plaintext) resolve(result.plaintext)
      else reject(new Error(result?.error || 'Unable to decrypt the pairing token'))
    })
  })
}

async function storeTokenSecurely(token) {
  // Never leave a new or legacy bearer token in plaintext localStorage.
  clearStoredToken()
  if (!token) return false
  try {
    const ciphertext = await encryptForCurrentUser(token)
    localStorage.setItem(STORAGE.tokenEncrypted, ciphertext)
    return true
  } catch (error) {
    log('TOKEN_STORAGE_ERROR', String(error?.message || error))
    return false
  }
}

async function loadStoredToken() {
  const encrypted = localStorage.getItem(STORAGE.tokenEncrypted)
  if (encrypted) {
    try {
      state.token = await decryptForCurrentUser(encrypted)
      return
    } catch (error) {
      log('TOKEN_DECRYPT_ERROR', String(error?.message || error))
      clearStoredToken()
    }
  }

  // One-time migration from <=0.3.1. Read it into memory, immediately remove
  // plaintext persistence, then re-store only if OS-bound encryption succeeds.
  const legacy = localStorage.getItem(STORAGE.token)
  if (legacy) {
    localStorage.removeItem(STORAGE.token)
    state.token = legacy
    const persisted = await storeTokenSecurely(legacy)
    if (!persisted) {
      setPairError('Secure token storage is unavailable. The pairing will work until Companion exits, then you will need to pair again.')
    }
  }
}

function log(kind, payload) {
  let text
  try { text = typeof payload === 'string' ? payload : JSON.stringify(payload) } catch (_) { text = String(payload) }
  logLines.push(`[${nowIso()}] [${kind}] ${text}`)
  if (logLines.length > LOG_LIMIT) logLines = logLines.slice(-LOG_LIMIT)
  if ($('log')) {
    $('log').textContent = logLines.join('\n')
    $('log').scrollTop = $('log').scrollHeight
  }
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch (_) { return value }
}

// SteamID64 is larger than JavaScript's safe integer range. Overwolf sends
// game_info.steam_id as a decimal string, so it must never pass through
// JSON.parse/Number before we preserve the original digits.
function asSteamIdString(value) {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null

    // Most important path: Overwolf documents steam_id as a raw decimal string.
    if (/^\d{16,20}$/.test(text)) return text

    // Some wrappers can return a JSON-encoded string such as "7656...".
    if (text.startsWith('\"') && text.endsWith('\"')) {
      try {
        const parsed = JSON.parse(text)
        if (typeof parsed === 'string' && /^\d{16,20}$/.test(parsed)) return parsed
      } catch (_) {}
    }

    return text
  }

  // If a host has already converted SteamID64 to Number, precision may already
  // be lost. Keep it for diagnostics, but the normal Overwolf path is string.
  return String(value)
}

function asInt(value) {
  if (value === null || value === undefined || value === '') return null
  const result = Number(value)
  return Number.isFinite(result) ? Math.trunc(result) : null
}

function maxKnown(current, next) {
  const a = asInt(current)
  const b = asInt(next)
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

function randomId(prefix = 'dc') {
  try {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    return `${prefix}-${Array.from(bytes).map(v => v.toString(16).padStart(2, '0')).join('')}`
  } catch (_) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

function ensureDeviceId() {
  if (state.deviceId) return state.deviceId
  state.deviceId = randomId('dc')
  localStorage.setItem(STORAGE.deviceId, state.deviceId)
  return state.deviceId
}

function cleanServerUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function modeDisplay(raw) {
  const value = parseMaybeJson(raw)
  const text = typeof value === 'object' && value
    ? `${value.match_mode || ''} ${value.game_mode || ''}`.toLowerCase()
    : String(value || '').toLowerCase()
  if (text.includes('street') || text.includes('brawl')) return 'STREET BRAWL'
  if (text.includes('ranked') && !text.includes('unranked')) return 'RANKED'
  if (text.includes('unranked') || text.includes('normal') || text.includes('standard')) return 'STANDARD'
  return text ? String(typeof value === 'object' ? JSON.stringify(value) : value) : '—'
}


function phaseDisplay(value) {
  return ({
    Init: 'INITIALIZING',
    WaitingForPlayersToJoin: 'WAITING FOR PLAYERS',
    PreGameWait: 'PRE-GAME',
    GameInProgress: 'MATCH IN PROGRESS',
    PostGame: 'POST-GAME',
  })[value] || value || '—'
}

function normalizeTeam(value) {
  const team = String(value || '').trim().toUpperCase()
  return team === 'AMBER' || team === 'SAPPHIRE' ? team : null
}

function parseMatchClock(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const seconds = Math.trunc(value)
    return seconds >= 0 && seconds <= 6 * 60 * 60 ? seconds : null
  }
  const text = String(value ?? '').trim()
  if (!text) return null
  const parts = text.split(':').map(Number)
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return null
  let seconds = null
  if (parts.length === 2 && parts[1] < 60) seconds = parts[0] * 60 + parts[1]
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
  return seconds !== null && seconds <= 6 * 60 * 60 ? Math.trunc(seconds) : null
}

function applyMatchClock(value) {
  const seconds = parseMatchClock(value)
  if (seconds === null) return false
  state.matchClockS = Math.max(state.matchClockS || 0, seconds)
  state.matchClockObservedAt = nowIso()
  if (!state.session || state.session.ended_at || !CONFIRMED_SESSION_STARTS.has(state.session.reason)) {
    const derivedStart = new Date(Date.now() - seconds * 1000).toISOString()
    ensureConfirmedSession('match_clock', derivedStart)
  }
  if (state.session) {
    state.session.match_clock_s = Math.max(state.session.match_clock_s || 0, seconds)
    state.session.match_clock_observed_at = state.matchClockObservedAt
  }
  persistSession()
  return true
}

function historyIds(history = state.matchHistory) {
  return new Set(
    (Array.isArray(history) ? history : [])
      .map(item => asInt(item?.match_id ?? item?.matchId ?? item))
      .filter(Boolean),
  )
}

function latestUnseenHistoryMatch() {
  if (!state.session) return null
  const baseline = new Set((state.session.baseline_history || []).map(Number))
  const unseen = [...historyIds()].filter(id => !baseline.has(id))
  return unseen.length ? Math.max(...unseen) : null
}

function newSession(reason = 'unknown', startedAt = null) {
  cancelPostMatchProductRefresh()
  const session = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    id: randomId('session'),
    reason,
    started_at: startedAt || nowIso(),
    ended_at: null,
    match_id: state.matchId || null,
    baseline_history: [...historyIds()],
    mode_raw: state.gameModeRaw,
    local_team: state.localTeam,
    match_outcome: state.matchOutcome,
    match_outcome_event_at: state.matchOutcomeEventAt,
    match_outcome_event_match_id: state.matchOutcomeEventMatchId,
    team_score: state.teamScore,
    event_counts: { kills: 0, deaths: 0, assists: 0 },
    evidence: {},
    last_roster_at: null,
    match_clock_s: state.matchClockS,
    match_clock_observed_at: state.matchClockObservedAt,
  }
  state.session = session
  state.eventCounts = { kills: 0, deaths: 0, assists: 0 }
  state.liveStats = null
  saveJson(STORAGE.session, session)
  log('SESSION_START', session)
  publishBridgeState()
  return session
}


function finalizedMatchId() {
  const value = asInt(state.finalized?.match_id)
  if (value) return value
  if (state.session?.ended_at && state.session?.match_id) return asInt(state.session.match_id)
  return null
}

function sameFinalizedMatch() {
  const finalized = finalizedMatchId()
  return !!(finalized && state.matchId && Number(finalized) === Number(state.matchId))
}

function logStaleFinalizedOnce(kind, payload = {}) {
  const key = `${kind}:${finalizedMatchId() || 'none'}:${state.session?.id || 'none'}`
  if (staleFinalizedNotices.has(key)) return
  staleFinalizedNotices.add(key)
  log(kind, payload)
}

function applyPhaseValue(value, source = 'gep') {
  const next = value != null ? String(parseMaybeJson(value)) : state.phase
  if (window.DCSessionGuard.shouldSuppressLifecycle({
    finalizedMatchId: finalizedMatchId(),
    currentMatchId: state.matchId,
    nextPhase: next,
  })) {
    logStaleFinalizedOnce('POST_FINAL_GHOST_PHASE_IGNORED', {
      matchId: state.matchId,
      phase: next,
      source,
    })
    return false
  }
  state.phase = next
  if (state.phase === 'GameInProgress') ensureConfirmedSession('phase_game_in_progress')
  if (state.phase === 'PostGame') finishSession('phase_postgame')
  return true
}

function applyGameModeValue(value, source = 'gep') {
  if (window.DCSessionGuard.shouldSuppressModeUpdate({
    finalizedMatchId: finalizedMatchId(),
    currentMatchId: state.matchId,
  })) {
    logStaleFinalizedOnce('POST_FINAL_GHOST_MODE_IGNORED', {
      matchId: state.matchId,
      mode: parseMaybeJson(value),
      source,
    })
    return false
  }
  state.gameModeRaw = parseMaybeJson(value)
  return true
}

function ensureSession(reason = 'observed') {
  if (state.session && !state.session.ended_at) return state.session
  if (sameFinalizedMatch()) return state.session
  return newSession(reason)
}

function ensureConfirmedSession(reason, startedAt = null) {
  if (!CONFIRMED_SESSION_STARTS.has(reason)) return ensureSession(reason)

  if (sameFinalizedMatch()) {
    logStaleFinalizedOnce('STALE_FINALIZED_MATCH_IGNORED', {
      matchId: state.matchId,
      sessionId: state.session?.id || null,
      reason,
    })
    return state.session
  }

  if (state.session && !state.session.ended_at) {
    if (CONFIRMED_SESSION_STARTS.has(state.session.reason)) return state.session
    finishSession('superseded_unconfirmed_start')
  }
  return newSession(reason, startedAt)
}

function persistSession() {
  if (!state.session) return
  state.session.match_id = state.matchId || state.session.match_id || null
  state.session.mode_raw = state.gameModeRaw ?? state.session.mode_raw ?? null
  state.session.local_team = state.localTeam ?? state.session.local_team ?? null
  state.session.match_outcome = state.matchOutcome ?? state.session.match_outcome ?? null
  state.session.match_outcome_event_at = state.matchOutcomeEventAt ?? state.session.match_outcome_event_at ?? null
  state.session.match_outcome_event_match_id = state.matchOutcomeEventMatchId ?? state.session.match_outcome_event_match_id ?? null
  state.session.team_score = state.teamScore ?? state.session.team_score ?? null
  state.session.event_counts = { ...state.eventCounts }
  state.session.evidence = { ...(state.liveStats || {}) }
  state.session.last_roster_at = state.lastRosterAt
  state.session.match_clock_s = state.matchClockS ?? state.session.match_clock_s ?? null
  state.session.match_clock_observed_at = state.matchClockObservedAt ?? state.session.match_clock_observed_at ?? null
  saveJson(STORAGE.session, state.session)
  publishBridgeState()
}

function finishSession(reason = 'match_end') {
  if (!state.session) return false
  const wasEnded = !!state.session.ended_at
  const promotedToMatchEnd = wasEnded && reason === 'match_end' && state.session.end_reason !== 'match_end'
  if (!wasEnded) state.session.ended_at = nowIso()
  if (!wasEnded || promotedToMatchEnd || !state.session.end_reason) state.session.end_reason = reason
  if (['match_end', 'phase_postgame'].includes(reason) && state.session.match_id) {
    const previous = window.DCSessionGuard.sameMatch(state.finalized?.match_id, state.session.match_id)
      ? state.finalized
      : {}
    state.finalized = {
      ...previous,
      match_id: Number(state.session.match_id),
      session_id: state.session.id,
      finalized_at: state.session.ended_at,
      reason,
    }
    saveJson(STORAGE.finalized, state.finalized)
  }
  persistSession()
  if (!wasEnded || promotedToMatchEnd) log('SESSION_END', state.session)
  return !wasEnded || promotedToMatchEnd
}

function publishBridgeState() {
  const bridge = {
    version: BRIDGE_STATE_VERSION,
    updated_at: nowIso(),
    companion_version: VERSION,
    evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
    paired: !!state.token,
    account: state.account ? {
      display_name: state.account.display_name || null,
      steam_id64: state.account.steam_id64 || null,
    } : null,
    game: {
      running: state.gameRunning,
      steam_id64: state.steamId,
      phase: state.phase,
      mode_raw: state.gameModeRaw,
      match_id: state.matchId,
      match_outcome: state.matchOutcome,
      match_outcome_event_at: state.matchOutcomeEventAt,
      match_outcome_event_match_id: state.matchOutcomeEventMatchId,
      team_score: state.teamScore,
      local_team: state.localTeam,
    },
    evidence: state.liveStats,
    session_id: state.session?.id || null,
    finalized_match_id: finalizedMatchId(),
    queue_count: state.queue.length,
    last_error: state.lastError || null,
    last_upload_status: state.lastUploadStatus,
    last_synced_at: state.lastSyncedAt,
    product: {
      status: state.product?.status || 'UNPAIRED',
      stale: !!state.product?.stale,
      loaded_at: state.product?.loaded_at || null,
      active_case_count: state.product?.active_cases?.length || 0,
    },
    gep: {
      local_version: state.gepVersion,
      public_version: state.gepPublicVersion,
      is_updated: state.gepUpdated,
      features: [...state.features],
      last_roster_at: state.lastRosterAt,
      last_info_at: state.lastInfoAt,
      last_event_at: state.lastEventAt,
    },
  }
  saveJson(STORAGE.bridgeState, bridge)
}

function setMatchId(value, source = 'gep') {
  const next = asInt(value)
  if (!next) return false
  if (next === state.matchId) return false

  const previousMatchId = state.matchId ? Number(state.matchId) : null
  const finalizedId = finalizedMatchId()

  if (!previousMatchId && finalizedId && next === finalizedId) {
    state.matchId = next
    log('FINALIZED_MATCH_REDISCOVERED', {
      matchId: next,
      source,
      sessionId: state.session?.id || null,
    })
    updateUi()
    return false
  }

  if (previousMatchId && next !== previousMatchId && state.session && !state.session.ended_at) {
    finishSession('match_id_changed')
  }

  state.matchId = next

  if (finalizedId && next !== finalizedId) {
    state.finalized = null
    localStorage.removeItem(STORAGE.finalized)
    state.liveStats = null
    state.matchOutcome = null
    state.matchOutcomeEventAt = null
    state.matchOutcomeEventMatchId = null
    state.teamScore = null
    state.localTeam = null
    state.matchClockS = null
    state.matchClockObservedAt = null
    state.eventCounts = { kills: 0, deaths: 0, assists: 0 }
    staleFinalizedNotices.clear()
    newSession(`match_id:${source}`)
  }

  let session = state.session
  if (!session) {
    session = newSession(`match_id:${source}`)
  } else if (
    session.match_id
    && Number(session.match_id) !== next
    && !session.ended_at
  ) {
    finishSession('match_id_changed')
    session = newSession(`match_id:${source}`)
  } else if (
    session.ended_at
    && Number(session.match_id || 0) !== next
  ) {
    session = newSession(`match_id:${source}`)
  }

  session.match_id = next
  persistSession()
  log('MATCH_ID', { matchId: next, source, sessionId: session.id })
  updateUi()
  return true
}

function normalizeRosterPlayer(value) {
  const player = parseMaybeJson(value)
  if (!player || typeof player !== 'object') return null
  const isLocal = player.is_local === true || String(player.is_local).toLowerCase() === 'true'
  const rosterSteam = player.steam_id ? String(player.steam_id) : null
  const sameSteam = state.steamId && rosterSteam && rosterSteam === String(state.steamId)
  if (!isLocal && !sameSteam) return null
  return {
    hero_id: asInt(player.hero_id),
    kills: asInt(player.kills),
    deaths: asInt(player.deaths),
    assists: asInt(player.assist ?? player.assists),
    hero_damage: asInt(player.hero_damage),
    object_damage: asInt(player.object_damage),
    healing: asInt(player.hero_healing ?? player.healing),
    souls: asInt(player.souls),
    team_name: player.team_name ? String(player.team_name) : null,
    hero_name: player.hero_name ? String(player.hero_name) : null,
  }
}

function mergeEvidence(next, source = 'roster') {
  if (!next) return false

  if (sameFinalizedMatch()) {
    logStaleFinalizedOnce('STALE_FINALIZED_EVIDENCE_IGNORED', {
      matchId: state.matchId,
      source,
      sessionId: state.session?.id || null,
    })
    return false
  }

  ensureSession(`evidence:${source}`)

  const old = state.liveStats || {}
  const merged = { ...old }
  const monotonic = ['kills', 'deaths', 'assists', 'hero_damage', 'object_damage', 'healing', 'souls']

  if (next.hero_id !== null && next.hero_id !== undefined) merged.hero_id = next.hero_id
  for (const key of monotonic) {
    if (next[key] !== null && next[key] !== undefined) merged[key] = maxKnown(old[key], next[key])
  }

  // Events are local-player events according to Deadlock GEP. Use them only as
  // a floor; roster remains the richer correction source.
  merged.kills = maxKnown(merged.kills, state.eventCounts.kills)
  merged.deaths = maxKnown(merged.deaths, state.eventCounts.deaths)
  merged.assists = maxKnown(merged.assists, state.eventCounts.assists)

  state.liveStats = merged
  if (next.team_name) state.localTeam = String(next.team_name).toUpperCase()
  state.lastRosterAt = nowIso()
  persistSession()
  log('EVIDENCE', { source, evidence: state.liveStats, localTeam: state.localTeam })
  updateUi()
  return true
}

function applyLocalRoster(value) {
  const stats = normalizeRosterPlayer(value)
  if (!stats) return false
  return mergeEvidence(stats, 'roster')
}

function applyMatchHistory(value) {
  const parsed = parseMaybeJson(value)
  if (!Array.isArray(parsed)) return false
  state.matchHistory = parsed
  log('MATCH_HISTORY', { count: parsed.length, ids: [...historyIds(parsed)].slice(-10) })

  if (state.session && !state.matchId) {
    const recovered = latestUnseenHistoryMatch()
    if (recovered) {
      setMatchId(recovered, 'match_history')
      scheduleSync('match_ended')
    }
  }
  return true
}

function applyMatchOutcome(value, source = 'get_info') {
  const parsed = parseMaybeJson(value)
  const winning = parsed && typeof parsed === 'object'
    ? String(parsed.winning_team || parsed.winner || '').toUpperCase()
    : String(parsed || '').toUpperCase()
  if (!winning) return
  state.matchOutcome = winning

  // Only an actual GEP info-update can become scoring-grade result evidence.
  // getInfo() may keep returning the previous match winner after match_id has
  // already advanced, so a polled/cached label is diagnostic only.
  if (source === 'info_update' && state.matchId) {
    state.matchOutcomeEventAt = nowIso()
    state.matchOutcomeEventMatchId = Number(state.matchId)
  }

  persistSession()
  log('MATCH_OUTCOME', {
    winning,
    source,
    matchId: state.matchId || null,
    eventAt: state.matchOutcomeEventAt,
    eventMatchId: state.matchOutcomeEventMatchId,
  })
}

function applyTeamScore(value) {
  const parsed = parseMaybeJson(value)
  if (parsed && typeof parsed === 'object') {
    state.teamScore = parsed
    persistSession()
    log('TEAM_SCORE', parsed)
  }
}

async function serverFetch(path, options = {}) {
  const base = cleanServerUrl(state.serverUrl)
  if (!isAllowedServerUrl(base)) throw new Error('Only the official https://deadlock-contracts.online server is allowed')
  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')
  if (options.body) headers.set('Content-Type', 'application/json')
  if (state.token && options.auth !== false) headers.set('Authorization', `Bearer ${state.token}`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  let response
  try {
    response = await fetch(base + path, {
      method: options.method || 'GET',
      headers,
      body: options.body || undefined,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Request timed out')
      timeoutError.code = 'REQUEST_TIMEOUT'
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  const data = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }))
  if (!response.ok) {
    const detail = typeof data.detail === 'string'
      ? data.detail
      : typeof data.message === 'string'
        ? data.message
        : `HTTP ${response.status}`
    const error = new Error(detail)
    error.status = response.status
    error.code = String(data.code || `HTTP_${response.status}`)
    error.requestId = data.request_id || response.headers.get('x-request-id') || null
    error.retryAfter = Number(response.headers.get('retry-after')) || null
    throw error
  }
  return data
}

function cancelPostMatchProductRefresh() {
  for (const timer of postMatchProductTimers) clearTimeout(timer)
  postMatchProductTimers = []
  postMatchProductKey = null
}

function schedulePostMatchProductRefresh(matchId = null, sessionId = null) {
  if (!state.token) return
  const key = String(matchId || sessionId || '')
  if (!key || postMatchProductKey === key) return
  cancelPostMatchProductRefresh()
  postMatchProductKey = key
  postMatchProductTimers = POST_MATCH_PRODUCT_REFRESH_MS.map(delay => setTimeout(() => {
    void refreshProduct().catch(error => log('POST_MATCH_PRODUCT_REFRESH_ERROR', {
      key,
      delay,
      message: String(error?.message || error),
    }))
  }, delay))
  log('POST_MATCH_PRODUCT_REFRESH_SCHEDULED', { key, delays: POST_MATCH_PRODUCT_REFRESH_MS })
}

async function refreshProduct() {
  if (!state.token) {
    clearProduct('UNPAIRED')
    return state.product
  }
  if (productRefreshInProgress) return state.product
  productRefreshInProgress = true
  if (!state.product?.loaded_at) state.product = window.DCProduct.emptyProductState('CONNECTING')
  try {
    const data = await serverFetch('/api/desktop/v1/bootstrap')
    state.product = window.DCProduct.normalizeBootstrap(data)
    if (state.product.account) {
      state.account = {
        ...state.account,
        ...state.product.account,
        steam_id64: state.product.account.steam_id64 || state.account?.steam_id64 || null,
      }
    }
    state.lastError = ''
    persistProduct()
    log('PRODUCT_SYNC', {
      boards: state.product.boards.length,
      activeCases: state.product.active_cases.length,
      history: state.product.history.length,
    })
  } catch (error) {
    log('PRODUCT_SYNC_ERROR', {
      code: error?.code || null,
      status: error?.status || null,
      requestId: error?.requestId || null,
      message: String(error?.message || error),
    })
    if (error?.status === 401) {
      state.token = ''
      state.account = null
      clearStoredToken()
      clearProduct('UNPAIRED')
    } else {
      state.product = productErrorState(error)
    }
  } finally {
    productRefreshInProgress = false
    publishBridgeState()
  }
  return state.product
}

async function lockContracts(mode, optionIds) {
  const normalizedMode = window.DCProduct.normalizeMode(mode)
  const ids = [...new Set((Array.isArray(optionIds) ? optionIds : []).map(String).filter(Boolean))]
  if (!normalizedMode) throw new Error('Unknown game mode')
  if (ids.length < 1 || ids.length > 3) throw new Error('Select between one and three contracts')
  await serverFetch('/api/desktop/v1/boards/lock', {
    method: 'POST',
    body: JSON.stringify({ mode: normalizedMode, option_ids: ids }),
  })
  await refreshProduct()
  return publicSnapshot()
}

async function rerollBoard(mode) {
  const normalizedMode = window.DCProduct.normalizeMode(mode)
  if (!normalizedMode) throw new Error('Unknown game mode')
  await serverFetch(`/api/desktop/v1/boards/${encodeURIComponent(normalizedMode)}/reroll`, { method: 'POST' })
  await refreshProduct()
  return publicSnapshot()
}

function setPairError(message = '') {
  state.lastError = String(message || '')
  if ($('pairError')) $('pairError').textContent = state.lastError
  publishBridgeState()
}

function queueSave() {
  if (state.queue.length > QUEUE_LIMIT) state.queue = state.queue.slice(-QUEUE_LIMIT)
  saveJson(STORAGE.queue, state.queue)
  publishBridgeState()
}

function queuePayload(payload, eventType) {
  if (!state.token) return

  if (eventType === 'match_ended' && !window.DCSessionGuard.shouldQueueFinalUpload({
    finalized: state.finalized,
    queue: state.queue,
    payload,
  })) {
    logStaleFinalizedOnce('DUPLICATE_MATCH_ENDED_SUPPRESSED', {
      matchId: payload?.match_id || null,
      sessionId: payload?.session_id || null,
    })
    return false
  }

  // A heartbeat is replaceable telemetry. Significant transition events are not.
  if (eventType === 'heartbeat') {
    state.queue = state.queue.filter(item => item.event_type !== 'heartbeat')
  }

  state.queue.push({
    id: randomId('upload'),
    event_type: eventType,
    created_at: nowIso(),
    attempts: 0,
    payload,
  })
  queueSave()
  if (eventType === 'match_ended' && state.finalized) {
    const uploadKey = window.DCSessionGuard.finalUploadKey(payload)
    if (uploadKey) {
      state.finalized.upload_key = uploadKey
      state.finalized.upload_queued_at = nowIso()
      saveJson(STORAGE.finalized, state.finalized)
    }
  }
  updateUi()
  return true
}

async function flushQueue() {
  if (flushInProgress || !state.token || !state.queue.length) return
  flushInProgress = true
  try {
    while (state.token && state.queue.length) {
      const item = state.queue[0]
      try {
        const data = await serverFetch('/api/companion/heartbeat', {
          method: 'POST',
          body: JSON.stringify(item.payload),
        })
        state.lastSyncedAt = data.server_time || nowIso()
        state.lastUploadStatus = `OK · ${new Date(state.lastSyncedAt).toLocaleTimeString('en-US')}`
        state.queue = state.queue.filter(queued => queued.id !== item.id)
        queueSave()
        log('SERVER_SYNC', {
          eventType: item.event_type,
          matchId: item.payload.match_id,
          mode: modeDisplay(item.payload.game_mode),
          liveStats: item.payload.live_stats,
          directBoards: data.direct_match_boards,
          wokenBoards: data.woken_boards,
        })
      } catch (error) {
        const message = String(error?.message || error)
        item.attempts = (item.attempts || 0) + 1
        item.last_error = message
        state.lastUploadStatus = `ERROR · ${message}`
        queueSave()
        log('SERVER_SYNC_ERROR', { id: item.id, attempts: item.attempts, message })
        if (error?.status === 401 || /token|401|invalid|expired|revoked/i.test(message)) {
          state.token = ''
          clearStoredToken()
          state.lastSyncedAt = null
        }
        break
      }
    }
  } finally {
    flushInProgress = false
    updateUi()
  }
}

function heartbeatPayload(eventType = 'heartbeat') {
  const session = state.session
  return {
    game_running: state.gameRunning,
    steam_id64: state.steamId || null,
    phase: state.phase,
    game_mode: state.gameModeRaw,
    match_id: state.matchId ? Number(state.matchId) : (session?.match_id ? Number(session.match_id) : null),
    gep_version: state.gepVersion,
    version: VERSION,
    live_stats: state.liveStats,
    session_id: session?.id || null,
    session_started_at: session?.started_at || null,
    session_ended_at: session?.ended_at || null,
    session_start_reason: session?.reason || null,
    session_end_reason: session?.end_reason || null,
    match_clock_s: session?.match_clock_s ?? state.matchClockS ?? null,
    match_clock_observed_at: session?.match_clock_observed_at ?? state.matchClockObservedAt ?? null,
    local_team: normalizeTeam(session?.local_team ?? state.localTeam),
    match_outcome: normalizeTeam(session?.match_outcome ?? state.matchOutcome),
    match_outcome_event_at: session?.match_outcome_event_at ?? state.matchOutcomeEventAt ?? null,
    match_outcome_event_match_id: session?.match_outcome_event_match_id ?? state.matchOutcomeEventMatchId ?? null,
    event_type: eventType,
  }
}

async function sendSnapshot(eventType = 'heartbeat') {
  if (!state.token) return
  const payload = heartbeatPayload(eventType)
  queuePayload(payload, eventType)
  await flushQueue()
  if (eventType === 'match_ended') schedulePostMatchProductRefresh(payload.match_id, payload.session_id)
}

function scheduleSync(eventType = 'heartbeat') {
  if (!state.token) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => void sendSnapshot(eventType), 250)
}

function detectTransitionEvent() {
  const previous = state.lastObserved
  let event = 'heartbeat'
  if (previous.gameRunning === false && state.gameRunning) event = 'game_started'
  else if (previous.gameRunning === true && !state.gameRunning) event = 'game_stopped'
  else if (state.matchId && state.matchId !== previous.matchId) event = 'match_started'
  else if (state.phase === 'PostGame' && previous.phase !== 'PostGame') event = 'match_ended'
  else if (state.phase && state.phase !== previous.phase) event = 'phase_changed'

  state.lastObserved = {
    gameRunning: state.gameRunning,
    phase: state.phase,
    matchId: state.matchId,
  }
  return event
}

function dynamicUnavailable() {
  return !!(
    state.gameRunning &&
    !state.phase &&
    !state.matchId &&
    !state.liveStats &&
    state.gameDetectedAt &&
    Date.now() - state.gameDetectedAt > 30000
  )
}

function localResultLabel() {
  if (!state.matchOutcome) return '—'
  if (!state.localTeam) return `WINNING TEAM: ${state.matchOutcome}`
  return state.matchOutcome === state.localTeam ? 'VICTORY' : 'DEFEAT'
}

function updateUi() {
  if (!$('serverUrl')) return
  $('serverUrl').value = state.serverUrl
  $('siteStatus').textContent = state.token ? 'CONNECTED' : 'NOT CONNECTED'
  $('accountName').textContent = state.account?.display_name || '—'
  $('gameRunning').textContent = state.gameRunning ? 'RUNNING' : 'NOT RUNNING'
  $('steamId').textContent = state.steamId || '—'
  $('phase').textContent = phaseDisplay(state.phase)
  $('gameMode').textContent = `Mode: ${modeDisplay(state.gameModeRaw)}`
  $('matchId').textContent = state.matchId || '—'
  $('gepVersion').textContent = state.gepVersion || '—'
  $('gepFeatures').textContent = dynamicUnavailable()
    ? 'Live GEP data is unavailable · post-match recovery remains active'
    : (state.features.length ? state.features.join(', ') : 'Waiting for Deadlock GEP')
  $('lastSync').textContent = `Last sync: ${state.lastSyncedAt ? new Date(state.lastSyncedAt).toLocaleTimeString('en-US') : '—'}`

  const expectedSteam = state.account?.steam_id64 ? String(state.account.steam_id64) : null
  const identityOk = expectedSteam && state.steamId ? expectedSteam === String(state.steamId) : null
  $('identityCheck').textContent = identityOk === true ? 'Steam identity verified' : identityOk === false ? 'STEAM ID MISMATCH' : 'Identity not verified yet'
  $('identityCheck').className = identityOk === false ? 'bad-text' : identityOk === true ? 'ok-text' : ''

  const s = state.liveStats || {}
  $('kills').textContent = s.kills ?? '—'
  $('deaths').textContent = s.deaths ?? '—'
  $('assists').textContent = s.assists ?? '—'
  $('heroDamage').textContent = s.hero_damage ?? '—'
  $('objectDamage').textContent = s.object_damage ?? '—'
  $('healing').textContent = s.healing ?? '—'
  $('souls').textContent = s.souls ?? '—'
  $('outcome').textContent = localResultLabel()

  $('sessionId').textContent = state.session?.id || '—'
  $('rosterAge').textContent = state.lastRosterAt
    ? `${Math.max(0, Math.round((Date.now() - new Date(state.lastRosterAt).getTime()) / 1000))} sec ago`
    : '—'
  $('queueCount').textContent = String(state.queue.length)
  $('uploadState').textContent = state.lastUploadStatus
  $('schemaVersion').textContent = `Evidence v${EVIDENCE_SCHEMA_VERSION}`

  const pill = $('overallPill')
  pill.className = `pill ${state.token ? (state.lastSyncedAt ? 'online' : 'paired') : 'offline'}`
  pill.querySelector('b').textContent = !state.token
    ? 'NOT PAIRED'
    : state.lastSyncedAt
      ? (state.gameRunning ? 'DEADLOCK DETECTED' : 'CONNECTED')
      : 'PAIRED'

  $('bridgeState').textContent = !state.token
    ? 'PAIRING REQUIRED'
    : state.gameRunning
      ? (state.matchId ? `MATCH #${state.matchId}` : (dynamicUnavailable() ? 'POST-MATCH RECOVERY' : 'MATCH IN PROGRESS'))
      : state.queue.length
        ? `QUEUED: ${state.queue.length}`
        : 'WAITING FOR DEADLOCK'

  $('disconnectBtn').disabled = !state.token
  $('flushBtn').disabled = !state.token || !state.queue.length
  publishBridgeState()
}

function extractMatchInfo(mi, source = 'get_info') {
  if (!mi || typeof mi !== 'object') return
  if (mi.match_id != null) setMatchId(parseMaybeJson(mi.match_id), 'getInfo')
  if (mi.match_outcome != null) applyMatchOutcome(mi.match_outcome, source)
  if (mi.team_score != null) applyTeamScore(mi.team_score)
  for (const [key, raw] of Object.entries(mi)) {
    if (key.startsWith('roster')) applyLocalRoster(raw)
  }
}

function classifyInfoSource(result) {
  return result?.feature && result?.info ? 'info_update' : 'get_info'
}

function extractKnown(result) {
  // getInfo() returns { success, res }; onInfoUpdates2 can return
  // { feature, info }. Deadlock documentation also shows flat key/value|data
  // updates, handled by the feature/category/key branch below.
  const source = classifyInfoSource(result)
  const res = result && (result.res || result.info || result)
  if (!res || typeof res !== 'object') return
  state.lastInfoAt = nowIso()

  if (res.match_info?.match_id != null) {
    setMatchId(parseMaybeJson(res.match_info.match_id), 'getInfo')
  }

  if (res.game_info) {
    const gi = res.game_info
    if (gi.steam_id != null) state.steamId = asSteamIdString(gi.steam_id)
    if (gi.phase != null) applyPhaseValue(gi.phase, 'getInfo')
    if (gi.game_mode != null) applyGameModeValue(gi.game_mode, 'getInfo')
    if (gi.match_history != null) applyMatchHistory(gi.match_history)
  }

  if (res.match_info) extractMatchInfo(res.match_info, source)

  if (res.gep_internal && res.gep_internal.version_info != null) {
    const vi = parseMaybeJson(res.gep_internal.version_info)
    if (vi && typeof vi === 'object') {
      state.gepVersion = String(vi.local_version || '') || null
      state.gepPublicVersion = String(vi.public_version || '') || null
      state.gepUpdated = vi.is_updated ?? null
    }
  }
  persistSession()
  updateUi()
}

function applyInfoUpdate(info) {
  try {
    state.lastInfoAt = nowIso()
    const feature = info.feature || info.category
    const key = info.key || ''
    const value = parseMaybeJson(('value' in info) ? info.value : info.data)

    if (feature === 'game_info') {
      if (key === 'steam_id') state.steamId = asSteamIdString(('value' in info) ? info.value : info.data) || state.steamId
      if (key === 'phase') {
        applyPhaseValue(value, 'info_update')
      }
      if (key === 'game_mode') applyGameModeValue(value, 'info_update')
      if (key === 'match_history') applyMatchHistory(value)
    }

    if (feature === 'match_info') {
      if (key === 'match_id') setMatchId(value, 'info_update')
      if (key === 'match_outcome') applyMatchOutcome(value, 'info_update')
      if (key === 'team_score') applyTeamScore(value)
      if (key.startsWith('roster')) applyLocalRoster(value)
    }

    if (feature === 'gep_internal' && key === 'version_info') {
      const vi = parseMaybeJson(value)
      if (vi && typeof vi === 'object') {
        state.gepVersion = String(vi.local_version || '') || null
        state.gepPublicVersion = String(vi.public_version || '') || null
        state.gepUpdated = vi.is_updated ?? null
      }
    }

    if (info.info) extractKnown({ res: info.info })
  } catch (error) {
    log('INFO_UPDATE_PARSE_ERROR', String(error))
  }

  persistSession()
  updateUi()
  scheduleSync(detectTransitionEvent())
}

function getInfo(eventType = null) {
  overwolf.games.events.getInfo(result => {
    log('GET_INFO', result)
    extractKnown(result)
    const transition = eventType || detectTransitionEvent()
    if (eventType || transition !== 'heartbeat') scheduleSync(transition)
  })
}

function setFeatures(attempt = 1) {
  overwolf.games.events.setRequiredFeatures(FEATURES, result => {
    log('SET_FEATURES', result)
    if (result && result.success) {
      state.features = result.supportedFeatures || FEATURES
      getInfo()
    } else {
      state.features = []
      setTimeout(() => setFeatures(attempt + 1), Math.min(30000, 3000 + attempt * 2000))
    }
    updateUi()
  })
}

function clearRecoveryTimers() {
  for (const timer of recoveryTimers) clearTimeout(timer)
  recoveryTimers = []
}

function scheduleHistoryRecovery() {
  clearRecoveryTimers()
  for (const delay of [1500, 5000, 15000, 30000, 60000]) {
    recoveryTimers.push(setTimeout(() => {
      getInfo('match_ended')
      const recovered = latestUnseenHistoryMatch()
      if (recovered) setMatchId(recovered, 'delayed_match_history')
    }, delay))
  }
}

function checkGame() {
  overwolf.games.getRunningGameInfo(info => {
    const running = !!(info && info.isRunning && Number(info.classId) === GAME_ID)
    const changed = running !== state.gameRunning
    state.gameRunning = running

    if (running && changed) {
      // New game process / new launch: don't carry the previous match's ID or
      // counters into the next session. First let getInfo() populate
      // match_history, then create a fallback session with a correct baseline.
      state.phase = null
      state.gameModeRaw = null
      state.matchId = null
      state.liveStats = null
      state.matchOutcome = null
      state.matchOutcomeEventAt = null
      state.matchOutcomeEventMatchId = null
      state.teamScore = null
      state.localTeam = null
      state.matchClockS = null
      state.matchClockObservedAt = null
      state.eventCounts = { kills: 0, deaths: 0, assists: 0 }
      state.gameDetectedAt = Date.now()
      getInfo()
      setTimeout(() => {
        if (
          state.gameRunning
          && (!state.session || state.session.ended_at)
          && !sameFinalizedMatch()
        ) {
          newSession('game_detected_fallback')
        }
      }, 1500)
    } else if (running && !state.gameDetectedAt) {
      state.gameDetectedAt = Date.now()
    }

    if (!running && changed) {
      state.gameDetectedAt = null
      finishSession('game_stopped')
      scheduleHistoryRecovery()
    }

    if (!running && !state.session) {
      state.phase = null
      state.gameModeRaw = null
      state.matchId = null
      state.liveStats = null
    }

    log('RUNNING_GAME', info)
    updateUi()
    if (changed) scheduleSync(running ? 'game_started' : 'game_stopped')
  })
}

function applyLocalEvent(name) {
  if (!['kill', 'death', 'assist'].includes(name)) return
  ensureSession(`event:${name}`)
  if (name === 'kill') state.eventCounts.kills += 1
  if (name === 'death') state.eventCounts.deaths += 1
  if (name === 'assist') state.eventCounts.assists += 1
  mergeEvidence({}, `event:${name}`)
}

function handleNewEvents(info) {
  state.lastEventAt = nowIso()
  log('NEW_EVENT', info)
  const events = Array.isArray(info?.events) ? info.events : []
  for (const event of events) {
    const name = event?.name
    if (name === 'match_clock') applyMatchClock(event?.data)
    if (name === 'match_start') {
      if (sameFinalizedMatch()) {
        log('STALE_MATCH_START_IGNORED', { matchId: state.matchId, finalized: state.finalized })
        getInfo('heartbeat')
      } else {
        if (state.session && !state.session.ended_at) finishSession('new_match_start')
        newSession('match_start')
        getInfo('match_started')
      }
    }
    if (name === 'kill' || name === 'death' || name === 'assist') applyLocalEvent(name)
    if (name === 'match_end') {
      const changed = finishSession('match_end')
      if (!changed && sameFinalizedMatch()) {
        logStaleFinalizedOnce('DUPLICATE_MATCH_END_EVENT_IGNORED', {
          matchId: state.matchId,
          sessionId: state.session?.id || null,
        })
        continue
      }
      getInfo('match_ended')
      scheduleHistoryRecovery()
      setTimeout(() => void sendSnapshot('match_ended'), 1000)
    }
  }
  updateUi()
}

async function reconnect() {
  if (!state.token) return
  try {
    const data = await serverFetch('/api/companion/hello')
    state.account = data.account
    state.lastSyncedAt = data.server_time
    state.lastUploadStatus = 'CONNECTION RESTORED'
    setPairError('')
    log('SERVER_HELLO', data)
    await flushQueue()
    if (state.finalized && !state.finalized.upload_queued_at && state.session?.ended_at) {
      await sendSnapshot('match_ended')
    }
    await refreshProduct()
  } catch (error) {
    const message = String(error?.message || error)
    log('SERVER_HELLO_ERROR', message)
    if (error?.status === 401 || /token|401|invalid|expired|revoked/i.test(message)) {
      state.token = ''
      clearStoredToken()
    } else {
      setPairError(`Website unavailable: ${message}. Match data is retained in the local queue.`)
    }
  }
  updateUi()
}

async function pair() {
  setPairError('')
  const serverUrl = cleanServerUrl($('serverUrl').value)
  const code = $('pairCode').value.trim().toUpperCase()
  if (!serverUrl || !code) {
    setPairError('Enter the website address and pairing code.')
    return false
  }
  if (!isAllowedServerUrl(serverUrl)) {
    setPairError('For security, only the official deadlock-contracts.online server is allowed.')
    return false
  }
  state.serverUrl = serverUrl
  localStorage.setItem(STORAGE.serverUrl, serverUrl)
  try {
    const data = await serverFetch('/api/companion/pairing/claim', {
      auth: false,
      method: 'POST',
      body: JSON.stringify({
        code,
        device_id: ensureDeviceId(),
        label: 'Deadlock Contracts Desktop',
        version: VERSION,
      }),
    })
    state.token = data.token
    state.account = data.account
    state.lastSyncedAt = nowIso()
    state.lastUploadStatus = 'PAIRING COMPLETE'
    const securelyStored = await storeTokenSecurely(state.token)
    if (!securelyStored) {
      setPairError('Pairing succeeded, but secure token storage is unavailable. You will need to pair again after Companion restarts.')
    }
    $('pairCode').value = ''
    log('PAIRED', { account: data.account, device: state.deviceId })
    updateUi()
    if (state.finalized && !state.finalized.upload_queued_at && state.session?.ended_at) {
      await sendSnapshot('match_ended')
    } else {
      await sendSnapshot('heartbeat')
    }
    await refreshProduct()
    return true
  } catch (error) {
    setPairError(String(error?.message || error))
    log('PAIR_ERROR', String(error?.message || error))
    return false
  }
}

async function testServer() {
  const candidate = cleanServerUrl($('serverUrl').value)
  if (!isAllowedServerUrl(candidate)) {
    setPairError('For security, only the official deadlock-contracts.online server is allowed.')
    return
  }
  state.serverUrl = candidate
  localStorage.setItem(STORAGE.serverUrl, state.serverUrl)
  try {
    const data = await serverFetch('/api/health', { auth: false })
    setPairError(`Server reachable: ${data.version || 'OK'}`)
  } catch (error) {
    setPairError(`Cannot reach the server: ${error?.message || error}`)
  }
}

async function disconnect() {
  if (state.token) {
    try { await serverFetch('/api/companion/disconnect', { method: 'POST' }) } catch (error) { log('DISCONNECT_SERVER_ERROR', String(error)) }
  }
  state.token = ''
  state.account = null
  state.lastSyncedAt = null
  state.lastUploadStatus = '—'
  state.queue = []
  clearStoredToken()
  localStorage.removeItem(STORAGE.queue)
  clearProduct('UNPAIRED')
  updateUi()
  setPairError('This Companion has been disconnected. Generate a new pairing code on the website to reconnect.')
}

function diagnosticsText() {
  const s = state.liveStats || {}
  return [
    'DEADLOCK CONTRACTS COMPANION — DIAGNOSTICS',
    `Companion: ${VERSION}`,
    `Evidence schema: ${EVIDENCE_SCHEMA_VERSION}`,
    `Device: ${state.deviceId}`,
    `Server: ${state.serverUrl}`,
    `Paired: ${!!state.token}`,
    `Account: ${state.account?.display_name || '—'}`,
    `Expected SteamID: ${state.account?.steam_id64 || '—'}`,
    `GEP SteamID: ${state.steamId || '—'}`,
    `Deadlock running: ${state.gameRunning}`,
    `Phase: ${state.phase || '—'}`,
    `Mode: ${modeDisplay(state.gameModeRaw)}`,
    `Match ID: ${state.matchId || '—'}`,
    `Session ID: ${state.session?.id || '—'}`,
    `GEP local/public: ${state.gepVersion || '—'} / ${state.gepPublicVersion || '—'}`,
    `GEP updated: ${state.gepUpdated ?? '—'}`,
    `Local team: ${state.localTeam || '—'}`,
    `Match outcome: ${state.matchOutcome || '—'}`,
    `Match clock: ${state.matchClockS ?? '—'} sec`,
    `K/D/A: ${s.kills ?? '—'}/${s.deaths ?? '—'}/${s.assists ?? '—'}`,
    `Hero damage: ${s.hero_damage ?? '—'}`,
    `Object damage: ${s.object_damage ?? '—'}`,
    `Healing: ${s.healing ?? '—'}`,
    `Souls: ${s.souls ?? '—'}`,
    `Last roster: ${state.lastRosterAt || '—'}`,
    `Queued uploads: ${state.queue.length}`,
    `Last upload: ${state.lastUploadStatus}`,
    `Desktop API: ${state.product?.status || 'UNPAIRED'} / ${state.product?.api_version || '—'}`,
    `Desktop features: ${(state.product?.server_features || []).join(', ') || '—'}`,
    `Product cache: ${state.product?.loaded_at || '—'}${state.product?.stale ? ' (stale)' : ''}`,
    `Daily boards: ${state.product?.boards?.length || 0}`,
    `Active cases: ${state.product?.active_cases?.length || 0}`,
    `Product error: ${state.product?.last_error?.message || '—'}`,
    '',
    '--- LOG ---',
    ...logLines,
  ].join('\n')
}

function copyText(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy') } finally { document.body.removeChild(ta) }
}

async function init() {
  ensureDeviceId()
  await loadStoredToken()
  if (state.token) restoreProductCache()
  if (!Array.isArray(state.queue)) state.queue = []
  if (state.session?.evidence) state.liveStats = { ...state.session.evidence }
  if (state.session?.event_counts) state.eventCounts = { ...state.session.event_counts }
  if (state.session?.match_id) state.matchId = asInt(state.session.match_id)
  if (state.session?.mode_raw) state.gameModeRaw = state.session.mode_raw
  if (state.session?.local_team) state.localTeam = state.session.local_team
  if (state.session?.match_outcome) state.matchOutcome = state.session.match_outcome
  if (state.session?.match_outcome_event_at) state.matchOutcomeEventAt = state.session.match_outcome_event_at
  if (state.session?.match_outcome_event_match_id) state.matchOutcomeEventMatchId = asInt(state.session.match_outcome_event_match_id)
  if (state.session?.team_score) state.teamScore = state.session.team_score
  if (state.session?.last_roster_at) state.lastRosterAt = state.session.last_roster_at
  if (state.session?.match_clock_s != null) state.matchClockS = asInt(state.session.match_clock_s)
  if (state.session?.match_clock_observed_at) state.matchClockObservedAt = state.session.match_clock_observed_at
  if (!state.finalized && state.session?.ended_at && state.session?.match_id && ['match_end', 'phase_postgame'].includes(state.session?.end_reason)) {
    state.finalized = { match_id: Number(state.session.match_id), session_id: state.session.id, finalized_at: state.session.ended_at, reason: state.session.end_reason }
    saveJson(STORAGE.finalized, state.finalized)
  }

  $('serverUrl').value = state.serverUrl
  $('pairBtn').onclick = () => void pair()
  $('testBtn').onclick = () => void testServer()
  $('syncBtn').onclick = () => getInfo('heartbeat')
  $('flushBtn').onclick = () => void flushQueue()
  $('disconnectBtn').onclick = () => void disconnect()
  $('copyBtn').onclick = () => copyText(logLines.join('\n'))
  $('reportBtn').onclick = () => copyText(diagnosticsText())
  $('clearBtn').onclick = () => { logLines = []; $('log').textContent = '' }

  overwolf.games.events.onInfoUpdates2.addListener(info => {
    log('INFO_UPDATE', info)
    applyInfoUpdate(info)
  })
  overwolf.games.events.onNewEvents.addListener(handleNewEvents)
  overwolf.games.events.onError.addListener(error => {
    log('GEP_ERROR', error)
    state.lastUploadStatus = `GEP: ${error?.error || error?.message || 'error'}`
    updateUi()
  })

  checkGame()
  setFeatures()
  updateUi()
  void reconnect().then(() => sendSnapshot('heartbeat'))
  setInterval(checkGame, GAME_POLL_MS)
  setInterval(() => getInfo(), INFO_POLL_MS)
  setInterval(() => void sendSnapshot('heartbeat'), HEARTBEAT_MS)
  setInterval(() => void refreshProduct(), PRODUCT_REFRESH_MS)
  setInterval(() => void flushQueue(), 10000)
  setInterval(updateUi, 1000)
  ensureOverlayLayout()
  log('APP', `Deadlock Contracts Companion ${VERSION} started · Evidence v${EVIDENCE_SCHEMA_VERSION}`)
}

function publicSnapshot() {
  const s = state.liveStats || {}
  const expectedSteam = state.account?.steam_id64 ? String(state.account.steam_id64) : null
  const identityOk = expectedSteam && state.steamId ? expectedSteam === String(state.steamId) : null
  return {
    version: VERSION,
    evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
    paired: !!state.token,
    account: state.account,
    game_running: state.gameRunning,
    steam_id64: state.steamId,
    identity_ok: identityOk,
    phase: state.phase,
    phase_display: phaseDisplay(state.phase),
    mode_display: modeDisplay(state.gameModeRaw),
    game_mode_raw: state.gameModeRaw,
    match_id: state.matchId,
    finalized_match_id: finalizedMatchId(),
    session: state.session ? JSON.parse(JSON.stringify(state.session)) : null,
    evidence: { ...s },
    match_outcome: state.matchOutcome,
    local_team: state.localTeam,
    result_label: localResultLabel(),
    match_clock_s: state.matchClockS,
    queue_count: state.queue.length,
    last_synced_at: state.lastSyncedAt,
    last_upload_status: state.lastUploadStatus,
    last_error: state.lastError,
    gep_version: state.gepVersion,
    gep_public_version: state.gepPublicVersion,
    gep_updated: state.gepUpdated,
    features: [...state.features],
    last_roster_at: state.lastRosterAt,
    last_info_at: state.lastInfoAt,
    last_event_at: state.lastEventAt,
    match_clock_observed_at: state.matchClockObservedAt,
    overlay_scale: overlayScale(),
    hotkey_binding: state.hotkeyBinding || DEFAULT_HOTKEY,
    product: JSON.parse(JSON.stringify(state.product || window.DCProduct.emptyProductState())),
    logs: logLines.slice(-300),
  }
}

function obtainWindow(name, callback, onError = null) {
  if (typeof overwolf === 'undefined' || !overwolf.windows?.obtainDeclaredWindow) {
    onError?.(new Error('Overwolf Window API is unavailable'))
    return
  }
  overwolf.windows.obtainDeclaredWindow(name, result => {
    if (!result?.success && result?.status !== 'success') {
      onError?.(new Error(result?.error || `Unable to obtain ${name} window`))
      return
    }
    callback?.(result.window?.id || result.id || name)
  })
}

function showDesktop() {
  obtainWindow('desktop', id => overwolf.windows.restore(id, () => {}))
}

function toggleOverlay() {
  return new Promise((resolve, reject) => {
    obtainWindow('overlay', id => {
      overwolf.windows.getWindowState(id, result => {
        const current = String(result?.window_state_ex || result?.window_state || '').toLowerCase()
        const isVisible = ['normal', 'maximized'].includes(current)
        const complete = actionResult => {
          if (actionResult?.success === false) reject(new Error(actionResult?.error || 'Unable to toggle overlay'))
          else resolve({ visible: !isVisible })
        }
        if (isVisible) overwolf.windows.minimize(id, complete)
        else overwolf.windows.restore(id, complete)
      })
    }, reject)
  })
}

const OVERLAY_PRESETS = {
  compact: { width: 420, height: 320 },
  regular: { width: 480, height: 340 },
  large: { width: 540, height: 360 },
}

function overlayScale() {
  const saved = localStorage.getItem(STORAGE.overlayScale)
  return OVERLAY_PRESETS[saved] ? saved : 'compact'
}

function setOverlayScale(preset) {
  const name = OVERLAY_PRESETS[preset] ? preset : 'compact'
  return new Promise((resolve, reject) => {
    if (typeof overwolf === 'undefined') {
      localStorage.setItem(STORAGE.overlayScale, name)
      resolve({ preset: name, success: true })
      return
    }
    obtainWindow('overlay', id => {
      overwolf.windows.changeSize({ window_id: id, ...OVERLAY_PRESETS[name], auto_dpi_resize: true }, result => {
        if (result?.success === false) reject(new Error(result?.error || 'Unable to resize overlay'))
        else {
          localStorage.setItem(STORAGE.overlayScale, name)
          resolve({ preset: name, success: true })
        }
      })
    }, reject)
  })
}

function ensureOverlayLayout() {
  if (localStorage.getItem(STORAGE.overlayLayout) === 'focus-v2') return
  const preset = overlayScale()
  if (typeof overwolf === 'undefined') {
    localStorage.setItem(STORAGE.overlayLayout, 'focus-v2')
    return
  }
  obtainWindow('overlay', id => {
    overwolf.windows.changeSize({ window_id: id, ...OVERLAY_PRESETS[preset], auto_dpi_resize: true }, result => {
      if (result?.success === false) {
        log('OVERLAY_LAYOUT_MIGRATION_FAILED', result?.error || 'changeSize failed')
        return
      }
      localStorage.setItem(STORAGE.overlayLayout, 'focus-v2')
      log('OVERLAY_LAYOUT_MIGRATED', { preset, ...OVERLAY_PRESETS[preset] })
    })
  })
}

function resetOverlayPosition() {
  return new Promise((resolve, reject) => {
    if (typeof overwolf === 'undefined') {
      resolve({ success: true })
      return
    }
    obtainWindow('overlay', id => {
      overwolf.windows.changePosition(id, 72, 72, result => {
        if (result?.success === false) reject(new Error(result?.error || 'Unable to reset overlay position'))
        else resolve({ success: true })
      })
    }, reject)
  })
}

async function exitApp() {
  try { await flushQueue() } catch (_) {}
  if (typeof overwolf === 'undefined' || !overwolf.windows?.getCurrentWindow) return
  overwolf.windows.getCurrentWindow(result => {
    const id = result?.window?.id || result?.id
    if (id) overwolf.windows.close(id, () => {})
  })
}

window.dcCompanion = {
  getSnapshot: publicSnapshot,
  diagnosticsText,
  getLogs: () => logLines.slice(),
  pair: async (serverUrl, code) => {
    $('serverUrl').value = cleanServerUrl(serverUrl)
    $('pairCode').value = String(code || '').trim().toUpperCase()
    const ok = await pair()
    if (!ok) throw new Error(state.lastError || 'Pairing failed')
    return publicSnapshot()
  },
  testServer: async serverUrl => {
    $('serverUrl').value = cleanServerUrl(serverUrl)
    await testServer()
    return publicSnapshot()
  },
  syncNow: async () => { getInfo('heartbeat'); await sendSnapshot('heartbeat'); await refreshProduct(); return publicSnapshot() },
  refreshProduct: async () => { await refreshProduct(); return publicSnapshot() },
  lockContracts,
  rerollBoard,
  flushNow: async () => { await flushQueue(); return publicSnapshot() },
  disconnect: async () => { await disconnect(); return publicSnapshot() },
  showDesktop,
  toggleOverlay,
  setOverlayScale,
  resetOverlayPosition,
  refreshHotkeyBinding: async () => { await refreshHotkeyBinding(); return publicSnapshot() },
  exitApp,
}

function hotkeyFromResult(result) {
  if (!result?.success) return null
  const gameHotkeys = result.games?.[String(GAME_ID)] ?? result.games?.[GAME_ID]
  const dedicated = Array.isArray(gameHotkeys) ? gameHotkeys : []
  const globals = Array.isArray(result.globals) ? result.globals : []
  const item = [...dedicated, ...globals].find(entry => entry?.name === HOTKEY_NAME)
  if (!item) return null
  if (item.IsUnassigned === true) return 'UNASSIGNED'
  return String(item.binding || '').trim() || 'UNASSIGNED'
}

function refreshHotkeyBinding() {
  return new Promise(resolve => {
    if (!overwolf.settings?.hotkeys?.get) {
      state.hotkeyBinding = DEFAULT_HOTKEY
      resolve(state.hotkeyBinding)
      return
    }
    overwolf.settings.hotkeys.get(result => {
      const binding = hotkeyFromResult(result)
      if (binding !== null) state.hotkeyBinding = binding
      publishBridgeState()
      resolve(state.hotkeyBinding)
    })
  })
}

function installHotkey() {
  if (overwolf.settings?.hotkeys?.onPressed?.addListener) {
    overwolf.settings.hotkeys.onPressed.addListener(event => {
      if (event?.name === HOTKEY_NAME) {
        void toggleOverlay().catch(error => log(`Overlay hotkey failed: ${error.message}`, 'warn'))
      }
    })
  }
  if (overwolf.settings?.hotkeys?.onChanged?.addListener) {
    overwolf.settings.hotkeys.onChanged.addListener(event => {
      if (event?.name !== HOTKEY_NAME) return
      state.hotkeyBinding = String(event.binding || '').trim() || 'UNASSIGNED'
      log('HOTKEY_CHANGED', { binding: state.hotkeyBinding, gameId: event.gameId || null })
      publishBridgeState()
    })
  }
  void refreshHotkeyBinding()
}


function launchSource(value = window.location.href) {
  try { return new URL(value).searchParams.get('source') || '' } catch (_) { return '' }
}

function installLaunchOrchestrator() {
  if (typeof overwolf === 'undefined') return

  // Game auto-launch stays quiet. Dock/install/manual launches open the actual product.
  if (launchSource() !== 'gamelaunchevent') showDesktop()

  if (overwolf.extensions?.onAppLaunchTriggered?.addListener) {
    overwolf.extensions.onAppLaunchTriggered.addListener(origin => {
      if (launchSource(String(origin || '')) !== 'gamelaunchevent') showDesktop()
    })
  }
}

window.addEventListener('load', () => {
  installLaunchOrchestrator()
  installHotkey()
  void init()
})
