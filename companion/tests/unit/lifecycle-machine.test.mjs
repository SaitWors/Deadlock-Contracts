import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const {MATCH_STATE, createLifecycleMachine} = require('../../src/lifecycle-machine.js')

function machine() {
  let id = 0
  return createLifecycleMachine({
    now: () => `2026-08-29T00:00:${String(id).padStart(2, '0')}.000Z`,
    createId: prefix => `${prefix}-${++id}`,
  })
}
function confirmed(m, matchId = 123) {
  m.observeProcess({running: true})
  m.observeMatchStart()
  m.observeMatchId({matchId, source: 'info_update'})
  m.observeMatchClock({seconds: 120})
}

test('menu-close-no-final', () => {
  const m = machine()
  m.observeProcess({running: true})
  assert.equal(m.snapshot().state, MATCH_STATE.PROCESS_ONLY)
  m.observeProcess({running: false})
  assert.equal(m.snapshot().state, MATCH_STATE.NO_GAME)
  assert.equal(m.snapshot().finalized, null)
  assert.equal(m.terminalCandidate(), null)
})

test('lobby-close-no-final', () => {
  const m = machine()
  m.observeProcess({running: true})
  m.observePhase({phase: 'WaitingForPlayersToJoin', source: 'info_update'})
  m.observeProcess({running: false})
  assert.equal(m.snapshot().state, MATCH_STATE.NO_GAME)
  assert.equal(m.snapshot().finalized, null)
})

test('valid-match-id-confirms-match', () => {
  const m = machine()
  m.observeProcess({running: true})
  const r = m.observeMatchId({matchId: 42, source: 'info_update'})
  assert.equal(r.confirmed, true)
  assert.equal(r.created, true)
  assert.equal(m.snapshot().state, MATCH_STATE.MATCH_CONFIRMED)
  assert.equal(m.currentSession().match_id, 42)
})

test('match-clock-confirms-match', () => {
  const m = machine()
  m.observeProcess({running: true})
  const r = m.observeMatchClock({seconds: 35})
  assert.equal(r.created, true)
  assert.equal(m.snapshot().state, MATCH_STATE.MATCH_CONFIRMED)
  assert.equal(m.currentSession().match_clock_s, 35)
})

test('match-start confirms match without fake clock', () => {
  const m = machine()
  m.observeProcess({running: true})
  m.observeMatchStart()
  assert.equal(m.snapshot().state, MATCH_STATE.MATCH_CONFIRMED)
  assert.equal(m.currentSession().confirmed_by, 'match_start')
  assert.equal(m.currentSession().match_clock_s, null)
})

test('game-in-progress-confirms-match', () => {
  const m = machine()
  m.observeProcess({running: true})
  const r = m.observePhase({phase: 'GameInProgress', source: 'info_update'})
  assert.equal(r.created, true)
  assert.equal(m.snapshot().state, MATCH_STATE.MATCH_CONFIRMED)
})

test('mid-match-stop-interrupted', () => {
  const m = machine()
  confirmed(m, 222)
  m.observeProcess({running: false})
  assert.equal(m.snapshot().state, MATCH_STATE.INTERRUPTED)
  assert.equal(m.snapshot().finalized, null)
  assert.equal(m.terminalCandidate(), null)
})

test('postgame requires correlation and produces one final', () => {
  const m = machine()
  m.observeHistory({matches: [{match_id: 10}]})
  confirmed(m, 333)
  const c = m.observeTerminalSignal({type: 'phase_postgame'})
  assert.equal(m.snapshot().state, MATCH_STATE.TERMINAL_PENDING)
  assert.equal(m.correlateTerminal(c.id).ok, false)
  m.observeHistory({matches: [{match_id: 10}, {match_id: 333}]})
  const proof = m.correlateTerminal(c.id)
  assert.equal(proof.ok, true)
  const attached = m.attachTerminalProof(c.id, proof, {deadlineAt: 5000})
  assert.equal(attached.ok, true)
  const first = m.finalize(c.id, proof, {details: {evidence: {kills: 8}, snapshot_captured_at: 'capture'}})
  const second = m.finalize(c.id, proof, {details: {evidence: {kills: 99}}})
  assert.equal(first.ok, true)
  assert.deepEqual(second, first)
  assert.equal(first.finalized.terminal_details.evidence.kills, 8)
  assert.equal(first.finalized.terminal_observed_at, c.observed_at)
  assert.equal(first.finalized.snapshot_captured_at, 'capture')
  assert.equal(m.snapshot().state, MATCH_STATE.FINALIZED)
})

