/* Deadlock Contracts Companion — Alpha.16 orchestration layer.
 * Lifecycle, queue, schema, progress, storage and health rules live in dedicated modules.
 */
const FEATURES = ['gep_internal', 'game_info', 'match_info']
const GAME_ID = 24482
const VERSION = window.DCRelease?.productVersion
if (!VERSION) throw new Error('Generated release metadata is missing')
const EVIDENCE_SCHEMA_VERSION = window.DCRelease?.evidenceSchemaVersion || 8
const HOTKEY_NAME = 'toggle_contract_overlay'
const DEFAULT_HOTKEY = 'Ctrl+Shift+C'
const ALLOWED_SERVER_URLS = new Set(['https://deadlock-contracts.online'])
const PAIRING_URL = 'https://deadlock-contracts.online/'
const EVENT_STATUS_URL = `https://game-events-status.overwolf.com/${GAME_ID}_prod.json`
const HEARTBEAT_MS = 15000
const PRODUCT_REFRESH_MS = 60000
const INFO_WATCHDOG_RUNNING_MS = 15000
const INFO_WATCHDOG_IDLE_MS = 30000
const FEATURE_RETRY_BASE_MS = 3000
const FEATURE_RETRY_MAX_MS = 60000
const EVENT_STATUS_COOLDOWN_MS = 60000
const FINAL_COLLECTION_GRACE_MS = 5000
const POST_MATCH_REFRESH_MS = [2500, 8000, 20000, 45000, 90000]
const AUTO_HIDE_OPTIONS = [0, 5000, 10000, 30000]
const DEFAULT_AUTO_HIDE_MS = 10000
const LOG_LIMIT = 300
const STREET_BRAWL_ROUND_DEDUPE_MS = 5000
const STREET_BRAWL_ACCUMULATED_METRICS = new Set(['kills','deaths','assists','hero_damage','object_damage','healing','match_clock_s'])

const Storage = window.DCStorage
const Schema = window.DCSchema
const Product = window.DCProduct
const Evidence = window.DCEvidence
const FocusSelector = window.DCFocusSelector
const I18n = window.DCI18n
const Progress = window.DCProgress
const Health = window.DCHealth
const Lifecycle = window.DCLifecycle
const UploadQueue = window.DCUploadQueue
const ServerCompat = window.DCServerCompat
if (![Storage, Schema, Product, I18n, Progress, Health, Lifecycle, UploadQueue, ServerCompat].every(Boolean)) {
  throw new Error('Alpha.16 runtime modules were not loaded in the required order')
}

const $ = id => document.getElementById(id)
const nowIso = () => new Date().toISOString()
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))
const STORAGE = Object.freeze({
  serverUrl: 'dc.serverUrl',
  tokenLegacy: 'dc.token',
  tokenEncrypted: 'dc.token.secure.v2',
  tokenEncryptedLegacy: 'dc.token.enc.v1',
  deviceId: 'dc.deviceId',
  diagnosticInstallId: 'dc.diagnostic.install.v1',
  queueSecure: 'dc.queue.v3.secure',
  queueLegacy: 'dc.queue.v2',
  lifecycleSecure: 'dc.lifecycle.v3.secure',
  product: 'dc.product.v3',
  overlayScale: 'dc.overlay.scale.v2',
  overlayAutoHide: 'dc.overlay.autohide.v2',
  overlayPosition: 'dc.overlay.position.v3',
})

function readStoredValue(key, { schemaVersion = 1, fallbackRaw = true } = {}) {
  const result = Storage.readJson(key, { schemaVersion })
  if (result?.ok && !result.missing) return result.value
  if (!fallbackRaw) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    // Legacy scalar values were stored without an envelope.
    if (result?.code === 'CORRUPT' || result?.code === 'SCHEMA_MISMATCH') return raw
  } catch (_) {}
  return null
}
function writeStoredValue(key, value, { schemaVersion = 1 } = {}) {
  const result = Storage.writeJson(key, value, { schemaVersion })
  if (!result.ok) setHealth?.('storage', result.code === 'QUOTA_EXCEEDED' ? 'FULL' : 'CORRUPT', result.code, result.error, { key })
  return result
}

const lifecycle = Lifecycle.createLifecycleMachine({ now: nowIso, createId: randomId })
const uploadQueue = UploadQueue.createUploadQueue()
const health = Health.createHealth()
const sequenceBySession = new Map()
const finalTimers = new Map()
const recoveryTimers = new Set()
const postMatchTimers = new Set()
let flushPromise = null
let productRefreshPromise = null
let reconnectPromise = null
let featureAttempt = 0
let lastEventStatusCheck = 0
let lastEventStatus = null
let watchdogTimer = 0
let heartbeatTimer = 0
let productTimer = 0
let flushTimer = 0
let healthTimer = 0
let overlayAutoHideTimer = 0
let overlayRevision = 0
let overlayLastSignature = ''
let lastLifecycleCheckpointAt = 0
let lastEvidenceCheckpointAt = 0
let logLines = []

const runtimeSessionId = randomId('runtime')
const performanceCounters = { overlay_dto_max_bytes: 0, runtime_state_publications: 0, queue_flushes: 0, queue_flush_failures: 0, queue_flush_ms_max: 0, product_refresh_ms_max: 0 }

const state = {
  serverUrl: allowedServerUrl(readStoredValue(STORAGE.serverUrl)) || 'https://deadlock-contracts.online',
  token: '',
  deviceId: String(readStoredValue(STORAGE.deviceId) || ''),
  diagnosticInstallId: String(readStoredValue(STORAGE.diagnosticInstallId) || ''),
  account: null,
  gameRunning: false,
  gameInfo: null,
  steamId: null,
  phase: null,
  gameModeRaw: null,
  mode: { value: null, state: 'UNKNOWN', raw_for_diagnostics: '' },
  matchId: null,
  matchHistory: [],
  matchOutcome: null,
  matchOutcomeEventAt: null,
  matchOutcomeEventMatchId: null,
  pendingOutcome: null,
  localTeam: null,
  teamScore: null,
  matchClockS: null,
  matchClockObservedAt: null,
  lastInfoAt: null,
  lastEventAt: null,
  lastRosterAt: null,
  gepVersion: null,
  gepPublicVersion: null,
  gepUpdated: null,
  features: [],
  evidence: {},
  evidenceMeta: {},
  evidenceRevision: 0,
  evidenceCorrelationKey: null,
  evidenceSource: {},
  metricActivity: {},
  streetBrawlRoundEpoch: 0,
  streetBrawlRoundAdvancedAt: 0,
  streetBrawlLastPhase: null,
  streetBrawlMatchStartSeen: false,
  matchClockRawS: null,
  resultLabel: '—',
  hotkeyBinding: DEFAULT_HOTKEY,
  lastSyncedAt: null,
  lastAckAt: null,
  lastUploadStatus: '—',
  product: Product.emptyProductState(),
  pairingError: null,
  updateState: 'NOT_CHECKED',
  processObservedAt: null,
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
function cleanServerUrl(value) { return String(value || '').trim().replace(/\/+$/, '') }
function allowedServerUrl(value) { const clean = cleanServerUrl(value); return ALLOWED_SERVER_URLS.has(clean) ? clean : null }
function asInt(value) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : null }
function asSteamId(value) {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim().replace(/^"|"$/g, '')
  return /^\d{16,20}$/.test(text) ? text : null
}
function parseMaybeJson(value) { if (typeof value !== 'string') return value; try { return JSON.parse(value) } catch (_) { return value } }
function normalizeTeam(value) { const team = String(value || '').trim().toUpperCase(); return ['AMBER', 'SAPPHIRE'].includes(team) ? team : null }
function parseMatchClock(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >= 0 && value <= 21600 ? Math.trunc(value) : null
  const parts = String(value ?? '').trim().split(':').map(Number)
  if (parts.some(v => !Number.isFinite(v) || v < 0)) return null
  if (parts.length === 2 && parts[1] < 60) return Math.trunc(parts[0] * 60 + parts[1])
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) return Math.trunc(parts[0] * 3600 + parts[1] * 60 + parts[2])
  return null
}
function maskIdentifier(value) { const text = String(value ?? '').trim(); if (!text) return '—'; if (text.length <= 6) return '••••'; return `${text.slice(0, 7)}•••••••${text.slice(-3)}` }
function safeLogValue(value) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.replace(/\b\d{16,20}\b/g, '[ID_REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
  if (Array.isArray(value)) return value.slice(0, 20).map(safeLogValue)
  if (typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (/(token|secret|authorization|pair.*code|steam.?id|account.?id|device.?id|roster)/i.test(key)) out[key] = '[REDACTED]'
      else out[key] = safeLogValue(item)
    }
    return out
  }
  return value
}
function log(kind, payload = null) {
  let text = ''
  try { text = payload == null ? '' : JSON.stringify(safeLogValue(payload)) } catch (_) { text = '[UNSERIALIZABLE]' }
  if (text.length > 2000) text = `${text.slice(0, 2000)}…[TRUNCATED]`
  logLines.push(`[${nowIso()}] [${kind}]${text ? ` ${text}` : ''}`)
  if (logLines.length > LOG_LIMIT) logLines = logLines.slice(-LOG_LIMIT)
  if ($('log')) $('log').textContent = logLines.join('\n')
}

function ensureDeviceId() {
  if (state.deviceId) return state.deviceId
  state.deviceId = randomId('device')
  writeStoredValue(STORAGE.deviceId, state.deviceId)
  return state.deviceId
}
function ensureDiagnosticInstallId() {
  if (state.diagnosticInstallId) return state.diagnosticInstallId
  state.diagnosticInstallId = randomId('diag')
  writeStoredValue(STORAGE.diagnosticInstallId, state.diagnosticInstallId)
  return state.diagnosticInstallId
}
function normalizePairCode(raw) {
  const source = String(raw || '').trim().toUpperCase()
  const valid = /^[A-Z0-9]{8,12}$/.test(source) || /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,2}$/.test(source)
  if (!valid) return { ok: false, code: 'PAIR_CODE_FORMAT', display: source, normalized: null }
  return { ok: true, display: source, normalized: source.replace(/-/g, '') }
}

function setHealth(channel, status, code = null, message = null, extra = {}) {
  health.patch(channel, { status, code, message, ...extra })
  publishRuntimeState()
}
function updateQueueHealth() {
  const totals = uploadQueue.totals()
  const status = health.state.storage.status === 'FULL' ? 'BLOCKED' : totals.dead_letter ? 'REJECTED' : totals.items ? 'PENDING' : 'OK'
  health.patch('queue', { status, count: totals.items, rejected: totals.dead_letter })
}
function updateGepHealth() {
  const snap = lifecycle.snapshot()
  health.gepFreshness({
    gameRunning: state.gameRunning,
    matchConfirmed: [Lifecycle.MATCH_STATE.MATCH_CONFIRMED, Lifecycle.MATCH_STATE.TERMINAL_PENDING].includes(snap.state),
    lastClockAt: state.matchClockObservedAt,
    featuresReady: FEATURES.every(feature => state.features.includes(feature)),
    paused: state.phase === 'Paused',
  })
}
function clearPairingError() { state.pairingError = null }
function setPairingError(error) {
  state.pairingError = {
    code: String(error?.code || 'PAIR_FAILED'),
    message: String(error?.message || error || 'Pairing failed'),
    request_id: error?.requestId || null,
    at: nowIso(),
  }
  publishRuntimeState()
}

