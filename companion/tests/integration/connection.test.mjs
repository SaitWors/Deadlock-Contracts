import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const bootstrap = JSON.parse(readFileSync(new URL('../fixtures/bootstrap-production-v1.json', import.meta.url), 'utf8'))
const background = readFileSync(new URL('../../background.html', import.meta.url), 'utf8')
const modules = Array.from(background.matchAll(/<script src="([^"]+)"/g), ([, file]) => [
  file, readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'),
])
const token = 't'.repeat(43)
const verifier = 'v'.repeat(43)
const account = { display_name: 'QA player', steam_id64: '76561198000000000' }
const now = new Date().toISOString()
const startPath = '/api/companion/pairing/link/start'
const claimPath = '/api/companion/pairing/link/claim'
const cancelPath = '/api/companion/pairing/link/cancel'
const heartbeatPath = '/api/companion/heartbeat'
const helloPath = '/api/companion/hello'
const bootstrapPath = '/api/desktop/v1/bootstrap'
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers })

function launch(handler, storage = new Map()) {
  let ms = Date.now()
  let sequence = 0
  const timers = new Map()
  const requests = []
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  }
  const context = vm.createContext({
    URL, Headers, AbortController, TextEncoder, CustomEvent,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [ms])) }
      static now() { return ms }
    },
    document: { getElementById: () => null },
    addEventListener() {},
    dispatchEvent() {},
    navigator: { onLine: true, languages: ['ru-RU'] },
    localStorage,
    setTimeout: (next, delay) => { timers.set(++sequence, { next, due: ms + delay }); return sequence },
    clearTimeout: id => timers.delete(id),
    overwolf: {
      cryptography: {
        encryptForCurrentUser: (text, done) => done({ success: true, ciphertext: Buffer.from(text).toString('base64') }),
        decryptForCurrentUser: (text, done) => done({ success: true, plaintext: Buffer.from(text, 'base64').toString() }),
      },
    },
    async fetch(url, options) {
      const path = new URL(url).pathname
      requests.push(path)
      return handler(path, options)
    },
  })
  context.window = context
  for (const [file, source] of modules) vm.runInContext(source, context, { filename: file })
  const run = source => vm.runInContext(source, context)
  return {
    api: context.dcCompanion, run, requests, storage,
    async advance(delay) {
      ms += delay
      for (const [id, { next, due }] of timers) {
        if (due > ms) continue
        timers.delete(id)
        next()
      }
      await run('browserPairingPoll')
    },
  }
}

function issued(expires = Date.now() + 60_000) {
  return reply({
    challenge: `${Math.floor(expires / 1000)}.${'a'.repeat(64)}.${'b'.repeat(64)}`,
    verifier, expires_at: new Date(expires).toISOString(),
  })
}

test('browser connection deduplicates start, resumes securely, and confirms with the server before going online', async () => {
  const first = launch(path => { assert.equal(path, startPath); return issued() })
  assert.equal(first.run('DCI18n.language()'), 'en')
  first.run("DCI18n.setPreference('ru')")
  const [url, again] = await Promise.all([first.api.startBrowserPairing(), first.api.startBrowserPairing()])
  assert.equal(url, again)
  assert.equal(new URL(url).searchParams.get('lang'), 'ru')
  assert.ok(!url.includes(verifier))
  assert.deepEqual(first.requests, [startPath])
  assert.equal(first.api.getSnapshot().paired, false)
  const ciphertext = first.storage.get('dc.pair.browser.secure.v1')
  assert.ok(ciphertext && !ciphertext.includes(verifier))

  const second = launch((path, options) => {
    if (path === claimPath) {
      assert.equal(options.headers.has('Authorization'), false)
      assert.equal(JSON.parse(options.body).verifier, verifier)
      return reply({ token, account })
    }
    assert.equal(options.headers.get('Authorization'), `Bearer ${token}`)
    if (path === helloPath) return reply({ ok: true, account, server_time: now })
    if (path === heartbeatPath) return reply({ ok: true, server_time: now })
    if (path === bootstrapPath) return reply(bootstrap)
    assert.fail(`Unexpected request ${path}`)
  }, first.storage)
  assert.equal(second.run('DCI18n.language()'), 'ru')
  await second.run('restoreBrowserPairing()')
  await second.advance(0)
  assert.deepEqual(second.requests, [claimPath, heartbeatPath, helloPath, bootstrapPath])
  assert.equal(second.api.getSnapshot().product.status, 'ONLINE')
  assert.equal(second.api.getSnapshot().pair_link_hint, null)
  assert.equal(second.storage.has('dc.pair.browser.secure.v1'), false)
  assert.ok(second.storage.has('dc.token.secure.v2'))
})

test('pending connection retries after network failure and cancel stops polling', async () => {
  let attempts = 0
  const session = launch(path => {
    if (path === startPath) return issued()
    if (path === cancelPath) return reply({ cancelled: true })
    assert.equal(path, claimPath)
    if (++attempts === 1) throw new TypeError('Network connection lost')
    return reply({ pending: true })
  })
  await session.api.startBrowserPairing()
  await session.advance(3000)
  assert.equal(session.api.getSnapshot().pairing_error.code, 'NETWORK_ERROR')
  await session.advance(6000)
  assert.equal(session.api.getSnapshot().pairing_error, null)
  await session.api.cancelBrowserPairing()
  await session.advance(10000)
  assert.deepEqual(session.requests, [startPath, claimPath, claimPath, cancelPath])
  assert.equal(session.api.getSnapshot().pair_link_hint, null)
  assert.equal(session.api.getSnapshot().paired, false)
  assert.equal(session.storage.has('dc.pair.browser.secure.v1'), false)
})

test('a timed-out browser connection ends with a localized error code and never calls claim', async () => {
  const session = launch(path => { assert.equal(path, startPath); return issued(Date.now() + 2000) })
  await session.api.startBrowserPairing()
  await session.advance(3001)
  assert.deepEqual(session.requests, [startPath])
  assert.equal(session.api.getSnapshot().pairing_error.code, 'PAIR_LINK_EXPIRED')
  assert.equal(session.api.getSnapshot().pair_link_hint, null)
})

test('reconnect declines forged success, handles the version floor, and clears expired credentials', async () => {
  let answer = () => reply({})
  const session = launch(path => { assert.equal(path, heartbeatPath); return answer() })
  session.run(`state.token = '${token}'`)
  assert.equal((await session.run('reconnect()')).ok, false)
  assert.equal(session.api.getSnapshot().product.status, 'DEGRADED')
  answer = () => reply({ code: 'COMPANION_UPDATE_REQUIRED' }, 426, { 'x-minimum-companion-version': '0.5.2-alpha.22' })
  assert.equal((await session.run('reconnect()')).code, 'COMPANION_UPDATE_REQUIRED')
  assert.equal(session.api.getSnapshot().product.status, 'INCOMPATIBLE')
  assert.equal(session.api.getSnapshot().product.last_error.minimum_version, '0.5.2-alpha.22')
  answer = () => reply({ code: 'TOKEN_EXPIRED' }, 401)
  assert.equal((await session.run('reconnect()')).code, 'TOKEN_EXPIRED')
  assert.equal(session.api.getSnapshot().paired, false)
  assert.equal(session.api.getSnapshot().pairing_error.code, 'TOKEN_EXPIRED')
  assert.deepEqual(session.requests, [heartbeatPath, heartbeatPath, heartbeatPath])
})
