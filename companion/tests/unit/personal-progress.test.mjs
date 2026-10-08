import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Product = require('../../src/product.js')

const base = {
  api_version: 'desktop.v1', schema_version: 2, server_time: '2026-10-08T12:00:00Z',
  desktop_features: ['debrief_v1', 'personal_progress_v1'], boards: [], active_cases: [],
  history: { items: [] }, progression: { total_xp: 250, level: 2 },
}

function progress(mode = 'STANDARD') {
  return {
    version: 'personal-progress-1', mode, intent: 'PRACTICE', sample_size: 9,
    minimum_sample_size: 8, confidence: 'LOW', sources: [{ kind: 'CLIENT_ATTESTED_GEP', count: 9 }],
    board: { id: 'board-1', status: 'OFFERED', generation: 1 },
    goal: {
      option_id: 'option-1', title_i18n: { ru: 'Держим строй', en: 'Hold together' },
      description_i18n: { ru: '8 помощей', en: '8 assists' }, reward_xp: 50, status: 'OFFERED',
      conditions: [{ metric: 'player.assists', operator: 'gte', target: 8 }],
      basis: [{ metric: 'player.assists', n: 9, median: 6, target: 8, source: 'median' }],
      reason: { ru: 'По последним матчам', en: 'Based on recent matches' }, personalized: true,
    },
    alternatives: [],
    debrief: {
      match_id: '100', hero_id: 18, played_at: '2026-10-08T11:00:00Z', source: 'CLIENT_ATTESTED_GEP',
      baseline_sample_size: 8, baseline_scope: 'SAME_HERO',
      comparisons: [{ metric: 'player.assists', current: 9, median: 6, delta: 3, n: 8, improved: true }],
      contracts: [{ assignment_id: 'assignment-1', title_i18n: { ru: 'Дело', en: 'Case' }, status: 'COMPLETED', reward_granted_xp: 50, explanation: 'Done' }],
      xp_granted: 50,
    },
    heroes: [{ hero_id: 18, matches: 9, contracts_completed: 1, records: [{ metric: 'player.assists', value: 9 }], sources: [{ kind: 'CLIENT_ATTESTED_GEP', count: 9 }] }],
  }
}

function normalize(value = progress(), extras = {}) {
  return Product.normalizeBootstrap({ ...base, personal_progress: { STANDARD: value }, ...extras })
}

test('bootstrap retains a supported private progress projection without copying unrelated fields', () => {
  const raw = progress()
  raw.account_id = 'another-account'
  raw.hero_xp = 9999
  raw.heroes[0].mastery_level = 30
  raw.sources[0].verified = true
  const product = normalize(raw)
  assert.equal(product.personal_progress?.STANDARD?.debrief?.comparisons[0]?.current, 9)
  assert.equal(product.personal_progress.STANDARD.goal.option_id, 'option-1')
  assert.deepEqual(product.personal_progress.STANDARD.sources, [{ kind: 'CLIENT_ATTESTED_GEP', count: 9 }])
  assert.equal(product.personal_progress.STANDARD.account_id, undefined)
  assert.equal(product.personal_progress.STANDARD.hero_xp, undefined)
  assert.equal(product.personal_progress.STANDARD.heroes[0].mastery_level, undefined)
  raw.heroes[0].records[0].value = 1000
  assert.equal(product.personal_progress.STANDARD.heroes[0].records[0].value, 9)
})

test('older bootstrap preserves existing progression and has no optional personal progress', () => {
  const product = Product.normalizeBootstrap({ ...base, desktop_features: ['debrief_v1'] })
  assert.deepEqual(product.personal_progress, {})
  assert.deepEqual(product.progression, { total_xp: 250, level: 2 })
  assert.deepEqual(Product.emptyProductState().personal_progress, {})
})

