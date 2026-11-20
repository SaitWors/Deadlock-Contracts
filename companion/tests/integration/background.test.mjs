import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const src = fs.readFileSync(new URL('../../src/background-engine.js', import.meta.url), 'utf8')

test('dock restores the last display and focuses desktop while game transitions use the other display', async () => {
  const primary = { id: 'DISPLAY1', handle: { value: 1 }, is_primary: true, x: 0, y: 0, width: 1920, height: 1080 }
  const secondary = { id: 'DISPLAY2', handle: { value: 2 }, x: -1920, y: 0, width: 1920, height: 1080 }
  const window = { id: 'desktop-id', width: 1200, height: 700, monitorId: primary.id }
  let state = 'closed'
  let displayList = [primary, secondary]
  let relaunch
  let hotkey
  const events = []
  const values = new Map()
  const context = vm.createContext({
    URL, addEventListener() {}, document: { getElementById: () => null },
    location: { href: 'overwolf-extension://fixture/background.html?source=dock' },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    overwolf: {
      extensions: { onAppLaunchTriggered: { addListener: callback => { relaunch = callback } } },
      settings: { hotkeys: {
        assign: (options, cb) => { hotkey = options; cb({ success: true }) },
        get: cb => cb({ success: true, games: { 24482: [{ name: 'toggle_contract_overlay', binding: 'Ctrl+F1' }] } }),
      } },
      games: { events: { getInfo: cb => cb({ success: false }) } },
      utils: { getMonitorsList: cb => cb({ displays: displayList }) },
      windows: {
        obtainDeclaredWindow: (_, cb) => cb({ success: true, window }),
        getWindow: (_, cb) => cb({ success: true, window }),
        getWindowState: (_, cb) => cb({ success: true, window_state_ex: state }),
        hide: (_, cb) => { state = 'hidden'; cb({ success: true }) },
        minimize: (_, cb) => cb({ success: true }),
        restore: (_, cb) => { state = 'normal'; cb({ success: true }) },
        maximize: (_, cb) => { state = 'maximized'; cb({ success: true }) },
        changePosition: (_, left, top, cb) => {
          window.monitorId = left < 0 ? secondary.id : primary.id
          events.push(['move', left, top])
          cb({ success: true })
        },
        bringToFront: (id, focus, cb) => { events.push(['front', id, focus]); cb({ success: true }) },
      },
    },
  })
  context.window = context
  const background = fs.readFileSync(new URL('../../background.html', import.meta.url), 'utf8')
  for (const [, source] of background.matchAll(/<script src="([^"]+)"/g)) {
    vm.runInContext(fs.readFileSync(new URL(`../../${source}`, import.meta.url), 'utf8'), context, { filename: source })
  }
  const api = context.dcCompanion
  const run = code => vm.runInContext(code, context)

  await run('installLaunchOrchestrator(); desktopAction')
  assert.deepEqual(events.splice(0), [['front', 'desktop-id', true]])
  await api.hideDesktop()
  await run('handleRunningGameInfo({ isRunning: true, classId: 24482, monitorHandle: { value: 1 } }); desktopAction')
  assert.deepEqual(events.splice(0), [['move', -1560, 190], ['front', 'desktop-id', false]])
  assert.equal(await api.toggleDesktopMaximized(), 'maximized')
  assert.equal(await api.toggleDesktopMaximized(), 'normal')
  await api.hideDesktop()
  await run('handleRunningGameInfo(null); desktopAction')
  assert.deepEqual(events.splice(0), [['move', 360, 190], ['front', 'desktop-id', true]])
  await api.hideDesktop()
  api.rememberDesktopMonitor('\\\\.\\DISPLAY2')
  relaunch(context.location.href)
  await run('desktopAction')
  assert.deepEqual(events.splice(0), [['move', -1560, 190], ['front', 'desktop-id', true]])
  await api.hideDesktop()
  await api.showDesktop({ placement: 'game', gameInfo: { monitorHandle: secondary.handle }, focus: false, reopen: false })
  assert.equal(state, 'hidden')
  assert.deepEqual(events.splice(0), [])
  displayList = [primary]
  await api.showDesktop()
  assert.deepEqual(events, [['move', 360, 190], ['front', 'desktop-id', true]])

  const snapshot = await api.assignOverlayHotkey(112, { ctrl: true, alt: false, shift: false })
  assert.equal(hotkey.name, 'toggle_contract_overlay')
  assert.equal(hotkey.gameId, 24482)
  assert.equal(hotkey.virtualKey, 112)
  assert.equal(snapshot.hotkey_binding, 'Ctrl+F1')
})

