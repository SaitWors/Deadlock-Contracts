import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
global.DCSchema = require('../../src/schema.js')
global.DCI18n = require('../../src/i18n.js')
global.DCProgress = require('../../src/progress.js')
global.DCStorage = require('../../src/storage.js')
const Product = require('../../src/product.js')

const base = {
  api_version: 'desktop.v1',
  schema_version: 2,
  server_time: '2026-09-05T12:00:00Z',
  desktop_features: ['announcements_v1'],
  boards: [],
  active_cases: [],
  history: { items: [] },
}

const announcement = {
  id: 'notice-1',
  revision: 2,
  phase: 'ACTIVE',
  severity: 'MAINTENANCE',
  presentation: 'BANNER',
  effect: 'SOFT_GLOW',
  dismiss_policy: 'DISMISSIBLE',
  priority: 80,
  title: 'Maintenance',
  body: 'Match checks can be delayed.',
  cta: { label: 'Status', url: '/status' },
  starts_at: '2026-09-05T11:00:00Z',
  ends_at: '2026-09-05T13:00:00Z',
  show_countdown: true,
}

test('bootstrap remains compatible without optional announcements', () => {
  const normalized = Product.normalizeBootstrap(base, '2026-09-05T12:00:00Z')
  assert.equal(normalized.cache_version, 4)
  assert.deepEqual(normalized.announcements, [])
  assert.deepEqual(normalized.overlay_announcements, [])
})

test('announcement normalization is allowlisted and drops unsupported presentation', () => {
  assert.equal(Product.normalizeAnnouncement({ ...announcement, effect: 'FUTURE_EFFECT' }).effect, 'NONE')
  assert.equal(Product.normalizeAnnouncement({ ...announcement, presentation: 'IFRAME' }), null)
  assert.equal(Product.normalizeAnnouncement({ ...announcement, cta: { label: 'Bad', url: 'javascript:alert(1)' } }).cta, null)
  assert.equal(Product.normalizeAnnouncement({ ...announcement, admin_payload: { token: 'secret' } }).admin_payload, undefined)
})

test('cached announcements expire against the server-adjusted clock', () => {
  const product = Product.normalizeBootstrap(
    { ...base, announcements: [announcement], overlay_announcements: [announcement] },
    '2026-09-05T12:00:00Z',
  )
  assert.equal(Product.serverNowMs(product, Date.parse('2026-09-05T12:30:00Z')), Date.parse('2026-09-05T12:30:00Z'))
  assert.equal(Product.activeAnnouncements(product.announcements, { now: Date.parse('2026-09-05T12:30:00Z') }).length, 1)
  assert.equal(Product.activeAnnouncements(product.announcements, { now: Date.parse('2026-09-05T13:00:00Z') }).length, 0)
})

test('overlay keeps one banner and disables unsupported confetti', () => {
  const modal = { ...announcement, id: 'modal', presentation: 'MODAL', priority: 100 }
  const confetti = { ...announcement, id: 'banner', effect: 'CONFETTI_ONCE', priority: 90 }
  const result = Product.activeAnnouncements([modal, confetti], {
    now: Date.parse('2026-09-05T12:30:00Z'),
    overlay: true,
    limit: 1,
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'banner')
  assert.equal(result[0].effect, 'NONE')
})

test('equal-priority announcements preserve the server order', () => {
  const first = { ...announcement, id: 'z-first' }
  const second = { ...announcement, id: 'a-second' }
  const result = Product.activeAnnouncements([first, second], {
    now: Date.parse('2026-09-05T12:30:00Z'),
    limit: 2,
  })
  assert.deepEqual(result.map(item => item.id), ['z-first', 'a-second'])
})