test('progress is rejected without capability or with a mismatched version or mode', () => {
  const cases = [
    { value: progress(), extras: { desktop_features: ['debrief_v1'] } },
    { value: { ...progress(), version: 'personal-progress-2' } },
    { value: progress('RANKED') },
    { value: { ...progress(), mode: 'UNRANKED' } },
  ]
  for (const { value, extras } of cases) assert.deepEqual(normalize(value, extras).personal_progress, {})
  const modes = Product.normalizeBootstrap({ ...base, personal_progress: { STANDARD: progress(), RANKED: progress('RANKED'), UNSUPPORTED: progress() } })
  assert.deepEqual(Object.keys(modes.personal_progress).sort(), ['RANKED', 'STANDARD'])
})

test('missing, nonnumeric and unsupported metrics are omitted while a factual zero is retained', () => {
  const raw = progress()
  raw.debrief.comparisons.push(
    { metric: 'player.deaths', current: null, median: 3, delta: -3, n: 8, improved: true },
    { metric: 'player.kills', current: '0', median: 2, delta: -2, n: 8, improved: false },
    { metric: 'secret.metric', current: 1, median: 1, delta: 0, n: 8, improved: false },
    { metric: 'player.healing', current: 0, median: 10, delta: -10, n: 8, improved: false },
  )
  raw.heroes[0].records.push({ metric: 'player.hero_damage', value: undefined }, { metric: 'player.kills', value: false }, { metric: 'player.deaths', value: 0 })
  const value = normalize(raw).personal_progress?.STANDARD
  assert.deepEqual(value?.debrief?.comparisons.map(row => [row.metric, row.current]), [['player.assists', 9], ['player.healing', 0]])
  assert.deepEqual(value.heroes[0].records, [{ metric: 'player.assists', value: 9 }, { metric: 'player.deaths', value: 0 }])
})

test('client and unknown sources cannot gain independent verification during normalization', () => {
  const raw = progress()
  raw.sources.push({ kind: 'FUTURE_PROVIDER', count: 2 })
  raw.debrief.source = 'FUTURE_PROVIDER'
  const value = normalize(raw).personal_progress?.STANDARD
  assert.deepEqual(value?.sources, [{ kind: 'CLIENT_ATTESTED_GEP', count: 9 }, { kind: 'UNKNOWN', count: 2 }])
  assert.equal(value.debrief.source, 'UNKNOWN')
})

test('a known current metric survives an unavailable prior baseline without claiming improvement', () => {
  const raw = progress()
  raw.debrief.baseline_scope = 'NONE'
  raw.debrief.baseline_sample_size = 0
  raw.debrief.comparisons = [{ metric: 'player.assists', current: 9, median: null, delta: null, n: 0, improved: false }]
  const value = normalize(raw).personal_progress?.STANDARD
  assert.deepEqual(value?.debrief.comparisons, [{ metric: 'player.assists', current: 9, median: null, delta: null, n: 0, improved: false }])
})

test('cached or unauthenticated progress is unavailable and cannot change the existing XP ledger', () => {
  const raw = progress()
  raw.debrief.xp_granted = 999999
  const product = normalize(raw)
  assert.equal(Product.personalProgressFor?.(product, 'STANDARD')?.debrief.match_id, '100')
  assert.equal(product.progression.total_xp, 250)
  for (const state of [{ status: 'OFFLINE', stale: true }, { status: 'ONLINE', stale: true }, { status: 'UNPAIRED' }, { server_features: [] }]) {
    assert.equal(Product.personalProgressFor?.({ ...product, ...state }, 'STANDARD'), null)
  }
  assert.equal(Product.personalProgressFor?.(product, 'RANKED'), null)
})

test('malformed optional records do not invalidate the compatible bootstrap', () => {
  const raw = progress()
  raw.debrief.comparisons.push(null)
  raw.heroes.push({ hero_id: '18', matches: 3, contracts_completed: 0, records: [] })
  raw.goal.conditions[0].target = null
  raw.sample_size = '9'
  const value = normalize(raw).personal_progress?.STANDARD
  assert.equal(value?.goal, null)
  assert.equal(value?.sample_size, null)
  assert.equal(value?.heroes.length, 1)
  assert.equal(value?.debrief.comparisons.length, 1)
})
