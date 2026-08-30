import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const Q = require('../../src/upload-queue.js')

function payload(session, match, event, sequence) {
  return {
    schema_version: 8,
    client_version: '0.5.2-alpha.16',
    device_id: 'd',
    event_type: event,
    session_id: session,
    match_id: match,
    match_clock_s: event === 'match_ended' ? 300 : 10,
    terminal_proof: event === 'match_ended' ? {type: 'gep_match_end', observed_at: 'x'} : null,
    sequence,
  }
}

test('causal key remains stable when match id changes unknown to known', () => {
  assert.equal(Q.sessionKey(payload('a', null, 'match_started', 1)), 'session:a')
  assert.equal(Q.sessionKey(payload('a', 123, 'match_ended', 2)), 'session:a')
})

test('causal-offline-order keeps known final behind unknown-id start', () => {
  let now = 1
  const q = Q.createUploadQueue({now: () => now})
  const start = q.enqueue(payload('a', null, 'match_started', 1), {sequence: 1})
  now += 1
  const final = q.enqueue(payload('a', 123, 'match_ended', 2), {sequence: 2})
  assert.equal(q.nextDue().id, start.item.id)
  q.markInFlight(start.item.id)
  assert.equal(q.nextDue(), null)
  q.acknowledge(start.item.id)
  assert.equal(q.nextDue().id, final.item.id)
})

test('persisted in-flight request recovers to retry-wait with same idempotency key', () => {
  let now = 1000
  const a = Q.createUploadQueue({now: () => now})
  const start = a.enqueue(payload('s', null, 'match_started', 1), {sequence: 1})
  a.markInFlight(start.item.id)
  const before = a.snapshot()
  const originalKey = before.items[0].idempotency_key

  now = 2000
  const b = Q.createUploadQueue({now: () => now})
  const migrated = b.replace(before)
  assert.equal(migrated.schema_version, 3)
  assert.equal(migrated.items[0].session_key, 'session:s')
  assert.equal(migrated.items[0].state, Q.ITEM_STATE.RETRY_WAIT)
  assert.equal(migrated.items[0].last_error.code, 'RECOVERED_UNKNOWN_IN_FLIGHT')
  assert.equal(migrated.items[0].idempotency_key, originalKey)
  assert.equal(b.nextDue().id, start.item.id)
})

test('v2 causal keys are migrated without changing idempotency identity', () => {
  const q = Q.createUploadQueue({now: () => 5000})
  const oldKey = 'match:unknown:session:s:event:match_started:schema:8'
  const restored = q.replace({
    schema_version: 2,
    items: [{
      id: 'old',
      idempotency_key: oldKey,
      session_key: 'match:unknown:session:s',
      sequence: 1,
      event_type: 'match_started',
      state: Q.ITEM_STATE.PENDING,
      created_at: '2026-08-29T00:00:00Z',
      attempts: 0,
      next_attempt_at: null,
      last_error: null,
      payload: {...payload('s', null, 'match_started', 1), idempotency_key: oldKey},
    }],
    dead_letter: [],
  })
  assert.equal(restored.schema_version, 3)
  assert.equal(restored.items[0].session_key, 'session:s')
  assert.equal(restored.items[0].idempotency_key, oldKey)
})

test('poison-does-not-block another session', () => {
  let now = 1
  const q = Q.createUploadQueue({now: () => now})
  const a = q.enqueue(payload('a', 1, 'match_started', 1), {sequence: 1})
  const af = q.enqueue(payload('a', 1, 'match_ended', 2), {sequence: 2})
  const b = q.enqueue(payload('b', 2, 'match_started', 1), {sequence: 1})
  q.deadLetter(a.item.id, {code: 'INVALID'})
  const next = q.nextDue()
  assert.equal(next.id, b.item.id)
  assert.notEqual(next.id, af.item.id)
})

test('auth-only-401 classification does not clear auth on 422 invalid payload', () => {
  assert.equal(Q.classifyUploadError({status: 401, code: 'HTTP_401'}), 'AUTH')
  assert.equal(Q.classifyUploadError({status: 422, code: 'INVALID_PAYLOAD', message: 'invalid token-looking payload'}), 'DEAD_LETTER')
  assert.equal(Q.classifyUploadError({status: 500}), 'RETRY')
})

test('duplicate final is idempotent', () => {
  const q = Q.createUploadQueue()
  const p = payload('a', 1, 'match_ended', 3)
  p.idempotency_key = Q.idempotencyKey(p, 'match_ended', 8)
  const a = q.enqueue(p, {sequence: 3, idempotencyKey: p.idempotency_key})
  const b = q.enqueue(p, {sequence: 3, idempotencyKey: p.idempotency_key})
  assert.equal(a.ok, true)
  assert.equal(b.duplicate, true)
  assert.equal(q.totals().items, 1)
})

test('legacy alpha8 terminal enters dead letter', () => {
  const q = Q.createUploadQueue()
  q.migrateLegacy([{created_at: '2026-01-01T00:00:00Z', event_type: 'match_ended', payload: {match_id: 9, session_id: 's', schema_version: 7}}])
  assert.equal(q.totals().items, 0)
  assert.equal(q.totals().dead_letter, 1)
  assert.equal(q.snapshot().dead_letter[0].last_error.code, 'LEGACY_ALPHA8_TERMINAL_REVIEW')
})

test('final is dead-lettered when a causal predecessor was rejected', () => {
  let now = 1
  const q = Q.createUploadQueue({now: () => now})
  const start = q.enqueue(payload('a', 1, 'match_started', 1), {sequence: 1})
  now += 1
  const final = q.enqueue(payload('a', 1, 'match_ended', 2), {sequence: 2})
  q.deadLetter(start.item.id, {code: 'INVALID_START'})
  assert.equal(q.nextDue(), null)
  const snap = q.snapshot()
  assert.equal(snap.items.some(item => item.id === final.item.id), false)
  const terminal = snap.dead_letter.find(item => item.id === final.item.id)
  assert.equal(terminal?.last_error?.code, 'PREREQUISITE_REJECTED')
})
