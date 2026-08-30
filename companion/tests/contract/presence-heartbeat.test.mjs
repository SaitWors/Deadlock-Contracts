import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../../src/background-engine.js', import.meta.url), 'utf8')

test('presence heartbeat survives menu and post-match states without a confirmed session', () => {
  assert.match(source, /async function sendPresenceHeartbeat\(\)/)
  assert.match(source, /serverFetch\('\/api\/companion\/heartbeat'/)
  assert.match(source, /session_id: null/)
  assert.match(source, /if \(!state\.token\) return[\s\S]*if \(lifecycle\.currentSession\(\)\)[\s\S]*enqueueSessionEvent\('heartbeat'\)[\s\S]*sendPresenceHeartbeat\(\)/)
  assert.doesNotMatch(source, /setInterval\(\(\) => \{ if \(state\.token && lifecycle\.currentSession\(\)\)/)
})

test('pairing and reconnect register presence immediately', () => {
  const reconnect = source.slice(source.indexOf('async function reconnect()'), source.indexOf('async function pair('))
  const pair = source.slice(source.indexOf('async function pair('), source.indexOf('async function testServer('))
  assert.match(reconnect, /await sendPresenceHeartbeat\(\)/)
  assert.match(pair, /await sendPresenceHeartbeat\(\)/)
})
