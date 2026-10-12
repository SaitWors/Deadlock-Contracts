import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Product = require('../../src/product.js')

test('only a delivered server receipt displays issued coins', () => {
  assert.equal(Product.coinRewardLabel({ status: 'DELIVERED', amount: 16, reason: 'AWARDED' }, 'en'), '+16 coins')
  assert.equal(Product.coinRewardLabel({ status: 'DELIVERED', amount: 16, reason: 'AWARDED' }, 'ru'), '+16 монет')
  assert.equal(Product.coinRewardLabel({ status: 'DELIVERED', amount: 1, reason: 'AWARDED' }, 'en'), '+1 coin')
  assert.equal(Product.coinRewardLabel({ status: 'DELIVERED', amount: 1, reason: 'AWARDED' }, 'ru'), '+1 монета')
  for (const status of ['PENDING', 'RESERVED']) {
    assert.equal(Product.coinRewardLabel({ status, amount: 16, reason: 'AWARDED' }, 'en'), 'Coins pending')
    assert.equal(Product.coinRewardLabel({ status, amount: 16, reason: 'AWARDED' }, 'ru'), 'Монеты ожидают начисления')
  }
})

test('partial and zero delivered rewards explain the server quota reason', () => {
  assert.equal(Product.coinRewardLabel({ status: 'DELIVERED', amount: 4, reason: 'DAILY_LIMIT' }, 'en'), '+4 coins · daily limit')
  assert.equal(Product.coinRewardLabel({ status: 'DELIVERED', amount: 0, reason: 'WEEKLY_LIMIT' }, 'en'), '0 coins · weekly limit')
  assert.equal(Product.coinRewardLabel({ status: 'DELIVERED', amount: 0, reason: 'DAILY_LIMIT' }, 'ru'), '0 монет · дневной лимит')
  assert.equal(Product.coinRewardLabel({ status: 'DELIVERED', amount: 4, reason: 'WEEKLY_LIMIT' }, 'ru'), '+4 монеты · недельный лимит')
})

test('corrected and invalidated rewards never appear issued', () => {
  assert.equal(Product.coinRewardLabel({ status: 'CORRECTED', amount: 24 }, 'en'), 'Coins corrected')
  assert.equal(Product.coinRewardLabel({ status: 'CORRECTED', amount: 24 }, 'ru'), 'Монеты скорректированы')
  assert.equal(Product.coinRewardLabel({ status: 'INVALIDATED', amount: 24, reason: 'RESULT_CHANGED' }, 'en'), 'Coins not awarded · result changed')
  assert.equal(Product.coinRewardLabel({ status: 'INVALIDATED', amount: 24, reason: 'RESULT_CHANGED' }, 'ru'), 'Монеты не начислены · результат изменён')
})

test('ineligible receipts explain known reasons without rendering untrusted server text', () => {
  const reasons = [
    ['NO_SIGNED_POLICY', 'contract predates coin rewards', 'контракт без денежной политики'],
    ['NOT_COMPLETED', 'contract incomplete', 'контракт не выполнен'],
    ['UNTRUSTED_RESULT', 'result not eligible', 'результат не подтверждён'],
    ['MISSING_MATCH_TIME', 'match time missing', 'нет времени матча'],
    ['OUTSIDE_ATTEMPT_WINDOW', 'outside contract window', 'матч вне срока контракта'],
  ]
  for (const [reason, en, ru] of reasons) {
    assert.equal(Product.coinRewardLabel({ status: 'REJECTED', amount: 1000, reason }, 'en'), `Coins not awarded · ${en}`)
    assert.equal(Product.coinRewardLabel({ status: 'REJECTED', amount: 1000, reason }, 'ru'), `Монеты не начислены · ${ru}`)
  }
  assert.equal(Product.coinRewardLabel({ status: 'REJECTED', reason: '<img onerror=alert(1)>' }, 'en'), 'Coins not awarded')
})

test('absent or malformed coin data cannot invent rewards from XP or local facts', () => {
  assert.equal(Product.coinRewardLabel(null, 'en'), '')
  assert.equal(Product.coinRewardLabel(undefined, 'ru'), '')
  assert.equal(Product.coinRewardLabel({ reward_granted_xp: 500, evidence: { completed: true } }, 'en'), 'Coins unavailable')
  for (const amount of [undefined, null, '16', -1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(Product.coinRewardLabel({ status: 'DELIVERED', amount }, 'en'), 'Coins unavailable')
  }
})

test('history normalization preserves optional receipt and grouping does not infer a coin award', () => {
  const receipt = { status: 'RESERVED', amount: 10, reason: 'AWARDED' }
  const item = Product.normalizeHistoryItem({ assignment_id: 'a', match_id: '123', status: 'COMPLETED',
    game_match_mode: 'STANDARD', reward_granted_xp: 100, coin_reward: receipt })
  assert.deepEqual(item.coin_reward, receipt)
  const group = Product.latestVerdictGroup([item])
  assert.equal(Product.coinRewardLabel(group.items[0].coin_reward, 'en'), 'Coins pending')
  assert.equal(group.reward_granted_coins, undefined)
})
