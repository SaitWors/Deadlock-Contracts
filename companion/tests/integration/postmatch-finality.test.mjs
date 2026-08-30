import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const Lifecycle = require('../../src/lifecycle-machine.js')
const Queue = require('../../src/upload-queue.js')

function lifecycleMachine() {
  let serial = 0
  return Lifecycle.createLifecycleMachine({
    now: () => `2026-08-29T12:00:${String(serial).padStart(2, '0')}.000Z`,
    createId: prefix => `${prefix}-${++serial}`,
  })
}

function queuedEvent(sessionId, matchId, eventType, sequence, proof = null) {
  return {
    schema_version: 8,
    client_version: '0.5.2-alpha.16',
    device_id: 'device',
    event_type: eventType,
    session_id: sessionId,
    match_id: matchId,
    match_clock_s: eventType === 'match_ended' ? 125 : 1,
    observed_at: '2026-08-29T12:00:00Z',
    terminal_proof: proof,
    sequence,
  }
}

test('post-match grace can capture late details without letting final bypass start', () => {
  const m = lifecycleMachine()
  m.observeProcess({running: true})
  const start = m.observeMatchStart()
  const sessionId = start.session.session_id

  const q = Queue.createUploadQueue({now: () => 1000})
  const queuedStart = q.enqueue(queuedEvent(sessionId, null, 'match_started', 1), {sequence: 1})

  m.observeMatchId({matchId: 123, source: 'info_update'})
  m.observeMatchClock({seconds: 120})
  const candidate = m.observeTerminalSignal({type: 'match_end', observedAt: '2026-08-29T12:30:00Z'})
  const proof = m.correlateTerminal(candidate.id)
  assert.equal(proof.ok, true)
  m.attachTerminalProof(candidate.id, proof, {deadlineAt: 6000})

  // Simulate late GEP updates arriving during the collection grace.
  m.observeMatchClock({seconds: 125, observedAt: '2026-08-29T12:30:03Z'})
  const finalized = m.finalize(candidate.id, null, {
    details: {
      match_id: 123,
      match_clock_s: 125,
      match_outcome: 'SAPPHIRE',
      evidence: {kills: 10, deaths: 3, assists: 18},
      snapshot_captured_at: '2026-08-29T12:30:05Z',
    },
  })
  assert.equal(finalized.ok, true)
  assert.equal(finalized.finalized.terminal_details.evidence.kills, 10)
  assert.equal(finalized.finalized.match_clock_s, 125)

  const finalPayload = queuedEvent(sessionId, 123, 'match_ended', 2, proof)
  const queuedFinal = q.enqueue(finalPayload, {sequence: 2})
  q.markInFlight(queuedStart.item.id)
  assert.equal(q.nextDue(), null)
  q.acknowledge(queuedStart.item.id)
  assert.equal(q.nextDue().id, queuedFinal.item.id)
})

test('crash recovery keeps terminal proof and retries unknown in-flight predecessor safely', () => {
  const a = lifecycleMachine()
  a.observeProcess({running: true})
  a.observeMatchStart()
  a.observeMatchId({matchId: 321, source: 'info_update'})
  a.observeMatchClock({seconds: 80})
  const candidate = a.observeTerminalSignal({type: 'match_end'})
  const proof = a.correlateTerminal(candidate.id)
  a.attachTerminalProof(candidate.id, proof, {deadlineAt: 5000})

  const sessionId = a.currentSession().session_id
  const q1 = Queue.createUploadQueue({now: () => 1000})
  const start = q1.enqueue(queuedEvent(sessionId, null, 'match_started', 1), {sequence: 1})
  q1.markInFlight(start.item.id)
  const originalIdempotency = q1.snapshot().items[0].idempotency_key

  // Process dies before ACK and before terminal commit.
  const b = lifecycleMachine()
  assert.equal(b.restore(a.snapshot()).ok, true)
  assert.equal(b.snapshot().state, Lifecycle.MATCH_STATE.TERMINAL_PENDING)
  assert.equal(b.terminalCandidate().proof.ok, true)

  const q2 = Queue.createUploadQueue({now: () => 2000})
  q2.replace(q1.snapshot())
  const recoveredStart = q2.nextDue()
  assert.equal(recoveredStart.state, Queue.ITEM_STATE.RETRY_WAIT)
  assert.equal(recoveredStart.idempotency_key, originalIdempotency)

  const restoredCandidate = b.terminalCandidate()
  const finalized = b.finalize(restoredCandidate.id, null, {
    details: {match_id: 321, match_clock_s: 80, evidence: {kills: 4}},
  })
  assert.equal(finalized.ok, true)
  const final = q2.enqueue(queuedEvent(sessionId, 321, 'match_ended', 2, restoredCandidate.proof), {sequence: 2})
  assert.equal(final.ok, true)
  assert.equal(q2.nextDue().id, recoveredStart.id)
})
