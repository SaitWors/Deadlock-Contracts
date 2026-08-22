import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const Guard = require(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src/session-guard.js'))

test('suppresses the observed post-finalization GEP phase bounce', () => {
  for (const nextPhase of ['Init', 'WaitingForPlayersToJoin', 'PreGameWait', 'GameInProgress']) {
    assert.equal(Guard.shouldSuppressLifecycle({
      finalizedMatchId: 100180758,
      currentMatchId: 100180758,
      nextPhase,
    }), true)
  }
  assert.equal(Guard.shouldSuppressLifecycle({
    finalizedMatchId: 100180758,
    currentMatchId: 100180759,
    nextPhase: 'GameInProgress',
  }), false)
})

test('queues one match_ended snapshot per exact match and session', () => {
  const payload = { match_id: 100180758, session_id: 'session-regression' }
  assert.equal(Guard.shouldQueueFinalUpload({ finalized: {}, queue: [], payload }), true)

  const queue = [{ event_type: 'match_ended', payload }]
  assert.equal(Guard.shouldQueueFinalUpload({ finalized: {}, queue, payload }), false)

  const finalized = {
    match_id: 100180758,
    upload_key: '100180758:session-regression',
    upload_queued_at: '2026-08-18T12:31:00Z',
  }
  assert.equal(Guard.shouldQueueFinalUpload({ finalized, queue: [], payload }), false)
  assert.equal(Guard.shouldQueueFinalUpload({
    finalized,
    queue: [],
    payload: { match_id: 100180759, session_id: 'session-next' },
  }), true)
})


test('rejects a pre-game match_end without gameplay proof', () => {
  assert.equal(
    Guard.hasTerminalGameplayProof({
      phase: 'MatchIntro',
      matchClockS: null,
      elapsedSeconds: 9,
    }),
    false,
  )

  assert.equal(
    Guard.hasTerminalGameplayProof({
      phase: 'GameInProgress',
      matchClockS: 1062,
      elapsedSeconds: 1080,
    }),
    true,
  )

  assert.equal(
    Guard.hasTerminalGameplayProof({
      phase: 'PostGame',
      matchClockS: null,
      elapsedSeconds: 10,
    }),
    false,
  )

  assert.equal(
    Guard.hasTerminalGameplayProof({
      phase: 'PostGame',
      matchClockS: 1,
      elapsedSeconds: 10,
    }),
    true,
  )

  assert.equal(
    Guard.hasTerminalGameplayProof({
      phase: 'MatchIntro',
      matchClockS: null,
      elapsedSeconds: 120,
    }),
    true,
  )
})
