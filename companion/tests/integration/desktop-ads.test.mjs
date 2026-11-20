import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/desktop-ads.js', import.meta.url), 'utf8')
const desktop = readFileSync(new URL('../../src/desktop.js', import.meta.url), 'utf8')

function launch({ native = true } = {}) {
  const ids = ['desktopAdRail', 'desktopAdContainer', 'desktopAdStudio', 'desktopStudioContainer']
  const elements = Object.fromEntries(ids.map(id => [id, { hidden: true, replaceChildren() {} }]))
  const scripts = []
  const started = []
  const stopped = []
  const timers = new Set()
  const listeners = new Map()
  const addEventListener = (name, fn) => listeners.set(name, fn)
  const wideWindow = { matches: false, addEventListener }
  const document = {
    visibilityState: 'visible',
    addEventListener,
    getElementById: id => elements[id],
    createElement: () => ({ removed: false, remove() { this.removed = true } }),
    head: { appendChild: script => scripts.push(script) },
  }
  const window = { matchMedia: () => wideWindow, addEventListener }
  vm.runInNewContext(source, {
    window, document,
    setTimeout: fn => { timers.add(fn); return fn },
    clearTimeout: fn => timers.delete(fn),
    console: { warn() {} },
    ...(native ? { overwolf: {} } : {}),
  })

  return {
    ads: window.DCDesktopAds, scripts, wideWindow, elements, started, stopped, timers, listeners, document,
    sdkReady() {
      // No creative or fill callback is emitted. A no-fill result must not spin up another instance.
      window.OwAd = class {
        constructor(container, { containerId, size }) {
          assert.equal(container, size.height === 60 ? elements.desktopAdContainer : elements.desktopStudioContainer)
          started.push(`${size.width}×${size.height}`)
          this.id = containerId
        }
        shutdown() { stopped.push(this.id) }
      }
      scripts.at(-1).onload()
    },
  }
}

test('eligible desktop slots load once with supported sizes, tolerate no-fill, and shut down when hidden', () => {
  const browser = launch()
  browser.ads.setEligible(true)
  assert.equal(browser.scripts.length, 0)
  browser.ads.setWindowVisible(true)
  assert.equal(browser.scripts[0].src, 'https://content.overwolf.com/libs/ads/latest/owads.min.js')
  browser.sdkReady()
  for (let i = 0; i < 5; i++) browser.ads.setEligible(true)
  assert.deepEqual(browser.started, ['400×60'])

  browser.wideWindow.matches = true
  browser.listeners.get('change')()
  assert.deepEqual(browser.started, ['400×60', '400×300'])
  assert.equal(browser.elements.desktopAdStudio.hidden, false)
  browser.ads.setWindowVisible(false)
  assert.deepEqual(browser.stopped, ['dc_400x60_dt_top', 'dc_400x300_dt_right'])
  assert.equal(browser.elements.desktopAdRail.hidden, true)
  assert.equal(browser.elements.desktopAdStudio.hidden, true)
})

test('SDK callbacks after navigation and previews outside Overwolf do not create slots', () => {
  const browser = launch()
  browser.ads.setWindowVisible(true)
  browser.ads.setEligible(true)
  browser.ads.setEligible(false)
  browser.sdkReady()
  assert.deepEqual(browser.started, [])

  const preview = launch({ native: false })
  preview.ads.setWindowVisible(true)
  preview.ads.setEligible(true)
  assert.equal(preview.scripts.length, 0)
})

test('unavailable SDK and stalled downloads keep the layout intact and do not retry in a loop', () => {
  for (const unavailable of [true, false]) {
    const browser = launch()
    browser.ads.setWindowVisible(true)
    browser.ads.setEligible(true)
    if (unavailable) browser.scripts[0].onload()
    else [...browser.timers][0]()
    assert.equal(browser.scripts[0].removed, true)
    assert.equal(browser.elements.desktopAdRail.hidden, true)
    assert.equal(browser.elements.desktopAdStudio.hidden, true)
    browser.ads.setEligible(true)
    assert.equal(browser.scripts.length, 1)
  }
})

test('desktop allows ads only in populated HQ and Contracts with fresh authenticated server state', () => {
  const policy = desktop.slice(desktop.indexOf('  function syncDesktopAdSlot()'), desktop.indexOf('  function setView('))
  const board = { options: [{ id: 'contract' }] }
  const product = { status: 'ONLINE', stale: false, boards: [board], server_features: ['desktop_ads_v1'] }
  const snapshot = { paired: true, product }
  const hidden = { ftue: true, confirmModal: true, offlineBar: true }
  let view = 'hq', modal = false, notice = false, activeMode = 'STANDARD', gameSafe = true, eligible
  const context = vm.createContext({
    PREVIEW: false, busy: false, modalResolve: null, snapshot,
    document: { querySelector: selector => selector === '[data-view].active' ? { dataset: { view } }
      : selector.includes('backdrop') ? modal : notice },
    $: id => id === 'toastRegion' ? { matches: () => !notice } : { hidden: hidden[id] },
    Product: { boardForMode: (_product, mode) => mode === 'STANDARD' ? board : null },
    navigator: { onLine: true },
    isSafeDesktopAdMoment: () => gameSafe,
    window: { DCDesktopAds: { setEligible: value => { eligible = value } } },
  })
  const check = expected => {
    context.activeMode = activeMode
    vm.runInContext(policy + '\nsyncDesktopAdSlot()', context)
    assert.equal(!!eligible, expected)
  }
  check(true)
  view = 'contracts'; check(true)
  activeMode = 'RANKED'; check(false)
  view = 'settings'; check(false)
  view = 'hq'; snapshot.paired = false; check(false)
  snapshot.paired = true; product.server_features = []; check(false)
  product.server_features = ['desktop_ads_v1']; product.stale = true; check(false)
  product.stale = false; gameSafe = false; check(false)
  gameSafe = true; hidden.ftue = false; check(false)
  hidden.ftue = true; modal = true; check(false)
  modal = false; notice = true; check(false)
  notice = false; check(true)
})
