import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../../src/background-engine.js', import.meta.url), 'utf8')

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

test('server actions fail closed on stale GEP while Deadlock is running', () => {
  assert.match(src, /function liveGepBlocksServerAction\(/)
  assert.match(src, /ACTION_BLOCKED_GEP_STALE/)
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
