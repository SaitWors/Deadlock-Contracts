(function attachProduct(root, factory) {
  const product = factory()
  if (typeof module === 'object' && module.exports) module.exports = product
  if (root) root.DCProduct = product
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const API_VERSION = 'desktop.v1'
  const PRODUCT_CACHE_VERSION = 2
  const MODES = ['STANDARD', 'RANKED', 'STREET_BRAWL']
  const ACTIVE_BOARD_STATES = new Set(['LOCKED', 'VERIFYING', 'REVIEW_REQUIRED'])
  const FINAL_BOARD_STATES = new Set(['SETTLED', 'PARTIALLY_SETTLED', 'EXPIRED'])
  const ATTEMPT_PENDING_STATES = new Set(['VERIFYING', 'REVIEW_REQUIRED'])

  function emptyProductState(status = 'UNPAIRED') {
    return {
      cache_version: PRODUCT_CACHE_VERSION,
      api_version: API_VERSION,
      schema_version: null,
      server_features: [],
      status,
      stale: false,
      server_time: null,
      loaded_at: null,
      account: null,
      device: null,
      refresh: null,
      boards: [],
      active_cases: [],
      adaptive_profiles: {},
      progression: null,
      history: [],
      last_error: null,
    }
  }

  function cleanArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : []
  }

  function finiteOrNull(value) {
    if (value == null || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function normalizeMode(value) {
    const text = String(value || '').trim().toUpperCase().replace(/[ -]+/g, '_')
    if (!text) return null
    if (['STREET_BRAWL', 'STREETBRAWL', 'BRAWL'].includes(text)) return 'STREET_BRAWL'
    if (text === 'RANKED') return 'RANKED'
    if (['STANDARD', 'NORMAL', 'UNRANKED'].includes(text)) return 'STANDARD'
    return null
  }

  function modeLabel(value) {
    return {
      STANDARD: 'STANDARD',
      RANKED: 'RANKED',
      STREET_BRAWL: 'STREET BRAWL',
    }[normalizeMode(value)] || 'UNKNOWN MODE'
  }

  function normalizeOption(option) {
    if (!option || typeof option !== 'object') return null
    const conditions = cleanArray(option.conditions).map(condition => ({
      metric: String(condition?.metric || option.metric || ''),
      operator: String(condition?.operator || option.operator || 'gte'),
      target: Number(condition?.target ?? option.target ?? 0),
      capabilities: cleanArray(condition?.capabilities).map(String),
    })).filter(condition => condition.metric && Number.isFinite(condition.target))
    if (!conditions.length && option.metric) {
      conditions.push({
        metric: String(option.metric),
        operator: String(option.operator || 'gte'),
        target: Number(option.target || 0),
        capabilities: [],
      })
    }
    return {
      id: String(option.id || ''),
      title: String(option.title || 'UNTITLED CONTRACT'),
      description: String(option.description || ''),
      metric: String(option.metric || ''),
      operator: String(option.operator || 'gte'),
      target: Number(option.target || 0),
      reward_xp: Number(option.reward_xp || 0),
      difficulty: String(option.difficulty || 'FOCUSED').toUpperCase(),
      rarity: String(option.rarity || 'COMMON').toUpperCase(),
      category: String(option.category || 'COMBAT').toUpperCase(),
      conditions,
      generator_meta: option.generator_meta && typeof option.generator_meta === 'object' ? option.generator_meta : {},
      selected: option.selected === true,
      status: String(option.status || 'OFFERED').toUpperCase(),
      progress_current: finiteOrNull(option.progress_current),
      progress_target: finiteOrNull(option.progress_target),
      explanation: option.explanation ? String(option.explanation) : null,
      bound_match_id: option.bound_match_id == null ? null : String(option.bound_match_id),
    }
  }

  function normalizeBoard(board) {
    if (!board || typeof board !== 'object') return null
    const gameMatchMode = normalizeMode(board.game_match_mode)
    if (!gameMatchMode) return null
    return {
      id: String(board.id || ''),
      date: board.date ? String(board.date) : null,
      status: String(board.status || 'OFFERED').toUpperCase(),
      game_match_mode: gameMatchMode,
      generation: Number(board.generation || 0),
      generator_version: String(board.generator_version || ''),
      attempts_used: Number(board.attempts_used || 0),
      max_attempts: Number(board.max_attempts || 3),
      attempts_remaining: Number(board.attempts_remaining ?? Math.max(0, Number(board.max_attempts || 3) - Number(board.attempts_used || 0))),
      offered_at: board.offered_at ? String(board.offered_at) : null,
      locked_at: board.locked_at ? String(board.locked_at) : null,
      expires_at: board.expires_at ? String(board.expires_at) : null,
      daily_reset_at: board.daily_reset_at ? String(board.daily_reset_at) : null,
      next_board_ready: board.next_board_ready === true,
      options: cleanArray(board.options).map(normalizeOption).filter(Boolean),
    }
  }

  function deriveActiveCases(boards) {
    return cleanArray(boards)
      .filter(board => ACTIVE_BOARD_STATES.has(board.status))
      .map(board => ({
        board_id: board.id,
        game_match_mode: board.game_match_mode,
        status: board.status,
        locked_at: board.locked_at,
        expires_at: board.expires_at,
        attempts_used: board.attempts_used,
        max_attempts: board.max_attempts,
        attempts_remaining: board.attempts_remaining,
        options: board.options.filter(option => option.selected),
      }))
  }

  function normalizeCase(value, boards) {
    if (!value || typeof value !== 'object') return null
    const board = cleanArray(boards).find(item => item.id === String(value.board_id || value.id || ''))
    const gameMatchMode = normalizeMode(value.game_match_mode || board?.game_match_mode)
    if (!gameMatchMode) return null
    return {
      board_id: String(value.board_id || value.id || board?.id || ''),
      game_match_mode: gameMatchMode,
      status: String(value.status || board?.status || 'LOCKED').toUpperCase(),
      locked_at: value.locked_at || board?.locked_at || null,
      expires_at: value.expires_at || value.case_expires_at || board?.expires_at || null,
      attempts_used: Number(value.attempts_used ?? board?.attempts_used ?? 0),
      max_attempts: Number(value.max_attempts ?? board?.max_attempts ?? 3),
      attempts_remaining: Number(value.attempts_remaining ?? board?.attempts_remaining ?? 3),
      options: cleanArray(value.options || board?.options).map(normalizeOption).filter(option => option?.selected !== false),
    }
  }

  function normalizeAdaptiveProfile(profile, fallbackMode = null) {
    if (!profile || typeof profile !== 'object') return null
    const mode = normalizeMode(profile.mode || fallbackMode)
    if (!mode) return null
    const metrics = {}
    if (profile.metrics && typeof profile.metrics === 'object') {
      for (const [metric, raw] of Object.entries(profile.metrics)) {
        if (!raw || typeof raw !== 'object') continue
        metrics[String(metric)] = {
          n: Math.max(0, finiteOrNull(raw.n) ?? 0),
          median: finiteOrNull(raw.median),
          p25: finiteOrNull(raw.p25),
          p60: finiteOrNull(raw.p60),
          p75: finiteOrNull(raw.p75),
          best: finiteOrNull(raw.best),
        }
      }
    }
    return {
      version: String(profile.version || ''),
      mode,
      sample_size: Math.max(0, finiteOrNull(profile.sample_size) ?? 0),
      confidence: String(profile.confidence || 'COLD_START').toUpperCase(),
      metrics,
    }
  }

  function normalizeEvaluation(value) {
    if (!value || typeof value !== 'object') return null
    return {
      id: String(value.id || ''),
      status: String(value.status || '').toUpperCase(),
      revision: Number(value.revision || 0),
      match_id: value.match_id == null ? null : String(value.match_id),
      match_started_at: value.match_started_at ? String(value.match_started_at) : null,
      match_ended_at: value.match_ended_at ? String(value.match_ended_at) : null,
      evidence_level: value.evidence_level ? String(value.evidence_level) : null,
      evaluator_version: value.evaluator_version ? String(value.evaluator_version) : null,
      progress_current: finiteOrNull(value.progress_current),
      progress_target: finiteOrNull(value.progress_target),
      score: finiteOrNull(value.score),
      explanation: value.explanation ? String(value.explanation) : null,
      created_at: value.created_at ? String(value.created_at) : null,
    }
  }

  function normalizeHistoryItem(item) {
    if (!item || typeof item !== 'object') return null
    return {
      ...item,
      assignment_id: String(item.assignment_id || ''),
      board_id: String(item.board_id || ''),
      game_match_mode: normalizeMode(item.game_match_mode),
      board_status: String(item.board_status || '').toUpperCase(),
      status: String(item.status || '').toUpperCase(),
      reward_xp: Number(item.reward_xp || 0),
      reward_granted_xp: Number(item.reward_granted_xp || 0),
      reward_granted_at: item.reward_granted_at ? String(item.reward_granted_at) : null,
      attempts_used: Number(item.attempts_used || 0),
      max_attempts: Number(item.max_attempts || 3),
      progress_current: finiteOrNull(item.progress_current),
      progress_target: finiteOrNull(item.progress_target),
      match_id: item.match_id == null ? null : String(item.match_id),
      match_started_at: item.match_started_at ? String(item.match_started_at) : null,
      match_ended_at: item.match_ended_at ? String(item.match_ended_at) : null,
      last_attempt_match_id: item.last_attempt_match_id == null ? null : String(item.last_attempt_match_id),
      latest_evaluation: normalizeEvaluation(item.latest_evaluation),
      locked_at: item.locked_at ? String(item.locked_at) : null,
      settled_at: item.settled_at ? String(item.settled_at) : null,
    }
  }

  function normalizeBootstrap(payload, loadedAt = new Date().toISOString()) {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid Desktop API response')
    if (payload.api_version && payload.api_version !== API_VERSION) {
      const error = new Error(`Unsupported Desktop API: ${payload.api_version}`)
      error.code = 'API_VERSION_MISMATCH'
      throw error
    }
    const boards = cleanArray(payload.boards).map(normalizeBoard).filter(Boolean)
    const suppliedCases = cleanArray(payload.active_cases).map(item => normalizeCase(item, boards)).filter(Boolean)
    const history = cleanArray(payload.history?.items || payload.history).map(normalizeHistoryItem).filter(Boolean)
    const adaptiveProfiles = {}
    if (payload.adaptive_profiles && typeof payload.adaptive_profiles === 'object') {
      for (const mode of MODES) {
        const profile = normalizeAdaptiveProfile(payload.adaptive_profiles[mode], mode)
        if (profile) adaptiveProfiles[mode] = profile
      }
    }
    return {
      cache_version: PRODUCT_CACHE_VERSION,
      api_version: payload.api_version || API_VERSION,
      schema_version: Number(payload.schema_version || 1),
      server_features: cleanArray(payload.desktop_features).map(String),
      status: 'ONLINE',
      stale: false,
      server_time: payload.server_time ? String(payload.server_time) : null,
      loaded_at: loadedAt,
      account: payload.account && typeof payload.account === 'object' ? { ...payload.account } : null,
      device: payload.device && typeof payload.device === 'object' ? { ...payload.device } : null,
      refresh: payload.refresh && typeof payload.refresh === 'object' ? { ...payload.refresh } : null,
      boards,
      active_cases: suppliedCases.length ? suppliedCases : deriveActiveCases(boards),
      adaptive_profiles: adaptiveProfiles,
      progression: payload.progression && typeof payload.progression === 'object' ? { ...payload.progression } : null,
      history,
      last_error: null,
    }
  }

  function boardForMode(product, mode) {
    const normalized = normalizeMode(mode)
    return cleanArray(product?.boards).find(board => board.game_match_mode === normalized) || null
  }

  function activeCaseFor(product, mode) {
    const cases = cleanArray(product?.active_cases)
    const normalized = normalizeMode(mode)
    return (normalized && cases.find(item => item.game_match_mode === normalized)) || cases[0] || null
  }

  function selectedContracts(activeCase) {
    return cleanArray(activeCase?.options)
      .filter(option => option?.selected !== false)
      .slice(0, 3)
  }

  function adaptiveProfileFor(product, mode) {
    const normalized = normalizeMode(mode)
    if (!normalized) return null
    return product?.adaptive_profiles?.[normalized] || null
  }

  function profileMetric(profile, metric) {
    return profile?.metrics?.[String(metric || '')] || null
  }

  function metricKey(metric) {
    return {
      'player.kills': 'kills',
      'player.deaths': 'deaths',
      'player.assists': 'assists',
      'player.hero_damage': 'hero_damage',
      'player.object_damage': 'object_damage',
      'player.healing': 'healing',
      'player.scoreboard_healing': 'healing',
      'player.net_worth.final': 'souls',
      'match.duration_s': 'match_clock_s',
    }[String(metric || '')] || null
  }

  function metricLabel(metric, lang = 'en') {
    const labels = {
      en: {
        'player.kills': 'KILLS', 'player.deaths': 'DEATHS', 'player.assists': 'ASSISTS',
        'player.kda': 'KDA', 'player.hero_damage': 'HERO DAMAGE', 'player.object_damage': 'OBJECT DAMAGE',
        'player.healing': 'HEALING', 'player.scoreboard_healing': 'SCOREBOARD HEALING',
        'player.net_worth.final': 'FINAL SOULS', 'match.duration_s': 'MATCH DURATION', 'match.win': 'MATCH WIN',
      },
      ru: {
        'player.kills': 'УБИЙСТВА', 'player.deaths': 'СМЕРТИ', 'player.assists': 'ПОМОЩЬ',
        'player.kda': 'KDA', 'player.hero_damage': 'УРОН ГЕРОЯМ', 'player.object_damage': 'УРОН ОБЪЕКТАМ',
        'player.healing': 'ЛЕЧЕНИЕ', 'player.scoreboard_healing': 'ЛЕЧЕНИЕ ПО ТАБЛИЦЕ',
        'player.net_worth.final': 'ДУШИ В ФИНАЛЕ', 'match.duration_s': 'ДЛИТЕЛЬНОСТЬ', 'match.win': 'ПОБЕДА',
      },
    }
    return labels[lang]?.[metric] || labels.en[metric] || String(metric || 'OBJECTIVE').replace(/[._]/g, ' ').toUpperCase()
  }

  function liveMetricValue(condition, snapshot) {
    const metric = String(condition?.metric || '')
    const evidence = snapshot?.evidence || {}
    if (metric === 'player.kda') {
      const kills = Number(evidence.kills)
      const assists = Number(evidence.assists)
      const deaths = Number(evidence.deaths)
      if (![kills, assists, deaths].every(Number.isFinite)) return null
      return Math.round(((kills + assists) / Math.max(1, deaths)) * 100) / 100
    }
    if (metric === 'match.win') {
      const result = String(snapshot?.result_label || '').toUpperCase()
      if (['WIN', 'VICTORY'].includes(result)) return 1
      if (['LOSS', 'DEFEAT'].includes(result)) return 0
      return null
    }
    const key = metricKey(metric)
    const value = key === 'match_clock_s' ? snapshot?.match_clock_s : evidence[key]
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function compare(value, operator, target) {
    if (!Number.isFinite(value) || !Number.isFinite(target)) return null
    if (operator === 'lte') return value <= target
    if (operator === 'eq') return value === target
    return value >= target
  }

  function conditionProgress(condition, snapshot) {
    const value = liveMetricValue(condition, snapshot)
    const target = Number(condition?.target)
    const operator = String(condition?.operator || 'gte')
    const supported = condition?.metric === 'player.kda' || condition?.metric === 'match.win' || !!metricKey(condition?.metric)
    let percent = 0
    if (Number.isFinite(value) && Number.isFinite(target)) {
      percent = operator === 'lte'
        ? (value <= target ? 100 : Math.max(0, (target / Math.max(1, value)) * 100))
        : (target <= 0 ? 100 : Math.max(0, (value / target) * 100))
    }
    return {
      supported,
      known: Number.isFinite(value),
      value,
      target,
      operator,
      percent: Math.min(100, Math.round(percent)),
      provisional_pass: compare(value, operator, target),
    }
  }

  function attemptMatchId(item) {
    return item?.last_attempt_match_id || item?.match_id || item?.latest_evaluation?.match_id || null
  }

  function attemptStatus(item) {
    const matchId = attemptMatchId(item)
    if (!matchId) return String(item?.status || '').toUpperCase()
    const currentMatch = item?.match_id != null && String(item.match_id) === String(matchId)
    if (currentMatch && ATTEMPT_PENDING_STATES.has(String(item?.status || '').toUpperCase())) {
      return String(item.status).toUpperCase()
    }
    const evaluation = item?.latest_evaluation
    if (evaluation?.match_id != null && String(evaluation.match_id) === String(matchId) && evaluation.status) {
      return String(evaluation.status).toUpperCase()
    }
    return String(item?.status || '').toUpperCase()
  }

  function attemptTimestamp(item) {
    const matchId = attemptMatchId(item)
    const currentMatch = item?.match_id != null && String(item.match_id) === String(matchId)
    const evaluation = item?.latest_evaluation
    const evaluationMatches = evaluation?.match_id != null && String(evaluation.match_id) === String(matchId)
    return (currentMatch && (item.match_ended_at || item.match_started_at))
      || (evaluationMatches && (evaluation.match_ended_at || evaluation.match_started_at || evaluation.created_at))
      || item?.settled_at
      || item?.reward_granted_at
      || item?.locked_at
      || null
  }

  function verdictGroups(history) {
    const groups = new Map()
    for (const item of cleanArray(history)) {
      const matchId = attemptMatchId(item)
      if (!matchId) continue
      const key = String(matchId)
      if (!groups.has(key)) {
        groups.set(key, {
          match_id: key,
          game_match_mode: normalizeMode(item.game_match_mode),
          at: attemptTimestamp(item),
          items: [],
          reward_granted_xp: 0,
        })
      }
      const group = groups.get(key)
      const status = attemptStatus(item)
      group.items.push({ ...item, attempt_status: status })
      group.reward_granted_xp += Number(item.reward_granted_xp || 0)
      const timestamp = attemptTimestamp(item)
      if (timestamp && (!group.at || new Date(timestamp).getTime() > new Date(group.at).getTime())) group.at = timestamp
    }

    const rows = [...groups.values()].map(group => {
      const statuses = group.items.map(item => item.attempt_status)
      const counts = {
        completed: statuses.filter(status => status === 'COMPLETED').length,
        failed: statuses.filter(status => status === 'FAILED').length,
        verifying: statuses.filter(status => status === 'VERIFYING').length,
        review: statuses.filter(status => status === 'REVIEW_REQUIRED').length,
        active: statuses.filter(status => status === 'LOCKED').length,
      }
      const status = counts.verifying ? 'VERIFYING'
        : counts.review ? 'REVIEW_REQUIRED'
          : counts.completed && !counts.failed ? 'COMPLETED'
            : counts.failed && !counts.completed ? 'FAILED'
              : counts.completed || counts.failed ? 'PARTIAL'
                : 'LOCKED'
      return { ...group, counts, status }
    })

    return rows.sort((a, b) => {
      const aTime = a.at ? new Date(a.at).getTime() : 0
      const bTime = b.at ? new Date(b.at).getTime() : 0
      if (aTime !== bTime) return bTime - aTime
      return Number(b.match_id) - Number(a.match_id)
    })
  }

  function latestVerdictGroup(history) {
    return verdictGroups(history)[0] || null
  }

  function isFinalBoard(board) {
    return FINAL_BOARD_STATES.has(String(board?.status || '').toUpperCase())
  }

  return {
    API_VERSION,
    PRODUCT_CACHE_VERSION,
    MODES,
    ACTIVE_BOARD_STATES,
    FINAL_BOARD_STATES,
    emptyProductState,
    normalizeMode,
    modeLabel,
    normalizeBootstrap,
    normalizeBoard,
    normalizeAdaptiveProfile,
    normalizeHistoryItem,
    deriveActiveCases,
    boardForMode,
    activeCaseFor,
    selectedContracts,
    adaptiveProfileFor,
    profileMetric,
    metricKey,
    metricLabel,
    liveMetricValue,
    conditionProgress,
    attemptMatchId,
    attemptStatus,
    attemptTimestamp,
    verdictGroups,
    latestVerdictGroup,
    isFinalBoard,
  }
})
