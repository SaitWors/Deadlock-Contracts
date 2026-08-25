import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const Policy = require('../src/queue-policy.js')

const item = (eventType, id) => ({ id, event_type: eventType })

test('queue pressure evicts replaceable telemetry before transitions', () => {
  const queue = [
    item('match_started', 'start'),
    item('heartbeat', 'heartbeat'),
    item('phase_changed', 'phase'),
    item('game_stopped', 'stop'),
  ]
  assert.deepEqual(Policy.trim(queue, 3).map(entry => entry.id), ['start', 'phase', 'stop'])
})

test('match lifecycle edges are never discarded by the soft queue limit', () => {
  const queue = [
    item('match_started', 'start-a'),
    item('match_ended', 'final-a'),
    item('match_started', 'start-b'),
    item('match_ended', 'final-b'),
  ]
  assert.deepEqual(Policy.trim(queue, 1).map(entry => entry.id), [
    'start-a',
    'final-a',
    'start-b',
    'final-b',
  ])
})

test('retry delay is bounded exponential backoff with jitter', () => {
  assert.equal(Policy.retryDelayMs(1, () => 0), 5000)
  assert.equal(Policy.retryDelayMs(2, () => 0), 10000)
  assert.equal(Policy.retryDelayMs(20, () => 1), Policy.MAX_RETRY_DELAY_MS)
})

test('due calculation treats missing timestamps as immediately sendable', () => {
  assert.equal(Policy.isDue({}, 1000), true)
  assert.equal(Policy.isDue({ next_attempt_at: '1970-01-01T00:00:02.000Z' }, 1000), false)
  assert.equal(Policy.isDue({ next_attempt_at: '1970-01-01T00:00:01.000Z' }, 1000), true)
})
