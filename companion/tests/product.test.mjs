import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const Product = require(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src/product.js'))

function bootstrap(overrides = {}) {
  return {
    api_version: 'desktop.v1',
    schema_version: 1,
    server_time: '2026-08-18T12:00:00Z',
    account: { display_name: 'Test' },
    refresh: { remaining: 1 },
    boards: [{
      id: 'board-1', status: 'LOCKED', game_match_mode: 'STREET_BRAWL', attempts_used: 1, max_attempts: 3,
      options: [{
        id: 'option-1', title: 'Server title', description: 'Server description', selected: true,
        status: 'LOCKED', reward_xp: 125, metric: 'player.healing', operator: 'gte', target: 5000,
        conditions: [{ metric: 'player.healing', operator: 'gte', target: 5000 }],
      }],
    }],
    progression: { level: 2 },
    history: { items: [] },
    ...overrides,
  }
}

test('normalizes modes without inventing unknown modes', () => {
  assert.equal(Product.normalizeMode('Street Brawl'), 'STREET_BRAWL')
  assert.equal(Product.normalizeMode('ranked'), 'RANKED')
  assert.equal(Product.normalizeMode('normal'), 'STANDARD')
  assert.equal(Product.normalizeMode('unranked'), 'STANDARD')
  assert.equal(Product.normalizeMode('custom'), null)
  assert.equal(Product.normalizeMode('not-ranked-custom'), null)
})

test('malformed or future server modes fail closed instead of becoming Standard', () => {
  const state = Product.normalizeBootstrap(bootstrap({
    boards: [
      ...bootstrap().boards,
      { id: 'future-board', status: 'OFFERED', game_match_mode: 'HERO_LABS', options: [] },
    ],
    active_cases: [{ board_id: 'future-case', game_match_mode: 'HERO_LABS', status: 'LOCKED', options: [] }],
    history: { items: [{ assignment_id: 'future-history', game_match_mode: 'HERO_LABS', status: 'COMPLETED', last_attempt_match_id: '42' }] },
  }))
  assert.equal(state.boards.some(board => board.id === 'future-board'), false)
  assert.equal(state.active_cases.some(item => item.board_id === 'future-case'), false)
  assert.equal(state.history[0].game_match_mode, null)
  assert.equal(Product.modeLabel(state.history[0].game_match_mode), 'UNKNOWN MODE')
})

test('preserves server adaptive metadata without giving the client authority', () => {
  const payload = bootstrap()
  payload.boards[0].options[0].generator_meta = {
    adaptive: {
      enabled: true, kind: 'CHALLENGE', sample_size: 12, confidence: 'MEDIUM',
      basis: [{ metric: 'player.healing', median: 4200, p75: 5100, target: 5000, source: 'p75' }],
    },
  }
  const state = Product.normalizeBootstrap(payload, '2026-08-18T12:00:01Z')
  const option = state.boards[0].options[0]
  assert.equal(option.generator_meta.adaptive.kind, 'CHALLENGE')
  assert.equal(option.generator_meta.adaptive.sample_size, 12)
  assert.equal(option.target, 5000)
  assert.equal('completed' in option.generator_meta.adaptive, false)
})

test('derives Active Case only from server-locked boards', () => {
  const state = Product.normalizeBootstrap(bootstrap(), '2026-08-18T12:00:01Z')
  assert.equal(state.status, 'ONLINE')
  assert.equal(state.active_cases.length, 1)
  assert.equal(state.active_cases[0].board_id, 'board-1')
  assert.equal(state.active_cases[0].options[0].id, 'option-1')
  assert.equal(Product.activeCaseFor(state, 'Street Brawl').game_match_mode, 'STREET_BRAWL')
})

test('live metric progress is provisional math, not a verdict', () => {
  const progress = Product.conditionProgress(
    { metric: 'player.healing', operator: 'gte', target: 5000 },
    { evidence: { healing: 3750 } },
  )
  assert.deepEqual(progress, {
    supported: true,
    known: true,
    value: 3750,
    target: 5000,
    operator: 'gte',
    percent: 75,
    provisional_pass: false,
  })
  assert.equal('status' in progress, false)
  assert.equal('completed' in progress, false)
})

test('Street Brawl scoreboard healing uses the live healing aggregate provisionally', () => {
  const progress = Product.conditionProgress(
    { metric: 'player.scoreboard_healing', operator: 'gte', target: 8000 },
    { evidence: { healing: 8567 } },
  )
  assert.equal(progress.supported, true)
  assert.equal(progress.value, 8567)
  assert.equal(progress.provisional_pass, true)
  assert.equal(Product.metricLabel('player.scoreboard_healing', 'ru'), 'ЛЕЧЕНИЕ ПО ТАБЛИЦЕ')
})

test('KDA is derived locally while final win waits for a known outcome', () => {
  assert.equal(Product.liveMetricValue({ metric: 'player.kda' }, { evidence: { kills: 7, deaths: 2, assists: 5 } }), 6)
  assert.equal(Product.liveMetricValue({ metric: 'match.win' }, { result_label: '—' }), null)
  assert.equal(Product.liveMetricValue({ metric: 'match.win' }, { result_label: 'WIN' }), 1)
})

test('rejects incompatible API versions before rendering data', () => {
  assert.throws(
    () => Product.normalizeBootstrap(bootstrap({ api_version: 'desktop.v2' })),
    error => error.code === 'API_VERSION_MISMATCH',
  )
})

test('object damage is supported by provisional live progress', () => {
  const progress = Product.conditionProgress(
    { metric: 'player.object_damage', operator: 'gte', target: 6000 },
    { evidence: { object_damage: 7200 } },
  )
  assert.equal(progress.supported, true)
  assert.equal(progress.known, true)
  assert.equal(progress.value, 7200)
  assert.equal(progress.provisional_pass, true)
  assert.equal(Product.metricLabel('player.object_damage', 'ru'), 'УРОН ОБЪЕКТАМ')
})

test('Deadlock local outcome labels VICTORY and DEFEAT map to provisional win only', () => {
  assert.equal(Product.liveMetricValue({ metric: 'match.win' }, { result_label: 'VICTORY' }), 1)
  assert.equal(Product.liveMetricValue({ metric: 'match.win' }, { result_label: 'DEFEAT' }), 0)
  const progress = Product.conditionProgress({ metric: 'match.win', operator: 'eq', target: 1 }, { result_label: 'VICTORY' })
  assert.equal(progress.provisional_pass, true)
  assert.equal('status' in progress, false)
  assert.equal('completed' in progress, false)
})

test('normalizes all three adaptive profiles and exposes metric baselines read-only', () => {
  const payload = bootstrap({
    adaptive_profiles: {
      STANDARD: { version: 'adaptive-profile-1', mode: 'STANDARD', sample_size: 12, confidence: 'MEDIUM', metrics: { 'player.kills': { n: 12, median: 7, p25: 5, p60: 8, p75: 10, best: 16 } } },
      RANKED: { version: 'adaptive-profile-1', mode: 'RANKED', sample_size: 6, confidence: 'LOW', metrics: { 'player.assists': { n: 6, median: 11, p25: 8, p60: 12, p75: 14, best: 19 } } },
      STREET_BRAWL: { version: 'adaptive-profile-1', mode: 'STREET_BRAWL', sample_size: 3, confidence: 'COLD_START', metrics: {} },
    },
  })
  const state = Product.normalizeBootstrap(payload)
  assert.deepEqual(Object.keys(state.adaptive_profiles).sort(), ['RANKED', 'STANDARD', 'STREET_BRAWL'])
  assert.equal(Product.adaptiveProfileFor(state, 'normal').sample_size, 12)
  assert.equal(Product.profileMetric(Product.adaptiveProfileFor(state, 'STANDARD'), 'player.kills').p75, 10)
})

test('malformed adaptive numeric fields fail closed instead of leaking NaN into UI state', () => {
  const profile = Product.normalizeAdaptiveProfile({
    mode: 'STANDARD', sample_size: 'not-a-number', confidence: 'MEDIUM',
    metrics: { 'player.kills': { n: 'bad', median: 'wat', p25: null, p60: 8, p75: '10', best: Infinity } },
  })
  assert.equal(profile.sample_size, 0)
  assert.equal(profile.metrics['player.kills'].n, 0)
  assert.equal(profile.metrics['player.kills'].median, null)
  assert.equal(profile.metrics['player.kills'].p60, 8)
  assert.equal(profile.metrics['player.kills'].p75, 10)
  assert.equal(profile.metrics['player.kills'].best, null)
})

test('latest verdict uses last evaluator match for retryable miss and never invents XP', () => {
  const history = [
    {
      assignment_id: 'retry', game_match_mode: 'STANDARD', status: 'LOCKED', reward_xp: 120,
      reward_granted_xp: 0, match_id: null, last_attempt_match_id: '100246793', locked_at: '2026-08-18T18:00:00Z',
      latest_evaluation: { status: 'FAILED', revision: 1, match_id: '100246793', match_ended_at: '2026-08-18T19:00:00Z', explanation: 'Target missed.' },
    },
    {
      assignment_id: 'done', game_match_mode: 'STANDARD', status: 'COMPLETED', reward_xp: 70,
      reward_granted_xp: 70, match_id: '100246793', last_attempt_match_id: '100246793', settled_at: '2026-08-18T19:01:00Z',
      latest_evaluation: { status: 'COMPLETED', revision: 1, match_id: '100246793', match_ended_at: '2026-08-18T19:00:00Z' },
    },
  ].map(Product.normalizeHistoryItem)
  const group = Product.latestVerdictGroup(history)
  assert.equal(group.match_id, '100246793')
  assert.equal(group.status, 'PARTIAL')
  assert.equal(group.counts.completed, 1)
  assert.equal(group.counts.failed, 1)
  assert.equal(group.reward_granted_xp, 70)
  assert.equal(group.items.find(item => item.assignment_id === 'retry').attempt_status, 'FAILED')
})

test('current bound VERIFYING match wins over an older evaluation for debrief grouping', () => {
  const item = Product.normalizeHistoryItem({
    assignment_id: 'verify', game_match_mode: 'RANKED', status: 'VERIFYING', reward_xp: 155,
    reward_granted_xp: 0, match_id: '200000002', last_attempt_match_id: '200000002', match_ended_at: '2026-08-18T20:00:00Z',
    latest_evaluation: { status: 'FAILED', revision: 1, match_id: '200000001', match_ended_at: '2026-08-18T19:00:00Z' },
  })
  assert.equal(Product.attemptMatchId(item), '200000002')
  assert.equal(Product.attemptStatus(item), 'VERIFYING')
  const group = Product.latestVerdictGroup([item])
  assert.equal(group.match_id, '200000002')
  assert.equal(group.status, 'VERIFYING')
  assert.equal(group.reward_granted_xp, 0)
})

test('Desktop additive feature flags are preserved for safe client capability gating', () => {
  const state = Product.normalizeBootstrap(bootstrap({ desktop_features: ['adaptive_profiles_v1', 'debrief_v1'] }))
  assert.deepEqual(state.server_features, ['adaptive_profiles_v1', 'debrief_v1'])
})

test('server-owned RU and EN mission content survives normalization and rendering', () => {
  const payload = bootstrap()
  payload.boards[0].options[0].title_i18n = { ru: 'Серверное задание', en: 'Server mission' }
  payload.boards[0].options[0].description_i18n = {
    ru: 'Серверное описание',
    en: 'Server description',
  }
  const state = Product.normalizeBootstrap(payload)
  const option = state.boards[0].options[0]

  assert.deepEqual(option.title_i18n, {
    ru: 'Серверное задание',
    en: 'Server mission',
  })
  assert.equal(Product.contractTitle(option, 'ru'), 'Серверное задание')
  assert.equal(Product.contractTitle(option, 'en'), 'Server mission')
  assert.equal(Product.contractDescription(option, 'STANDARD', 'ru'), 'Серверное описание')
  assert.equal(Product.contractDescription(option, 'STANDARD', 'en'), 'Server description')
})


test('selectedContracts exposes all 1-3 active selected contracts and caps malformed overflow', () => {
  const make = id => ({
    id,
    title: id,
    selected: true,
  })

  assert.deepEqual(
    Product.selectedContracts({
      options: [
        make('one'),
        make('two'),
        make('three'),
      ],
    }).map(item => item.id),
    ['one', 'two', 'three'],
  )

  assert.deepEqual(
    Product.selectedContracts({
      options: [
        make('one'),
        {
          ...make('hidden'),
          selected: false,
        },
        make('two'),
        make('three'),
        make('overflow'),
      ],
    }).map(item => item.id),
    ['one', 'two', 'three'],
  )
})