function tokenEncrypt(value) { return new Promise((resolve, reject) => {
  const fn = overwolf?.cryptography?.encryptForCurrentUser
  if (!fn) return reject(Object.assign(new Error('Overwolf Cryptography API unavailable'), { code: 'SECURE_STORAGE_UNAVAILABLE' }))
  fn(value, result => result?.success && result.ciphertext ? resolve(result.ciphertext) : reject(Object.assign(new Error(result?.error || 'Encryption failed'), { code: 'SECURE_STORAGE_FAILED' })))
}) }
function tokenDecrypt(value) { return new Promise((resolve, reject) => {
  const fn = overwolf?.cryptography?.decryptForCurrentUser
  if (!fn) return reject(Object.assign(new Error('Overwolf Cryptography API unavailable'), { code: 'SECURE_STORAGE_UNAVAILABLE' }))
  fn(value, result => result?.success && result.plaintext ? resolve(result.plaintext) : reject(Object.assign(new Error(result?.error || 'Decryption failed'), { code: 'AUTH_STORAGE_INVALID' })))
}) }
async function storeToken(token) {
  Storage.remove(STORAGE.tokenLegacy)
  Storage.remove(STORAGE.tokenEncryptedLegacy)
  if (!token) { Storage.remove(STORAGE.tokenEncrypted); return { ok: true } }
  const result = await Storage.writeSecureJson(STORAGE.tokenEncrypted, { token: String(token) }, { schemaVersion: 2 })
  if (result.ok) {
    setHealth('secureStorage', 'OK')
    return result
  }
  setHealth('secureStorage', result.code === 'SECURE_STORAGE_UNAVAILABLE' ? 'UNAVAILABLE' : 'FAILED', result.code || 'SECURE_STORAGE_FAILED', result.error || 'Secure token storage failed')
  return result
}
async function loadToken() {
  const current = await Storage.readSecureJson(STORAGE.tokenEncrypted, { schemaVersion: 2 })
  if (current.ok && current.value?.token) {
    state.token = String(current.value.token)
    setHealth('auth', 'OK')
    setHealth('secureStorage', 'OK')
    return
  }
  if (!current.ok && !current.missing) {
    state.token = ''
    setHealth('auth', 'STORAGE_INVALID', 'AUTH_STORAGE_INVALID', I18n.t('pair.storage_invalid'))
    setHealth('secureStorage', current.code === 'SECURE_STORAGE_UNAVAILABLE' ? 'UNAVAILABLE' : 'FAILED', current.code || 'AUTH_STORAGE_INVALID', I18n.t('pair.storage_invalid'))
    return
  }

  // Migrate Alpha.8 ciphertext only after a successful decrypt; never delete
  // unrelated queue/product data when auth storage is invalid.
  const legacyCipher = localStorage.getItem(STORAGE.tokenEncryptedLegacy)
  if (legacyCipher) {
    try {
      state.token = await tokenDecrypt(legacyCipher)
      const migrated = await storeToken(state.token)
      if (!migrated.ok) throw Object.assign(new Error(migrated.error || 'Token migration failed'), { code: migrated.code })
      setHealth('auth', 'OK')
      return
    } catch (error) {
      state.token = ''
      setHealth('auth', 'STORAGE_INVALID', 'AUTH_STORAGE_INVALID', I18n.t('pair.storage_invalid'))
      setHealth('secureStorage', 'FAILED', error.code || 'AUTH_STORAGE_INVALID', I18n.t('pair.storage_invalid'))
      return
    }
  }

  const legacy = localStorage.getItem(STORAGE.tokenLegacy)
  if (legacy) {
    state.token = legacy
    const result = await storeToken(legacy)
    if (!result.ok) setHealth('auth', 'STORAGE_INVALID', result.code, I18n.t('pair.storage_invalid'))
    else setHealth('auth', 'OK')
  } else {
    setHealth('auth', 'UNPAIRED')
  }
}
function clearLocalAuth() {
  state.token = ''
  state.account = null
  Storage.remove(STORAGE.tokenLegacy)
  Storage.remove(STORAGE.tokenEncrypted)
  Storage.remove(STORAGE.tokenEncryptedLegacy)
  setHealth('auth', 'UNPAIRED')
}

async function persistQueue() {
  updateQueueHealth()
  const result = await Storage.writeSecureJson(STORAGE.queueSecure, uploadQueue.snapshot(), { schemaVersion: 2 })
  if (!result.ok) setHealth('storage', result.code === 'QUOTA_EXCEEDED' ? 'FULL' : 'CORRUPT', result.code, result.error, { key: STORAGE.queueSecure })
  else if (health.state.storage.status !== 'OK') setHealth('storage', 'OK')
  return result
}
function seedSequencesFromQueue() {
  sequenceBySession.clear()
  const snapshot = uploadQueue.snapshot()
  for (const item of [...(snapshot.items || []), ...(snapshot.dead_letter || [])]) {
    let key
    try { key = UploadQueue.sessionKey(item?.payload || {}) } catch (_) { continue }
    const sequence = Math.max(0, Number(item?.sequence) || Number(item?.payload?.sequence) || 0)
    sequenceBySession.set(key, Math.max(sequenceBySession.get(key) || 0, sequence))
  }
}
async function restoreQueue() {
  const current = await Storage.readSecureJson(STORAGE.queueSecure, { schemaVersion: 2 })
  if (current.ok && current.value) {
    const needsMigration = Number(current.value.schema_version) !== 3
      || (Array.isArray(current.value.items) && current.value.items.some(item => (
        item?.state === UploadQueue.ITEM_STATE.IN_FLIGHT
        || !String(item?.session_key || '').startsWith('session:')
      )))
    uploadQueue.replace(current.value)
    seedSequencesFromQueue()
    if (needsMigration) {
      const saved = await persistQueue()
      if (!saved.ok) return
      log('QUEUE_V3_MIGRATED', uploadQueue.totals())
    }
    updateQueueHealth()
    return
  }
  if (!current.ok && !current.missing) setHealth('storage', 'CORRUPT', current.code, current.error, { key: STORAGE.queueSecure })
  const rawLegacy = localStorage.getItem(STORAGE.queueLegacy)
  if (rawLegacy) {
    try {
      const legacy = JSON.parse(rawLegacy)
      uploadQueue.migrateLegacy(legacy)
      seedSequencesFromQueue()
      const saved = await persistQueue()
      if (saved.ok) localStorage.removeItem(STORAGE.queueLegacy)
      log('QUEUE_MIGRATED', uploadQueue.totals())
    } catch (error) {
      setHealth('storage', 'CORRUPT', 'LEGACY_QUEUE_CORRUPT', String(error.message || error), { key: STORAGE.queueLegacy })
    }
  }
}
async function checkpointLifecycle({ force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastLifecycleCheckpointAt < 15000) return { ok: true, skipped: true }
  lastLifecycleCheckpointAt = now
  const value = {
    lifecycle: lifecycle.snapshot(),
    evidence: clone(state.evidence),
    evidence_meta: clone(state.evidenceMeta),
    evidence_revision: state.evidenceRevision,
    evidence_source: clone(state.evidenceSource),
    mode: clone(state.mode),
    phase: state.phase,
    match_id: state.matchId,
    game_mode_raw: clone(state.gameModeRaw),
    match_clock_s: state.matchClockS,
    match_clock_raw_s: state.matchClockRawS,
    match_clock_observed_at: state.matchClockObservedAt,
    match_outcome: state.matchOutcome,
    match_outcome_event_at: state.matchOutcomeEventAt,
    match_outcome_event_match_id: state.matchOutcomeEventMatchId,
    pending_outcome: clone(state.pendingOutcome),
    local_team: state.localTeam,
    team_score: clone(state.teamScore),
    result_label: state.resultLabel,
    street_brawl_round_epoch: state.streetBrawlRoundEpoch,
    street_brawl_round_advanced_at: state.streetBrawlRoundAdvancedAt,
    street_brawl_last_phase: state.streetBrawlLastPhase,
    street_brawl_match_start_seen: state.streetBrawlMatchStartSeen,
  }
  const result = await Storage.writeSecureJson(STORAGE.lifecycleSecure, value, { schemaVersion: 3 })
  if (!result.ok) setHealth('storage', result.code === 'QUOTA_EXCEEDED' ? 'FULL' : 'CORRUPT', result.code, result.error, { key: STORAGE.lifecycleSecure })
  return result
}
async function restoreLifecycleCheckpoint() {
  const saved = await Storage.readSecureJson(STORAGE.lifecycleSecure, { schemaVersion: 3 })
  if (saved.missing) return { ok: true, missing: true }
  if (!saved.ok || !saved.value) {
    setHealth('storage', 'CORRUPT', saved.code || 'LIFECYCLE_CHECKPOINT_INVALID', saved.error || 'Unable to restore lifecycle checkpoint', { key: STORAGE.lifecycleSecure })
    return { ok: false, code: saved.code || 'LIFECYCLE_CHECKPOINT_INVALID' }
  }
  const value = saved.value
  const restored = lifecycle.restore(value.lifecycle || {})
  if (!restored.ok) {
    setHealth('storage', 'CORRUPT', restored.code, 'Lifecycle checkpoint has an invalid state', { key: STORAGE.lifecycleSecure })
    return restored
  }
  state.evidence = value.evidence && typeof value.evidence === 'object' ? clone(value.evidence) : {}
  state.evidenceMeta = value.evidence_meta && typeof value.evidence_meta === 'object' ? clone(value.evidence_meta) : {}
  state.evidenceRevision = Number(value.evidence_revision) || 0
  state.evidenceSource = value.evidence_source && typeof value.evidence_source === 'object' ? clone(value.evidence_source) : {}
  state.mode = value.mode && typeof value.mode === 'object' ? clone(value.mode) : state.mode
  state.phase = value.phase || null
  state.matchId = asInt(value.match_id)
  state.gameModeRaw = value.game_mode_raw == null ? null : clone(value.game_mode_raw)
  state.matchClockS = Number.isFinite(Number(value.match_clock_s)) ? Number(value.match_clock_s) : null
  state.matchClockRawS = Number.isFinite(Number(value.match_clock_raw_s)) ? Number(value.match_clock_raw_s) : null
  state.matchClockObservedAt = value.match_clock_observed_at || null
  state.matchOutcome = normalizeTeam(value.match_outcome)
  state.matchOutcomeEventAt = value.match_outcome_event_at || null
  state.matchOutcomeEventMatchId = asInt(value.match_outcome_event_match_id)
  state.pendingOutcome = value.pending_outcome && typeof value.pending_outcome === 'object' ? clone(value.pending_outcome) : null
  state.localTeam = normalizeTeam(value.local_team)
  state.teamScore = value.team_score && typeof value.team_score === 'object' ? clone(value.team_score) : null
  state.resultLabel = value.result_label || localResultLabel()
  state.streetBrawlRoundEpoch = Number.isFinite(Number(value.street_brawl_round_epoch)) ? Math.max(0, Math.trunc(Number(value.street_brawl_round_epoch))) : 0
  state.streetBrawlRoundAdvancedAt = Number.isFinite(Number(value.street_brawl_round_advanced_at)) ? Number(value.street_brawl_round_advanced_at) : 0
  state.streetBrawlLastPhase = value.street_brawl_last_phase || null
  state.streetBrawlMatchStartSeen = value.street_brawl_match_start_seen === true
  state.evidenceCorrelationKey = evidenceSessionKey()
  log('LIFECYCLE_RESTORED', { lifecycle_state: lifecycle.snapshot().state, match_id: state.matchId })
  return { ok: true }
}

