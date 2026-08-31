import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('Alpha18 KDA events are activity hints and never increment absolute roster totals', () => {
  const bg = read('src/background-engine.js')

  assert.doesNotMatch(bg, /Number\(state\.evidence\[key\]\s*\|\|\s*0\)\s*\+\s*1/)
  assert.match(bg, /GEP_KDA_EVENT_HINT/)
  assert.match(bg, /void getInfoSnapshot\(\)\.catch/)
  assert.match(bg, /assists:\s*asInt\(player\.assist\s*\?\?\s*player\.assists\)/)
})

test('Alpha18 overlay has a live match dashboard for matches without selected contracts', () => {
  const html = read('overlay.html')
  const js = read('src/overlay.js')

  for (const id of [
    'overlayStats',
    'overlayStatKills',
    'overlayStatDeaths',
    'overlayStatAssists',
    'overlayStatHealing',
    'overlayStatHeroDamage',
    'overlayStatObjectDamage',
    'overlayStatSouls',
    'overlayStatClock',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`))
  }

  assert.match(js, /function renderMatchDashboard/)
  assert.match(js, /NO ACTIVE CONTRACTS/)
  assert.match(js, /LAST KNOWN GEP VALUES/)
  assert.match(js, /selected\.length === 0/)
})

test('Alpha18 contract selection is not blocked merely because Deadlock is open or GEP is stale', () => {
  const bg = read('src/background-engine.js')
  const desktop = read('src/desktop.js')

  assert.doesNotMatch(bg, /ACTION_BLOCKED_GEP_STALE/)
  assert.doesNotMatch(bg, /LIVE_MODE_MISMATCH/)
  assert.doesNotMatch(desktop, /gepBlocksAction/)
  assert.match(desktop, /NEXT MATCH/)
})

test('Alpha18 release preserves security boundaries', () => {
  const manifest = JSON.parse(read('manifest.json'))
  const bg = read('src/background-engine.js')

  assert.equal(manifest.permissions?.includes('FileSystem'), false)
  assert.doesNotMatch(bg, /new WebSocket\s*\(/)
  assert.match(bg, /FINAL_COLLECTION_GRACE_MS = 5000/)
  assert.match(bg, /\/api\/companion\/attempts\/start/)
  assert.match(bg, /\/api\/companion\/matches\/finalize/)
})
