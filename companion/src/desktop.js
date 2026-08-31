(() => {
  const { t, localizeServerText, formatNumber, formatDateTime, preference, language, setPreference } = window.DCShared
  const Product = window.DCProduct
  const Storage = window.DCStorage
  const OFFICIAL_SITE = 'https://deadlock-contracts.online'
  const MCG_URL = 'https://t.me/MandarinCreatorGroup'
  const HOTKEY_URL = 'overwolf://settings/games-overlay?hotkey=toggle_contract_overlay&gameId=24482'
  const FTUE_KEY = 'dc.desktop.ftue.v2'
  const DEBRIEF_SEEN_KEY = 'dc.desktop.debrief.seen.v1'
  const DRAFT_KEY = 'dc.desktop.contract-drafts.v1'
  const FTUE_STORAGE_VERSION = 1
  const PREVIEW = typeof overwolf === 'undefined' && new URLSearchParams(location.search).get('preview') === '1'

  const fallback = {
    version: window.DCRelease?.productVersion || 'UNKNOWN', paired: false, account: null, game_running: false, steam_id64: null, steam_id_masked: '—',
    game_state_observed_at: null, game_state_confirmed: false, identity_ok: null, phase: null, phase_display: '—', mode_display: '—', match_id: null,
    session: null, lifecycle: null, evidence: {}, evidence_revision: 0, match_clock_s: null, queue_count: 0, queue: {items:0,dead_letter:0,last_ack_at:null}, last_upload_status: '—', gep_settlement: null,
    gep_version: null, gep_public_version: null, gep_updated: null, gep_feature_health: { status: 'WAITING', attempts: 0, last_error: null }, health: {}, pairing_error: null, last_error: '', overlay_scale: 'compact', overlay_auto_hide_ms: 10000, hotkey_binding: 'Ctrl+Shift+C',
    product: Product.emptyProductState(),
  }

  let backgroundWindow = null
  let currentWindowId = null
  let snapshot = structuredCloneSafe(fallback)
  let activeMode = 'STANDARD'
  let activeCaseMode = null
  let lastAutoDetectedMode = null
  let historyFilter = 'ALL'
  let busy = false
  let previewPromise = null
  let productSignature = ''
  let liveSignature = ''
  let modalResolve = null
  let modalReturnFocus = null
  function readSeenDebriefId() {
    const verified = Storage?.readJson?.(DEBRIEF_SEEN_KEY, { schemaVersion: 1 })
    if (verified?.ok && !verified.missing) return String(verified.value || '')
    const legacy = typeof localStorage !== 'undefined' ? localStorage.getItem(DEBRIEF_SEEN_KEY) : null
    return legacy && !String(legacy).startsWith('{') ? String(legacy) : ''
  }
  let lastNotifiedDebriefId = readSeenDebriefId()
  const selections = new Map(Product.MODES.map(mode => [mode, new Set()]))
  const draftState = (() => {
    const result = Storage?.readJson?.(DRAFT_KEY, { schemaVersion: 1 })
    return result?.ok && result.value && typeof result.value === 'object' ? result.value : {}
  })()
  const draftAppliedBoards = new Set()

  const $ = id => document.getElementById(id)
  const all = selector => [...document.querySelectorAll(selector)]
  const ui = (english, russian) => window.DCI18n?.literal?.(english, russian, language()) || (language() === 'ru' ? russian : english)
  const optionTitle = option => Product.contractTitle(option, language())
  const optionDescription = (option, mode) => Product.contractDescription(option, mode, language())

  function structuredCloneSafe(value) {
    try { return JSON.parse(JSON.stringify(value)) } catch (_) { return value }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character])
  }

  function controller() {
    if (!backgroundWindow && typeof overwolf !== 'undefined') {
      try { backgroundWindow = overwolf.windows.getMainWindow() } catch (_) { backgroundWindow = null }
    }
    return backgroundWindow?.dcCompanion || null
  }

  async function call(name, ...args) {
    const api = controller()
    if (!api || typeof api[name] !== 'function') throw new Error('Background controller is not ready yet.')
    return await api[name](...args)
  }

  function openExternal(url) {
    if (typeof overwolf !== 'undefined' && overwolf.utils?.openUrlInDefaultBrowser) {
      overwolf.utils.openUrlInDefaultBrowser(url)
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function setText(id, value) {
    const element = $(id)
    if (element) element.textContent = value == null || value === '' ? '—' : String(value)
  }

  function formatClock(seconds) {
    const total = Number(seconds)
    if (!Number.isFinite(total) || total < 0) return '—'
    return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`
  }

  function formatRelativeSync(value) {
    if (!value) return '—'
    const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
    if (!Number.isFinite(elapsed)) return '—'
    if (elapsed < 60000) return language() === 'ru' ? 'только что' : 'just now'
    const minutes = Math.floor(elapsed / 60000)
    if (minutes < 60) return language() === 'ru' ? `${minutes} мин назад` : `${minutes}m ago`
    return formatDateTime(value)
  }

  async function copyText(text) {
    const value = String(text || '')
    try {
      return await call('copyText', value)
    } catch (error) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return { ok: true }
      }
      throw error
    }
  }


  function toast(title, message = '', kind = 'success') {
    const element = document.createElement('div')
    element.className = `toast ${kind === 'error' ? 'error' : ''}`
    element.innerHTML = `<div></div><div><b>${escapeHtml(title)}</b>${message ? `<span>${escapeHtml(message)}</span>` : ''}</div>`
    $('toastRegion').appendChild(element)
    setTimeout(() => element.remove(), 4400)
  }

  function setBusy(value) {
    busy = !!value
    $('workspace').classList.toggle('busy', busy)
    all('#view-contracts button, #view-settings button').forEach(button => { button.disabled = busy || button.dataset.baseDisabled === '1' })
    syncDesktopAdSlot()
  }

  function isSafeDesktopAdMoment() {
    const gepStatus = String(snapshot.health?.gep?.status || '')
    // Fail closed on unknown/stale state. Ads are never eligible while Deadlock
    // is running in the initial QA channel.
    if (!['LIVE', 'LAGGING', 'NO_MATCH'].includes(gepStatus)) return false
    return snapshot.game_running === false
  }

  function syncDesktopAdSlot() {
    const hqIsOpen = $('view-hq')?.classList.contains('active')
    const ftueIsClosed = $('ftue')?.hidden === true
    const modalIsClosed = $('confirmModal')?.hidden === true && !modalResolve
    const productReady = snapshot.product?.status === 'ONLINE'
      && ((snapshot.product?.boards?.length || 0) > 0 || (snapshot.product?.active_cases?.length || 0) > 0)
    const serverAllowsAds = snapshot.product?.server_features?.includes('desktop_ads_v1') === true
    const eligible = serverAllowsAds
      && !!snapshot.paired
      && hqIsOpen
      && ftueIsClosed
      && modalIsClosed
      && !busy
      && navigator.onLine !== false
      && document.visibilityState === 'visible'
      && productReady
      && isSafeDesktopAdMoment()
    window.DCDesktopAds?.setEligible(eligible)
  }

  function setView(name) {
    all('[data-view]').forEach(view => view.classList.toggle('active', view.dataset.view === name))
    all('.side-nav [data-view-target]').forEach(button => button.classList.toggle('active', button.dataset.viewTarget === name))
    if (name === 'active') renderActiveCase()
    if (name === 'contracts') renderContracts()
    if (name === 'debrief') {
      const detectedLiveMode = Product.normalizeMode(snapshot.mode_display)
    if (snapshot.game_running && detectedLiveMode) {
      if (detectedLiveMode !== lastAutoDetectedMode) {
        activeMode = detectedLiveMode
        activeCaseMode = detectedLiveMode
        lastAutoDetectedMode = detectedLiveMode
      }
    } else if (!snapshot.game_running) {
      lastAutoDetectedMode = null
    }
    const latest = Product.latestVerdictGroup(snapshot.product?.history || [])
      if (latest?.match_id) {
        Storage?.writeJson?.(DEBRIEF_SEEN_KEY, String(latest.match_id), { schemaVersion: 1 })
        lastNotifiedDebriefId = String(latest.match_id)
      }
      renderDebrief()
      renderHq()
    }
    syncDesktopAdSlot()
  }

  function statusLabel(status) {
    return {
      OFFERED: t('offered'), LOCKED: t('locked'), VERIFYING: t('verifying'), REVIEW_REQUIRED: t('reviewRequired'),
      COMPLETED: t('completed'), FAILED: t('failed'), PARTIAL: t('partial'), SETTLED: t('completed'), PARTIALLY_SETTLED: t('partial'),
      ONLINE: t('online'), OFFLINE: t('offline'), DEGRADED: t('degraded'), INCOMPATIBLE: t('incompatible'),
      UNPAIRED: t('unpaired'), CONNECTING: t('waiting'), PENDING: t('verifying'), VOID: t('voidStatus'), EXPIRED: t('expired'), ISSUED_ACTIVE: 'ACTIVE', ISSUED_QUEUED: 'QUEUED', INELIGIBLE: 'INELIGIBLE', CONSUMED: 'SETTLED', CONSUMED_QUEUED: 'QUEUED',
    }[String(status || '').toUpperCase()] || (status ? t('unknownServerStatus') : '—')
  }

  function statusClass(status) {
    const value = String(status || '').toUpperCase()
    if (['ONLINE', 'COMPLETED', 'SETTLED'].includes(value)) return 'good'
    if (['VERIFYING', 'REVIEW_REQUIRED', 'LOCKED', 'CONNECTING', 'PARTIALLY_SETTLED', 'PARTIAL'].includes(value)) return 'warn'
    if (['FAILED', 'INCOMPATIBLE'].includes(value)) return 'bad'
    return ''
  }

  function operatorSymbol(operator) {
    return operator === 'lte' ? '≤' : operator === 'eq' ? '=' : '≥'
  }

  function formatConditionValue(condition, value) {
    if (value == null || !Number.isFinite(Number(value))) return '—'
    if (condition.metric === 'match.duration_s') return formatClock(value)
    if (condition.metric === 'match.win') return Number(value) === 1 ? 'WIN' : 'LOSS'
    return formatNumber(value, condition.metric === 'player.kda' ? 2 : 0)
  }

  function conditionLabel(condition) {
    const metric = Product.metricLabel(condition.metric, language())
    const target = condition.metric === 'match.win' ? 'WIN' : formatConditionValue(condition, condition.target)
    return `${metric} ${condition.metric === 'match.win' ? '' : operatorSymbol(condition.operator)} ${target}`.trim()
  }

  function adaptiveInfo(option) {
    const value = option?.generator_meta?.adaptive
    return value && typeof value === 'object' ? value : null
  }

  function adaptiveKindLabel(kind) {
    return ({
      COLD_START: t('adaptiveCold'),
      CONSISTENCY: t('adaptiveConsistency'),
      CHALLENGE: t('adaptiveChallenge'),
      MASTERY: t('adaptiveMastery'),
      BREAK_THE_HABIT: t('adaptiveHabit'),
      WILDCARD: t('adaptiveWildcard'),
    })[String(kind || '').toUpperCase()] || String(kind || '').replaceAll('_', ' ')
  }

  function contractHeader(option) {
    const adaptive = adaptiveInfo(option)
    if (adaptive?.enabled) return `${t('personalized')} / ${adaptiveKindLabel(adaptive.kind)}`
    if (adaptive?.kind === 'WILDCARD') return `${adaptiveKindLabel(adaptive.kind)} / ${option.difficulty}`
    return `${option.category} / ${option.difficulty}`
  }

  function adaptiveWhyHtml(option) {
    const adaptive = adaptiveInfo(option)
    if (!adaptive?.enabled) return ''
    const rows = Array.isArray(adaptive.basis) ? adaptive.basis : []
    const sample = Number(adaptive.sample_size || 0)
    const intro = language() === 'ru'
      ? `Основано на ${sample} ${t('recentMatches')}. Уровень данных: ${String(adaptive.confidence || '—')}.`
      : `Based on ${sample} ${t('recentMatches')}. Data confidence: ${String(adaptive.confidence || '—')}.`
    const facts = rows.map(row => {
      const metric = Product.metricLabel(row.metric, language())
      const median = row.median == null ? '—' : formatConditionValue({ metric: row.metric }, row.median)
      const target = row.target == null ? '—' : formatConditionValue({ metric: row.metric }, row.target)
      const sourceKey = String(row.source || '').toLowerCase()
      const sourceValue = row[sourceKey] == null ? null : formatConditionValue({ metric: row.metric }, row[sourceKey])
      const basis = sourceValue ? `${sourceKey.toUpperCase()} ${sourceValue}` : `${t('median')} ${median}`
      return `<span><b>${escapeHtml(metric)}</b><em>${escapeHtml(`${basis} → ${language() === 'ru' ? 'цель' : 'target'} ${target}`)}</em></span>`
    }).join('')
    return `<details class="adaptive-why"><summary>${escapeHtml(t('whyContract'))}</summary><p>${escapeHtml(intro)}</p>${facts ? `<div>${facts}</div>` : ''}</details>`
  }

  function renderSystemStatus() {
    const product = snapshot.product || Product.emptyProductState()
    const game = !!snapshot.game_running
    const serverStatus = snapshot.paired ? product.status || 'CONNECTING' : 'UNPAIRED'
    const serverChip = $('topServerStatus')
    serverChip.className = `status-chip ${statusClass(serverStatus)}`
    serverChip.innerHTML = `<i></i><b>${escapeHtml(t('server'))}</b><em>${escapeHtml(statusLabel(serverStatus))}</em>`
    const gameChip = $('topGameStatus')
    gameChip.className = `status-chip ${game ? 'good' : ''}`
    gameChip.innerHTML = `<i></i><b>${escapeHtml(t('deadlock'))}</b><em>${escapeHtml(game ? t('running') : t('notRunning'))}</em>`

    const productError = localizeServerText(product.last_error?.message)
    const networkOffline = navigator.onLine === false || product.status === 'OFFLINE'
    const incompatible = product.status === 'INCOMPATIBLE'
    const degraded = product.status === 'DEGRADED'
    $('offlineBar').hidden = !(networkOffline || incompatible || degraded)
    if (networkOffline) {
      setText('offlineTitle', ui('OFFLINE MODE', 'ОФЛАЙН-РЕЖИМ'))
      setText('offlineCopy', language() === 'ru' ? 'GEP продолжает работу локально. Серверные действия возобновятся после подключения.' : 'Live GEP continues locally. Server actions will resume after reconnection.')
    } else if (incompatible) {
      setText('offlineTitle', t('incompatible'))
      setText('offlineCopy', productError || ui('Desktop API v1 must be deployed before this build can be submitted.', 'Перед отправкой этой сборки необходимо развернуть Desktop API v1.'))
    } else if (degraded) {
      setText('offlineTitle', t('degraded'))
      setText('offlineCopy', productError || ui('Server data could not be refreshed. Cached data is marked as stale.', 'Не удалось обновить серверные данные. Кэш помечен как устаревший.'))
    }
  }

  function renderTelemetry() {
    const product = snapshot.product || Product.emptyProductState()
    const evidence = snapshot.evidence || {}
    const game = !!snapshot.game_running
    const gepStatus = String(snapshot.health?.gep?.status || '')
    const gepReady = ['LIVE','LAGGING','NO_MATCH','PAUSED','STARTING'].includes(gepStatus) || !!snapshot.gep_version || (Array.isArray(snapshot.features) && snapshot.features.length > 0)
    const accountSteam = String(snapshot.account?.steam_id64 || snapshot.product?.account?.steam_id64 || '')
    const identity = snapshot.steam_id64 && accountSteam ? String(snapshot.steam_id64) === accountSteam : null

    renderSystemStatus()
    setText('hqGame', game ? t('running') : t('notRunning'))
    setText('hqPhase', `${ui('Phase', 'Фаза')}: ${snapshot.phase_display || snapshot.phase || '—'}`)
    setText('hqGep', gepReady ? t('online') : t('waiting'))
    setText('hqGepVersion', `${ui('Version', 'Версия')}: ${snapshot.gep_version || '—'}`)
    setText('hqIdentity', identity === true ? t('verified') : identity === false ? t('mismatch') : t('waiting'))
    setText('hqSteam', `Steam: ${snapshot.steam_id_masked || '—'}`)
    setText('hqServer', snapshot.paired ? statusLabel(product.status) : t('unpaired'))
    setText('hqServerTime', `${product.stale ? `${t('staleCache')} · ` : ''}${t('updated')}: ${formatRelativeSync(product.loaded_at)}`)

    const gepProblem = ['STALE','UNAVAILABLE'].includes(gepStatus)
    $('gepAlert').hidden = !gepProblem
    if (gepProblem) setText('gepAlertText', snapshot.health?.gep?.message || ui('Live data is stale or unavailable. Final server verification remains authoritative.', 'Live-данные устарели или недоступны. Финальная серверная проверка остаётся источником истины.'))

    setText('activeMatchTitle', game ? (snapshot.match_id ? `${ui('MATCH', 'МАТЧ')} #${snapshot.match_id}` : ui('DEADLOCK DETECTED', 'DEADLOCK ОБНАРУЖЕН')) : ui('WAITING FOR DEADLOCK', 'ОЖИДАНИЕ DEADLOCK'))
    setText('activeSession', snapshot.lifecycle?.session?.session_id ? ui('ACTIVE SESSION', 'АКТИВНАЯ СЕССИЯ') : ui('NO SESSION', 'НЕТ СЕССИИ'))
    setText('statKills', formatNumber(evidence.kills))
    setText('statDeaths', formatNumber(evidence.deaths))
    setText('statAssists', formatNumber(evidence.assists))
    setText('statHealing', formatNumber(evidence.healing))
    setText('statHeroDamage', formatNumber(evidence.hero_damage))
    setText('statObjectDamage', formatNumber(evidence.object_damage))
    setText('statSouls', formatNumber(evidence.souls))
    setText('statClock', formatClock(snapshot.match_clock_s))
    renderActiveCase()
    renderSettings()
  }

  function emptyState(title, body, action = null, compact = false) {
    return `<div class="empty-state${compact ? ' compact' : ''}"><div><div class="state-symbol"><span>◇</span></div><b>${escapeHtml(title)}</b><p>${escapeHtml(body)}</p>${action ? `<button class="secondary-btn" type="button" data-empty-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>` : ''}</div></div>`
  }

  function renderHq() {
    const product = snapshot.product || Product.emptyProductState()
    const cases = product.active_cases || []
    $('navContractsCount').textContent = product.boards?.length ? String(product.boards.length) : ''
    $('navActiveCount').textContent = cases.length ? String(cases.length) : ''
    $('hqOperations').innerHTML = Product.MODES.map((mode, index) => {
      const board = Product.boardForMode(product, mode)
      const activeCase = cases.find(item => item.game_match_mode === mode)
      const available = board?.status === 'OFFERED' ? board.options?.length || 0 : 0
      const state = activeCase ? statusLabel(activeCase.status) : board ? (board.status === 'OFFERED' ? `${available} ${ui('AVAILABLE', 'ДОСТУПНО')}` : statusLabel(board.status)) : t('waiting')
      return `<article class="operation-card ${activeCase ? 'active-case' : ''}"><div><span>${Product.modeLabel(mode)} / 0${index + 1}</span><h3>${Product.modeLabel(mode)}</h3></div><b>${escapeHtml(state)}</b><button type="button" data-operation-mode="${mode}" data-operation-target="${activeCase ? 'active' : 'contracts'}">${escapeHtml(activeCase ? t('openActive') : t('openBoard'))} →</button></article>`
    }).join('')

    const active = Product.activeCaseFor(product, Product.normalizeMode(snapshot.mode_display))
    if (!active) {
      $('hqCaseStrip').innerHTML = `<div class="notice"><b>${escapeHtml(t('noActiveCase'))}</b><span>${escapeHtml(t('noActiveBody'))}</span></div>`
      return
    }
    const options = active.options || []
    const title = options[0] ? optionTitle(options[0]) : t('activeCase')
    const extra = Math.max(0, options.length - 1)
    $('hqCaseStrip').innerHTML = `<button class="case-strip-card" type="button" data-view-target="active"><span>${escapeHtml(Product.modeLabel(active.game_match_mode))}</span><h3>${escapeHtml(title)}${extra ? ` +${extra}` : ''}</h3><small>${escapeHtml(statusLabel(active.status))}</small><b>${escapeHtml(`${t('attempt')} ${active.current_attempt || 1}/${active.max_attempts}`)}</b></button>`
  }

  function renderModeTabs(rootId, selectedMode, casesOnly = false) {
    const product = snapshot.product || Product.emptyProductState()
    const cases = product.active_cases || []
    const panelId = rootId === 'modeTabs' ? 'contractBoard' : 'activeCaseContent'
    $(rootId).setAttribute('role', 'tablist')
    $(rootId).innerHTML = Product.MODES.map(mode => {
      const board = Product.boardForMode(product, mode)
      const active = cases.find(item => item.game_match_mode === mode)
      const marker = active ? '●' : casesOnly ? '' : board?.status === 'OFFERED' ? String(board.options?.length || 0) : board ? '•' : ''
      const selected = mode === selectedMode
      return `<button class="${selected ? 'active' : ''}" type="button" role="tab" aria-selected="${selected}" aria-controls="${panelId}" tabindex="${selected ? '0' : '-1'}" data-mode="${mode}">${Product.modeLabel(mode)}${marker ? `<em>${marker}</em>` : ''}</button>`
    }).join('')
  }

  function saveDrafts() {
    const result = Storage?.writeJson?.(DRAFT_KEY, draftState, { schemaVersion: 1 })
    if (result && !result.ok) toast(t('draftNotSaved'), result.code || '', 'error')
    return result
  }

  function persistSelectionDraft(board, selected) {
    if (!board?.id || board.status !== 'OFFERED') return
    draftState[board.game_match_mode] = {
      board_id: String(board.id),
      option_ids: [...selected],
      saved_at: new Date().toISOString(),
    }
    saveDrafts()
  }

  function clearSelectionDraft(mode) {
    if (!draftState[mode]) return
    delete draftState[mode]
    saveDrafts()
  }

  function reconcileSelection(board) {
    const mode = board.game_match_mode
    const selected = selections.get(mode) || new Set()
    const allowed = new Set((board.options || []).map(option => option.id))
    const draft = draftState[mode]

    if (board.status !== 'OFFERED') {
      selected.clear()
      clearSelectionDraft(mode)
      selections.set(mode, selected)
      return selected
    }

    if (draft && String(draft.board_id) !== String(board.id)) {
      selected.clear()
      clearSelectionDraft(mode)
    } else if (draft && !draftAppliedBoards.has(String(board.id))) {
      selected.clear()
      for (const id of Array.isArray(draft.option_ids) ? draft.option_ids : []) {
        if (allowed.has(String(id)) && selected.size < 3) selected.add(String(id))
      }
      draftAppliedBoards.add(String(board.id))
    }

    for (const id of [...selected]) if (!allowed.has(id)) selected.delete(id)
    selections.set(mode, selected)
    return selected
  }

  function adaptiveMetricValue(metric, value) {
    if (value == null || !Number.isFinite(Number(value))) return '—'
    return formatConditionValue({ metric }, value)
  }

  function renderAdaptiveIntel() {
    const product = snapshot.product || Product.emptyProductState()
    if (snapshot.paired && product.status === 'ONLINE' && !product.server_features?.includes('adaptive_profiles_v1')) {
      $('adaptiveIntel').innerHTML = `<div><span>${escapeHtml(t('personalIntel'))}</span><h3>${escapeHtml(t('incompatible'))}</h3><p>${escapeHtml(t('adaptiveNeedsServer'))}</p></div>`
      return
    }
    const profile = Product.adaptiveProfileFor(product, activeMode)
    if (!profile) {
      $('adaptiveIntel').innerHTML = `<div><span>${escapeHtml(t('personalIntel'))}</span><h3>${escapeHtml(t('waiting'))}</h3><p>${escapeHtml(language() === 'ru' ? 'Сервер ещё не передал adaptive profile.' : 'The server has not delivered an adaptive profile yet.')}</p></div><div class="intel-metrics"></div>`
      return
    }
    const sample = Number(profile.sample_size || 0)
    const calibrating = sample < 5
    const metrics = ['player.kills', 'player.assists', 'player.hero_damage', 'player.deaths']
    const cards = metrics.map(metric => {
      const row = Product.profileMetric(profile, metric)
      const value = row?.median
      return `<div class="intel-metric"><span>${escapeHtml(Product.metricLabel(metric, language()))}</span><b>${escapeHtml(adaptiveMetricValue(metric, value))}</b></div>`
    }).join('')
    const body = calibrating
      ? (language() === 'ru' ? `Нужно ещё ${Math.max(0, 5 - sample)} подтверждённых матчей для персонализации.` : `${Math.max(0, 5 - sample)} more verified matches are needed for personalization.`)
      : t('adaptiveBody')
    $('adaptiveIntel').innerHTML = `<div><span>${escapeHtml(t('personalIntel'))}</span><h3>${escapeHtml(`${Product.modeLabel(activeMode)} · ${calibrating ? t('calibration') : profile.confidence}`)}</h3><p>${escapeHtml(`${sample} ${t('recentMatches')} · ${body}`)}</p></div><div class="intel-metrics">${cards}</div>`
  }

  function renderContracts() {
    const product = snapshot.product || Product.emptyProductState()
    renderModeTabs('modeTabs', activeMode)
    renderAdaptiveIntel()
    const board = Product.boardForMode(product, activeMode)
    const paired = !!snapshot.paired
    const loading = paired && ['CONNECTING'].includes(product.status) && !product.loaded_at
    const selected = board ? reconcileSelection(board) : selections.get(activeMode)
    const canEdit = board?.status === 'OFFERED'
    const refresh = product.refresh || {}

    setText('boardModeTitle', `${Product.modeLabel(activeMode)} ${ui('BOARD', 'ДОСКА')}`)
    setText('boardAuthority', product.stale ? t('staleCache') : t('serverAuthority'))
    $('boardAuthority').className = `outline-badge ${product.stale ? 'warn' : product.status === 'ONLINE' ? 'good' : ''}`
    setText('boardReset', `${t('reset')} ${formatDateTime(refresh.reset_at || board?.daily_reset_at)}`)
    setText('boardMeta', board ? `${statusLabel(board.status)} · ${t('generation')} ${board.generation} · ${board.attempts_remaining}/${board.max_attempts} ${t('attempts')}` : statusLabel(product.status))
    setText('selectionCount', `${selected?.size || 0} / 3 ${t('selected')}`)
    setText('rerollBtn', t('reroll'))
    setText('lockBtn', t('lockCase'))

    const backendStatus = String(snapshot.health?.backend?.status || '')
    const gepStatus = String(snapshot.health?.gep?.status || '')
    const gepBlocksAction = !!snapshot.game_running && ['STALE', 'UNAVAILABLE'].includes(gepStatus)
    const modeKnown = !!Product.normalizeMode(activeMode)
    const serverFresh = product.status === 'ONLINE' && !product.stale && backendStatus === 'OK'
    const attemptsRemaining = Number(board?.attempts_remaining || 0)
    const rerollDisabled = busy || !canEdit || !serverFresh || gepBlocksAction || !modeKnown || attemptsRemaining <= 0 || Number(refresh.remaining || 0) < 1
    const lockDisabled = busy || !canEdit || !serverFresh || gepBlocksAction || !modeKnown || attemptsRemaining <= 0 || !selected?.size
    $('rerollBtn').disabled = rerollDisabled
    $('lockBtn').disabled = lockDisabled
    $('rerollBtn').dataset.baseDisabled = rerollDisabled ? '1' : '0'
    $('lockBtn').dataset.baseDisabled = lockDisabled ? '1' : '0'

    let actionReason = t('lockBlockedReady')
    let actionReasonClass = ''
    if (busy) { actionReason = t('lockBlockedBusy'); actionReasonClass = 'warn' }
    else if (!modeKnown) { actionReason = t('lockBlockedMode'); actionReasonClass = 'bad' }
    else if (backendStatus === 'OFFLINE') { actionReason = t('lockBlockedOffline'); actionReasonClass = 'bad' }
    else if (gepBlocksAction) { actionReason = t('lockBlockedGep'); actionReasonClass = 'bad' }
    else if (!serverFresh || product.status === 'INCOMPATIBLE') { actionReason = t('lockBlockedStale'); actionReasonClass = 'bad' }
    else if (attemptsRemaining <= 0) { actionReason = t('lockBlockedAttempts'); actionReasonClass = 'bad' }
    else if (!selected?.size) { actionReason = t('lockBlockedSelection'); actionReasonClass = 'warn' }
    if ($('boardActionReason')) {
      $('boardActionReason').textContent = actionReason
      $('boardActionReason').className = `action-reason ${actionReasonClass}`.trim()
    }

    if (!paired) {
      $('contractBoard').innerHTML = emptyState(t('pairFirst'), t('pairFirstBody'), { id: 'pair', label: t('pairNow') })
      return
    }
    if (loading) {
      $('contractBoard').innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" aria-label="Loading"></div>').join('')
      return
    }
    if (!board) {
      const message = localizeServerText(product.last_error?.message) || (language() === 'ru' ? 'Сервер не вернул доску для этого режима.' : 'The server did not return a board for this mode.')
      $('contractBoard').innerHTML = emptyState(t('noBoard'), message, { id: 'retry', label: t('retry') })
      return
    }

    $('contractBoard').innerHTML = (board.options || []).map(option => {
      const chosen = canEdit ? selected.has(option.id) : option.selected
      const classes = [`contract-card`, `rarity-${option.rarity.toLowerCase()}`, chosen ? 'selected' : '', !canEdit ? 'locked' : ''].filter(Boolean).join(' ')
      const conditions = (option.conditions || []).map(condition => `<span>${escapeHtml(conditionLabel(condition))}</span>`).join('')
      const control = canEdit
        ? `<button type="button" data-option-id="${escapeHtml(option.id)}" aria-pressed="${chosen}">${escapeHtml(chosen ? t('selected') : t('select'))}</button>`
        : `<span class="contract-status">${escapeHtml(statusLabel(option.status || board.status))}</span>`
      return `<article class="${classes}"><header><span>${escapeHtml(contractHeader(option))}</span><span>${escapeHtml(option.rarity)}</span></header><h3>${escapeHtml(optionTitle(option))}</h3><p>${escapeHtml(optionDescription(option, board.game_match_mode))}</p><div class="condition-chips">${conditions}</div>${adaptiveWhyHtml(option)}<footer><strong>${formatNumber(option.reward_xp)} XP</strong>${control}</footer></article>`
    }).join('')
  }

  function renderActiveCase() {
    const product = snapshot.product || Product.emptyProductState()
    const cases = product.active_cases || []
    const detectedMode = Product.normalizeMode(snapshot.mode_display)
    if (snapshot.game_running && detectedMode) activeCaseMode = detectedMode
    else if (!activeCaseMode || !cases.some(item => item.game_match_mode === activeCaseMode)) activeCaseMode = cases[0]?.game_match_mode || 'STANDARD'
    renderModeTabs('activeModeTabs', activeCaseMode, true)
    const active = cases.find(item => item.game_match_mode === activeCaseMode) || null
    setText('activeCaseBadge', active ? statusLabel(active.status) : t('noActiveCase'))
    $('activeCaseBadge').className = `outline-badge ${active ? statusClass(active.status) : ''}`
    if (!active) {
      $('activeCaseContent').innerHTML = emptyState(t('noActiveCase'), t('noActiveBody'), { id: 'contracts', label: t('openContracts') }, true)
      return
    }

    const liveModeMatches = !!snapshot.game_running && detectedMode === active.game_match_mode
    const providerStatus = active.provider_status && typeof active.provider_status === 'object'
      ? active.provider_status
      : null
    const queuedMatches = Array.isArray(providerStatus?.queued_matches)
      ? providerStatus.queued_matches
      : []
    const providerNotice = providerStatus?.phase === 'VERIFYING'
      ? `<div class="notice warning"><b>${escapeHtml(ui('WAITING FOR PROVIDER', 'ЖДЁМ ПОДТВЕРЖДЕНИЕ'))}</b><span>${escapeHtml(providerStatus.message || ui('The match is saved. Waiting for independent server confirmation.', 'Матч сохранён. Ждём независимое подтверждение сервера.'))}</span></div>`
      : ''
    const queueNotice = queuedMatches.length
      ? `<div class="notice warning"><b>${escapeHtml(ui('NEXT MATCH QUEUED', 'СЛЕДУЮЩИЙ МАТЧ СОХРАНЁН'))}</b><span>${escapeHtml(ui(`Match #${queuedMatches[0].match_id} is safe and will be processed after the previous attempt.`, `Матч #${queuedMatches[0].match_id} не потерян и будет обработан после предыдущей попытки.`))}</span></div>`
      : ''
    $('activeCaseContent').innerHTML = `${providerNotice}${queueNotice}${(active.options || []).map((option, index) => {
      const objectives = (option.conditions || []).map(condition => {
        const progress = Product.conditionProgress(condition, snapshot)
        const serverFinal = ['COMPLETED', 'FAILED', 'VOID'].includes(option.status)
        const useLive = liveModeMatches && progress.supported && !serverFinal
        const value = serverFinal && option.progress_current != null ? option.progress_current : useLive ? progress.value : null
        const stateText = useLive && progress.known ? t('provisional') : t('postMatch')
        const width = useLive ? progress.percent : serverFinal && option.status === 'COMPLETED' ? 100 : 0
        return `<div class="objective-row ${useLive ? '' : 'post-match'}"><div class="objective-copy"><span>${escapeHtml(Product.metricLabel(condition.metric, language()))}<small> · ${escapeHtml(stateText)}</small></span><strong><em>${escapeHtml(formatConditionValue(condition, value))}</em> ${condition.metric === 'match.win' ? '' : `/ ${escapeHtml(operatorSymbol(condition.operator))} ${escapeHtml(formatConditionValue(condition, condition.target))}`}</strong></div><progress class="progress-track" max="100" value="${Math.max(0, Math.min(100, width))}"></progress></div>`
      }).join('')
      const caseState = option.status && option.status !== 'OFFERED' ? option.status : active.status
      return `<article class="case-file"><div class="case-top"><span>${escapeHtml(`${Product.modeLabel(active.game_match_mode)} / ${ui('FILE', 'ДЕЛО')} ${String(index + 1).padStart(2, '0')}`)}</span><b>${escapeHtml(`${option.rarity} / ${formatNumber(option.reward_xp)} XP`)}</b></div><h2>${escapeHtml(optionTitle(option))}</h2><p>${escapeHtml(optionDescription(option, active.game_match_mode))}</p>${adaptiveWhyHtml(option)}<div class="objective-list">${objectives}</div><div class="case-foot"><span>${escapeHtml(liveModeMatches ? t('provisional') : statusLabel(caseState))}</span><b>${escapeHtml(`${t('attempt')} ${active.current_attempt || 1} / ${active.max_attempts}`)}</b></div></article>`
    }).join('')}`
  }

  function renderDebrief() {
    const product = snapshot.product || Product.emptyProductState()
    if (snapshot.paired && product.status === 'ONLINE' && !product.server_features?.includes('debrief_v1')) {
      setText('debriefStatus', t('incompatible'))
      $('debriefStatus').className = 'outline-badge bad'
      $('debriefContent').innerHTML = emptyState(t('incompatible'), t('debriefNeedsServer'))
      return
    }
    const group = Product.latestVerdictGroup(product.history || [])
    if (!group) {
      setText('debriefStatus', t('noDebrief'))
      $('debriefStatus').className = 'outline-badge'
      $('debriefContent').innerHTML = emptyState(t('noDebrief'), t('noDebriefBody'))
      return
    }

    setText('debriefStatus', statusLabel(group.status))
    $('debriefStatus').className = `outline-badge ${statusClass(group.status)}`
    const reward = Number(group.reward_granted_xp || 0)
    const completed = Number(group.counts?.completed || 0)
    const failed = Number(group.counts?.failed || 0)
    const pending = Number(group.counts?.verifying || 0) + Number(group.counts?.review || 0)
    const contractRows = group.items.map(item => {
      const status = String(item.attempt_status || item.status || '').toUpperCase()
      const retryableMiss = status === 'FAILED' && String(item.status || '').toUpperCase() === 'LOCKED'
      const explanation = item.latest_evaluation?.match_id === group.match_id
        ? item.latest_evaluation?.explanation
        : item.explanation
      const xp = Number(item.reward_granted_xp || 0) > 0
        ? `+${formatNumber(item.reward_granted_xp)} XP`
        : status === 'COMPLETED' ? t('xpPending') : `${formatNumber(item.reward_xp || 0)} XP`
      const label = retryableMiss ? t('attemptMissed') : statusLabel(status)
      const detail = retryableMiss ? `${localizeServerText(explanation) || ''} ${t('stillActive')}`.trim() : (localizeServerText(explanation) || '')
      return `<article class="debrief-contract ${status.toLowerCase()}"><span>${escapeHtml(label)}</span><div><h3>${escapeHtml(Product.contractTitle(item, language()))}</h3><p>${escapeHtml(detail)}</p></div><b>${escapeHtml(xp)}</b></article>`
    }).join('')

    const profile = Product.adaptiveProfileFor(product, group.game_match_mode)
    const profileMetrics = ['player.kills', 'player.assists', 'player.hero_damage'].map(metric => {
      const row = Product.profileMetric(profile, metric)
      return `<span><em>${escapeHtml(Product.metricLabel(metric, language()))}</em><b>${escapeHtml(adaptiveMetricValue(metric, row?.median))}</b></span>`
    }).join('')
    const localSameMatch = String(snapshot.finalized_match_id || snapshot.match_id || '') === String(group.match_id)
    const local = snapshot.evidence || {}
    const localHtml = localSameMatch
      ? `<article class="debrief-card"><span class="eyebrow">${escapeHtml(t('localCapture'))}</span><h3>MATCH #${escapeHtml(group.match_id)}</h3><div class="mini-kv"><span><em>${escapeHtml(t('kills'))}</em><b>${escapeHtml(formatNumber(local.kills))}</b></span><span><em>${escapeHtml(t('assists'))}</em><b>${escapeHtml(formatNumber(local.assists))}</b></span><span><em>${escapeHtml(t('heroDamage'))}</em><b>${escapeHtml(formatNumber(local.hero_damage))}</b></span><span><em>${escapeHtml(t('matchClock'))}</em><b>${escapeHtml(formatClock(snapshot.match_clock_s))}</b></span></div></article>`
      : ''
    const progression = product.progression || {}
    $('debriefContent').innerHTML = `<div class="debrief-main"><article class="debrief-summary"><header><span>${escapeHtml(`${Product.modeLabel(group.game_match_mode)} · MATCH #${group.match_id}`)}</span><b>${escapeHtml(formatDateTime(group.at))}</b></header><h2>${escapeHtml(t('latestServerResult'))}</h2><div class="debrief-score"><div><span>${escapeHtml(t('completed'))}</span><b>${completed}</b></div><div><span>${escapeHtml(t('failed'))}</span><b>${failed}</b></div><div><span>${escapeHtml(t('verifying'))}</span><b>${pending}</b></div><div class="xp"><span>${escapeHtml(t('xpGranted'))}</span><b>+${formatNumber(reward)} XP</b></div></div></article><div class="debrief-contracts">${contractRows}</div></div><aside class="debrief-side"><article class="debrief-card"><span class="eyebrow">${escapeHtml(t('personalIntel'))}</span><h3>${escapeHtml(`${Product.modeLabel(group.game_match_mode)} · ${profile?.confidence || t('waiting')}`)}</h3><div class="mini-kv"><span><em>${escapeHtml(t('sample'))}</em><b>${escapeHtml(formatNumber(profile?.sample_size || 0))}</b></span>${profileMetrics}</div></article><article class="debrief-card"><span class="eyebrow">${escapeHtml(t('progression'))}</span><h3>${escapeHtml(t('level'))} ${escapeHtml(progression.level || '—')}</h3><div class="mini-kv"><span><em>${escapeHtml(t('totalXp'))}</em><b>${escapeHtml(formatNumber(progression.total_xp))}</b></span><span><em>${escapeHtml(t('toNext'))}</em><b>${escapeHtml(formatNumber(progression.xp_to_next))} XP</b></span></div></article>${localHtml}</aside>`
  }

  function historyGroup(status) {
    const value = String(status || '').toUpperCase()
    if (value === 'COMPLETED') return 'COMPLETED'
    if (value === 'FAILED') return 'FAILED'
    if (['LOCKED', 'PENDING', 'VERIFYING', 'REVIEW_REQUIRED'].includes(value)) return 'ACTIVE'
    return value
  }

  function renderHistory() {
    const items = snapshot.product?.history || []
    const filtered = historyFilter === 'ALL' ? items : items.filter(item => historyGroup(item.status) === historyFilter)
    setText('historyTotal', `${items.length} ${t('records')}`)
    all('[data-history-filter]').forEach(button => { const selected = button.dataset.historyFilter === historyFilter; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)) })
    if (!filtered.length) {
      $('historyList').innerHTML = emptyState(t('noHistory'), t('noHistoryBody'))
      return
    }
    $('historyList').innerHTML = filtered.map(item => {
      const group = historyGroup(item.status)
      const date = item.settled_at || item.latest_evaluation?.created_at || item.locked_at
      const progress = item.progress_current == null ? '' : `${formatNumber(item.progress_current)} / ${formatNumber(item.progress_target)}`
      const granted = Number(item.reward_granted_xp || 0)
      const xp = granted > 0 ? `+${formatNumber(granted)} XP` : `${formatNumber(item.reward_xp)} XP`
      const historyMatchId = Product.attemptMatchId(item)
      return `<article class="history-row ${group.toLowerCase()}"><span>${escapeHtml(statusLabel(item.status))}</span><div><h3>${escapeHtml(Product.contractTitle(item, language()))}</h3><p>${escapeHtml(`${Product.modeLabel(item.game_match_mode)} · ${localizeServerText(item.explanation) || progress || `${t('attempt')} ${item.attempts_used || 0}/${item.max_attempts || 3}`}`)}</p></div><small>${escapeHtml(formatDateTime(date))}${historyMatchId ? `<br>${ui('MATCH', 'МАТЧ')} #${escapeHtml(historyMatchId)}` : ''}</small><b>${escapeHtml(xp)}</b></article>`
    }).join('')
  }

  function renderProfile() {
    const product = snapshot.product || Product.emptyProductState()
    const account = product.account || snapshot.account || null
    const progression = product.progression || {}
    const completed = Number(progression.contracts_completed || 0)
    const failed = Number(progression.contracts_failed || 0)
    const totalVerdicts = completed + failed
    const success = totalVerdicts ? Math.round((completed / totalVerdicts) * 100) : null
    setText('profileName', account?.display_name || ui('UNPAIRED OPERATIVE', 'НЕПРИВЯЗАННЫЙ ОПЕРАТИВНИК'))
    setText('profileSteam', account?.steam_id64 ? `Steam ID ${snapshot.steam_id_masked || '••••'}` : 'Steam ID —')
    setText('profileXp', formatNumber(progression.total_xp ?? account?.xp))
    setText('profileCompleted', formatNumber(progression.contracts_completed))
    setText('profileSuccess', success == null ? '—' : `${success}%`)
    setText('profileLevelBadge', `${ui('LEVEL', 'УРОВЕНЬ')} ${progression.level || '—'}`)
    setText('profileXpNext', progression.xp_to_next == null ? ui('Server ledger', 'Серверный реестр') : `${formatNumber(progression.xp_to_next)} XP ${t('toNextLevel')}`)
    setText('profileReview', `${formatNumber(progression.review_pending || 0)} ${ui('UNDER REVIEW', 'НА ПРОВЕРКЕ')}`)
    setText('profileFailed', `${formatNumber(failed)} ${ui('FAILED', 'ПРОВАЛЕНО')}`)
    $('profileBadges').innerHTML = (account?.badges || [account?.access_role || (snapshot.paired ? 'PLAYER' : '')]).filter(Boolean).map(badge => `<b>${escapeHtml(badge)}</b>`).join('')
    const pct = Number(progression.progress_pct || 0)
    $('profileProgress').innerHTML = `<article class="level-card"><div><span>${ui('LEVEL', 'УРОВЕНЬ')} ${escapeHtml(progression.level || '—')} ${ui('PROGRESS', 'ПРОГРЕСС')}</span><b>${formatNumber(progression.level_xp)} / ${formatNumber(progression.next_level_xp)} XP</b></div><progress class="progress-track" max="100" value="${Math.max(0, Math.min(100, pct))}"></progress></article>`
    $('modeStats').innerHTML = Product.MODES.map(mode => {
      const stats = progression.mode_stats?.[mode] || {}
      return `<article class="mode-stat-card"><span>${ui('OPERATION', 'ОПЕРАЦИЯ')}</span><h3>${Product.modeLabel(mode)}</h3><div><small>${ui('DONE', 'ВЫПОЛНЕНО')}<b>${formatNumber(stats.completed || 0)}</b></small><small>${ui('FAILED', 'ПРОВАЛЕНО')}<b>${formatNumber(stats.failed || 0)}</b></small><small>XP<b>${formatNumber(stats.xp || 0)}</b></small></div></article>`
    }).join('')
    const adaptiveFeatureReady = product.server_features?.includes('adaptive_profiles_v1')
    if (snapshot.paired && product.status === 'ONLINE' && !adaptiveFeatureReady) {
      $('adaptiveProfiles').innerHTML = `<article class="adaptive-profile-card incompatible"><header><span>${escapeHtml(t('personalIntel'))}</span><b>${escapeHtml(t('incompatible'))}</b></header><h3>${escapeHtml(t('adaptiveNeedsServer'))}</h3></article>`
    } else {
      $('adaptiveProfiles').innerHTML = Product.MODES.map(mode => {
        const profile = Product.adaptiveProfileFor(product, mode)
        const metrics = ['player.kills', 'player.assists', 'player.hero_damage'].map(metric => {
          const row = Product.profileMetric(profile, metric)
          return `<div class="profile-baseline"><span>${escapeHtml(Product.metricLabel(metric, language()))}</span><b><small>${escapeHtml(t('median'))}</small>${escapeHtml(adaptiveMetricValue(metric, row?.median))}</b><b><small>P75</small>${escapeHtml(adaptiveMetricValue(metric, row?.p75))}</b><b><small>${escapeHtml(t('best'))}</small>${escapeHtml(adaptiveMetricValue(metric, row?.best))}</b></div>`
        }).join('')
        return `<article class="adaptive-profile-card"><header><span>${escapeHtml(Product.modeLabel(mode))}</span><b>${escapeHtml(profile?.confidence || 'COLD_START')}</b></header><h3>${escapeHtml(`${formatNumber(profile?.sample_size || 0)} ${t('recentMatches')}`)}</h3><div class="profile-baselines">${metrics}</div></article>`
      }).join('')
    }
  }

  function renderSettings() {
    const product = snapshot.product || Product.emptyProductState()
    const account = product.account || snapshot.account
    setText('pairAccount', account?.display_name || t('unpaired'))
    setText('pairBadge', snapshot.paired ? statusLabel(product.status || 'CONNECTING') : t('unpaired'))
    $('pairBadge').className = `outline-badge ${snapshot.paired ? statusClass(product.status) : ''}`
    $('disconnectBtn').disabled = busy || !snapshot.paired
    $('forceSignOutBtn').disabled = busy || !snapshot.paired
    $('syncBtn').disabled = busy || !snapshot.paired
    for (const id of ['disconnectBtn','forceSignOutBtn','syncBtn']) $(id).dataset.baseDisabled = snapshot.paired ? '0' : '1'

    const gepStatus = String(snapshot.health?.gep?.status || 'STARTING')
    setText('diagState', product.status === 'INCOMPATIBLE' ? t('incompatible') : `GEP ${gepStatus}`)
    const q = snapshot.queue || {}
    setText('diagCopy', `${t('localEvidence')}: ${q.items || 0} queued / ${q.dead_letter || 0} rejected · ${t('serverLedger')}: ${product.status || 'UNPAIRED'}`)
    const healthSource = snapshot.health || {}
    const gameState = snapshot.lifecycle?.state || (snapshot.game_running ? 'PROCESS_ONLY' : 'NO_GAME')
    const auth = healthSource.auth || {status: snapshot.paired ? 'OK' : 'UNPAIRED'}
    const secure = healthSource.secureStorage || {status:'OK'}
    const storage = healthSource.storage || {status:'OK'}
    const queue = healthSource.queue || {status:'OK',count:0,rejected:0}
    const healthCards = [
      {key:'healthGame', status:gameState, code:null, meta:snapshot.game_state_observed_at || null, action:'settings', label:'healthOpenSettings'},
      {key:'healthGep', status:healthSource.gep?.status || 'STARTING', code:healthSource.gep?.code, meta:healthSource.gep?.last_clock_at || healthSource.gep?.updated_at, action:'gep-retry', label:'healthRetry'},
      {key:'healthIdentity', status:secure.status !== 'OK' ? secure.status : auth.status, code:secure.code || auth.code, meta:auth.updated_at || secure.updated_at, action:snapshot.paired?'settings':'pair', label:snapshot.paired?'healthOpenSettings':'healthPair'},
      {key:'healthServer', status:healthSource.backend?.status || product.status || 'OFFLINE', code:healthSource.backend?.code, meta:healthSource.backend?.last_success_at || healthSource.backend?.updated_at, action:'sync', label:'healthRetry'},
      {key:'healthLocal', status:storage.status !== 'OK' ? storage.status : queue.status, code:storage.code || queue.code, meta:`${Number(queue.count||0)} queued / ${Number(queue.rejected||0)} rejected`, action:'export', label:'healthExport'},
    ]
    if ($('healthGrid')) $('healthGrid').innerHTML = healthCards.map(card => `<article class="health-row"><b>${escapeHtml(t(card.key))}</b><em>${escapeHtml(String(card.status || '—'))}</em>${card.code ? `<small>${escapeHtml(card.code)}</small>` : ''}${card.meta ? `<small>${escapeHtml(String(card.meta))}</small>` : ''}<button type="button" data-health-action="${card.action}">${escapeHtml(t(card.label))}</button></article>`).join('')

    const pairError = snapshot.pairing_error
    if (pairError) {
      $('pairMessage').classList.add('error')
      const code=String(pairError.code || 'PAIR_FAILED')
      const messageKey = /EXPIRED/.test(code) ? 'pairErrorExpired' : /USED|CLAIMED/.test(code) ? 'pairErrorUsed' : /FORMAT|INVALID|NOT_FOUND/.test(code) ? 'pairErrorInvalid' : /OFFLINE|NETWORK|TIMEOUT/.test(code) ? 'pairErrorOffline' : 'pairErrorGeneric'
      setText('pairMessage', `${t(messageKey)} (${code})${pairError.request_id ? ` · ${t('requestId')}: ${pairError.request_id}` : ''}`)
    } else {
      $('pairMessage').classList.remove('error')
      setText('pairMessage', t('pairHelp'))
    }

    all('[data-overlay-scale]').forEach(button => button.classList.toggle('active', button.dataset.overlayScale === (snapshot.overlay_scale || 'compact')))
    all('[data-auto-hide]').forEach(button => button.classList.toggle('active', Number(button.dataset.autoHide) === Number(snapshot.overlay_auto_hide_ms)))
    setText('hotkeyBinding', snapshot.hotkey_binding || 'UNASSIGNED')
    setText('ftueHotkey', snapshot.hotkey_binding || 'UNASSIGNED')
    if ($('hotkeyWarning')) $('hotkeyWarning').hidden = snapshot.hotkey_binding !== 'UNASSIGNED'
    if ($('hqHotkeyAlert')) $('hqHotkeyAlert').hidden = snapshot.hotkey_binding !== 'UNASSIGNED'
  }


  function renderProductViews() {
    renderHq()
    renderContracts()
    renderDebrief()
    renderHistory()
    renderProfile()
    renderActiveCase()
  }

  function render(next, force = false) {
    const incoming = next || {}
    const lifecycleSession = incoming.lifecycle?.session || null
    const accountSteam = String(incoming.account?.steam_id64 || incoming.product?.account?.steam_id64 || '')
    snapshot = {
      ...fallback,
      ...incoming,
      product: incoming.product || fallback.product,
      session: lifecycleSession ? { ...lifecycleSession, id: lifecycleSession.session_id } : null,
      queue_count: incoming.queue?.items ?? incoming.queue_count ?? 0,
      game_state_observed_at: incoming.health?.gep?.observed_at || incoming.game_state_observed_at || null,
      game_state_confirmed: !['UNAVAILABLE','STARTING'].includes(String(incoming.health?.gep?.status || '')),
      gep_feature_health: { status: incoming.health?.gep?.status || 'WAITING', last_error: incoming.health?.gep?.message || null },
      identity_ok: incoming.steam_id64 && accountSteam ? String(incoming.steam_id64) === accountSteam : null,
    }
    const latest = Product.latestVerdictGroup(snapshot.product?.history || [])
    const seen = readSeenDebriefId()
    const unseen = !!latest?.match_id && String(latest.match_id) !== seen
    if ($('navDebriefCount')) $('navDebriefCount').textContent = unseen ? '!' : ''
    const latestAt = latest?.at ? new Date(latest.at).getTime() : 0
    const recentVerdict = Number.isFinite(latestAt) && latestAt > 0 && Math.abs(Date.now() - latestAt) <= 15 * 60 * 1000
    if (unseen && recentVerdict && String(latest.match_id) !== lastNotifiedDebriefId && latest.status !== 'LOCKED') {
      lastNotifiedDebriefId = String(latest.match_id)
      toast(t('newVerdict'), `${Product.modeLabel(latest.game_match_mode)} · MATCH #${latest.match_id}`)
    }
    renderTelemetry()
    const signature = JSON.stringify({ product: snapshot.product, paired: snapshot.paired, account: snapshot.account, lang: language(), game_running: snapshot.game_running, mode: Product.normalizeMode(snapshot.mode_display) })
    const nextLiveSignature = JSON.stringify({
      evidence_revision: Number(snapshot.evidence_revision || 0),
      match_clock_s: snapshot.match_clock_s,
      match_id: snapshot.match_id,
      lifecycle_revision: Number(snapshot.lifecycle?.revision || 0),
      result_label: snapshot.result_label || null,
      mode: Product.normalizeMode(snapshot.mode_display),
    })
    if (force || signature !== productSignature) {
      productSignature = signature
      liveSignature = nextLiveSignature
      renderProductViews()
    } else if (nextLiveSignature !== liveSignature) {
      // Telemetry changes should refresh live contract rows without forcing the
      // heavier board/history/profile views to rebuild every roster update.
      liveSignature = nextLiveSignature
      renderActiveCase()
    }
    syncDesktopAdSlot()
  }

  async function loadPreview() {
    if (!previewPromise) {
      previewPromise = fetch('fixtures/preview.json', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error(`Preview fixture HTTP ${response.status}`)
        return response.json()
      })
    }
    return await previewPromise
  }

  async function refresh() {
    try {
      const api = controller()
      if (api?.getSnapshot) render(await api.getSnapshot())
      else if (PREVIEW) render(await loadPreview())
      else render(fallback)
    } catch (error) {
      if (PREVIEW) console.warn('Preview unavailable', error)
    }
  }

  function applyLanguage() {
    document.documentElement.lang = language()
    all('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n) })
    all('[data-i18n-aria]').forEach(node => { const value = t(node.dataset.i18nAria); if (value) node.setAttribute('aria-label', value) })
    all('[data-language]').forEach(button => button.classList.toggle('active', button.dataset.language === preference()))
    productSignature = ''
    liveSignature = ''
    render(snapshot, true)
  }

  function openModal({ title, body, summary = [], confirmLabel }) {
    if (modalResolve) modalResolve(false)
    modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setText('modalTitle', title)
    $('modalBody').innerHTML = `<p>${escapeHtml(body)}</p>${summary.length ? `<div class="modal-summary">${summary.map(item => `<span><em>${escapeHtml(item.label)}</em><b>${escapeHtml(item.value)}</b></span>`).join('')}</div>` : ''}`
    setText('modalCancel', t('cancel'))
    setText('modalConfirm', confirmLabel)
    $('confirmModal').hidden = false
    if ($('appShell')) $('appShell').inert = true
    syncDesktopAdSlot()
    $('modalCancel').focus()
    return new Promise(resolve => { modalResolve = resolve })
  }

  function closeModal(result) {
    $('confirmModal').hidden = true
    if ($('appShell')) $('appShell').inert = false
    const resolve = modalResolve
    modalResolve = null
    syncDesktopAdSlot()
    resolve?.(result)
    modalReturnFocus?.focus?.()
    modalReturnFocus = null
  }

  async function runAction(action, successMessage) {
    if (busy) return null
    setBusy(true)
    try {
      const next = await action()
      if (next) render(next, true)
      if (successMessage) toast(successMessage)
      return next
    } catch (error) {
      toast(t('actionFailed'), error?.message || String(error), 'error')
      return null
    } finally {
      setBusy(false)
      renderContracts()
      renderSettings()
    }
  }

  function bindNavigation() {
    document.addEventListener('click', event => {
      const target = event.target.closest('[data-view-target]')
      if (target) setView(target.dataset.viewTarget)
      const emptyAction = event.target.closest('[data-empty-action]')?.dataset.emptyAction
      if (emptyAction === 'pair') setView('settings')
      if (emptyAction === 'contracts') setView('contracts')
      if (emptyAction === 'retry') void runAction(() => call('refreshProduct'), t('syncComplete'))
    })
    $('hqOperations').addEventListener('click', event => {
      const button = event.target.closest('[data-operation-mode]')
      if (!button) return
      activeMode = button.dataset.operationMode
      activeCaseMode = button.dataset.operationMode
      setView(button.dataset.operationTarget)
    })
  }

  function bindLanguage() {
    all('[data-language]').forEach(button => button.addEventListener('click', () => setPreference(button.dataset.language)))
    window.addEventListener('dc:language', applyLanguage)
    window.addEventListener('languagechange', () => { if (preference() === 'auto') applyLanguage() })
  }

  function bindWindow() {
    if (typeof overwolf === 'undefined') return
    overwolf.windows.getCurrentWindow(result => { currentWindowId = result?.window?.id || result?.id || null })
    $('titlebar').addEventListener('mousedown', event => {
      if (event.button !== 0 || event.target.closest('button, input')) return
      if (currentWindowId) overwolf.windows.dragMove(currentWindowId)
    })
    $('minimizeBtn').addEventListener('click', () => currentWindowId && overwolf.windows.minimize(currentWindowId, () => {}))
    $('closeBtn').addEventListener('click', () => {
      void call('hideDesktop').catch(error => toast(t('actionFailed'), error?.message || String(error), 'error'))
    })
  }

  function bindFtue() {
    const ftueSaved = Storage?.readJson?.(FTUE_KEY, { schemaVersion: FTUE_STORAGE_VERSION })
    $('ftue').hidden = ftueSaved?.value === true || PREVIEW
    const done = destination => {
      Storage?.writeJson?.(FTUE_KEY, true, { schemaVersion: FTUE_STORAGE_VERSION })
      $('ftue').hidden = true
      if (destination) setView(destination)
      else syncDesktopAdSlot()
    }
    $('ftueContinue').addEventListener('click', () => done('hq'))
    $('ftuePair').addEventListener('click', () => done('settings'))
  }

  function bindContracts() {
    $('modeTabs').addEventListener('click', event => {
      const button = event.target.closest('[data-mode]')
      if (!button) return
      activeMode = button.dataset.mode
      renderContracts()
    })
    $('activeModeTabs').addEventListener('click', event => {
      const button = event.target.closest('[data-mode]')
      if (!button) return
      activeCaseMode = button.dataset.mode
      renderActiveCase()
    })
    $('contractBoard').addEventListener('click', event => {
      const button = event.target.closest('[data-option-id]')
      if (!button || busy) return
      const selected = selections.get(activeMode)
      const id = button.dataset.optionId
      if (selected.has(id)) selected.delete(id)
      else if (selected.size < 3) selected.add(id)
      else return toast(language() === 'ru' ? 'МОЖНО ВЫБРАТЬ НЕ БОЛЕЕ ТРЁХ' : 'SELECT UP TO THREE CONTRACTS', '', 'error')
      const board = Product.boardForMode(snapshot.product, activeMode)
      if (board) persistSelectionDraft(board, selected)
      renderContracts()
    })
    $('lockBtn').addEventListener('click', async () => {
      const board = Product.boardForMode(snapshot.product, activeMode)
      const ids = [...(selections.get(activeMode) || [])]
      const options = board?.options?.filter(option => ids.includes(option.id)) || []
      if (!options.length) return
      const confirmed = await openModal({
        title: t('lockTitle'), body: t('lockWarning'), confirmLabel: t('confirmLock'),
        summary: [{ label: t('summaryMode'), value: Product.modeLabel(activeMode) }, { label: t('summaryExpiry'), value: formatDateTime(board?.expires_at) }, { label: t('summaryAttempt'), value: `${board?.current_attempt || 1} / ${board?.max_attempts || 3}` }, { label: t('summaryReward'), value: `${formatNumber(options.reduce((sum, option) => sum + option.reward_xp, 0))} XP` }, {label:t('summaryDataAge'),value:formatRelativeSync(snapshot.product?.loaded_at)}, ...options.map((option, index) => ({ label: `${t('summaryContract')} 0${index + 1}`, value: `${optionTitle(option)} — ${optionDescription(option, activeMode)}` }))],
      })
      if (confirmed) {
        const result = await runAction(() => call('lockContracts', activeMode, ids), t('syncComplete'))
        if (result) { selections.get(activeMode)?.clear(); clearSelectionDraft(activeMode) }
      }
    })
    $('rerollBtn').addEventListener('click', async () => {
      const remaining = Number(snapshot.product?.refresh?.remaining || 0)
      const confirmed = await openModal({ title: t('rerollTitle'), body: t('rerollWarning'), confirmLabel: t('confirmReroll'), summary: [{ label: Product.modeLabel(activeMode), value: `${t('generation')} ${Product.boardForMode(snapshot.product, activeMode)?.generation || 0}` }, { label: t('freeRerolls'), value: `${remaining} → ${Math.max(0, remaining - 1)}` }] })
      if (confirmed) {
        const result = await runAction(() => call('rerollBoard', activeMode), t('syncComplete'))
        if (result) { selections.get(activeMode)?.clear(); clearSelectionDraft(activeMode) }
      }
    })
  }

  function bindHistory() {
    all('[data-history-filter]').forEach(button => button.addEventListener('click', () => {
      historyFilter = button.dataset.historyFilter
      renderHistory()
    }))
  }

  function bindActions() {
    $('mcgBtn').addEventListener('click', () => openExternal(MCG_URL))
    $('healthGrid')?.addEventListener('click', event => {
      const action=event.target.closest('[data-health-action]')?.dataset.healthAction
      if (!action) return
      if (action === 'pair' || action === 'settings') return setView('settings')
      if (action === 'sync') return void runAction(() => call('syncNow'), t('syncComplete'))
      if (action === 'gep-retry') return void call('checkEventStatus', {force:true}).then(() => refresh()).catch(error => toast(t('actionFailed'), error?.message || String(error), 'error'))
      if (action === 'export') return void call('exportPendingUploads').then(text => copyText(text)).then(() => toast(ui('Pending uploads copied.', 'Очередь скопирована.'))).catch(error => toast(t('actionFailed'), error?.message || String(error), 'error'))
    })
    $('pairSiteBtn').addEventListener('click', async () => {
      try { openExternal(await call('pairingUrl')) } catch (_) { openExternal(`${OFFICIAL_SITE}/pair`) }
    })
    const submitPair = async () => {
      const raw = $('pairCode').value
      let normalized
      try { normalized = await call('normalizePairCode', raw) } catch (_) { normalized = { ok: false, code: 'PAIR_CODE_INVALID' } }
      if (!normalized?.ok) {
        $('pairMessage').classList.add('error')
        setText('pairMessage', ui('Use the exact pairing code shown on the website. Invalid characters are not changed silently.', 'Введите код точно как на сайте. Недопустимые символы не исправляются автоматически.'))
        return
      }
      const next = await runAction(() => call('pair', OFFICIAL_SITE, normalized.normalized), null)
      if (next) { $('pairCode').value = ''; setText('pairMessage', t('pairSuccess')); toast(t('pairSuccess')) }
    }
    $('pairBtn').addEventListener('click', submitPair)
    $('pairCode').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void submitPair() } })
    $('disconnectBtn').addEventListener('click', async () => {
      const confirmed = await openModal({ title: ui('REVOKE & DISCONNECT?', 'ОТОЗВАТЬ И ОТКЛЮЧИТЬ?'), body: ui('Pending uploads are flushed first. The server token is revoked only after acknowledgement.', 'Сначала отправляется очередь. Серверный токен отзывается только после подтверждения.'), confirmLabel: ui('REVOKE', 'ОТОЗВАТЬ') })
      if (confirmed) await runAction(() => call('revokeAndDisconnect'), t('disconnected'))
    })
    $('forceSignOutBtn').addEventListener('click', async () => {
      const q = snapshot.queue || {}
      const confirmed = await openModal({ title: ui('FORCE LOCAL SIGN-OUT?', 'ЛОКАЛЬНО ВЫЙТИ ПРИНУДИТЕЛЬНО?'), body: ui('This works offline. The server token may remain active. Pending uploads are preserved.', 'Это работает офлайн. Серверный токен может остаться активным. Очередь отправок сохраняется.'), confirmLabel: ui('SIGN OUT LOCALLY', 'ВЫЙТИ ЛОКАЛЬНО'), summary: [{label:'PENDING',value:String(q.items||0)},{label:'REJECTED',value:String(q.dead_letter||0)}] })
      if (confirmed) await runAction(() => call('forceLocalSignOut'), t('disconnected'))
    })
    $('syncBtn').addEventListener('click', async () => {
      const result = await runAction(() => call('syncNow'), null)
      if (!result) return
      if (result.ok) toast(t('syncComplete'))
      else toast(t('actionFailed'), `${result.code || 'SYNC_DEGRADED'} · upload=${result.upload?.ok ? 'ok' : result.upload?.code || 'pending'} · product=${result.product?.ok ? 'fresh' : result.product?.code || 'stale'}`, 'error')
    })
    $('overlayBtn').addEventListener('click', () => call('toggleOverlay').catch(error => toast(t('actionFailed'), error?.message || String(error), 'error')))
    $('overlayResetBtn').addEventListener('click', () => runAction(() => call('resetOverlayPosition'), language() === 'ru' ? 'Позиция оверлея сброшена.' : 'Overlay position reset.'))
    all('[data-overlay-scale]').forEach(button => button.addEventListener('click', () => runAction(async () => {
      await call('setOverlayScale', button.dataset.overlayScale)
      return await call('getSnapshot')
    }, language() === 'ru' ? 'Размер оверлея изменён.' : 'Overlay size updated.')))
    all('[data-auto-hide]').forEach(button => button.addEventListener('click', () => runAction(async () => {
      await call('setOverlayAutoHide', Number(button.dataset.autoHide))
      return await call('getSnapshot')
    }, ui('Overlay auto-hide updated.', 'Автоскрытие оверлея обновлено.'))))
    $('hotkeyBtn').addEventListener('click', () => {
      void call('openHotkeySettings')
      setTimeout(() => void call('refreshHotkeyBinding').then(next => render(next, true)).catch(() => {}), 1200)
    })
    $('hqHotkeyBtn')?.addEventListener('click', () => {
      void call('openHotkeySettings')
      setTimeout(() => void call('refreshHotkeyBinding').then(next => render(next, true)).catch(() => {}), 1200)
    })
    $('reportBtn').addEventListener('click', async () => {
      try { await copyText(await call('diagnosticsText')); toast(t('reportCopied')) } catch (error) { toast(t('actionFailed'), error?.message || String(error), 'error') }
    })
    $('updateBtn').addEventListener('click', () => {
      setText('updateState', t('update.CHECKING') || 'CHECKING')
      if (typeof overwolf === 'undefined' || !overwolf.extensions?.checkForExtensionUpdate) return setText('updateState', t('update.UP_TO_DATE') || 'UP TO DATE')
      overwolf.extensions.checkForExtensionUpdate(result => {
        if (result?.success === false) {
          setText('updateState', t('update.FAILED'))
          $('updateBtn').textContent = t('retry')
          return
        }
        const raw = String(result?.state || result?.status || '')
        const updateState = raw === 'UpdateAvailable' ? 'UPDATE_AVAILABLE'
          : raw === 'UpToDate' ? 'UP_TO_DATE'
          : raw === 'PendingRestart' ? 'PENDING_RESTART'
          : 'FAILED'
        setText('updateState', t(`update.${updateState}`))
        $('updateBtn').textContent = updateState === 'FAILED' ? t('retry') : t('checkUpdate')
      })
    })
    $('helpBtn').addEventListener('click', () => openExternal(`${OFFICIAL_SITE}/data-sources`))
    $('privacyBtn').addEventListener('click', () => openExternal(`${OFFICIAL_SITE}/privacy`))
    $('supportBtn').addEventListener('click', () => openExternal(`${OFFICIAL_SITE}/support`))
    $('replayIntroBtn').addEventListener('click', () => { Storage?.remove?.(FTUE_KEY); $('ftue').hidden = false; $('ftueContinue').focus() })
    $('exportQueueBtn').addEventListener('click', async () => { try { await copyText(await call('exportPendingUploads')); toast(ui('Pending uploads copied.', 'Очередь скопирована.')) } catch (error) { toast(t('actionFailed'), error?.message || String(error), 'error') } })
    $('clearCacheBtn').addEventListener('click', async () => { const yes = await openModal({title:ui('CLEAR LOCAL CACHE?','ОЧИСТИТЬ ЛОКАЛЬНЫЙ КЭШ?'),body:ui('Account/product cache is removed. Pairing and pending uploads are preserved.','Кэш аккаунта/контрактов будет удалён. Pairing и очередь сохранятся.'),confirmLabel:ui('CLEAR CACHE','ОЧИСТИТЬ')}); if (yes) await runAction(() => call('clearLocalCache'), ui('Local cache cleared.','Локальный кэш очищен.')) })
    $('clearAllDataBtn').addEventListener('click', async () => { const yes = await openModal({title:ui('CLEAR ALL LOCAL DATA?','ОЧИСТИТЬ ВСЕ ЛОКАЛЬНЫЕ ДАННЫЕ?'),body:ui('Pairing, cache, lifecycle checkpoints and pending uploads will be removed from this Windows profile. Export pending uploads first if needed.','Pairing, кэш, lifecycle checkpoints и очередь отправок будут удалены из этого профиля Windows. При необходимости сначала экспортируйте очередь.'),confirmLabel:ui('CLEAR EVERYTHING','ОЧИСТИТЬ ВСЁ')}); if (yes) { await call('clearAllLocalData'); Storage?.remove?.(DRAFT_KEY); location.reload() } })
    $('showSteamBtn').addEventListener('click', () => { const id = snapshot.account?.steam_id64 || snapshot.product?.account?.steam_id64 || snapshot.steam_id64; setText('profileSteam', id ? `Steam ID ${id}` : 'Steam ID —') })
    $('copySteamBtn').addEventListener('click', async () => { const id = snapshot.account?.steam_id64 || snapshot.product?.account?.steam_id64 || snapshot.steam_id64; if (!id) return; try { await copyText(String(id)); toast(ui('Steam ID copied.','Steam ID скопирован.')) } catch (error) { toast(t('actionFailed'), error?.message || String(error), 'error') } })
    $('exitBtn').addEventListener('click', async () => {
      try {
        const status = await call('exitStatus')
        const confirmed = await openModal({
          title: ui('EXIT COMPANION?', 'ВЫЙТИ ИЗ COMPANION?'),
          body: status.active_match ? ui('An active match is detected. Keeping the Companion running is recommended.', 'Обнаружен активный матч. Рекомендуется оставить Companion запущенным.') : ui('The background controller and GEP listeners will stop.', 'Фоновый контроллер и GEP listeners будут остановлены.'),
          confirmLabel: ui('EXIT ANYWAY', 'ВСЁ РАВНО ВЫЙТИ'),
          summary: [
            {label:'ACTIVE MATCH',value:status.active_match?'YES':'NO'},
            {label:'PENDING UPLOADS',value:String(status.pending_uploads||0)},
            {label:'REJECTED UPLOADS',value:String(status.rejected_uploads||0)},
            {label:'LAST ACK',value:status.last_server_acknowledgement||'NEVER'},
          ],
        })
        if (confirmed) await call('exitApp', {deadlineMs:3000})
      } catch (error) { toast(t('actionFailed'), error?.message || String(error), 'error') }
    })
    $('modalCancel').addEventListener('click', () => closeModal(false))
    $('modalConfirm').addEventListener('click', () => closeModal(true))
    $('confirmModal').addEventListener('click', event => { if (event.target === $('confirmModal')) closeModal(false) })
    window.addEventListener('keydown', event => {
      if ($('confirmModal').hidden) return
      if (event.key === 'Escape') { event.preventDefault(); closeModal(false); return }
      if (event.key !== 'Tab') return
      const focusable = [...$('confirmModal').querySelectorAll('button:not([disabled]), [href], input:not([disabled])')].filter(node => !node.hidden)
      if (!focusable.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    })
  }

  function bindNetwork() {
    const update = () => renderSystemStatus()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
  }

  function bindKeyboardNavigation() {
    for (const root of [document.querySelector('.side-nav'), $('modeTabs'), $('activeModeTabs')].filter(Boolean)) {
      root.addEventListener('keydown', event => {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return
        const buttons = [...root.querySelectorAll('button:not([disabled])')]
        if (!buttons.length) return
        const current = Math.max(0, buttons.indexOf(document.activeElement))
        let next = current
        if (['ArrowRight','ArrowDown'].includes(event.key)) next = (current + 1) % buttons.length
        if (['ArrowLeft','ArrowUp'].includes(event.key)) next = (current - 1 + buttons.length) % buttons.length
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = buttons.length - 1
        event.preventDefault(); buttons[next].focus()
      })
    }
  }

  function init() {
    bindNavigation()
    bindLanguage()
    bindWindow()
    bindFtue()
    bindContracts()
    bindHistory()
    bindActions()
    bindNetwork()
    bindKeyboardNavigation()
    applyLanguage()
    void refresh()
    setInterval(() => void refresh(), 1500)
  }

  window.addEventListener('DOMContentLoaded', init)
})()