test('menu/game stop cannot synthesize final', () => {
  assert.doesNotMatch(src, /finishSession\(['"]game_stopped/)
  assert.doesNotMatch(src, /getInfo\(['"]match_ended/)
  assert.doesNotMatch(src, /game_detected_fallback/)
})

test('current Overwolf game API and explicit GEP status endpoint are used', () => {
  assert.match(src, /getRunningGameInfo2/)
  assert.doesNotMatch(src, /getRunningGameInfo\(/)
  assert.match(src, /game-events-status\.overwolf\.com/)
})

test('terminal proof opens a five second collection grace before final capture', () => {
  assert.match(src, /FINAL_COLLECTION_GRACE_MS = 5000/)
  assert.match(src, /function tryProveTerminalCandidate\(/)
  assert.match(src, /attachTerminalProof\(current\.id, proof, \{ deadlineAt \}\)/)
  assert.doesNotMatch(src, /details: captureTerminalDetails\(observedAt\)/)
})

test('final is captured and persisted at commit before lifecycle becomes FINALIZED', () => {
  assert.match(src, /async function commitPendingTerminal\(/)
  assert.match(src, /const details = captureTerminalDetails\(candidate\.observed_at, capturedAt\)/)
  const enqueueAt = src.indexOf('const queued = await enqueuePayload(payload)')
  const finalizeAt = src.indexOf('const finalized = lifecycle.finalize(candidate.id')
  assert.ok(enqueueAt > 0)
  assert.ok(finalizeAt > enqueueAt)
  assert.match(src, /await checkpointLifecycle\(\{ force: true \}\)/)
})

test('terminal pending survives restart and explicit exit forces durable commit', () => {
  assert.match(src, /function resumePendingTerminal\(/)
  assert.match(src, /async function forceCommitPendingTerminal\(/)
  assert.match(src, /if \(lifecycle\.snapshot\(\)\.state === Lifecycle\.MATCH_STATE\.TERMINAL_PENDING\)/)
  assert.match(src, /await persistQueue\(\)/)
})

test('queue final respects causal predecessor acknowledgement', () => {
  assert.match(src, /allPriorAcknowledged/)
  assert.match(src, /classifyUploadError/)
  assert.match(src, /seedSequencesFromQueue/)
})

test('terminal payload uses late captured context instead of stale global state', () => {
  assert.match(src, /function captureTerminalDetails\(/)
  assert.match(src, /terminal_observed_at:/)
  assert.match(src, /snapshot_captured_at:/)
  assert.match(src, /context: details/)
  assert.match(src, /terminalContext\?\.match_clock_s \?\? session\.match_clock_s/)
  assert.doesNotMatch(src, /session\.match_id \|\| terminalContext\?\.match_id \|\| state\.matchId/)
})

test('identity is applied before phase in getInfo snapshots', () => {
  const extractStart = src.indexOf('function extractKnown(')
  const extractEnd = src.indexOf('function applyInfoUpdate(', extractStart)
  const extract = src.slice(extractStart, extractEnd)
  assert.ok(extract.indexOf('applyMatchId(mi.match_id') < extract.indexOf('applyPhase(gi.phase'))
})

test('new sessions reset match-scoped state while same-session recovery preserves evidence', () => {
  assert.match(src, /function resetMatchScopedState\(/)
  assert.match(src, /const newSession = result\?\.created === true \|\| result\?\.replaced_interrupted === true/)
  assert.match(src, /else if \(result\?\.recovered === true\)/)
  assert.match(src, /Same-session restart recovery preserves evidence/)
})

test('outcome observed before exact match id is bound to immutable session first', () => {
  assert.match(src, /pendingOutcome: null/)
  assert.match(src, /function bindPendingOutcome\(/)
  assert.match(src, /session_id: session\.session_id/)
  assert.match(src, /bindPendingOutcome\(state\.matchId\)/)
})

test('evidence keeps per-metric correlation metadata and performance counters are instrumented', () => {
  assert.match(src, /evidenceMeta:\s*\{\}/)
  assert.match(src, /state\.evidenceMeta\[key\]\s*=\s*\{/)
  assert.match(src, /session_id:\s*session\?\.session_id/)
  assert.match(src, /match_id:\s*session\?\.match_id/)
  assert.match(src, /observed_at:\s*observedAt/)
  assert.match(src, /performanceCounters\.overlay_dto_max_bytes/)
  assert.match(src, /performanceCounters\.runtime_state_publications\s*\+=\s*1/)
})

test('server board actions are not blocked merely because Deadlock is open or GEP is stale', () => {
  assert.doesNotMatch(src, /function liveGepBlocksServerAction\(/)
  assert.doesNotMatch(src, /ACTION_BLOCKED_GEP_STALE/)
  assert.doesNotMatch(src, /LIVE_MODE_MISMATCH/)
  assert.match(src, /\/api\/companion\/attempts\/start/)
})

test('game mode resolver consumes the complete GEP game_mode payload', () => {
  assert.match(src, /const nextRaw = parseMaybeJson\(value\)/)
  assert.match(src, /Product\.normalizeModeResult\(nextRaw\)/)
  assert.doesNotMatch(src, /match_mode \|\| state\.gameModeRaw\?\.game_mode/)
})

test('partial roster updates do not delete accumulated evidence and correlation is session-stable', () => {
  assert.match(src, /Evidence\.mergeMetric/)
  assert.doesNotMatch(src, /delete state\.evidence\[key\]/)
  assert.match(src, /Evidence\.correlationKey\(lifecycle\.currentSession\(\)\)/)
})

test('overlay focus considers every selected contract condition instead of only conditions zero', () => {
  assert.match(src, /conditions\.forEach\(\(condition, conditionIndex\)/)
  assert.match(src, /FocusSelector\.choose\(candidates/)
  assert.doesNotMatch(src, /focusOption\?\.conditions\?\.\[0\]/)
})

test('transient match id and lower clock samples cannot clear live Street Brawl display', () => {
  assert.match(src, /MATCH_ID_CONFLICT_IGNORED/)
  assert.match(src, /roundAwareMetricValue\('match_clock_s', rawSeconds\)/)
  assert.match(src, /street_brawl_round_epoch/)
})

test('Street Brawl round-aware accumulation is preserved together with modular evidence merge', () => {
  assert.match(src, /STREET_BRAWL_ACCUMULATED_METRICS/)
  assert.match(src, /function roundAwareMetricValue\(/)
  assert.match(src, /roundAwareMetricValue\('match_clock_s'/)
  assert.match(src, /const adjusted = roundAwareMetricValue\(key, row\[key\]\)/)
  assert.match(src, /Evidence\.mergeMetric/)
})

test('Street Brawl PostGame is treated as a round boundary, not a synthetic final', () => {
  assert.match(src, /STREET_BRAWL_ROUND_POSTGAME/)
  assert.match(src, /if \(isStreetBrawl\(\)\)/)
})

test('known mode stays sticky for the active immutable match session', () => {
  assert.match(src, /SESSION_MODE_STICKY_IGNORED/)
  assert.match(src, /Lifecycle\.MATCH_STATE\.MATCH_CONFIRMED/)
  assert.match(src, /Lifecycle\.MATCH_STATE\.TERMINAL_PENDING/)
  assert.match(src, /previousMode/)
  assert.match(src, /ignored_mode/)
  assert.match(src, /preserved_mode/)
})
