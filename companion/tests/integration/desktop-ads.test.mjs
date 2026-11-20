import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/desktop-ads.js', import.meta.url), 'utf8')

function launch({ testFlag = null, native = true } = {}) {
  const ids = ['desktopAdRail', 'desktopAdContainer', 'desktopAdStudio', 'desktopStudioContainer']
  const elements = Object.fromEntries(ids.map(id => [id, { hidden: true, replaceChildren() {} }]))
  const scripts = []
  const started = []
  const stopped = []
  const wideWindow = { matches: false, addEventListener() {} }
  const document = {
    visibilityState: 'visible',
    addEventListener() {},
    getElementById: id => elements[id],
    createElement: () => ({}),
    head: { appendChild: script => scripts.push(script) },
  }
  const window = { matchMedia: () => wideWindow, addEventListener() {} }
  vm.runInNewContext(source, {
    window, document, localStorage: { getItem: key => key === 'owAdTestAd' ? testFlag : null },
    ...(native ? { overwolf: {} } : {}),
  })

  return {
    ads: window.DCDesktopAds, scripts, wideWindow, elements, started, stopped,
    sdkReady() {
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

test('Overwolf test flag enables SDK test ads while the server disables live ads', () => {
  const browser = launch({ testFlag: 'true' })
  browser.ads.setEligible(false, false)
  assert.equal(browser.scripts.length, 0)
  browser.ads.setEligible(true, false)
  assert.equal(browser.scripts.length, 1)
  browser.sdkReady()
  assert.deepEqual(browser.started, ['400×60'])
  assert.equal(browser.elements.desktopAdRail.hidden, false)

  browser.wideWindow.matches = true
  browser.ads.setEligible(true, false)
  assert.deepEqual(browser.started, ['400×60', '400×300'])
  assert.equal(browser.elements.desktopAdStudio.hidden, false)
  browser.ads.setWindowVisible(false)
  assert.deepEqual(browser.stopped, ['dc_400x60_dt_top', 'dc_400x300_dt_right'])
  assert.equal(browser.elements.desktopAdRail.hidden, true)
  assert.equal(browser.elements.desktopAdStudio.hidden, true)
})

test('live ads respect server opt-out and the SDK cannot start outside Overwolf', () => {
  const browser = launch({ testFlag: 'false' })
  browser.ads.setEligible(true, false)
  assert.equal(browser.scripts.length, 0)
  browser.ads.setEligible(true, true)
  assert.equal(browser.scripts.length, 1)
  browser.ads.setEligible(true, false)
  browser.sdkReady()
  assert.deepEqual(browser.started, [])

  const preview = launch({ native: false, testFlag: 'true' })
  preview.ads.setEligible(true, true)
  assert.equal(preview.scripts.length, 0)
})
