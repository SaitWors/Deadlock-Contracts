import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Storage = require('../../src/storage.js')
const html = fs.readFileSync(new URL('../../overlay.html', import.meta.url), 'utf8')

test('overlay reads the same verified language preference saved by the desktop', () => {
  for (const language of ['ru', 'en']) {
    const values = new Map()
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
    assert.equal(Storage.writeJson('dc.language.v2', language, { storage }).ok, true)
    const context = vm.createContext({
      localStorage: storage, navigator: { language: 'en-US' }, location: { search: '' },
      URLSearchParams, TextEncoder, addEventListener() {},
    })
    context.window = context
    for (const [, source] of html.matchAll(/<script src="([^"]+)"/g)) {
      vm.runInContext(fs.readFileSync(new URL(`../../${source}`, import.meta.url), 'utf8'), context, { filename: source })
    }
    assert.equal(context.DCI18n.language(), language)
    assert.equal(context.DCI18n.literal('KILLS', 'УБИЙСТВА'), language === 'ru' ? 'УБИЙСТВА' : 'KILLS')
  }
})
