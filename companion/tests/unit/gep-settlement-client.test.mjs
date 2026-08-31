import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const GEP = require('../../src/gep-settlement-client.js')

const STEAM = '76561198736917392'
const SESSION = {
  session_id: 'session-alpha17-001',
  mode: 'STANDARD',
  match_id: 102910001,
  match_clock_s: 990,
}

function lease(status = 'ISSUED_ACTIVE') {
  return GEP.applyStartResponse(GEP.emptyState(), {
    enabled: true,
    status,
    eligible: true,
    queued: status === 'ISSUED_QUEUED',
    lease_id: 'lease-1',
    board_id: 'board-1',
    session_id: SESSION.session_id,
    attempt_nonce: 'a'.repeat(43),
  }, { sessionId: SESSION.session_id })
}

test('start payload keeps SteamID64 as string and match_id is optional', () => {
  const first = GEP.buildStartPayload({
    session: { ...SESSION, match_id: null },
    steamId: STEAM,
    gameMode: 'STANDARD',
    version: '0.5.2-alpha.17',
  })
  assert.equal(first.ok, true)
  assert.equal(first.payload.steam_id64, STEAM)
  assert.equal(first.payload.match_id, null)

  const retry = GEP.buildStartPayload({
    session: SESSION,
    steamId: STEAM,
    gameMode: 'STANDARD',
    version: '0.5.2-alpha.17',
  })
  assert.equal(retry.ok, true)
  assert.equal(retry.payload.match_id, 102910001)
})

test('public state never exposes attempt nonce', () => {
  const state = lease()
  assert.equal(state.current.attempt_nonce.length, 43)
  assert.equal(GEP.publicState(state).current.attempt_nonce, undefined)
})

test('queued lease can finalize but only from explicit match_end', () => {
  const state = lease('ISSUED_QUEUED')

  const bad = GEP.buildFinalizePayload({
    current: state.current,
    session: SESSION,
    terminalType: 'phase_postgame',
    steamId: STEAM,
    finalSequence: 8,
    evidence: { kills: 3, deaths: 0, assists: 8 },
    version: '0.5.2-alpha.17',
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'EXPLICIT_MATCH_END_REQUIRED')

  const good = GEP.buildFinalizePayload({
    current: state.current,
    session: SESSION,
    terminalType: 'match_end',
    steamId: STEAM,
    finalSequence: 8,
    evidence: {
      hero_id: 10, kills: 3, deaths: 0, assists: 8,
      healing: 13222, hero_damage: 13054, object_damage: 5082, souls: 34000,
    },
    localTeam: 'AMBER',
    winningTeam: 'AMBER',
    version: '0.5.2-alpha.17',
  })
  assert.equal(good.ok, true)
  assert.equal(good.payload.terminal_signal, 'match_end')
  assert.equal(good.payload.live_stats.assists, 8)
  assert.equal(good.payload.local_team, 'AMBER')
})

test('winning team is omitted unless both team facts are present', () => {
  const state = lease()
  const result = GEP.buildFinalizePayload({
    current: state.current,
    session: SESSION,
    terminalType: 'match_end',
    steamId: STEAM,
    finalSequence: 9,
    evidence: { kills: 1 },
    localTeam: 'AMBER',
    winningTeam: null,
    version: '0.5.2-alpha.17',
  })
  assert.equal(result.ok, true)
  assert.equal(result.payload.local_team, null)
  assert.equal(result.payload.winning_team, null)
})

test('multiple pending finals survive and acknowledge independently', () => {
  let state = GEP.emptyState()
  state = GEP.stageFinalize(state, {
    session_id: 'session-alpha17-001', match_id: 1001, attempt_nonce: 'x'.repeat(43),
  }, '2026-08-31T00:00:00.000Z')
  state = GEP.stageFinalize(state, {
    session_id: 'session-alpha17-002', match_id: 1002, attempt_nonce: 'y'.repeat(43),
  }, '2026-08-31T00:00:01.000Z')
  assert.equal(state.pending_finalizes.length, 2)

  state = GEP.acknowledgeFinalize(state, 'session-alpha17-001:1001', {
    session_id: 'session-alpha17-001',
    match_id: '1001',
    status: 'CONSUMED',
    integrity_status: 'CLIENT_ATTESTED_GEP',
    settlement_source: 'OVERWOLF_GEP',
  }, '2026-08-31T00:01:00.000Z')

  assert.equal(state.pending_finalizes.length, 1)
  assert.equal(state.pending_finalizes[0].payload.match_id, 1002)
  assert.equal(state.last_result.match_id, 1001)
})

test('failed finalization stays durable until retry time', () => {
  let state = GEP.stageFinalize(GEP.emptyState(), {
    session_id: SESSION.session_id, match_id: SESSION.match_id, attempt_nonce: 'z'.repeat(43),
  }, '2026-08-31T00:00:00.000Z')

  state = GEP.markFinalizeError(state, `${SESSION.session_id}:${SESSION.match_id}`, {
    code: 'NETWORK', message: 'offline',
    now: '2026-08-31T00:00:10.000Z', retryMs: 15000,
  })
  assert.equal(state.pending_finalizes[0].attempts, 1)
  assert.equal(GEP.dueFinalizes(state, Date.parse('2026-08-31T00:00:20.000Z')).length, 0)
  assert.equal(GEP.dueFinalizes(state, Date.parse('2026-08-31T00:00:26.000Z')).length, 1)
})
