import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const Product = require(path.join(root, 'src/product.js'))
const Focus = require(path.join(root, 'src/overlay-focus.js'))

const option = (id, metric, target, title = id) => ({
  id, title, reward_xp: 70, selected: true, status: 'LOCKED',
  conditions: [{ metric, operator: 'gte', target }],
})

const activeCase = {
  board_id: 'board-standard', game_match_mode: 'STANDARD', status: 'LOCKED', attempts_used: 0, max_attempts: 3,
  options: [
    option('kills', 'player.kills', 8, 'Kill contract'),
    option('assists', 'player.assists', 10, 'Assist contract'),
    option('damage', 'player.hero_damage', 30000, 'Damage contract'),
  ],
}

const snapshot = (kills, assists, heroDamage) => ({ evidence: { kills, assists, hero_damage: heroDamage, deaths: 0 } })
const progressOf = (condition, value) => Product.conditionProgress(condition, value)

test('focus router keeps exactly one candidate and waits three seconds from the first activity before switching', () => {
  const router = Focus.createRouter({ switchDelayMs: 3000, activeSuppressionMs: 2200 })
  let state = router.update({ activeCase, snapshot: snapshot(0, 0, 0), live: true, context: 'm1', now: 0, progressOf })
  assert.equal(state.candidate.option.id, 'kills')

  state = router.update({ activeCase, snapshot: snapshot(0, 0, 5000), live: true, context: 'm1', now: 500, progressOf })
  assert.equal(state.candidate.option.id, 'kills')
  assert.equal(state.pending.key.includes('damage'), true)

  state = router.update({ activeCase, snapshot: snapshot(0, 0, 12000), live: true, context: 'm1', now: 3400, progressOf })
  assert.equal(state.candidate.option.id, 'kills')

  state = router.update({ activeCase, snapshot: snapshot(0, 0, 13000), live: true, context: 'm1', now: 3600, progressOf })
  assert.equal(state.candidate.option.id, 'damage')
})

test('damage can become focus, then assist and kill are coalesced by the three-second settle window', () => {
  const router = Focus.createRouter({ switchDelayMs: 3000, activeSuppressionMs: 2200 })
  router.update({ activeCase, snapshot: snapshot(0, 0, 0), live: true, context: 'm2', now: 0, progressOf })

  let state = router.update({ activeCase, snapshot: snapshot(0, 0, 4000), live: true, context: 'm2', now: 100, progressOf })
  assert.equal(state.pending.key.includes('damage'), true)
  state = router.update({ activeCase, snapshot: snapshot(0, 0, 8000), live: true, context: 'm2', now: 3200, progressOf })
  assert.equal(state.candidate.option.id, 'damage')

  state = router.update({ activeCase, snapshot: snapshot(0, 1, 9000), live: true, context: 'm2', now: 3500, progressOf })
  assert.equal(state.pending.key.includes('assists'), true)

  // A kill arrives during the same settle window. It becomes the pending focus without restarting the 3s timer.
  state = router.update({ activeCase, snapshot: snapshot(1, 1, 10000), live: true, context: 'm2', now: 4200, progressOf })
  assert.equal(state.candidate.option.id, 'damage')
  assert.equal(state.pending.key.includes('kills'), true)

  state = router.update({ activeCase, snapshot: snapshot(1, 1, 10500), live: true, context: 'm2', now: 6600, progressOf })
  assert.equal(state.candidate.option.id, 'kills')
  assert.equal(state.pending, null)
})

test('context change resets stale live values and cannot carry focus between matches', () => {
  const router = Focus.createRouter({ switchDelayMs: 3000, activeSuppressionMs: 0 })
  router.update({ activeCase, snapshot: snapshot(0, 0, 0), live: true, context: 'match-a', now: 0, progressOf })
  router.update({ activeCase, snapshot: snapshot(0, 1, 1000), live: true, context: 'match-a', now: 100, progressOf })
  const next = router.update({ activeCase, snapshot: snapshot(0, 0, 0), live: true, context: 'match-b', now: 200, progressOf })
  assert.equal(next.pending, null)
  assert.equal(next.candidate.option.id, 'kills')
})

test('duration is low-priority and cannot steal focus while a stronger metric remains active', () => {
  const caseWithTime = {
    ...activeCase,
    options: [option('damage', 'player.hero_damage', 30000), option('time', 'match.duration_s', 1800)],
  }
  const router = Focus.createRouter({ switchDelayMs: 3000, activeSuppressionMs: 2200 })
  router.update({ activeCase: caseWithTime, snapshot: { evidence: { hero_damage: 0 }, match_clock_s: 10 }, live: true, context: 'm3', now: 0, progressOf })
  let state = router.update({ activeCase: caseWithTime, snapshot: { evidence: { hero_damage: 2000 }, match_clock_s: 11 }, live: true, context: 'm3', now: 500, progressOf })
  assert.equal(state.candidate.option.id, 'damage')
  assert.equal(state.pending, null)
  state = router.update({ activeCase: caseWithTime, snapshot: { evidence: { hero_damage: 4000 }, match_clock_s: 12 }, live: true, context: 'm3', now: 1000, progressOf })
  assert.equal(state.pending, null)
})
