(function attachSchema(root, factory) {
  const release = root?.DCRelease || (typeof module === 'object' && module.exports ? require('./release-meta.js') : null)
  const api = factory(release)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCSchema = api
})(typeof window !== 'undefined' ? window : globalThis, (Release) => {
  if (!Release?.productVersion) throw new Error('Generated release metadata is missing before schema.js')
  const API_VERSION = 'desktop.v1'
  const CLIENT_VERSION = Release.productVersion
  const BOOTSTRAP_SCHEMA_VERSION = 2
  const BOOTSTRAP_COMPAT_VERSIONS = new Set([1, 2])
  const EVIDENCE_SCHEMA_VERSION = 8
  const MODES = new Set(['STANDARD','RANKED','STREET_BRAWL'])
  const OPERATORS = new Set(['gte','lte','eq'])
  const METRICS = new Set(['player.kills','player.deaths','player.assists','player.kda','player.net_worth.final','player.hero_damage','player.object_damage','player.healing','player.scoreboard_healing','match.duration_s','match.win'])
  const STATUSES = new Set(['OFFERED','LOCKED','VERIFYING','REVIEW_REQUIRED','COMPLETED','FAILED','SETTLED','PARTIAL','PARTIALLY_SETTLED','EXPIRED','VOID','SKIPPED'])
  class SchemaError extends Error { constructor(code, path, message) { super(message || code); this.name='SchemaError'; this.code=code; this.path=path } }
  function assert(condition, code, path, message) { if (!condition) throw new SchemaError(code,path,message) }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value) }
  function validateCondition(c, path='condition') {
    assert(c && typeof c === 'object' && !Array.isArray(c),'CONDITION_INVALID',path)
    assert(METRICS.has(String(c.metric||'')),'METRIC_UNSUPPORTED',`${path}.metric`)
    assert(OPERATORS.has(String(c.operator||'')),'OPERATOR_UNSUPPORTED',`${path}.operator`)
    assert(finite(c.target),'TARGET_REQUIRED',`${path}.target`)
    assert(c.target >= 0,'TARGET_NEGATIVE',`${path}.target`)
    if (c.metric === 'match.win') { assert(c.operator === 'eq' && c.target === 1,'MATCH_WIN_DOMAIN',path) }
    if (c.metric === 'match.duration_s') assert(c.target <= 21600,'DURATION_TOO_LARGE',`${path}.target`)
    return true
  }
  function validateAttempts(value, path='attempts') {
    if (!value || typeof value !== 'object') return true
    const present = ['max_attempts','attempts_used','attempts_remaining','current_attempt'].filter(key => value[key] !== undefined && value[key] !== null)
    if (!present.length) return true
    for (const key of present) assert(Number.isInteger(Number(value[key])), 'ATTEMPT_INVALID', `${path}.${key}`)
    const max = Number(value.max_attempts ?? 3)
    const used = Number(value.attempts_used ?? 0)
    const remaining = Number(value.attempts_remaining ?? (max - used))
    const current = Number(value.current_attempt ?? Math.min(max, used + 1))
    assert(max >= 1, 'ATTEMPT_MAX_INVALID', `${path}.max_attempts`)
    assert(used >= 0 && used <= max, 'ATTEMPT_USED_INVALID', `${path}.attempts_used`)
    assert(remaining >= 0 && remaining <= max, 'ATTEMPT_REMAINING_INVALID', `${path}.attempts_remaining`)
    assert(used + remaining <= max, 'ATTEMPT_RELATION_INVALID', path)
    assert(current >= 1 && current <= max, 'ATTEMPT_CURRENT_INVALID', `${path}.current_attempt`)
    return true
  }
  function validateOption(option, path='option') {
    assert(option && typeof option === 'object' && !Array.isArray(option),'OPTION_INVALID',path)
    assert(typeof option.id === 'string' && option.id.trim(),'OPTION_ID_REQUIRED',`${path}.id`)
    assert((typeof option.title_key === 'string' && option.title_key.trim()) || (option.title_i18n && typeof option.title_i18n === 'object'),'OPTION_TITLE_REQUIRED',path)
    assert(MODES.has(String(option.game_match_mode||'')),'MODE_UNSUPPORTED',`${path}.game_match_mode`)
    assert(Array.isArray(option.conditions) && option.conditions.length >= 1 && option.conditions.length <= 3,'CONDITIONS_INVALID',`${path}.conditions`)
    option.conditions.forEach((c,i)=>validateCondition(c,`${path}.conditions[${i}]`))
    assert(Number.isInteger(option.reward_xp) && option.reward_xp >= 0,'REWARD_INVALID',`${path}.reward_xp`)
    assert(STATUSES.has(String(option.status||'')),'STATUS_UNKNOWN',`${path}.status`)
    return true
  }
  function validateBootstrapV2(payload) {
    assert(payload && typeof payload === 'object' && !Array.isArray(payload),'BOOTSTRAP_INVALID','$')
    assert(payload.api_version === API_VERSION,'API_VERSION_MISMATCH','$.api_version')
    assert(Number.isInteger(payload.schema_version),'SCHEMA_VERSION_MISSING','$.schema_version')
    assert(BOOTSTRAP_COMPAT_VERSIONS.has(payload.schema_version),'SCHEMA_VERSION_UNSUPPORTED','$.schema_version')
    assert(typeof payload.server_time === 'string' && payload.server_time,'SERVER_TIME_REQUIRED','$.server_time')
    assert(Array.isArray(payload.boards),'BOARDS_REQUIRED','$.boards')
    assert(Array.isArray(payload.active_cases),'ACTIVE_CASES_REQUIRED','$.active_cases')
    assert(payload.history && typeof payload.history === 'object' && Array.isArray(payload.history.items),'HISTORY_REQUIRED','$.history.items')
    const boardIds = new Set()
    const optionIds = new Set()
    for (let i=0;i<payload.boards.length;i++) {
      const board = payload.boards[i]
      const p=`$.boards[${i}]`
      assert(board && typeof board==='object','BOARD_INVALID',p)
      assert(typeof board.id==='string' && board.id.trim(),'BOARD_ID_REQUIRED',`${p}.id`)
      assert(!boardIds.has(board.id),'BOARD_ID_DUPLICATE',`${p}.id`); boardIds.add(board.id)
      assert(MODES.has(String(board.game_match_mode||'')),'MODE_UNSUPPORTED',`${p}.game_match_mode`)
      assert(Array.isArray(board.options), 'BOARD_OPTIONS_REQUIRED', `${p}.options`)
      validateAttempts(board, p)
      const localIds = new Set()
      for (let j=0;j<board.options.length;j++) {
        const option={...board.options[j],game_match_mode:board.options[j]?.game_match_mode || board.game_match_mode}
        validateOption(option,`${p}.options[${j}]`)
        assert(!localIds.has(option.id),'OPTION_ID_DUPLICATE',`${p}.options[${j}].id`); localIds.add(option.id); optionIds.add(option.id)
      }
    }
    const activeModes = new Set()
    for (let i=0;i<payload.active_cases.length;i++) {
      const item=payload.active_cases[i]; const p=`$.active_cases[${i}]`
      assert(item && typeof item==='object','ACTIVE_CASE_INVALID',p)
      assert(MODES.has(String(item.game_match_mode||'')),'MODE_UNSUPPORTED',`${p}.game_match_mode`)
      assert(!activeModes.has(item.game_match_mode),'ACTIVE_CASE_MODE_DUPLICATE',`${p}.game_match_mode`); activeModes.add(item.game_match_mode)
      validateAttempts(item, p)
      const boardId=String(item.board_id||item.id||'')
      const board=payload.boards.find(candidate=>String(candidate?.id||'')===boardId && String(candidate?.game_match_mode||'')===String(item.game_match_mode||''))
      assert(!!board,'ACTIVE_CASE_BOARD_NOT_FOUND',`${p}.board_id`)
      const boardOptionIds=new Set((Array.isArray(board?.options)?board.options:[]).map(option=>String(option?.id||'')))
      const options = Array.isArray(item.options) ? item.options : []
      for (let j=0;j<options.length;j++) {
        const option={...options[j], game_match_mode:options[j]?.game_match_mode || item.game_match_mode}
        validateOption(option, `${p}.options[${j}]`)
        assert(boardOptionIds.has(String(option.id||'')),'ACTIVE_CASE_OPTION_NOT_IN_BOARD',`${p}.options[${j}].id`)
      }
    }
    return true
  }
  const validateBootstrap = validateBootstrapV2
  function validateEvidenceV8(payload, {final=false}={}) {
    assert(payload && typeof payload==='object','EVIDENCE_INVALID','$')
    assert(payload.schema_version === EVIDENCE_SCHEMA_VERSION,'EVIDENCE_SCHEMA_UNSUPPORTED','$.schema_version')
    assert(payload.client_version === CLIENT_VERSION,'CLIENT_VERSION_UNSUPPORTED','$.client_version')
    assert(typeof payload.device_id==='string' && payload.device_id,'DEVICE_ID_REQUIRED','$.device_id')
    assert(['game_started','game_stopped','match_started','phase_changed','heartbeat','match_ended','interrupted'].includes(String(payload.event_type||'')),'EVENT_TYPE_UNSUPPORTED','$.event_type')
    assert(typeof payload.session_id==='string' && payload.session_id,'SESSION_ID_REQUIRED','$.session_id')
    assert(typeof payload.idempotency_key==='string' && payload.idempotency_key,'IDEMPOTENCY_KEY_REQUIRED','$.idempotency_key')
    assert(Number.isInteger(payload.sequence) && payload.sequence > 0,'SEQUENCE_REQUIRED','$.sequence')
    assert(typeof payload.observed_at==='string' && payload.observed_at,'OBSERVED_AT_REQUIRED','$.observed_at')
    if (final || payload.event_type === 'match_ended') {
      assert(payload.match_id !== null && payload.match_id !== undefined && String(payload.match_id).trim(),'MISSING_MATCH_ID','$.match_id')
      assert(Number(payload.match_clock_s) > 0,'MATCH_CLOCK_REQUIRED','$.match_clock_s')
      assert(payload.terminal_proof && typeof payload.terminal_proof.type==='string' && payload.terminal_proof.type,'TERMINAL_PROOF_REQUIRED','$.terminal_proof.type')
      assert(typeof payload.terminal_proof.observed_at==='string' && payload.terminal_proof.observed_at,'TERMINAL_PROOF_TIME_REQUIRED','$.terminal_proof.observed_at')
    }
    return true
  }
  function normalizeError(error) { return {code:String(error?.code || error?.name || 'UNKNOWN_ERROR'), path:error?.path || null, message:String(error?.message || error)} }
  return {API_VERSION, CLIENT_VERSION, BOOTSTRAP_SCHEMA_VERSION, BOOTSTRAP_COMPAT_VERSIONS, EVIDENCE_SCHEMA_VERSION, MODES, OPERATORS, METRICS, STATUSES, SchemaError, assert, validateAttempts, validateCondition, validateOption, validateBootstrap, validateBootstrapV2, validateEvidenceV8, normalizeError}
})
