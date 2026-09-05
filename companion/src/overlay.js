(() => {
  const PREVIEW = typeof overwolf === 'undefined' && new URLSearchParams(location.search).get('preview') === '1'
  const REFRESH_MS = 1000
  let backgroundWindow = null
  let previewPromise = null
  let lastRevision = -1
  let lastFocusKey = ''
  let lastValue = null
  let lastCompletionKey = ''
  let visibleSince = Date.now()
  let lastSuccessAt = 0
  let consecutiveFailures = 0

  const $ = id => document.getElementById(id)
  const I18n = window.DCI18n
  const Product = window.DCProduct
  const language = () => I18n?.language?.() || 'en'
  const ui = (en, ru) => I18n?.literal?.(en, ru, language()) || (language() === 'ru' ? ru : en)

  function controller() {
    if (!backgroundWindow && typeof overwolf !== 'undefined') {
      try { backgroundWindow = overwolf.windows.getMainWindow() } catch (_) { backgroundWindow = null }
    }
    return backgroundWindow?.dcCompanion || null
  }
  function setVisible(element, visible) { if (element) element.hidden = !visible }
  function announcementDismissed(item) {
    try { return Boolean(localStorage.getItem(`dc.announcement.dismissed.${item.id}.${item.revision}`)) } catch (_) { return false }
  }
  function renderOverlayAnnouncement(item) {
    const container = $('overlayAnnouncement')
    const visible = Boolean(item && item.presentation === 'BANNER' && !announcementDismissed(item))
    setVisible(container, visible)
    $('overlayShell')?.classList.toggle('has-announcement', visible)
    if (!visible) return
    container.className = `overlay-announcement severity-${String(item.severity || 'INFO').toLowerCase()} effect-${item.effect === 'SOFT_GLOW' ? 'soft-glow' : 'none'}`
    container.setAttribute('role', ['WARNING','MAINTENANCE','CRITICAL'].includes(item.severity) ? 'alert' : 'status')
    $('overlayAnnouncementSeverity').textContent = String(item.severity || 'INFO')
    $('overlayAnnouncementTitle').textContent = String(item.title || '')
    $('overlayAnnouncementBody').textContent = String(item.body || '')
  }
  function number(value, digits = 1) {
    if (value === null || value === undefined || value === '') return '—'
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    return n.toLocaleString(language() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: digits })
  }
  function displayValue(metric, value) {
    if (value === null || value === undefined) return '—'
    if (metric === 'match.win') return Number(value) === 1 ? ui('WIN', 'ПОБЕДА') : '—'
    if (metric === 'match.duration_s') {
      const seconds = Math.max(0, Math.trunc(Number(value) || 0))
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    }
    return number(value, metric === 'player.kda' ? 2 : 0)
  }
  function animate(className) {
    const card = $('overlayFocus')
    if (!card || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    card.classList.remove(className)
    void card.offsetWidth
    card.classList.add(className)
  }
  function renderSelected(selected = [], focusedId = null) {
    const container = $('overlaySelected')
    if (!container) return
    if (!selected.length) { container.replaceChildren(); setVisible(container, false); return }
    const fragment = document.createDocumentFragment()
    selected.slice(0, 3).forEach((item, index) => {
      const row = document.createElement('div')
      row.className = `selected-contract${String(item.id) === String(focusedId) ? ' active' : ''}`
      const n = document.createElement('span'); n.textContent = String(index + 1)
      const b = document.createElement('b'); b.textContent = String(item.title || ui('CONTRACT', 'КОНТРАКТ'))
      row.append(n, b); fragment.appendChild(row)
    })
    container.replaceChildren(fragment)
    setVisible(container, true)
  }
  function renderEmpty(title, mode = '—', attempt = '—', foot = '') {
    setVisible($('overlayFocus'), false)
    setVisible($('overlayStats'), false)
    setVisible($('overlayEmpty'), true)
    setVisible($('overlaySelected'), false)
    $('overlayEmpty').textContent = title
    $('overlayMode').textContent = mode
    $('overlayAttempt').textContent = attempt
    $('overlayFoot').textContent = foot
  }

  function statText(value) {
    if (value === null || value === undefined || value === '') return '—'
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    return number(n, 0)
  }
  function renderMatchDashboard(dto, { stale = false, backendBad = false } = {}) {
    const stats = dto?.stats || {}
    setVisible($('overlayFocus'), false)
    setVisible($('overlayEmpty'), false)
    setVisible($('overlaySelected'), false)
    setVisible($('overlayStats'), true)

    const matchId = dto?.match?.id
    const staleSeconds = Math.max(0, Math.round(Number(dto?.health?.age_ms || 0) / 1000))
    $('overlayMode').textContent = `${Product?.modeLabel?.(dto.match?.mode, dto.language) || dto.match?.mode || '—'}${matchId ? ` · #${matchId}` : ''}`
    $('overlayAttempt').textContent = ui('NO ACTIVE CONTRACTS', 'НЕТ АКТИВНЫХ КОНТРАКТОВ')
    $('overlayStatsMatch').textContent = matchId
      ? `${ui('MATCH', 'МАТЧ')} #${matchId}`
      : ui('CURRENT MATCH', 'ТЕКУЩИЙ МАТЧ')
    $('overlayStatsStatus').textContent = stale
      ? `◐ ${ui('STALE', 'УСТАРЕЛО')} · ${staleSeconds}s`
      : '● LIVE'
    $('overlayStats').classList.toggle('stale', stale)

    const labels = {
      overlayStatKillsLabel: ui('KILLS', 'УБИЙСТВА'),
      overlayStatDeathsLabel: ui('DEATHS', 'СМЕРТИ'),
      overlayStatAssistsLabel: ui('ASSISTS', 'ПОМОЩИ'),
      overlayStatHealingLabel: ui('HEALING', 'ЛЕЧЕНИЕ'),
      overlayStatHeroDamageLabel: ui('HERO DMG', 'УРОН ГЕРОЯМ'),
      overlayStatObjectDamageLabel: ui('OBJECT DMG', 'УРОН ОБЪЕКТАМ'),
      overlayStatSoulsLabel: ui('SOULS', 'ДУШИ'),
      overlayStatClockLabel: ui('CLOCK', 'ВРЕМЯ'),
    }
    for (const [id, label] of Object.entries(labels)) if ($(id)) $(id).textContent = label

    $('overlayStatKills').textContent = statText(stats.kills)
    $('overlayStatDeaths').textContent = statText(stats.deaths)
    $('overlayStatAssists').textContent = statText(stats.assists)
    $('overlayStatHealing').textContent = statText(stats.healing)
    $('overlayStatHeroDamage').textContent = statText(stats.hero_damage)
    $('overlayStatObjectDamage').textContent = statText(stats.object_damage)
    $('overlayStatSouls').textContent = statText(stats.souls)
    $('overlayStatClock').textContent = displayValue('match.duration_s', stats.match_clock_s)

    $('overlayStatsFoot').textContent = stale
      ? ui('LAST KNOWN GEP VALUES', 'ПОСЛЕДНИЕ ИЗВЕСТНЫЕ ДАННЫЕ GEP')
      : ui('LIVE MATCH DATA · NO ACTIVE CONTRACTS', 'LIVE-ДАННЫЕ МАТЧА · НЕТ АКТИВНЫХ КОНТРАКТОВ')
    $('overlayFoot').textContent = backendBad
      ? ui('SERVER DEGRADED · LIVE DATA STAYS LOCAL', 'СЕРВЕР НЕДОСТУПЕН · LIVE-ДАННЫЕ ОСТАЮТСЯ ЛОКАЛЬНО')
      : stale
        ? ui('GEP STALE · SHOWING LAST KNOWN VALUES', 'GEP УСТАРЕЛ · ПОКАЗАНЫ ПОСЛЕДНИЕ ЗНАЧЕНИЯ')
        : ui('MATCH DASHBOARD', 'ПАНЕЛЬ МАТЧА')
  }

  function render(dto, { force = false } = {}) {
    if (!dto || Number(dto.dto_version) !== 2) {
      renderEmpty(ui('OVERLAY DATA UNAVAILABLE', 'ДАННЫЕ ОВЕРЛЕЯ НЕДОСТУПНЫ'), 'DTO v2 REQUIRED', '—', ui('OPEN DESKTOP FOR DIAGNOSTICS', 'ОТКРОЙТЕ DESKTOP ДЛЯ ДИАГНОСТИКИ'))
      return
    }
    if (!force && Number(dto.revision) === lastRevision) {
      updateCountdown(dto)
      return
    }
    lastRevision = Number(dto.revision)
    renderOverlayAnnouncement(dto.announcement)
    document.documentElement.lang = dto.language || language()
    const hotkey = dto.hotkey?.assigned ? dto.hotkey.binding : 'UNASSIGNED'
    $('overlayHotkey').textContent = String(hotkey || 'UNASSIGNED').toUpperCase()

    const gameState = String(dto.health?.game || 'NO_GAME')
    const gepStatus = String(dto.health?.gep || 'STARTING')
    const stale = ['STALE', 'UNAVAILABLE'].includes(gepStatus)
    const backendBad = ['OFFLINE', 'DEGRADED'].includes(String(dto.health?.backend || ''))
    $('overlayState').className = stale || backendBad ? 'warn' : gameState === 'MATCH' ? 'live' : ''
    $('overlayState').textContent = stale ? `◐ ${gepStatus}` : gameState === 'MATCH' ? '● LIVE' : ui('○ STANDBY', '○ ОЖИДАНИЕ')

    if (!dto.hotkey?.assigned) {
      renderEmpty(ui('OVERLAY HOTKEY UNASSIGNED', 'HOTKEY ОВЕРЛЕЯ НЕ НАЗНАЧЕН'), dto.match?.mode || '—', '—', ui('OPEN DESKTOP → HOTKEY SETTINGS', 'ОТКРОЙТЕ DESKTOP → HOTKEY'))
      return
    }
    if (gameState === 'NO_GAME') {
      renderEmpty(ui('WAITING FOR DEADLOCK', 'ОЖИДАНИЕ DEADLOCK'), ui('NO LIVE MATCH', 'НЕТ АКТИВНОГО МАТЧА'), '—', backendBad ? ui('SERVER OFFLINE · LOCAL STATE PRESERVED', 'СЕРВЕР OFFLINE · ЛОКАЛЬНОЕ СОСТОЯНИЕ СОХРАНЕНО') : ui('HOTKEY TO HIDE', 'HOTKEY СКРЫВАЕТ ОВЕРЛЕЙ'))
      return
    }
    if (gameState === 'PROCESS_ONLY') {
      renderEmpty(ui('WAITING FOR CONFIRMED MATCH', 'ОЖИДАНИЕ ПОДТВЕРЖДЁННОГО МАТЧА'), dto.match?.mode || ui('DETECTING MODE', 'ОПРЕДЕЛЯЕМ РЕЖИМ'), '—', ui('PROCESS DETECTED · NO SCORING SESSION YET', 'ПРОЦЕСС НАЙДЕН · SCORING-СЕССИЯ ЕЩЁ НЕ НАЧАТА'))
      return
    }
    const selected = Array.isArray(dto.selected) ? dto.selected : []
    if (gameState === 'MATCH' && selected.length === 0) {
      renderMatchDashboard(dto, { stale, backendBad })
      return
    }
    if (stale) {
      renderEmpty(ui('LIVE DATA IS STALE', 'LIVE-ДАННЫЕ УСТАРЕЛИ'), dto.match?.mode || '—', dto.match?.attempt ? `${dto.match.attempt.current}/${dto.match.attempt.max}` : '—', `${ui('GEP', 'GEP')} ${gepStatus} · ${Math.round(Number(dto.health?.age_ms || 0) / 1000)}s`)
      return
    }
    const focus = dto.focus
    if (!focus?.condition || !focus?.progress) {
      renderEmpty(ui('NO LIVE-SUPPORTED OBJECTIVE', 'НЕТ ЦЕЛИ С LIVE-ПРОГРЕССОМ'), dto.match?.mode || '—', dto.match?.attempt ? `${dto.match.attempt.current}/${dto.match.attempt.max}` : '—', backendBad ? ui('SERVER DEGRADED', 'СЕРВЕР НЕДОСТУПЕН') : ui('SERVER VERDICT REMAINS AUTHORITATIVE', 'ФИНАЛЬНЫЙ ВЕРДИКТ ОСТАЁТСЯ ЗА СЕРВЕРОМ'))
      renderSelected(dto.selected || [])
      return
    }

    setVisible($('overlayFocus'), true)
    setVisible($('overlayStats'), false)
    setVisible($('overlayEmpty'), false)
    const progress = focus.progress
    const condition = focus.condition
    const metric = String(condition.metric || '')
    const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)))
    $('overlayMode').textContent = `${Product?.modeLabel?.(dto.match?.mode, dto.language) || dto.match?.mode || '—'}${dto.match?.id ? ` · #${dto.match.id}` : ''}`
    $('overlayAttempt').textContent = dto.match?.attempt ? `${ui('ATTEMPT', 'ПОПЫТКА')} ${dto.match.attempt.current}/${dto.match.attempt.max}` : '—'
    $('overlayMetric').textContent = focus.metric_label || metric
    $('overlayXp').textContent = `${number(focus.reward_xp, 0)} XP`
    $('overlayTitle').textContent = focus.title || ui('CONTRACT', 'КОНТРАКТ')
    $('overlayCurrent').textContent = progress.known ? displayValue(metric, progress.value) : '—'
    $('overlayTarget').textContent = metric === 'match.win' ? `/ ${ui('WIN', 'ПОБЕДА')}` : `/ ${displayValue(metric, progress.target)}`
    $('overlayPercent').textContent = `${percent}%`
    $('overlayProgress').value = percent
    const stateLabel = String(progress.state || 'PENDING')
    $('overlayHint').textContent = progress.final ? stateLabel : `${stateLabel} · ${ui('PROVISIONAL', 'ПРЕДВАРИТЕЛЬНО')}`
    const completionReady = progress.allow_completion_animation === true || ['TARGET_REACHED_PROVISIONAL','ON_TARGET_PROVISIONAL','COMPLETED','SETTLED'].includes(String(progress.state || ''))
    $('overlayFocus').classList.toggle('focus-complete', completionReady)
    renderSelected(dto.selected || [], focus.option_id)

    const focusKey = `${focus.option_id}:${focus.condition_index ?? 0}:${metric}`
    if (focusKey !== lastFocusKey) { animate('focus-enter'); lastFocusKey = focusKey; lastValue = progress.value }
    else if (progress.known && Number(progress.value) !== Number(lastValue)) { animate('focus-progressing'); lastValue = progress.value }
    const completionKey = `${focusKey}:${stateLabel}:${percent}`
    if (completionReady && completionKey !== lastCompletionKey) { animate('focus-completion-burst'); lastCompletionKey = completionKey }
    if (!completionReady) lastCompletionKey = ''
    $('overlayFoot').textContent = backendBad ? ui('SERVER DEGRADED · FINAL WILL WAIT FOR ACK', 'СЕРВЕР НЕДОСТУПЕН · ФИНАЛ ЖДЁТ ACK') : ui('SERVER FINAL · LIVE VALUES PROVISIONAL', 'ФИНАЛ ЗА СЕРВЕРОМ · LIVE ПРЕДВАРИТЕЛЬНЫЙ')
    updateCountdown(dto)
  }
  function updateCountdown(dto) {
    const hotkey = dto?.hotkey?.assigned ? dto.hotkey.binding : 'UNASSIGNED'
    if (!dto?.auto_hide_ms) { $('overlayHotkey').textContent = String(hotkey).toUpperCase(); return }
    const remaining = Math.max(0, Number(dto.auto_hide_ms) - (Date.now() - visibleSince))
    $('overlayHotkey').textContent = remaining > 0 && remaining <= 3000
      ? `${String(hotkey).toUpperCase()} · ${Math.ceil(remaining / 1000)}s`
      : String(hotkey).toUpperCase()
  }
  async function previewDto() {
    if (!previewPromise) previewPromise = fetch('fixtures/preview.json', { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error(`Preview fixture HTTP ${response.status}`)
      return response.json()
    })
    const fixture = await previewPromise
    return fixture.overlay || fixture.overlay_dto || fixture
  }
  async function refresh() {
    try {
      const api = controller()
      const dto = api?.getOverlaySnapshot ? await api.getOverlaySnapshot() : PREVIEW ? await previewDto() : null
      if (!dto) throw Object.assign(new Error('Background controller unavailable'), {code:'BACKGROUND_UNAVAILABLE'})
      lastSuccessAt = Date.now()
      consecutiveFailures = 0
      render(dto)
    } catch (error) {
      consecutiveFailures += 1
      const ageMs = lastSuccessAt ? Date.now() - lastSuccessAt : Infinity
      const hideValues = !Number.isFinite(ageMs) || ageMs >= 60000
      renderEmpty(
        hideValues ? ui('OPEN DESKTOP FOR RECOVERY', 'ОТКРОЙТЕ DESKTOP ДЛЯ ВОССТАНОВЛЕНИЯ') : ui('LIVE DATA IS STALE', 'LIVE-ДАННЫЕ УСТАРЕЛИ'),
        '—', '—',
        `${String(error?.code || 'BACKGROUND_REFRESH_FAILED')} · ${Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : 0}s`
      )
      $('overlayState').className = 'warn'
      $('overlayState').textContent = '◐ STALE'
    }
  }
  window.addEventListener('DOMContentLoaded', () => {
    visibleSince = Date.now()
    void refresh()
    setInterval(() => void refresh(), REFRESH_MS)
  })
})()
