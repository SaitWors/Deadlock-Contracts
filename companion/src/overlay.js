(() => {
  const Product = window.DCProduct
  const Focus = window.DCOverlayFocus
  const PREVIEW = typeof overwolf === 'undefined' && new URLSearchParams(location.search).get('preview') === '1'
  const REFRESH_MS = 400
  const router = Focus.createRouter({ switchDelayMs: 3000 })
  let backgroundWindow = null
  let previewPromise = null
  let lastRenderedKey = null
  let lastRenderedValue = null
  let dodgeLeaveTimer = 0

  const $ = id => document.getElementById(id)
  const number = value => window.DCShared.formatNumber(value, 1)

  function controller() {
    if (!backgroundWindow && typeof overwolf !== 'undefined') {
      try { backgroundWindow = overwolf.windows.getMainWindow() } catch (_) { backgroundWindow = null }
    }
    return backgroundWindow?.dcCompanion || null
  }

  function strictActiveCase(product, mode) {
    const normalized = Product.normalizeMode(mode)
    if (!normalized) return null
    return (product?.active_cases || []).find(item => item.game_match_mode === normalized) || null
  }

  function setVisible(element, visible) {
    if (!element) return
    element.hidden = !visible
  }

  function serverStatus(option) {
    const value = String(option?.status || '').toUpperCase()
    if (value === 'COMPLETED') return 'COMPLETED'
    if (value === 'FAILED') return 'FAILED'
    if (value === 'REVIEW_REQUIRED') return 'REVIEW REQUIRED'
    if (value === 'VERIFYING' || value === 'PENDING') return 'VERIFYING'
    return null
  }

  function serverPercent(option) {
    const status = String(option?.status || '').toUpperCase()
    if (status === 'COMPLETED') return 100
    const conditions = option?.conditions || []
    if (conditions.length !== 1 || option?.progress_current == null) return 0
    const condition = conditions[0]
    const current = Number(option.progress_current)
    const target = Number(condition.target)
    if (!Number.isFinite(current) || !Number.isFinite(target)) return 0
    if (condition.metric === 'match.win') return current === 1 ? 100 : 0
    if (condition.operator === 'lte') return current <= target ? Math.max(0, Math.min(100, (1 - current / Math.max(target, 1)) * 100)) : 0
    if (condition.operator === 'eq') return current === target ? 100 : 0
    if (target <= 0) return current >= target ? 100 : 0
    return Math.max(0, Math.min(100, current / target * 100))
  }

  function displayValue(metric, value) {
    if (metric === 'match.win') return Number(value) === 1 ? 'WIN' : '—'
    if (metric === 'match.duration_s') {
      const seconds = Math.max(0, Math.trunc(Number(value) || 0))
      const minutes = Math.floor(seconds / 60)
      const rest = String(seconds % 60).padStart(2, '0')
      return `${minutes}:${rest}`
    }
    return number(value)
  }

  function progressFor(candidate, option, live) {
    if (live && candidate?.progress) return candidate.progress
    const condition = candidate?.condition || option?.conditions?.[0] || null
    const target = Number(condition?.target ?? option?.progress_target ?? option?.target ?? 0)
    const current = Number(option?.progress_current)
    return {
      supported: !!condition,
      known: Number.isFinite(current),
      value: Number.isFinite(current) ? current : null,
      target: Number.isFinite(target) ? target : null,
      operator: String(condition?.operator || option?.operator || 'gte'),
      percent: serverPercent(option),
      provisional_pass: String(option?.status || '').toUpperCase() === 'COMPLETED',
    }
  }

  function animateCardSwitch() {
    const card = $('overlayFocus')
    if (!card) return
    card.classList.remove('focus-enter')
    void card.offsetWidth
    card.classList.add('focus-enter')
  }

  function animateProgress() {
    const card = $('overlayFocus')
    if (!card) return
    card.classList.remove('focus-progressing')
    void card.offsetWidth
    card.classList.add('focus-progressing')
  }

  function renderCandidate(candidate, live, pending) {
    const option = candidate?.option
    const condition = candidate?.condition || option?.conditions?.[0]
    if (!option || !condition) return false
    const progress = progressFor(candidate, option, live)
    const metric = String(condition.metric || option.metric || '')
    const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)))
    const current = progress.known ? displayValue(metric, progress.value) : '—'
    const target = metric === 'match.win' ? 'WIN' : displayValue(metric, progress.target)
    const key = candidate.key || `${option.id}:${metric}`

    setVisible($('overlayFocus'), true)
    setVisible($('overlayEmpty'), false)
    $('overlayMetric').textContent = Product.metricLabel(metric, 'en')
    $('overlayXp').textContent = `${number(option.reward_xp)} XP`
    $('overlayTitle').textContent = option.title
    $('overlayCurrent').textContent = current
    $('overlayTarget').textContent = `/ ${target}`
    $('overlayPercent').textContent = `${percent}%`
    $('overlayProgress').value = percent

    const status = serverStatus(option)
    if (live) {
      $('overlayHint').textContent = pending ? 'FOCUS LOCK · 3 SEC' : progress.provisional_pass ? 'TARGET MET · PROVISIONAL' : 'LIVE · PROVISIONAL'
    } else {
      $('overlayHint').textContent = status || 'SERVER STATE'
    }

    $('overlayFocus').classList.toggle('focus-complete', live && progress.provisional_pass)
    if (lastRenderedKey !== key) {
      animateCardSwitch()
      lastRenderedKey = key
      lastRenderedValue = progress.value
    } else if (progress.known && Number(progress.value) !== Number(lastRenderedValue)) {
      animateProgress()
      lastRenderedValue = progress.value
    }
    return true
  }

  function render(snapshot) {
    const product = snapshot?.product || Product.emptyProductState()
    const detectedMode = Product.normalizeMode(snapshot?.mode_display)
    const active = snapshot?.game_running ? strictActiveCase(product, detectedMode) : null
    const verifying = !!active && ['VERIFYING', 'REVIEW_REQUIRED'].includes(String(active.status || '').toUpperCase())
    const live = !!snapshot?.game_running && !!active && !verifying
    const hotkey = String(snapshot?.hotkey_binding || 'Ctrl+Shift+C')

    if ($('overlayHotkey')) $('overlayHotkey').textContent = hotkey.toUpperCase()
    $('overlayState').className = live ? 'live' : verifying ? 'warn' : ''
    $('overlayState').textContent = live ? '● LIVE' : verifying ? '◐ VERIFYING' : '○ STANDBY'

    if (!snapshot?.paired) {
      router.reset('unpaired')
      setVisible($('overlayFocus'), false)
      setVisible($('overlayEmpty'), true)
      $('overlayEmpty').textContent = 'PAIR ACCOUNT IN DESKTOP'
      $('overlayMode').textContent = 'ACCOUNT REQUIRED'
      $('overlayAttempt').textContent = 'NO ACTIVE CASE'
      $('overlayFoot').textContent = 'OPEN DESKTOP TO CONNECT'
      return
    }

    if (snapshot?.game_running && !detectedMode) {
      router.reset(`match:${snapshot?.match_id || 'unknown'}:mode-pending`)
      setVisible($('overlayFocus'), false)
      setVisible($('overlayEmpty'), true)
      $('overlayEmpty').textContent = 'DETECTING CURRENT MODE'
      $('overlayMode').textContent = snapshot?.match_id ? `MATCH #${snapshot.match_id}` : 'MATCH DETECTED'
      $('overlayAttempt').textContent = 'WAITING FOR MODE'
      $('overlayFoot').textContent = 'NO CROSS-MODE FALLBACK'
      return
    }

    if (!snapshot?.game_running) {
      router.reset('no-game')
      setVisible($('overlayFocus'), false)
      setVisible($('overlayEmpty'), true)
      $('overlayEmpty').textContent = 'WAITING FOR MATCH'
      $('overlayMode').textContent = 'NO LIVE MATCH'
      $('overlayAttempt').textContent = '—'
      $('overlayFoot').textContent = 'HOTKEY TO HIDE'
      return
    }

    if (!active) {
      router.reset(`match:${snapshot?.match_id || 'unknown'}:${detectedMode}:no-case`)
      setVisible($('overlayFocus'), false)
      setVisible($('overlayEmpty'), true)
      $('overlayEmpty').textContent = `NO ${Product.modeLabel(detectedMode)} CASE`
      $('overlayMode').textContent = `${Product.modeLabel(detectedMode)}${snapshot.match_id ? ` · #${snapshot.match_id}` : ''}`
      $('overlayAttempt').textContent = 'OPEN DESKTOP'
      $('overlayFoot').textContent = 'ONLY CURRENT MODE IS SHOWN'
      return
    }

    $('overlayMode').textContent = `${Product.modeLabel(detectedMode)}${snapshot.match_id ? ` · #${snapshot.match_id}` : ''}`
    $('overlayAttempt').textContent = `ATTEMPT ${Math.min(active.max_attempts, active.attempts_used + 1)}/${active.max_attempts}`

    const context = `${snapshot.match_id || 'no-match'}:${detectedMode}:${active.board_id}`
    const focus = router.update({
      activeCase: active,
      snapshot,
      live,
      context,
      now: Date.now(),
      progressOf: (condition, value) => Product.conditionProgress(condition, value),
    })

    if (!renderCandidate(focus.candidate, live, focus.pending)) {
      setVisible($('overlayFocus'), false)
      setVisible($('overlayEmpty'), true)
      $('overlayEmpty').textContent = 'NO LIVE-SUPPORTED OBJECTIVE'
    }
    $('overlayFoot').textContent = verifying
      ? 'AWAITING SERVER VERDICT'
      : live
        ? focus.pending ? 'ACTIVITY DETECTED · SWITCHING AFTER 3 SEC' : 'ONE LIVE OBJECTIVE · SERVER VERDICT FINAL'
        : 'SERVER STATE'
  }

  async function previewSnapshot() {
    if (!previewPromise) previewPromise = fetch('tests/fixtures/preview.json', { cache: 'no-store' }).then(response => response.json())
    return await previewPromise
  }

  async function refresh() {
    try {
      const api = controller()
      if (api?.getSnapshot) render(await api.getSnapshot())
      else if (PREVIEW) render(await previewSnapshot())
      else render({ paired: false, game_running: false, product: Product.emptyProductState() })
    } catch (_) {}
  }

  function installDodgeBehavior() {
    const sensor = $('overlayHoverSensor')
    if (!sensor) return
    const enter = () => {
      clearTimeout(dodgeLeaveTimer)
      document.body.classList.add('overlay-dodge')
    }
    const leave = () => {
      clearTimeout(dodgeLeaveTimer)
      dodgeLeaveTimer = setTimeout(() => document.body.classList.remove('overlay-dodge'), 260)
    }
    sensor.addEventListener('pointerenter', enter)
    sensor.addEventListener('pointerleave', leave)
    sensor.addEventListener('mouseenter', enter)
    sensor.addEventListener('mouseleave', leave)
  }

  window.addEventListener('DOMContentLoaded', () => {
    installDodgeBehavior()
    void refresh()
    setInterval(() => void refresh(), REFRESH_MS)
  })
})()