test('match_end proof remains terminal-pending until explicit commit', () => {
  const m = machine()
  confirmed(m, 444)
  const c = m.observeTerminalSignal({type: 'match_end'})
  const proof = m.correlateTerminal(c.id)
  assert.equal(proof.ok, true)
  assert.equal(proof.type, 'gep_match_end')
  const attached = m.attachTerminalProof(c.id, proof, {deadlineAt: 12345})
  assert.equal(attached.ok, true)
  assert.equal(m.snapshot().state, MATCH_STATE.TERMINAL_PENDING)
  assert.equal(m.terminalCandidate().commit_deadline_at, 12345)
  const f = m.finalize(c.id, null, {details: {evidence: {assists: 3}}})
  assert.equal(f.finalized.match_id, 444)
  assert.equal(f.finalized.terminal_details.evidence.assists, 3)
})

test('terminal details are captured at commit, not terminal signal', () => {
  const m = machine()
  confirmed(m, 555)
  const c = m.observeTerminalSignal({type: 'match_end'})
  const proof = m.correlateTerminal(c.id)
  m.attachTerminalProof(c.id, proof, {deadlineAt: 5000})
  const final = m.finalize(c.id, null, {details: {evidence: {kills: 9}, snapshot_captured_at: 'late'}})
  assert.equal(final.finalized.terminal_details.evidence.kills, 9)
  assert.equal(final.finalized.snapshot_captured_at, 'late')
})

test('terminal pending proof and deadline survive restart', () => {
  const a = machine()
  confirmed(a, 556)
  const c = a.observeTerminalSignal({type: 'match_end'})
  const proof = a.correlateTerminal(c.id)
  a.attachTerminalProof(c.id, proof, {deadlineAt: 9999})
  const saved = a.snapshot()

  const b = machine()
  const restored = b.restore(saved)
  assert.equal(restored.ok, true)
  assert.equal(b.snapshot().state, MATCH_STATE.TERMINAL_PENDING)
  assert.equal(b.terminalCandidate().proof.ok, true)
  assert.equal(b.terminalCandidate().commit_deadline_at, 9999)
})

test('late exact match id can correlate an already pending match_end', () => {
  const m = machine()
  m.observeProcess({running: true})
  m.observeMatchStart()
  m.observeMatchClock({seconds: 90})
  const c = m.observeTerminalSignal({type: 'match_end'})
  assert.equal(m.correlateTerminal(c.id).ok, false)
  const id = m.observeMatchId({matchId: 901, source: 'info_update'})
  assert.equal(id.confirmed, true)
  const proof = m.correlateTerminal(c.id)
  assert.equal(proof.ok, true)
  assert.equal(proof.match_id, 901)
  m.attachTerminalProof(c.id, proof, {deadlineAt: 1})
  const f = m.finalize(c.id, null, {details: {match_id: 901, match_clock_s: 91}})
  assert.equal(f.finalized.match_id, 901)
  assert.equal(f.finalized.session_snapshot.match_id, 901)
})

test('persisted active session restores interrupted and phase alone cannot revive known identity', () => {
  const a = machine()
  confirmed(a, 777)
  const saved = a.snapshot()
  const b = machine()
  const result = b.restore(saved)
  assert.equal(result.ok, true)
  assert.equal(b.snapshot().state, MATCH_STATE.INTERRUPTED)
  assert.equal(b.currentSession().match_id, 777)

  const phase = b.observePhase({phase: 'GameInProgress', source: 'info_update'})
  assert.equal(phase.reason, 'identity_required_for_recovery')
  assert.equal(b.snapshot().state, MATCH_STATE.INTERRUPTED)

  const id = b.observeMatchId({matchId: 777, source: 'info_update'})
  assert.equal(id.recovered, true)
  assert.equal(b.snapshot().state, MATCH_STATE.MATCH_CONFIRMED)
})

test('previous finalized match id cannot bind to a newly created session', () => {
  const m = machine()
  confirmed(m, 100)
  const c = m.observeTerminalSignal({type: 'match_end'})
  const proof = m.correlateTerminal(c.id)
  m.attachTerminalProof(c.id, proof, {deadlineAt: 1})
  m.finalize(c.id, null, {details: {match_id: 100, match_clock_s: 120}})

  const next = m.observeMatchStart()
  assert.equal(next.created, true)
  assert.equal(m.currentSession().match_id, null)
  const stale = m.observeMatchId({matchId: 100, source: 'get_info'})
  assert.equal(stale.confirmed, false)
  assert.equal(stale.reason, 'previous_match_id_rediscovered')
  assert.equal(m.currentSession().match_id, null)
  const fresh = m.observeMatchId({matchId: 101, source: 'info_update'})
  assert.equal(fresh.confirmed, true)
  assert.equal(m.currentSession().match_id, 101)
})

test('transient conflicting match id cannot interrupt a confirmed Street Brawl session', () => {
  const m = machine()
  confirmed(m, 101991017)
  const before = m.currentSession()
  const result = m.observeMatchId({matchId: 999999999, source: 'get_info'})
  assert.equal(result.confirmed, false)
  assert.equal(result.reason, 'match_id_conflict_ignored')
  assert.equal(m.snapshot().state, MATCH_STATE.MATCH_CONFIRMED)
  assert.equal(m.currentSession().session_id, before.session_id)
  assert.equal(m.currentSession().match_id, 101991017)
})