async function serverFetch(path, options = {}) {
  const base = allowedServerUrl(state.serverUrl)
  if (!base) throw Object.assign(new Error('Only the official HTTPS server is allowed'), { code: 'SERVER_NOT_ALLOWED' })
  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')
  headers.set('Accept-Language', I18n.language() === 'ru' ? 'ru' : 'en')
  if (options.body) headers.set('Content-Type', 'application/json')
  if (state.token && options.auth !== false) headers.set('Authorization', `Bearer ${state.token}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000)
  let response
  try {
    response = await fetch(base + path, { method: options.method || 'GET', headers, body: options.body || undefined, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
  } catch (error) {
    const wrapped = Object.assign(new Error(error?.name === 'AbortError' ? 'Request timed out' : String(error?.message || error)), { code: error?.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', status: 0 })
    setHealth('backend', navigator.onLine === false ? 'OFFLINE' : 'DEGRADED', wrapped.code, wrapped.message)
    throw wrapped
  } finally { clearTimeout(timer) }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = Object.assign(new Error(String(data?.message || data?.detail || `HTTP ${response.status}`)), {
      status: response.status,
      code: String(data?.code || `HTTP_${response.status}`),
      requestId: data?.request_id || response.headers.get('x-request-id') || null,
      retryAfter: Number(response.headers.get('retry-after')) || null,
      minimumVersion: response.headers.get('x-minimum-companion-version') || null,
    })
    setHealth('backend', response.status >= 500 ? 'DEGRADED' : health.state.backend.status, error.code, error.message, { requestId: error.requestId })
    throw error
  }
  health.success('backend', { requestId: data?.request_id || response.headers.get('x-request-id') || null })
  return data
}

function productErrorState(error) {
  const status = error?.status === 401 ? 'UNPAIRED'
    : ['API_VERSION_MISMATCH', 'SCHEMA_VERSION_UNSUPPORTED', 'SCHEMA_VERSION_MISSING'].includes(error?.code) || error?.status === 426 ? 'INCOMPATIBLE'
      : navigator.onLine === false ? 'OFFLINE' : 'DEGRADED'
  return { ...state.product, status, stale: !!state.product?.loaded_at, last_error: { code: error?.code || 'PRODUCT_SYNC_FAILED', message: String(error?.message || error), status: error?.status || null, request_id: error?.requestId || null, at: nowIso() } }
}
function restoreProductCache() {
  const cached = Storage.readJson(STORAGE.product, { schemaVersion: Product.PRODUCT_CACHE_VERSION, ttlMs: Storage.CACHE_TTL_MS })
  if (cached.ok && cached.value) state.product = { ...Product.emptyProductState('OFFLINE'), ...cached.value, status: 'OFFLINE', stale: true }
}
function persistProduct() {
  if (!state.product?.loaded_at) return
  const result = Storage.writeJson(STORAGE.product, Storage.sanitizeProductCache(state.product), { schemaVersion: Product.PRODUCT_CACHE_VERSION })
  if (!result.ok) setHealth('storage', result.code === 'QUOTA_EXCEEDED' ? 'FULL' : 'CORRUPT', result.code, result.error, { key: STORAGE.product })
}
async function refreshProduct({ requireFresh = false } = {}) {
  const perfStartedAt = globalThis.performance?.now?.() ?? Date.now()
  if (!state.token) {
    state.product = Product.emptyProductState('UNPAIRED')
    return { ok: false, code: 'UNPAIRED', fresh: false, product: state.product }
  }
  if (productRefreshPromise) return productRefreshPromise
  productRefreshPromise = (async () => {
    try {
      const data = await serverFetch('/api/desktop/v1/bootstrap')
      const previousFingerprints = state.product?.logic_fingerprints || {}
      const next = Product.normalizeBootstrap(data)
      const sameBoardIds = new Set((state.product?.boards || []).map(board => board.id))
      for (const board of next.boards) {
        if (!sameBoardIds.has(board.id)) continue
        for (const option of board.options) {
          if (previousFingerprints[option.id] && previousFingerprints[option.id] !== next.logic_fingerprints[option.id]) {
            const error = Object.assign(new Error(I18n.t('error.SERVER_CONTRACT_CHANGED')), { code: 'SERVER_CONTRACT_CHANGED' })
            state.product = productErrorState(error)
            publishRuntimeState()
            return { ok: false, code: error.code, fresh: false, product: state.product }
          }
        }
      }
      state.product = next
      if (next.account) state.account = { ...state.account, ...next.account }
      I18n.setServerLanguage(next.account?.locale || null)
      persistProduct()
      publishRuntimeState()
      return { ok: true, fresh: true, server_time: next.server_time, product: next }
    } catch (error) {
      if (error?.status === 401 || ['TOKEN_EXPIRED', 'TOKEN_REVOKED', 'AUTH_REQUIRED'].includes(error?.code)) transitionToUnpaired(error.code || 'AUTH_REQUIRED')
      state.product = productErrorState(error)
      publishRuntimeState()
      return { ok: false, code: error?.code || 'PRODUCT_SYNC_FAILED', request_id: error?.requestId || null, fresh: false, product: state.product }
    } finally {
      productRefreshPromise = null
      const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - perfStartedAt
      performanceCounters.product_refresh_ms_max = Math.max(performanceCounters.product_refresh_ms_max, Math.round(elapsed))
    }
  })()
  const result = await productRefreshPromise
  if (requireFresh && !result.ok) return result
  return result
}

function evidenceSessionKey() {
  return Evidence.correlationKey(lifecycle.currentSession())
}
function resetEvidence(reason = 'new_session') {
  state.evidence = {}
  state.evidenceMeta = {}
  state.evidenceSource = {}
  state.evidenceRevision += 1
  state.evidenceCorrelationKey = evidenceSessionKey()
  state.metricActivity = {}
  state.lastRosterAt = null
  state.matchClockRawS = null
  state.streetBrawlRoundEpoch = state.mode.value === 'STREET_BRAWL' && state.phase === 'GameInProgress' ? 1 : 0
  state.streetBrawlRoundAdvancedAt = Date.now()
  state.streetBrawlLastPhase = state.phase || null
  state.streetBrawlMatchStartSeen = false
  log('EVIDENCE_RESET', { reason, revision: state.evidenceRevision, mode: state.mode.value, round_epoch: state.streetBrawlRoundEpoch })
}
function resetMatchScopedState(reason = 'new_session') {
  state.matchId = null
  state.matchClockS = null
  state.matchClockRawS = null
  state.matchClockObservedAt = null
  state.matchOutcome = null
  state.matchOutcomeEventAt = null
  state.matchOutcomeEventMatchId = null
  state.pendingOutcome = null
  state.localTeam = null
  state.teamScore = null
  state.resultLabel = '—'
  state.gameModeRaw = null
  state.mode = { value: null, state: 'UNKNOWN', raw_for_diagnostics: '' }
  resetEvidence(reason)
}
function isStreetBrawl() { return state.mode.value === 'STREET_BRAWL' }
function ensureStreetBrawlRound(reason = 'live') {
  if (!isStreetBrawl()) return 0
  if (state.streetBrawlRoundEpoch <= 0) {
    state.streetBrawlRoundEpoch = 1
    state.streetBrawlRoundAdvancedAt = Date.now()
    log('STREET_BRAWL_ROUND', { epoch: 1, reason })
  }
  return state.streetBrawlRoundEpoch
}
function advanceStreetBrawlRound(reason = 'phase_game_in_progress') {
  if (!isStreetBrawl()) return false
  const now = Date.now()
  if (state.streetBrawlRoundEpoch > 0 && now - state.streetBrawlRoundAdvancedAt < STREET_BRAWL_ROUND_DEDUPE_MS) return false
  state.streetBrawlRoundEpoch = Math.max(0, state.streetBrawlRoundEpoch) + 1
  state.streetBrawlRoundAdvancedAt = now
  log('STREET_BRAWL_ROUND', { epoch: state.streetBrawlRoundEpoch, reason })
  return true
}
function roundAwareMetricValue(key, rawValue) {
  const number = Number(rawValue)
  if (!Number.isFinite(number)) return null
  if (!isStreetBrawl() || !STREET_BRAWL_ACCUMULATED_METRICS.has(key)) return number
  const sessionId = evidenceSessionKey()
  if (!sessionId) return number
  const epoch = ensureStreetBrawlRound('metric')
  let tracker = state.evidenceSource[key]
  if (!tracker || tracker.session_id !== sessionId) tracker = { session_id: sessionId, epoch, carried: 0, peak: 0, raw: null }
  if (tracker.epoch !== epoch) tracker = { ...tracker, epoch, carried: Number(tracker.carried || 0) + Number(tracker.peak || 0), peak: 0, raw: null }
  tracker.raw = number
  tracker.peak = Math.max(Number(tracker.peak || 0), number)
  state.evidenceSource[key] = tracker
  return Number(tracker.carried || 0) + Number(tracker.peak || 0)
}
function updateEvidenceMetric(key, value, { source = 'gep', monotonic = true } = {}) {
  const correlation = evidenceSessionKey()
  if (!correlation) return
  if (state.evidenceCorrelationKey && state.evidenceCorrelationKey !== correlation) resetEvidence('correlation_changed')
  state.evidenceCorrelationKey = correlation

  const old = state.evidence[key]
  const merged = Evidence.mergeMetric(old, value, { monotonic })

  // Deadlock roster updates can be partial. Missing/null fields are not resets.
  // Explicit session/process transitions call resetEvidence() instead.
  if (!merged.accepted) return

  const next = merged.value
  if (!merged.changed) return

  state.evidence[key] = next
  state.evidenceRevision += 1
  const observedAt = nowIso()
  const observedMs = Date.now()
  const session = lifecycle.currentSession()
  state.evidenceMeta[key] = {
    session_id: session?.session_id || null,
    match_id: session?.match_id || state.matchId || null,
    revision: state.evidenceRevision,
    value: next,
    observed_at: observedAt,
    source,
  }

  const previousActivity = state.metricActivity[key] || null
  const meaningfulInitial = old !== undefined || Number(next) > 0 || String(source).startsWith('event:')
  if (meaningfulInitial) {
    state.metricActivity[key] = {
      at: observedMs,
      observed_at: observedAt,
      value: next,
      previous: merged.previous,
      source,
      priority_until: String(source).startsWith('event:')
        ? observedMs + 4500
        : Math.max(Number(previousActivity?.priority_until || 0), 0),
      revision: state.evidenceRevision,
    }
  }

  state.lastRosterAt = observedAt
  const terminalPending = lifecycle.snapshot().state === Lifecycle.MATCH_STATE.TERMINAL_PENDING
  if (terminalPending || Date.now() - lastEvidenceCheckpointAt >= 15000) {
    lastEvidenceCheckpointAt = Date.now()
    void checkpointLifecycle({ force: terminalPending })
  }
  publishRuntimeState()
}
function localResultLabel() {
  if (!state.matchOutcome) return '—'
  if (!state.localTeam) return `WINNING TEAM: ${state.matchOutcome}`
  return state.matchOutcome === state.localTeam ? 'VICTORY' : 'DEFEAT'
}
function normalizeRosterPlayer(value) {
  const player = parseMaybeJson(value)
  if (!player || typeof player !== 'object') return null
  const rosterSteam = asSteamId(player.steam_id)
  const local = player.is_local === true || String(player.is_local).toLowerCase() === 'true' || (state.steamId && rosterSteam === state.steamId)
  if (!local) return null
  return {
    hero_id: asInt(player.hero_id),
    kills: asInt(player.kills), deaths: asInt(player.deaths), assists: asInt(player.assist ?? player.assists),
    hero_damage: asInt(player.hero_damage), object_damage: asInt(player.object_damage), healing: asInt(player.hero_healing ?? player.healing), souls: asInt(player.souls),
    local_team: normalizeTeam(player.team_name),
  }
}
function applyRoster(value) {
  const row = normalizeRosterPlayer(value)
  if (!row) return
  if (row.local_team) state.localTeam = row.local_team
  if (
    row.hero_id !== null &&
    row.hero_id !== undefined &&
    state.evidence.hero_id == null
  ) {
    updateEvidenceMetric('hero_id', row.hero_id, { source: 'roster', monotonic: false })
  }
  for (const key of ['kills','deaths','assists','hero_damage','object_damage','healing','souls']) {
    if (row[key] === null || row[key] === undefined) continue
    const adjusted = roundAwareMetricValue(key, row[key])
    updateEvidenceMetric(key, adjusted, { source: 'roster', monotonic: true })
  }
  state.resultLabel = localResultLabel()
}
function applyHistory(value) {
  const history = parseMaybeJson(value)
  if (!Array.isArray(history)) return
  state.matchHistory = history
  lifecycle.observeHistory({ matches: history, observedAt: nowIso() })
  const candidate = lifecycle.terminalCandidate()
  if (candidate) tryProveTerminalCandidate(candidate)
}
function applyMode(value) {
  const observedAt = nowIso()
  const previousMode = state.mode.value

  const nextRaw = parseMaybeJson(value)
  const nextMode = Product.normalizeModeResult(nextRaw)

  const lifecycleState = lifecycle.snapshot().state
  const session = lifecycle.currentSession()

  const sessionActive = !!session && [
    Lifecycle.MATCH_STATE.MATCH_CONFIRMED,
    Lifecycle.MATCH_STATE.TERMINAL_PENDING,
    Lifecycle.MATCH_STATE.INTERRUPTED,
  ].includes(lifecycleState)

  // Once a real game mode is known for an immutable match session,
  // late GEP resets must not replace it with UNKNOWN or another mode.
  //
  // Real production trace:
  // STREET_BRAWL -> PostGame -> End -> Init/MatchIntro -> UNKNOWN
  // -> match_end.
  //
  // The final packet must still belong to STREET_BRAWL.
  if (
    sessionActive &&
    previousMode &&
    (!nextMode.value || nextMode.value !== previousMode)
  ) {
    log('SESSION_MODE_STICKY_IGNORED', {
      session_id: session.session_id || null,
      match_id: session.match_id || state.matchId || null,
      preserved_mode: previousMode,
      ignored_mode: nextMode.value || nextMode.state || 'UNKNOWN',
      lifecycle_state: lifecycleState,
    })

    lifecycle.observeMode({
      mode: previousMode,
      observedAt,
    })

    return
  }

  state.gameModeRaw = nextRaw
  state.mode = nextMode

  lifecycle.observeMode({
    mode: state.mode.value,
    observedAt,
  })

  if (
    state.mode.value === 'STREET_BRAWL' &&
    previousMode !== 'STREET_BRAWL' &&
    state.phase === 'GameInProgress'
  ) {
    ensureStreetBrawlRound('mode_detected_in_progress')
  }
}
function captureTerminalDetails(terminalObservedAt = nowIso(), snapshotCapturedAt = nowIso()) {
  return Object.freeze({
    terminal_observed_at: terminalObservedAt,
    snapshot_captured_at: snapshotCapturedAt,
    observed_at: snapshotCapturedAt,
    evidence: clone(state.evidence),
    game_running: state.gameRunning,
    steam_id64: state.steamId || null,
    phase: state.phase,
    game_mode: clone(state.gameModeRaw),
    game_match_mode: state.mode.value,
    match_id: state.matchId,
    match_clock_s: state.matchClockS,
    match_clock_observed_at: state.matchClockObservedAt,
    gep_version: state.gepVersion,
    match_outcome: state.matchOutcome,
    match_outcome_event_at: state.matchOutcomeEventAt,
    match_outcome_event_match_id: state.matchOutcomeEventMatchId,
    local_team: state.localTeam,
    result_label: state.resultLabel,
  })
}
function applyPhase(value, source) {
  const phase = String(parseMaybeJson(value) || '')
  const previous = state.phase
  state.phase = phase
  if (isStreetBrawl() && phase === 'GameInProgress' && previous && previous !== 'GameInProgress') {
    advanceStreetBrawlRound(`phase:${previous}->GameInProgress`)
  } else if (isStreetBrawl() && phase === 'GameInProgress') {
    ensureStreetBrawlRound('phase_game_in_progress')
  }
  state.streetBrawlLastPhase = phase
  const before = lifecycle.snapshot().state
  const lifecycleResult = lifecycle.observePhase({ phase, source, observedAt: nowIso() })
  handleSessionTransition(before, lifecycle.snapshot().state, `phase:${phase}`, lifecycleResult)
  if (phase === 'PostGame' && source === 'info_update') {
    if (isStreetBrawl()) {
      log('STREET_BRAWL_ROUND_POSTGAME', { round_epoch: state.streetBrawlRoundEpoch, match_id: state.matchId })
    } else {
      const observedAt = nowIso()
      const candidate = lifecycle.observeTerminalSignal({ type: 'phase_postgame', observedAt })
      if (candidate) {
        void checkpointLifecycle({ force: true })
        if (!tryProveTerminalCandidate(candidate)) scheduleHistoryRecovery(candidate)
      }
    }
  }
  if (phase !== previous) queueDiagnostic('phase_changed')
}
function bindPendingOutcome(matchId) {
  const exactMatchId = asInt(matchId)
  const session = lifecycle.currentSession()
  const pending = state.pendingOutcome
  if (!exactMatchId || !session?.session_id || !pending || pending.session_id !== session.session_id) return false
  state.matchOutcome = pending.team
  state.matchOutcomeEventAt = pending.observed_at
  state.matchOutcomeEventMatchId = exactMatchId
  state.pendingOutcome = null
  state.resultLabel = localResultLabel()
  return true
}
function applyMatchId(value, source) {
  const matchId = asInt(parseMaybeJson(value))
  if (!matchId) return
  const before = lifecycle.snapshot().state
  const result = lifecycle.observeMatchId({ matchId, source, observedAt: nowIso() })
  const session = lifecycle.currentSession()

  if (result?.confirmed) {
    state.matchId = session?.match_id || matchId
    bindPendingOutcome(state.matchId)
  } else if (['finalized_match_rediscovered', 'previous_match_id_rediscovered'].includes(result?.reason)) {
    log('PREVIOUS_MATCH_ID_IGNORED', {
      observed_match_id: matchId,
      reason: result.reason,
      session_id: session?.session_id || null,
    })
    state.matchId = session?.match_id || null
  } else if (!session) {
    state.matchId = matchId
  } else if (result?.reason === 'match_id_conflict_ignored') {
    log('MATCH_ID_CONFLICT_IGNORED', {
      observed_match_id: matchId,
      active_match_id: session.match_id || state.matchId || null,
      source,
    })
    state.matchId = session.match_id || state.matchId
  }

  handleSessionTransition(before, lifecycle.snapshot().state, `match_id:${source}`, result)
  if (result?.confirmed && state.pendingOutcome) bindPendingOutcome(result.session?.match_id || state.matchId)
  if (lifecycle.snapshot().state === Lifecycle.MATCH_STATE.TERMINAL_PENDING) {
    void checkpointLifecycle({ force: true })
    const candidate = lifecycle.terminalCandidate()
    if (candidate) tryProveTerminalCandidate(candidate)
  }
}
function applyMatchClock(value) {
  const rawSeconds = parseMatchClock(value)
  if (rawSeconds === null) return
  state.matchClockRawS = rawSeconds
  const seconds = roundAwareMetricValue('match_clock_s', rawSeconds)
  if (seconds === null) return
  state.matchClockS = seconds
  state.matchClockObservedAt = nowIso()
  const before = lifecycle.snapshot().state
  const result = lifecycle.observeMatchClock({ seconds, observedAt: state.matchClockObservedAt })
  handleSessionTransition(before, lifecycle.snapshot().state, 'match_clock', result)
  if (lifecycle.snapshot().state === Lifecycle.MATCH_STATE.TERMINAL_PENDING) {
    void checkpointLifecycle({ force: true })
    const candidate = lifecycle.terminalCandidate()
    if (candidate) tryProveTerminalCandidate(candidate)
  }
  updateGepHealth()
}
function applyOutcome(value, source) {
  const parsed = parseMaybeJson(value)
  const winning = normalizeTeam(parsed?.winning_team || parsed?.winner || parsed)
  if (!winning) return
  state.matchOutcome = winning
  if (source === 'info_update') {
    const observedAt = nowIso()
    const session = lifecycle.currentSession()
    const exactMatchId = asInt(session?.match_id || state.matchId)
    if (session?.session_id && exactMatchId) {
      state.matchOutcomeEventAt = observedAt
      state.matchOutcomeEventMatchId = exactMatchId
      state.pendingOutcome = null
    } else if (session?.session_id) {
      // Outcome can precede match_id. Bind the marker to the immutable session
      // first, then attach the exact match id when it arrives.
      state.pendingOutcome = {
        session_id: session.session_id,
        team: winning,
        observed_at: observedAt,
      }
      state.matchOutcomeEventAt = null
      state.matchOutcomeEventMatchId = null
    }
  }
  state.resultLabel = localResultLabel()
  if (source === 'info_update') {
    const terminalPending = lifecycle.snapshot().state === Lifecycle.MATCH_STATE.TERMINAL_PENDING
    void checkpointLifecycle({ force: terminalPending })
    publishRuntimeState()
  }
}
function applyGepVersion(value) {
  const parsed = parseMaybeJson(value)
  if (!parsed || typeof parsed !== 'object') return
  state.gepVersion = String(parsed.local_version || '') || null
  state.gepPublicVersion = String(parsed.public_version || '') || null
  state.gepUpdated = parsed.is_updated ?? null
}
function extractKnown(result, source = null) {
  const provenance = source || (result?.feature && result?.info ? 'info_update' : 'get_info')
  const res = result?.res || result?.info || result
  if (!res || typeof res !== 'object') return
  state.lastInfoAt = nowIso()
  const gi = res.game_info
  const mi = res.match_info

  // Exact identity must be processed before phase/clock recovery. Otherwise a
  // cached GameInProgress can revive the previous interrupted session first.
  if (mi?.match_id != null) applyMatchId(mi.match_id, provenance)

  if (gi) {
    if (gi.steam_id != null) state.steamId = asSteamId(gi.steam_id) || state.steamId
    if (gi.phase != null) applyPhase(gi.phase, provenance)
    if (gi.game_mode != null) applyMode(gi.game_mode)
    if (gi.match_history != null) applyHistory(gi.match_history)
  }
  if (mi) {
    if (mi.match_outcome != null) applyOutcome(mi.match_outcome, provenance)
    if (mi.team_score != null) state.teamScore = parseMaybeJson(mi.team_score)
    for (const [key, raw] of Object.entries(mi)) if (key.startsWith('roster')) applyRoster(raw)
  }
  if (res.gep_internal?.version_info != null) applyGepVersion(res.gep_internal.version_info)
  publishRuntimeState()
}
function applyInfoUpdate(info) {
  state.lastInfoAt = nowIso()


  const feature = info?.feature || info?.category
  const key = String(info?.key || '')
  const raw = Object.prototype.hasOwnProperty.call(info || {}, 'value')
    ? info.value
    : info?.data
  const value = parseMaybeJson(raw)

  log('GEP_INFO', {
    feature,
    key,
    source: 'info_update',
  })
  if (feature === 'game_info') {
    if (key === 'steam_id') state.steamId = asSteamId(raw) || state.steamId
    else if (key === 'phase') applyPhase(value, 'info_update')
    else if (key === 'game_mode') applyMode(value)
    else if (key === 'match_history') applyHistory(value)
  } else if (feature === 'match_info') {
    if (key === 'match_id') applyMatchId(value, 'info_update')
    else if (key === 'match_outcome') applyOutcome(value, 'info_update')
    else if (key === 'team_score') state.teamScore = value
    else if (key.startsWith('roster')) applyRoster(value)
  } else if (feature === 'gep_internal' && key === 'version_info') applyGepVersion(value)
  if (info?.info) extractKnown(info, 'info_update')
}
function getInfoSnapshot() {
  return new Promise((resolve, reject) => {
    overwolf.games.events.getInfo(result => {
      if (!result?.success) return reject(Object.assign(new Error(result?.error || 'GEP getInfo failed'), { code: 'GEP_GET_INFO_FAILED' }))
      extractKnown(result, 'get_info')
      resolve({ raw: result, phase: state.phase, match_id: state.matchId, match_clock_s: state.matchClockS, history: clone(state.matchHistory), history_ids: state.matchHistory.map(item => asInt(item?.match_id ?? item)).filter(Boolean), observed_at: nowIso(), source: 'get_info' })
    })
  })
}

function nextSequence(sessionKey) {
  const next = (sequenceBySession.get(sessionKey) || 0) + 1
  sequenceBySession.set(sessionKey, next)
  return next
}
function buildEvidencePayload({ eventType, session = lifecycle.currentSession(), evidence = state.evidence, proof = null, observedAt = nowIso(), context = null }) {
  if (!session?.session_id) throw Object.assign(new Error('Session is not confirmed'), { code: 'SESSION_ID_REQUIRED' })
  const terminalContext = context && typeof context === 'object' ? context : null
  const evidenceSnapshot = terminalContext?.evidence ?? evidence
  const base = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    client_version: VERSION,
    version: VERSION,
    device_id: ensureDeviceId(),
    event_type: eventType,
    observed_at: observedAt,
    game_running: terminalContext ? terminalContext.game_running === true : state.gameRunning,
    steam_id64: (terminalContext?.steam_id64 ?? state.steamId) || null,
    phase: terminalContext?.phase ?? state.phase,
    game_mode: terminalContext?.game_mode ?? state.gameModeRaw,
    game_match_mode: terminalContext?.game_match_mode ?? state.mode.value,
    match_id: session.match_id || terminalContext?.match_id || null,
    match_clock_s: terminalContext?.match_clock_s ?? session.match_clock_s ?? state.matchClockS ?? null,
    match_clock_observed_at: terminalContext?.match_clock_observed_at ?? session.match_clock_observed_at ?? state.matchClockObservedAt ?? null,
    gep_version: terminalContext?.gep_version ?? state.gepVersion,
    session_id: session.session_id,
    session_started_at: session.started_at,
    session_start_reason: session.confirmed_by,
    local_team: terminalContext?.local_team ?? state.localTeam,
    match_outcome: terminalContext?.match_outcome ?? state.matchOutcome,
    match_outcome_event_at: terminalContext?.match_outcome_event_at ?? state.matchOutcomeEventAt,
    match_outcome_event_match_id: terminalContext?.match_outcome_event_match_id ?? state.matchOutcomeEventMatchId,
    live_stats: clone(evidenceSnapshot || {}),
    terminal_proof: proof ? clone(proof) : null,
  }
  const sessionKey = UploadQueue.sessionKey(base)
  base.sequence = nextSequence(sessionKey)
  base.idempotency_key = UploadQueue.idempotencyKey(base, eventType, EVIDENCE_SCHEMA_VERSION)
  if (eventType === 'match_ended') {
    try { Schema.validateEvidenceV8(base, { final: true }) }
    catch (error) {
      setHealth('queue', 'BLOCKED', 'FINAL_NOT_SENT_MISSING_PROOF', I18n.t('error.FINAL_NOT_SENT_MISSING_PROOF'))
      throw Object.assign(error, { code: 'FINAL_NOT_SENT_MISSING_PROOF', cause_code: error.code })
    }
  } else Schema.validateEvidenceV8(base)
  return base
}
async function enqueuePayload(payload) {
  const result = uploadQueue.enqueue(payload, { eventType: payload.event_type, sequence: payload.sequence, idempotencyKey: payload.idempotency_key, sessionKey: UploadQueue.sessionKey(payload) })
  if (!result.ok) {
    setHealth('storage', result.code === 'LOCAL_STORAGE_FULL' ? 'FULL' : 'CORRUPT', result.code, I18n.t('error.LOCAL_STORAGE_FULL'))
    return result
  }
  const saved = await persistQueue()
  if (!saved.ok) return { ok: false, code: saved.code }
  return result
}
async function enqueueSessionEvent(eventType) {
  const session = lifecycle.currentSession()
  if (!session) return { ok: false, code: 'NO_CONFIRMED_SESSION' }
  try { return await enqueuePayload(buildEvidencePayload({ eventType, session, evidence: state.evidence })) }
  catch (error) { log('ENQUEUE_REJECTED', { eventType, code: error.code }); return { ok: false, code: error.code } }
}
function queueDiagnostic(eventType) {
  if (!state.token || !lifecycle.currentSession()) return
  void enqueueSessionEvent(eventType).then(() => flushQueue())
}
async function flushQueue({ deadlineMs = null } = {}) {
  const perfStartedAt = globalThis.performance?.now?.() ?? Date.now()
  if (flushPromise) return flushPromise
  performanceCounters.queue_flushes += 1
  flushPromise = (async () => {
    const started = Date.now()
    let acknowledged = 0
    let rejected = 0
    if (!state.token) return { ok: false, code: 'UNPAIRED', acknowledged, rejected }
    while (state.token) {
      if (deadlineMs && Date.now() - started >= deadlineMs) break
      const item = uploadQueue.nextDue({ prerequisite: candidate => candidate.event_type !== 'match_ended' || uploadQueue.allPriorAcknowledged(candidate.session_key, candidate.sequence) })
      if (!item) break
      uploadQueue.markInFlight(item.id)
      await persistQueue()
      try {
        const wirePayload = ServerCompat.toHeartbeatV1(item.payload)
        const data = await serverFetch('/api/companion/heartbeat', { method: 'POST', body: JSON.stringify(wirePayload) })
        uploadQueue.acknowledge(item.id, { request_id: data?.request_id || null, server_time: data?.server_time || null, duplicate: data?.duplicate === true })
        state.lastSyncedAt = data?.server_time || nowIso()
        state.lastAckAt = state.lastSyncedAt
        state.lastUploadStatus = 'ACKNOWLEDGED'
        acknowledged += 1
        uploadQueue.removeAcknowledged()
        await persistQueue()
        if (item.event_type === 'match_ended') schedulePostMatchProductRefresh(item.payload.match_id, item.payload.session_id)
      } catch (error) {
        performanceCounters.queue_flush_failures += 1
        const kind = UploadQueue.classifyUploadError(error)
        if (kind === 'AUTH') {
          uploadQueue.retry(item.id, error)
          await persistQueue()
          transitionToUnpaired(error.code || 'AUTH_REQUIRED')
          break
        }
        if (kind === 'RETRY') uploadQueue.retry(item.id, error)
        else { uploadQueue.deadLetter(item.id, { status: error.status || null, code: error.code || 'REJECTED', request_id: error.requestId || null, message: String(error.message || error) }); rejected += 1 }
        await persistQueue()
        if (kind === 'RETRY') continue
      }
    }
    updateQueueHealth()
    publishRuntimeState()
    const totals = uploadQueue.totals()
    return { ok: totals.items === 0 && totals.dead_letter === 0, acknowledged, rejected, pending: totals.items, dead_letter: totals.dead_letter, last_ack_at: state.lastAckAt }
  })().finally(() => {
    const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - perfStartedAt
    performanceCounters.queue_flush_ms_max = Math.max(performanceCounters.queue_flush_ms_max, Math.round(elapsed))
    flushPromise = null
  })
  return flushPromise
}
function handleSessionTransition(before, after, reason, result = null) {
  const newSession = result?.created === true || result?.replaced_interrupted === true
  if (newSession) {
    resetMatchScopedState(reason)
    if (result?.session?.match_id) state.matchId = result.session.match_id
    if (result?.session?.match_clock_s != null) {
      state.matchClockS = Number(result.session.match_clock_s)
      state.matchClockRawS = Number(result.session.match_clock_s)
      state.matchClockObservedAt = result.session.match_clock_observed_at || state.matchClockObservedAt
    }
    void checkpointLifecycle({ force: true })
    if (state.token) void enqueueSessionEvent('match_started').then(() => flushQueue())
  } else if (result?.recovered === true) {
    // Same-session restart recovery preserves evidence and must not emit another
    // match_started edge for the same immutable session id.
    void checkpointLifecycle({ force: true })
  }

  if (after === Lifecycle.MATCH_STATE.INTERRUPTED && before !== Lifecycle.MATCH_STATE.INTERRUPTED) {
    void checkpointLifecycle({ force: true })
    if (state.token) void enqueueSessionEvent('interrupted').then(() => flushQueue())
  }
  if (result?.session?.match_id) state.matchId = result.session.match_id
}

function clearTerminalTimer(candidateId) {
  const timer = finalTimers.get(candidateId)
  if (timer) clearTimeout(timer)
  finalTimers.delete(candidateId)
}

async function commitPendingTerminal(candidateId, { force = false, flush = true } = {}) {
  let candidate = lifecycle.terminalCandidate()
  if (!candidate || candidate.id !== candidateId) return { ok: false, code: 'TERMINAL_CANDIDATE_NOT_FOUND' }

  let proof = candidate.proof
  if (!proof?.ok) {
    proof = lifecycle.correlateTerminal(candidate.id, {
      history_ids: state.matchHistory.map(item => asInt(item?.match_id ?? item)).filter(Boolean),
    })
    if (!proof.ok) return { ok: false, code: proof.code || 'TERMINAL_PROOF_REQUIRED' }
    const attached = lifecycle.attachTerminalProof(candidate.id, proof, { deadlineAt: force ? Date.now() : Date.now() + FINAL_COLLECTION_GRACE_MS })
    if (!attached.ok) return attached
    candidate = attached.candidate
    await checkpointLifecycle({ force: true })
  }

  // The only immutable terminal capture happens at commit time. This keeps the
  // bounded grace window open for late roster/outcome/clock/match_id updates.
  const capturedAt = nowIso()
  const details = captureTerminalDetails(candidate.observed_at, capturedAt)
  const session = lifecycle.currentSession() || candidate.session_snapshot
  let payload
  try {
    payload = buildEvidencePayload({
      eventType: 'match_ended',
      session,
      evidence: clone(details.evidence || {}),
      proof: candidate.proof || proof,
      observedAt: candidate.observed_at,
      context: details,
    })
  } catch (error) {
    log('FINAL_NOT_SENT', { code: error.code, cause: error.cause_code || null })
    return { ok: false, code: error.code || 'FINAL_BUILD_FAILED' }
  }

  // Durability first: the final queue item must be persisted before lifecycle
  // moves to FINALIZED. A crash after this point safely retries by idempotency.
  const queued = await enqueuePayload(payload)
  if (!queued.ok) {
    log('FINAL_QUEUE_PERSIST_FAILED', { code: queued.code || 'QUEUE_WRITE_FAILED' })
    return queued
  }

  const finalized = lifecycle.finalize(candidate.id, candidate.proof || proof, { details })
  if (!finalized.ok) return finalized
  clearTerminalTimer(candidate.id)
  clearRecoveryTimers()
  await checkpointLifecycle({ force: true })
  if (state.token && flush) await flushQueue()
  return { ok: true, queued, finalized: finalized.finalized }
}

function scheduleTerminalCommit(candidateId, deadlineAt) {
  if (!candidateId) return false
  clearTerminalTimer(candidateId)
  const deadline = Number(deadlineAt)
  const delay = Math.max(0, (Number.isFinite(deadline) ? deadline : Date.now()) - Date.now())
  const timer = setTimeout(() => {
    finalTimers.delete(candidateId)
    void commitPendingTerminal(candidateId).catch(error => log('TERMINAL_COMMIT_FAILED', {
      candidate_id: candidateId,
      code: error?.code || 'TERMINAL_COMMIT_FAILED',
    }))
  }, delay)
  finalTimers.set(candidateId, timer)
  return true
}

function tryProveTerminalCandidate(candidate) {
  const current = lifecycle.terminalCandidate()
  if (!candidate || !current || current.id !== candidate.id) return false
  if (current.proof?.ok) {
    const deadlineAt = current.commit_deadline_at || Date.now()
    void checkpointLifecycle({ force: true }).then(saved => {
      if (saved?.ok) scheduleTerminalCommit(current.id, deadlineAt)
      else log('TERMINAL_PROOF_CHECKPOINT_FAILED', { candidate_id: current.id, code: saved?.code || 'SECURE_WRITE_FAILED' })
    })
    return true
  }
  const proof = lifecycle.correlateTerminal(current.id, {
    history_ids: state.matchHistory.map(item => asInt(item?.match_id ?? item)).filter(Boolean),
  })
  if (!proof.ok) return false
  clearRecoveryTimers()
  const deadlineAt = Date.now() + FINAL_COLLECTION_GRACE_MS
  const attached = lifecycle.attachTerminalProof(current.id, proof, { deadlineAt })
  if (!attached.ok) return false
  void checkpointLifecycle({ force: true }).then(saved => {
    if (saved?.ok) scheduleTerminalCommit(current.id, deadlineAt)
    else log('TERMINAL_PROOF_CHECKPOINT_FAILED', { candidate_id: current.id, code: saved?.code || 'SECURE_WRITE_FAILED' })
  })
  return true
}

async function forceCommitPendingTerminal() {
  let candidate = lifecycle.terminalCandidate()
  if (!candidate) return { ok: true, skipped: true }
  if (!candidate.proof?.ok) {
    try { await getInfoSnapshot() } catch (error) { log('EXIT_TERMINAL_REFRESH_FAILED', { code: error?.code || 'GEP_GET_INFO_FAILED' }) }
    candidate = lifecycle.terminalCandidate()
    if (!candidate) return { ok: true, skipped: true }
    const proof = lifecycle.correlateTerminal(candidate.id, {
      history_ids: state.matchHistory.map(item => asInt(item?.match_id ?? item)).filter(Boolean),
    })
    if (proof.ok) {
      const attached = lifecycle.attachTerminalProof(candidate.id, proof, { deadlineAt: Date.now() })
      if (!attached.ok) return attached
      await checkpointLifecycle({ force: true })
      candidate = attached.candidate
    }
  }
  if (!candidate?.proof?.ok) {
    await checkpointLifecycle({ force: true })
    return { ok: false, code: 'TERMINAL_PROOF_PENDING' }
  }
  return commitPendingTerminal(candidate.id, { force: true, flush: false })
}

function resumePendingTerminal() {
  const candidate = lifecycle.terminalCandidate()
  if (!candidate) return false
  if (candidate.proof?.ok) {
    scheduleTerminalCommit(candidate.id, candidate.commit_deadline_at || Date.now())
  } else {
    scheduleHistoryRecovery(candidate)
  }
  return true
}

function clearRecoveryTimers() {
  for (const timer of recoveryTimers) clearTimeout(timer)
  recoveryTimers.clear()
}
function scheduleHistoryRecovery(candidate) {
  clearRecoveryTimers()
  if (!candidate || candidate.state !== Lifecycle.MATCH_STATE.TERMINAL_PENDING) return
  for (const delay of [1500, 5000, 15000, 30000, 60000]) {
    const timer = setTimeout(async () => {
      recoveryTimers.delete(timer)
      try {
        const info = await getInfoSnapshot()
        lifecycle.observeInfo(info)
        const current = lifecycle.terminalCandidate()
        if (current && tryProveTerminalCandidate(current)) return
      } catch (error) {
        log('TERMINAL_RECOVERY_FAILED', { delay, code: error.code || 'GEP_GET_INFO_FAILED' })
      }
    }, delay)
    recoveryTimers.add(timer)
  }
}
function schedulePostMatchProductRefresh(matchId, sessionId) {
  for (const timer of postMatchTimers) clearTimeout(timer)
  postMatchTimers.clear()
  if (!state.token) return
  const key = String(matchId || sessionId || '')
  if (!key) return
  for (const delay of POST_MATCH_REFRESH_MS) {
    const timer = setTimeout(() => { postMatchTimers.delete(timer); void refreshProduct() }, delay)
    postMatchTimers.add(timer)
  }
}

function applyNewEvent(name, data) {
  state.lastEventAt = nowIso()
  log('GEP_EVENT', { name })
  if (name === 'match_clock') { applyMatchClock(data); return }
  if (['kill','death','assist'].includes(name)) {
    const key = name === 'assist' ? 'assists' : `${name}s`
    updateEvidenceMetric(key, Number(state.evidence[key] || 0) + 1, { source: `event:${name}`, monotonic: true })
    return
  }
  if (name === 'match_start') {
    if (isStreetBrawl()) {
      if (state.streetBrawlMatchStartSeen && lifecycle.currentSession()) advanceStreetBrawlRound('match_start')
      state.streetBrawlMatchStartSeen = true
    }
    const before = lifecycle.snapshot().state
    const result = lifecycle.observeMatchStart({ observedAt: nowIso() })
    handleSessionTransition(before, lifecycle.snapshot().state, 'match_start', result)
    void getInfoSnapshot().catch(error => log('MATCH_START_REFRESH_FAILED', { code: error.code }))
    return
  }
  if (name === 'match_end') {
    const observedAt = nowIso()
    const candidate = lifecycle.observeTerminalSignal({ type: 'match_end', observedAt })
    if (!candidate) { log('MATCH_END_IGNORED', { state: lifecycle.snapshot().state, match_id: state.matchId, clock: state.matchClockS }); return }
    void checkpointLifecycle({ force: true })
    if (!tryProveTerminalCandidate(candidate)) scheduleHistoryRecovery(candidate)
  }
}
function handleNewEvents(info) { for (const event of Array.isArray(info?.events) ? info.events : []) applyNewEvent(String(event?.name || ''), event?.data) }

function handleRunningGameInfo(info, { resolutionChanged = false } = {}) {
  const running = !!(info && info.isRunning && Number(info.classId) === GAME_ID)
  const previous = state.gameRunning
  state.gameInfo = info || null
  state.gameRunning = running
  state.processObservedAt = nowIso()
  const before = lifecycle.snapshot().state
  lifecycle.observeProcess({ running, processId: info?.processId || null, gameSessionId: info?.sessionId || null, observedAt: state.processObservedAt })
  const after = lifecycle.snapshot().state
  if (running && !previous) {
    // Preserve a restored INTERRUPTED session or TERMINAL_PENDING candidate until
    // exact identity decides whether this is the same match. A clean process-only
    // launch starts with an empty match-scoped state.
    if (!lifecycle.currentSession() && !lifecycle.hasTerminalCandidate()) {
      resetMatchScopedState('process_started')
    }
    log('GAME_PROCESS_STARTED', { class_id: info?.classId || null })
    void getInfoSnapshot().catch(error => log('INITIAL_GEP_SNAPSHOT_FAILED', { code: error.code }))
  }
  if (!running && previous) {
    log('GAME_PROCESS_STOPPED', { lifecycle_state: after })
    dismissOverlay('game_stopped')
    if (before === Lifecycle.MATCH_STATE.MATCH_CONFIRMED && after === Lifecycle.MATCH_STATE.INTERRUPTED) handleSessionTransition(before, after, 'process_stopped')
    if (lifecycle.hasTerminalCandidate()) scheduleHistoryRecovery(lifecycle.terminalCandidate())
    if (after === Lifecycle.MATCH_STATE.NO_GAME) { state.phase = null; state.matchId = null; state.matchClockS = null; state.matchClockObservedAt = null; state.matchOutcome = null; state.matchOutcomeEventAt = null; state.matchOutcomeEventMatchId = null; resetEvidence('no_game') }
  }
  if (resolutionChanged && running) void clampOverlayToGameBounds(info)
  updateGepHealth()
  publishRuntimeState()
}
function queryRunningGame() {
  return new Promise(resolve => {
    overwolf.games.getRunningGameInfo2(result => {
      if (!result?.success) {
        setHealth('gep', 'UNAVAILABLE', 'GAME_INFO_FAILED', result?.error || 'getRunningGameInfo2 failed')
        return resolve(false)
      }
      handleRunningGameInfo(result.gameInfo || null)
      resolve(true)
    })
  })
}
function scheduleWatchdog() {
  clearTimeout(watchdogTimer)
  watchdogTimer = setTimeout(async () => {
    await queryRunningGame()
    if (state.gameRunning) await getInfoSnapshot().catch(() => {})
    scheduleWatchdog()
  }, state.gameRunning ? INFO_WATCHDOG_RUNNING_MS : INFO_WATCHDOG_IDLE_MS)
}

function checkEventStatus({ force = false } = {}) {
  if (!force && Date.now() - lastEventStatusCheck < EVENT_STATUS_COOLDOWN_MS) return Promise.resolve(lastEventStatus)
  lastEventStatusCheck = Date.now()
  return fetch(EVENT_STATUS_URL, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
    .then(data => {
      lastEventStatus = { ok: true, checked_at: nowIso(), state: data?.state ?? null, disabled: data?.disabled === true, maintenance_msg: data?.maintenance_msg || null, features: data?.features || [] }
      if (data?.disabled === true || Number(data?.state) === 3) setHealth('gep', 'UNAVAILABLE', 'OVERWOLF_GEP_SERVICE_UNAVAILABLE', data?.maintenance_msg || 'Overwolf GEP service reports unavailable')
      publishRuntimeState()
      return lastEventStatus
    })
    .catch(error => { lastEventStatus = { ok: false, checked_at: nowIso(), code: 'STATUS_ENDPOINT_FAILED', message: String(error.message || error) }; return lastEventStatus })
}
function setRequiredFeatures(attempt = 1) {
  featureAttempt = attempt
  overwolf.games.events.setRequiredFeatures(FEATURES, result => {
    if (result?.success) {
      state.features = Array.isArray(result.supportedFeatures) && result.supportedFeatures.length ? result.supportedFeatures : [...FEATURES]
      setHealth('gep', 'STARTING', null, null, { feature: null })
      void getInfoSnapshot().catch(() => {})
    } else {
      state.features = []
      setHealth('gep', 'UNAVAILABLE', 'FEATURE_REGISTRATION_FAILED', String(result?.error || 'Required features unavailable'))
      void checkEventStatus({ force: true })
      const delay = Math.min(FEATURE_RETRY_MAX_MS, FEATURE_RETRY_BASE_MS * (2 ** Math.min(5, attempt - 1))) + Math.floor(Math.random() * 750)
      setTimeout(() => setRequiredFeatures(attempt + 1), delay)
    }
    publishRuntimeState()
  })
}

function transitionToUnpaired(reason = 'AUTH_REQUIRED') {
  clearLocalAuth()
  state.product = Product.emptyProductState('UNPAIRED')
  setHealth('auth', reason === 'TOKEN_EXPIRED' ? 'EXPIRED' : 'UNPAIRED', reason, null)
  publishRuntimeState()
}
async function sendPresenceHeartbeat() {
  if (!state.token) return { ok: false, code: 'UNPAIRED' }

  const observedAt = nowIso()
  const payload = {
    client_version: VERSION,
    version: VERSION,
    device_id: ensureDeviceId(),
    event_type: 'heartbeat',
    observed_at: observedAt,
    // Presence is account/device liveness, not match evidence. It must keep
    // flowing in menus and after a terminal session has been cleared.
    game_running: state.gameRunning === true,
    steam_id64: state.steamId || null,
    phase: state.phase,
    game_mode: state.gameModeRaw,
    game_match_mode: state.mode.value,
    match_id: state.matchId,
    match_clock_s: state.matchClockS,
    match_clock_observed_at: state.matchClockObservedAt,
    gep_version: state.gepVersion,
    session_id: null,
    session_started_at: null,
    session_start_reason: null,
    local_team: state.localTeam,
    match_outcome: state.matchOutcome,
    match_outcome_event_at: state.matchOutcomeEventAt,
    match_outcome_event_match_id: state.matchOutcomeEventMatchId,
    live_stats: clone(state.evidence || {}),
    sequence: 0,
    idempotency_key: `presence:${runtimeSessionId}:${observedAt}`,
  }

  try {
    const wirePayload = ServerCompat.toHeartbeatV1(payload)
    const data = await serverFetch('/api/companion/heartbeat', {
      method: 'POST',
      body: JSON.stringify(wirePayload),
    })
    state.lastSyncedAt = data?.server_time || nowIso()
    state.lastAckAt = state.lastSyncedAt
    state.lastUploadStatus = 'ACKNOWLEDGED'
    setHealth('auth', 'OK')
    publishRuntimeState()
    return { ok: true, last_ack_at: state.lastAckAt }
  } catch (error) {
    if (UploadQueue.classifyUploadError(error) === 'AUTH') {
      transitionToUnpaired(error.code || 'AUTH_REQUIRED')
    }
    state.lastUploadStatus = error?.code || 'PRESENCE_FAILED'
    publishRuntimeState()
    return { ok: false, code: error?.code || 'PRESENCE_FAILED' }
  }
}

async function reconnect() {
  if (!state.token) return { ok: false, code: 'UNPAIRED' }
  if (reconnectPromise) return reconnectPromise
  reconnectPromise = (async () => {
    try {
      const data = await serverFetch('/api/companion/hello')
      state.account = data.account || state.account
      state.lastSyncedAt = data.server_time || nowIso()
      setHealth('auth', 'OK')
      const presence = await sendPresenceHeartbeat()
      const upload = await flushQueue()
      const product = await refreshProduct({ requireFresh: true })
      return { ok: product.ok && presence.ok, presence, upload, product }
    } catch (error) {
      if (UploadQueue.classifyUploadError(error) === 'AUTH') transitionToUnpaired(error.code || 'AUTH_REQUIRED')
      return { ok: false, code: error.code || 'RECONNECT_FAILED' }
    } finally { reconnectPromise = null }
  })()
  return reconnectPromise
}
async function pair(serverUrl, rawCode) {
  clearPairingError()
  const allowed = allowedServerUrl(serverUrl)
  const code = normalizePairCode(rawCode)
  if (!allowed) throw Object.assign(new Error('Only the official server is allowed'), { code: 'SERVER_NOT_ALLOWED' })
  if (!code.ok) { const error = Object.assign(new Error(I18n.t('pair.invalid_format')), { code: code.code }); setPairingError(error); throw error }
  state.serverUrl = allowed
  writeStoredValue(STORAGE.serverUrl, allowed)
  try {
    const data = await serverFetch('/api/companion/pairing/claim', { auth: false, method: 'POST', body: JSON.stringify({ code: code.normalized, device_id: ensureDeviceId(), label: 'Deadlock Contracts Desktop', version: VERSION }) })
    state.token = String(data.token || '')
    state.account = data.account || null
    const saved = await storeToken(state.token)
    if (!saved.ok) throw Object.assign(new Error(I18n.t('pair.storage_invalid')), { code: saved.code })
    setHealth('auth', 'OK')
    clearPairingError()
    await sendPresenceHeartbeat()
    await flushQueue()
    await refreshProduct({ requireFresh: true })
    publishRuntimeState()
    return publicSnapshot()
  } catch (error) { setPairingError(error); throw error }
}
async function testServer(serverUrl) {
  const allowed = allowedServerUrl(serverUrl)
  if (!allowed) throw Object.assign(new Error('Only the official server is allowed'), { code: 'SERVER_NOT_ALLOWED' })
  state.serverUrl = allowed
  writeStoredValue(STORAGE.serverUrl, allowed)
  return serverFetch('/api/health', { auth: false })
}
async function revokeAndDisconnect() {
  const upload = await flushQueue({ deadlineMs: 5000 })
  if (upload.pending) throw Object.assign(new Error(`${upload.pending} uploads still await acknowledgement`), { code: 'PENDING_UPLOADS' })
  if (state.token) await serverFetch('/api/companion/disconnect', { method: 'POST' })
  clearLocalAuth()
  state.product = Product.emptyProductState('UNPAIRED')
  publishRuntimeState()
  return publicSnapshot()
}
function forceLocalSignOut() {
  clearLocalAuth()
  state.product = Product.emptyProductState('UNPAIRED')
  publishRuntimeState()
  return publicSnapshot()
}
function liveGepBlocksServerAction() {
  return state.gameRunning && ['STALE', 'UNAVAILABLE'].includes(String(health.state.gep.status || ''))
}
async function lockContracts(mode, optionIds) {
  if (!state.token) throw Object.assign(new Error('Pairing required'), { code: 'UNPAIRED' })
  if (health.state.backend.status === 'OFFLINE' || state.product.stale || state.product.status !== 'ONLINE') throw Object.assign(new Error('Fresh server data is required'), { code: 'ACTION_BLOCKED_STALE' })
  if (liveGepBlocksServerAction()) throw Object.assign(new Error('Live GEP data is stale or unavailable while Deadlock is running'), { code: 'ACTION_BLOCKED_GEP_STALE' })
  const normalized = Product.normalizeMode(mode)
  const ids = [...new Set((Array.isArray(optionIds) ? optionIds : []).map(String).filter(Boolean))]
  if (!normalized) throw Object.assign(new Error('Unknown mode'), { code: 'MODE_UNKNOWN' })
  if (state.gameRunning && state.mode.value && normalized !== state.mode.value) throw Object.assign(new Error(`Live Deadlock mode is ${state.mode.value}; cannot lock ${normalized} contracts.`), { code: 'LIVE_MODE_MISMATCH' })
  if (ids.length < 1 || ids.length > 3) throw Object.assign(new Error('Select 1–3 contracts'), { code: 'SELECTION_INVALID' })
  const board = Product.boardForMode(state.product, normalized)
  if (!board || board.attempts_remaining <= 0) throw Object.assign(new Error('No attempts remaining'), { code: 'ATTEMPTS_EXHAUSTED' })
  await serverFetch('/api/desktop/v1/boards/lock', { method: 'POST', body: JSON.stringify({ mode: normalized, option_ids: ids }) })
  await refreshProduct({ requireFresh: true })
  return publicSnapshot()
}
async function rerollBoard(mode) {
  if (!state.token) throw Object.assign(new Error('Pairing required'), { code: 'UNPAIRED' })
  if (health.state.backend.status === 'OFFLINE' || state.product.stale || state.product.status !== 'ONLINE') throw Object.assign(new Error('Fresh server data is required'), { code: 'ACTION_BLOCKED_STALE' })
  if (liveGepBlocksServerAction()) throw Object.assign(new Error('Live GEP data is stale or unavailable while Deadlock is running'), { code: 'ACTION_BLOCKED_GEP_STALE' })
  const normalized = Product.normalizeMode(mode)
  if (!normalized) throw Object.assign(new Error('Unknown mode'), { code: 'MODE_UNKNOWN' })
  await serverFetch(`/api/desktop/v1/boards/${encodeURIComponent(normalized)}/reroll`, { method: 'POST' })
  await refreshProduct({ requireFresh: true })
  return publicSnapshot()
}
async function clearAllLocalData() {
  const lifecycleState = lifecycle.snapshot().state
  if ([Lifecycle.MATCH_STATE.MATCH_CONFIRMED, Lifecycle.MATCH_STATE.TERMINAL_PENDING].includes(lifecycleState)) {
    throw Object.assign(new Error('Local data cannot be cleared during an active match.'), { code: 'ACTIVE_MATCH_BLOCKS_CLEAR' })
  }
  uploadQueue.clear({ deadLetters: true })
  clearRecoveryTimers()
  for (const timer of postMatchTimers) clearTimeout(timer)
  postMatchTimers.clear()
  for (const timer of finalTimers.values()) clearTimeout(timer)
  finalTimers.clear()
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith('dc.')) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch (error) {
    throw Object.assign(new Error(String(error?.message || error)), { code: 'LOCAL_CLEAR_FAILED' })
  }
  state.token = ''
  state.account = null
  state.product = Product.emptyProductState('UNPAIRED')
  state.pairingError = null
  state.evidence = {}
  state.evidenceRevision += 1
  health.patch('auth', { status: 'UNPAIRED', code: null, message: null })
  health.patch('queue', { status: 'OK', count: 0, rejected: 0, code: null, message: null })
  health.patch('storage', { status: 'OK', code: null, message: null, key: null })
  publishRuntimeState()
  return { ok: true, restart_recommended: true, snapshot: publicSnapshot() }
}

async function syncNow() {
  if (navigator.onLine === false) return { ok: false, code: 'OFFLINE', upload: { ok: false, code: 'OFFLINE' }, product: { ok: false, code: 'OFFLINE' }, snapshot: publicSnapshot() }
  let info
  try { info = await getInfoSnapshot() } catch (error) { info = { ok: false, code: error.code || 'GEP_GET_INFO_FAILED' } }
  if (lifecycle.currentSession()) await enqueueSessionEvent('heartbeat')
  const upload = await flushQueue()
  const product = await refreshProduct({ requireFresh: true })
  const ok = upload.ok && product.ok
  return { ok, info, upload, product, snapshot: publicSnapshot() }
}

function copyText(text) {
  return new Promise((resolve, reject) => {
    try {
      overwolf.utils.placeOnClipboard(String(text))
      overwolf.utils.getFromClipboard(value => value === String(text) ? resolve({ ok: true }) : reject(Object.assign(new Error('Clipboard verification failed'), { code: 'CLIPBOARD_VERIFY_FAILED' })))
    } catch (error) { reject(error) }
  })
}
function exportPendingUploads() { return JSON.stringify({ exported_at: nowIso(), queue: uploadQueue.snapshot() }, null, 2) }
function diagnosticsText() {
  const snap = publicSnapshot()
  return [
    'DEADLOCK CONTRACTS COMPANION — DIAGNOSTICS',
    `Companion: ${VERSION}`,
    `Evidence schema: ${EVIDENCE_SCHEMA_VERSION}`,
    `Diagnostic install: ${ensureDiagnosticInstallId()}`,
    `Device: ${maskIdentifier(state.deviceId)}`,
    `Paired: ${!!state.token}`,
    `Steam: ${maskIdentifier(state.steamId)}`,
    `Deadlock: ${state.gameRunning}`,
    `Lifecycle: ${snap.lifecycle?.state || '—'}`,
    `Mode: ${state.mode.value || state.mode.state}`,
    `Match: ${state.matchId || '—'}`,
    `GEP local/public: ${state.gepVersion || '—'} / ${state.gepPublicVersion || '—'}`,
    `GEP health: ${snap.health?.gep?.status || '—'}`,
    `Backend health: ${snap.health?.backend?.status || '—'}`,
    `Storage health: ${snap.health?.storage?.status || '—'}`,
    `Queue: ${uploadQueue.totals().items} / rejected ${uploadQueue.totals().dead_letter}`,
    `Last ack: ${state.lastAckAt || '—'}`,
    `Runtime session: ${runtimeSessionId}`,
    `Performance: ${JSON.stringify(performanceCounters)}`,
    '',
    '--- LOG ---',
    ...logLines,
  ].join('\n')
}
function clearLocalCache() {
  Storage.remove(STORAGE.product)
  state.product = state.token ? Product.emptyProductState('CONNECTING') : Product.emptyProductState('UNPAIRED')
  publishRuntimeState()
  return { ok: true }
}
function overlayAutoHideMs() {
  const saved = Number(readStoredValue(STORAGE.overlayAutoHide))
  return AUTO_HIDE_OPTIONS.includes(saved) ? saved : DEFAULT_AUTO_HIDE_MS
}
function setOverlayAutoHide(value) {
  const next = Number(value)
  if (!AUTO_HIDE_OPTIONS.includes(next)) throw Object.assign(new Error('Invalid auto-hide option'), { code: 'AUTO_HIDE_INVALID' })
  writeStoredValue(STORAGE.overlayAutoHide, next)
  publishRuntimeState()
  return { ok: true, auto_hide_ms: next }
}
const OVERLAY_PRESETS = { compact:{width:440,height:190}, regular:{width:500,height:205}, large:{width:560,height:220} }
function overlayScale() { const saved = String(readStoredValue(STORAGE.overlayScale) || ''); return OVERLAY_PRESETS[saved] ? saved : 'compact' }
function obtainWindow(name) { return new Promise((resolve, reject) => {
  overwolf.windows.obtainDeclaredWindow(name, result => result?.success || result?.status === 'success' ? resolve(result.window?.id || result.id || name) : reject(Object.assign(new Error(result?.error || `Unable to obtain ${name}`), { code: 'WINDOW_OBTAIN_FAILED' })))
}) }
function getWindowState(id) { return new Promise((resolve, reject) => {
  overwolf.windows.getWindowState(id, result => {
    if (result?.success === false || (!result?.window_state && !result?.window_state_ex && !result?.state)) return reject(Object.assign(new Error(result?.error || 'Unable to read window state'), { code: 'WINDOW_STATE_FAILED' }))
    const stateName = String(result.window_state_ex || result.window_state || result.state || '').toLowerCase()
    resolve({ raw: result, state: stateName, visible: ['normal','maximized'].includes(stateName) })
  })
}) }
function windowAction(method, id, ...args) { return new Promise((resolve, reject) => {
  const fn = overwolf.windows?.[method]
  if (!fn) return reject(Object.assign(new Error(`Window API ${method} unavailable`), { code: 'WINDOW_API_UNAVAILABLE' }))
  fn(id, ...args, result => result?.success === false ? reject(Object.assign(new Error(result?.error || `${method} failed`), { code: `WINDOW_${method.toUpperCase()}_FAILED` })) : resolve(result || { success: true }))
}) }
async function showDesktop({ minimized = false } = {}) {
  const id = await obtainWindow('desktop')
  if (minimized) {
    await windowAction('minimize', id)
    return { ok: true, visible: false }
  }
  await windowAction('restore', id)
  if (overwolf.windows.bringToFront) await windowAction('bringToFront', id)
  const check = await getWindowState(id)
  if (!check.visible) throw Object.assign(new Error('Desktop window did not become visible'), { code: 'WINDOW_VISIBILITY_VERIFY_FAILED' })
  return { ok: true, visible: true }
}
async function hideDesktop() {
  const id = await obtainWindow('desktop')
  await windowAction('minimize', id)
  const check = await getWindowState(id)
  if (check.visible) throw Object.assign(new Error('Desktop window remained visible after minimize'), { code: 'WINDOW_HIDE_VERIFY_FAILED' })
  return { ok: true, visible: false }
}
function cancelOverlayAutoHide() { if (overlayAutoHideTimer) clearTimeout(overlayAutoHideTimer); overlayAutoHideTimer = 0 }
function scheduleOverlayAutoHide() {
  cancelOverlayAutoHide()
  const gepStatus = String(health?.state?.gep?.status || '')
  // Do not hide a stale/unavailable recovery message before the user can act on it.
  if (['STALE','UNAVAILABLE'].includes(gepStatus)) return
  const ms = overlayAutoHideMs()
  if (!ms) return
  overlayAutoHideTimer = setTimeout(() => dismissOverlay('auto_hide'), ms)
}
async function dismissOverlay(reason = 'dismiss') {
  cancelOverlayAutoHide()
  try { const id = await obtainWindow('overlay'); await windowAction('minimize', id); return { ok: true, reason } } catch (error) { log('OVERLAY_DISMISS_FAILED', { reason, code: error.code }); return { ok: false, code: error.code } }
}
async function toggleOverlay() {
  const id = await obtainWindow('overlay')
  const before = await getWindowState(id)
  if (before.visible) { await windowAction('minimize', id); cancelOverlayAutoHide() }
  else { await clampOverlayToGameBounds(state.gameInfo); await windowAction('restore', id); scheduleOverlayAutoHide() }
  const after = await getWindowState(id)
  const expectedVisible = !before.visible
  if (after.visible !== expectedVisible) throw Object.assign(new Error('Overlay state did not change as requested'), { code: 'OVERLAY_VISIBILITY_VERIFY_FAILED' })
  return { ok: true, visible: after.visible, auto_hide_ms: after.visible ? overlayAutoHideMs() : 0 }
}
async function setOverlayScale(preset) {
  const name = OVERLAY_PRESETS[preset] ? preset : 'compact'
  writeStoredValue(STORAGE.overlayScale, name)
  const id = await obtainWindow('overlay')
  await new Promise((resolve, reject) => overwolf.windows.changeSize({ window_id: id, ...OVERLAY_PRESETS[name], auto_dpi_resize: true }, result => result?.success === false ? reject(new Error(result?.error || 'Resize failed')) : resolve(result)))
  await clampOverlayToGameBounds(state.gameInfo)
  publishRuntimeState()
  return { ok: true, preset: name }
}
async function clampOverlayToGameBounds(info = state.gameInfo, { reset = false } = {}) {
  if (!info) return { ok: false, code: 'GAME_BOUNDS_UNKNOWN' }
  const preset = OVERLAY_PRESETS[overlayScale()]
  const gameWidth = Number(info.logicalWidth || info.width || 0)
  const gameHeight = Number(info.logicalHeight || info.height || 0)
  if (!gameWidth || !gameHeight) return { ok: false, code: 'GAME_BOUNDS_UNKNOWN' }
  let saved = Storage.readJson(STORAGE.overlayPosition, { schemaVersion: 1 }).value || null
  if (reset || !saved) saved = { left: Math.max(16, gameWidth - preset.width - 16), top: 16 }
  const left = Math.max(16, Math.min(Number(saved.left) || 16, Math.max(16, gameWidth - preset.width - 16)))
  const top = Math.max(16, Math.min(Number(saved.top) || 16, Math.max(16, gameHeight - preset.height - 16)))
  const id = await obtainWindow('overlay')
  await new Promise((resolve, reject) => overwolf.windows.changePosition(id, left, top, result => result?.success === false ? reject(new Error(result?.error || 'Position failed')) : resolve(result)))
  Storage.writeJson(STORAGE.overlayPosition, { left, top }, { schemaVersion: 1 })
  return { ok: true, left, top }
}
function resetOverlayPosition() { return clampOverlayToGameBounds(state.gameInfo, { reset: true }) }

function hotkeyFromResult(result) {
  if (!result?.success) return null
  const gameHotkeys = result.games?.[String(GAME_ID)] ?? result.games?.[GAME_ID]
  const items = [...(Array.isArray(gameHotkeys) ? gameHotkeys : []), ...(Array.isArray(result.globals) ? result.globals : [])]
  const item = items.find(entry => entry?.name === HOTKEY_NAME)
  if (!item) return null
  if (item.IsUnassigned === true) return 'UNASSIGNED'
  return String(item.binding || '').trim() || 'UNASSIGNED'
}
function refreshHotkeyBinding() { return new Promise(resolve => {
  if (!overwolf.settings?.hotkeys?.get) { state.hotkeyBinding = DEFAULT_HOTKEY; return resolve(state.hotkeyBinding) }
  overwolf.settings.hotkeys.get(result => { const binding = hotkeyFromResult(result); if (binding !== null) state.hotkeyBinding = binding; publishRuntimeState(); resolve(state.hotkeyBinding) })
}) }
function openHotkeySettings() { try { overwolf.settings?.hotkeys?.openHotkeySettings?.(); return { ok: true } } catch (error) { return { ok: false, code: 'HOTKEY_SETTINGS_FAILED' } } }

let overlayStickyFocusKey = null
let overlayStickyFocusUntil = 0

function buildOverlayDto() {
  const session = lifecycle.currentSession()
  const active = Product.activeCaseFor(state.product, state.mode.value)
  const selected = Product.selectedContracts(active)

  const candidates = []
  for (const option of selected) {
    const conditions = Array.isArray(option?.conditions) ? option.conditions : []
    conditions.forEach((condition, conditionIndex) => {
      const current = Product.liveMetricValue(condition, {
        evidence: state.evidence,
        match_clock_s: state.matchClockS,
        result_label: state.resultLabel,
      })
      const progress = Progress.evaluate(condition, current, {
        stale: health.state.gep.status === 'STALE',
        server_status: option?.status,
        server_current: option?.progress_current,
        server_target: option?.progress_target,
      })
      const metricKey = Product.metricKey(condition.metric)
      candidates.push({
        key: `${option.id}:${conditionIndex}:${condition.metric}`,
        option,
        condition,
        condition_index: conditionIndex,
        metric_key: metricKey,
        progress,
        activity: state.metricActivity[metricKey] || null,
      })
    })
  }

  const choice = FocusSelector.choose(candidates, {
    now: Date.now(),
    stickyKey: overlayStickyFocusKey,
    stickyUntil: overlayStickyFocusUntil,
  })
  overlayStickyFocusKey = choice.sticky_key
  overlayStickyFocusUntil = choice.sticky_until

  const focusCandidate = choice.candidate
  const focusOption = focusCandidate?.option || null
  const condition = focusCandidate?.condition || null
  const progress = focusCandidate?.progress || null

  const signature = JSON.stringify({
    lang: I18n.language(),
    health: health.state.gep.status,
    match: session?.match_id || state.matchId,
    mode: state.mode.value,
    focus: focusCandidate?.key || null,
    progress,
    evidence_revision: state.evidenceRevision,
    hotkey: state.hotkeyBinding,
    auto: overlayAutoHideMs(),
  })
  if (signature !== overlayLastSignature) {
    overlayLastSignature = signature
    overlayRevision += 1
  }

  const dto = {
    dto_version: 2,
    revision: overlayRevision,
    generated_at: nowIso(),
    language: I18n.language(),
    health: {
      game: session ? 'MATCH' : state.gameRunning ? 'PROCESS_ONLY' : 'NO_GAME',
      gep: health.state.gep.status,
      age_ms: health.state.gep.age_ms,
      backend: health.state.backend.status,
    },
    match: {
      id: session?.match_id || state.matchId || null,
      mode: state.mode.value,
      attempt: active ? { current: active.current_attempt || 1, max: active.max_attempts || 3 } : null,
    },
    focus: focusOption && condition && progress ? {
      option_id: focusOption.id,
      condition_index: focusCandidate.condition_index,
      focus_reason: choice.reason,
      title: Product.contractTitle(focusOption, I18n.language()),
      metric_label: Product.metricLabel(condition.metric, I18n.language()),
      reward_xp: focusOption.reward_xp,
      condition: clone(condition),
      progress,
    } : null,
    selected: selected.map(option => ({
      id: option.id,
      title: Product.contractTitle(option, I18n.language()),
    })),
    hotkey: {
      binding: state.hotkeyBinding,
      assigned: !!state.hotkeyBinding && state.hotkeyBinding !== 'UNASSIGNED',
    },
    auto_hide_ms: overlayAutoHideMs(),
  }

  try {
    const bytes = new TextEncoder().encode(JSON.stringify(dto)).length
    performanceCounters.overlay_dto_max_bytes = Math.max(performanceCounters.overlay_dto_max_bytes, bytes)
  } catch (_) {}
  return dto
}
function publicSnapshot() {
  const lifecycleSnapshot = lifecycle.snapshot()
  const totals = uploadQueue.totals()
  return {
    version: VERSION,
    evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
    paired: !!state.token,
    account: state.account ? { ...state.account, steam_id64: state.account.steam_id64 ? String(state.account.steam_id64) : null } : null,
    game_running: state.gameRunning,
    steam_id64: state.steamId,
    steam_id_masked: maskIdentifier(state.steamId),
    phase: state.phase,
    mode: clone(state.mode),
    mode_display: state.mode.value,
    match_id: state.matchId,
    match_clock_s: state.matchClockS,
    evidence: clone(state.evidence),
    evidence_meta: clone(state.evidenceMeta),
    evidence_revision: state.evidenceRevision,
    street_brawl_round_epoch: state.streetBrawlRoundEpoch,
    match_clock_raw_s: state.matchClockRawS,
    result_label: state.resultLabel,
    gep_version: state.gepVersion,
    gep_public_version: state.gepPublicVersion,
    gep_updated: state.gepUpdated,
    features: [...state.features],
    hotkey_binding: state.hotkeyBinding,
    overlay_scale: overlayScale(),
    overlay_auto_hide_ms: overlayAutoHideMs(),
    pairing_error: clone(state.pairingError),
    health: health.snapshot(),
    lifecycle: lifecycleSnapshot,
    queue: { ...totals, last_ack_at: state.lastAckAt },
    last_synced_at: state.lastSyncedAt,
    last_upload_status: state.lastUploadStatus,
    event_status: clone(lastEventStatus),
    product: clone(state.product),
  }
}
function publishRuntimeState() {
  performanceCounters.runtime_state_publications += 1
  updateQueueHealth()
  updateGepHealth()
  if ($('gameRunning')) $('gameRunning').textContent = state.gameRunning ? 'RUNNING' : 'NOT RUNNING'
  if ($('phase')) $('phase').textContent = state.phase || '—'
  if ($('gameMode')) $('gameMode').textContent = state.mode.value || state.mode.state
  if ($('matchId')) $('matchId').textContent = state.matchId || '—'
  if ($('queueCount')) $('queueCount').textContent = String(uploadQueue.totals().items)
  if ($('schemaVersion')) $('schemaVersion').textContent = `Evidence v${EVIDENCE_SCHEMA_VERSION}`
}

async function exitApp({ deadlineMs = 5000 } = {}) {
  if (lifecycle.snapshot().state === Lifecycle.MATCH_STATE.TERMINAL_PENDING) {
    const committed = await forceCommitPendingTerminal()
    if (!committed.ok && committed.code !== 'TERMINAL_PROOF_PENDING') {
      log('EXIT_TERMINAL_COMMIT_FAILED', { code: committed.code || 'TERMINAL_COMMIT_FAILED' })
    }
  }
  await persistQueue()
  await checkpointLifecycle({ force: true })
  const queue = await flushQueue({ deadlineMs })
  const current = await new Promise(resolve => overwolf.windows.getCurrentWindow(result => resolve(result?.window?.id || result?.id || null)))
  if (current) await new Promise(resolve => overwolf.windows.close(current, () => resolve()))
  return { ok: queue.pending === 0, queue }
}
function exitStatus() { const snap = lifecycle.snapshot(); const totals = uploadQueue.totals(); return { active_match: [Lifecycle.MATCH_STATE.MATCH_CONFIRMED, Lifecycle.MATCH_STATE.TERMINAL_PENDING].includes(snap.state), pending_uploads: totals.items, rejected_uploads: totals.dead_letter, last_server_acknowledgement: state.lastAckAt } }

function installListeners() {
  overwolf.games.events.onInfoUpdates2.addListener(applyInfoUpdate)
  overwolf.games.events.onNewEvents.addListener(handleNewEvents)
  overwolf.games.events.onError.addListener(error => { log('GEP_ERROR', { code: error?.error || error?.message || 'GEP_ERROR' }); setHealth('gep', 'UNAVAILABLE', 'LOCAL_GEP_ERROR', String(error?.error || error?.message || 'GEP error')); void checkEventStatus({ force: true }) })
  overwolf.games.onGameInfoUpdated.addListener(event => { handleRunningGameInfo(event?.gameInfo || null, { resolutionChanged: event?.resolutionChanged === true }) })
  overwolf.settings?.hotkeys?.onPressed?.addListener(event => { if (event?.name === HOTKEY_NAME) void toggleOverlay().catch(error => log('OVERLAY_TOGGLE_FAILED', { code: error.code })) })
  overwolf.settings?.hotkeys?.onChanged?.addListener(event => { if (event?.name === HOTKEY_NAME) { state.hotkeyBinding = String(event.binding || '').trim() || 'UNASSIGNED'; publishRuntimeState() } })
  window.addEventListener('online', () => { setHealth('backend', 'DEGRADED', 'RECOVERING', 'Network restored; recovering'); void runRecoveryOnce() })
  window.addEventListener('offline', () => { setHealth('backend', 'OFFLINE', 'OFFLINE', 'No network connection') })
}
async function runRecoveryOnce() {
  if (reconnectPromise) return reconnectPromise
  return reconnect()
}
function startTimers() {
  scheduleWatchdog()
  heartbeatTimer = setInterval(() => {
    if (!state.token) return
    if (lifecycle.currentSession()) {
      void enqueueSessionEvent('heartbeat').then(() => flushQueue())
      return
    }
    void sendPresenceHeartbeat()
  }, HEARTBEAT_MS)
  productTimer = setInterval(() => void refreshProduct(), PRODUCT_REFRESH_MS)
  flushTimer = setInterval(() => void flushQueue(), 10000)
  healthTimer = setInterval(() => { updateGepHealth(); if (health.state.gep.status === 'STALE') void checkEventStatus(); publishRuntimeState() }, 1000)
}
function launchSource(value = window.location.href) { try { return new URL(value).searchParams.get('source') || '' } catch (_) { return '' } }
function installLaunchOrchestrator() {
  const open = value => void showDesktop({ minimized: launchSource(value) === 'gamelaunchevent' }).catch(error => log('DESKTOP_SHOW_FAILED', { code: error.code }))
  open(window.location.href)
  overwolf.extensions?.onAppLaunchTriggered?.addListener(origin => open(String(origin || '')))
}
async function init() {
  ensureDeviceId()
  ensureDiagnosticInstallId()
  await loadToken()
  restoreProductCache()
  await restoreQueue()
  await restoreLifecycleCheckpoint()
  installListeners()
  installLaunchOrchestrator()
  await refreshHotkeyBinding()
  await queryRunningGame()
  setRequiredFeatures()
  resumePendingTerminal()
  void checkEventStatus({ force: true })
  startTimers()
  if (state.token) void reconnect()
  publishRuntimeState()
  log('APP_STARTED', { version: VERSION, schema: EVIDENCE_SCHEMA_VERSION })
}

window.dcCompanion = {
  getSnapshot: publicSnapshot,
  getOverlaySnapshot: buildOverlayDto,
  diagnosticsText,
  getLogs: () => logLines.slice(),
  pair,
  pairingUrl: () => PAIRING_URL,
  normalizePairCode,
  testServer,
  syncNow,
  refreshProduct: async () => { await refreshProduct({ requireFresh: true }); return publicSnapshot() },
  lockContracts,
  rerollBoard,
  flushNow: () => flushQueue(),
  revokeAndDisconnect,
  forceLocalSignOut,
  disconnect: revokeAndDisconnect,
  showDesktop,
  hideDesktop,
  toggleOverlay,
  setOverlayScale,
  setOverlayAutoHide,
  resetOverlayPosition,
  refreshHotkeyBinding: async () => { await refreshHotkeyBinding(); return publicSnapshot() },
  openHotkeySettings,
  copyText,
  exportPendingUploads,
  clearLocalCache,
  clearAllLocalData,
  exitStatus,
  exitApp,
  checkEventStatus,
}

window.addEventListener('load', () => void init())
