import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Appearance = require('../../src/appearance.js')

test('appearance accepts the five themes and rejects untrusted persisted values', () => {
  for (const theme of ['system', 'dark', 'light', 'black', 'custom']) {
    assert.equal(Appearance.normalize({ theme }).theme, theme)
  }
  assert.deepEqual(Appearance.normalize({ theme: 'url(javascript:bad)', motion: 'off', token: 'secret' }), {
    version: 1, theme: 'dark', motion: 'system',
  })
  assert.deepEqual(Appearance.normalize(null), Appearance.normalize({}))
})

test('system mode follows color preference and reduced motion is never overridden', () => {
  assert.deepEqual(Appearance.resolve({ theme: 'system', motion: 'system' }, { dark: false, reduced: true }), { theme: 'light', reduced: true })
  assert.deepEqual(Appearance.resolve({ theme: 'system', motion: 'system' }, { dark: true, reduced: false }), { theme: 'dark', reduced: false })
  assert.deepEqual(Appearance.resolve({ theme: 'custom', motion: 'reduced' }, { dark: false, reduced: false }), { theme: 'custom', reduced: true })
})

test('appearance survives corrupt or unavailable storage without changing contract storage', () => {
  let value = '{broken'
  const writes = []
  const storage = { getItem: () => value, setItem: (key, next) => { writes.push(key); value = next } }
  assert.equal(Appearance.read(storage).theme, 'dark')
  assert.equal(Appearance.write({ theme: 'black', motion: 'reduced' }, storage), true)
  assert.deepEqual(Appearance.read(storage), { version: 1, theme: 'black', motion: 'reduced' })
  assert.deepEqual(writes, [Appearance.KEY])
  const denied = { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } }
  assert.equal(Appearance.read(denied).theme, 'dark')
  assert.equal(Appearance.write({ theme: 'light' }, denied), false)
})

test('applying presentation sets resolved theme and accessible selected states only', () => {
  const attributes = {}
  const buttons = ['system', 'dark', 'light'].map(theme => ({ dataset: { appearanceTheme: theme }, setAttribute(name, value) { this[name] = value } }))
  const motion = ['system', 'reduced'].map(value => ({ dataset: { appearanceMotion: value }, setAttribute(name, next) { this[name] = next } }))
  const doc = { documentElement: { setAttribute(name, value) { attributes[name] = value } }, querySelectorAll(selector) { return selector.includes('theme') ? buttons : motion } }
  Appearance.apply({ theme: 'system', motion: 'reduced' }, doc, { dark: false })
  assert.equal(attributes['data-theme'], 'light')
  assert.equal(attributes['data-reduced-motion'], 'true')
  assert.equal(buttons[0]['aria-pressed'], 'true')
  assert.equal(buttons[2]['aria-pressed'], 'false')
  assert.equal(motion[1]['aria-pressed'], 'true')
})


test('resolved City themes update the browser window color', () => {
  const colors = { dark: '#181715', light: '#eee6d5', black: '#000000', custom: '#201921' }
  let actual
  const doc = {
    documentElement: { setAttribute() {} },
    querySelectorAll() { return [] },
    querySelector() { return { setAttribute(name, value) { if (name === 'content') actual = value } } },
  }
  for (const [theme, color] of Object.entries(colors)) {
    Appearance.apply({ theme }, doc, {})
    assert.equal(actual, color)
  }
  Appearance.apply({ theme: 'system' }, doc, { dark: false })
  assert.equal(actual, colors.light)
})
