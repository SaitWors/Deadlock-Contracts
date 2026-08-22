import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'


const background = readFileSync(
  new URL('../src/background-engine.js', import.meta.url),
  'utf8',
)


function extractFunctionSource(name) {
  const marker = `function ${name}(`
  const start = background.indexOf(marker)

  assert.notEqual(
    start,
    -1,
    `missing function ${name}`,
  )

  const braceStart = background.indexOf('{', start)

  assert.notEqual(
    braceStart,
    -1,
    `missing opening brace for ${name}`,
  )

  let depth = 0
  let quote = null
  let escape = false
  let lineComment = false
  let blockComment = false

  for (let index = braceStart; index < background.length; index += 1) {
    const char = background[index]
    const next = background[index + 1]

    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }

    if (quote !== null) {
      if (escape) {
        escape = false
        continue
      }

      if (char === '\\') {
        escape = true
        continue
      }

      if (char === quote) {
        quote = null
      }

      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }

    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1

      if (depth === 0) {
        return background.slice(start, index + 1)
      }
    }
  }

  assert.fail(`unterminated function ${name}`)
}


function compileFunction(name, bindings = {}) {
  const source = extractFunctionSource(name)

  return Function(
    ...Object.keys(bindings),
    `"use strict"; return (${source});`,
  )(...Object.values(bindings))
}


test('nested onInfoUpdates2 and getInfo have distinct trust provenance', () => {
  const classifyInfoSource = compileFunction(
    'classifyInfoSource',
  )

  assert.equal(
    classifyInfoSource({
      success: true,
      res: {
        match_info: {},
      },
    }),
    'get_info',
  )

  assert.equal(
    classifyInfoSource({
      feature: 'match_info',
      info: {
        match_info: {},
      },
    }),
    'info_update',
  )
})


test('nested match outcome propagates info_update provenance', () => {
  const calls = []

  const extractMatchInfo = compileFunction(
    'extractMatchInfo',
    {
      setMatchId() {},
      parseMaybeJson(value) {
        return value
      },
      applyMatchOutcome(value, source) {
        calls.push({ value, source })
      },
      applyTeamScore() {},
      applyLocalRoster() {},
      updateUi() {},
    },
  )

  const value = JSON.stringify({
    winning_team: 'SAPPHIRE',
  })

  extractMatchInfo(
    {
      match_outcome: value,
    },
    'info_update',
  )

  assert.deepEqual(
    calls,
    [
      {
        value,
        source: 'info_update',
      },
    ],
  )
})


test('cached getInfo match outcome keeps diagnostic-only provenance', () => {
  const calls = []

  const extractMatchInfo = compileFunction(
    'extractMatchInfo',
    {
      setMatchId() {},
      parseMaybeJson(value) {
        return value
      },
      applyMatchOutcome(value, source) {
        calls.push({ value, source })
      },
      applyTeamScore() {},
      applyLocalRoster() {},
      updateUi() {},
    },
  )

  const value = JSON.stringify({
    winning_team: 'AMBER',
  })

  extractMatchInfo({
    match_outcome: value,
  })

  assert.deepEqual(
    calls,
    [
      {
        value,
        source: 'get_info',
      },
    ],
  )
})


test('release requires GEP version that contains Deadlock winning_team', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../manifest.json', import.meta.url),
      'utf8',
    ),
  )

  assert.equal(
    manifest.meta['minimum-gep-version'],
    '311.0.0',
  )
})


test('applyInfoUpdate preserves nested onInfoUpdates2 provenance end to end', () => {
  const outcomeCalls = []

  const classifyInfoSource = compileFunction(
    'classifyInfoSource',
  )

  const extractMatchInfo = compileFunction(
    'extractMatchInfo',
    {
      setMatchId() {},
      parseMaybeJson(value) {
        return value
      },
      applyMatchOutcome(value, source) {
        outcomeCalls.push({
          value,
          source,
        })
      },
      applyTeamScore() {},
      applyLocalRoster() {},
    },
  )

  const state = {}

  const extractKnown = compileFunction(
    'extractKnown',
    {
      classifyInfoSource,
      state,
      nowIso() {
        return '2026-08-22T10:39:13.000Z'
      },
      setMatchId() {},
      parseMaybeJson(value) {
        return value
      },
      asSteamIdString(value) {
        return String(value)
      },
      applyPhaseValue() {},
      applyGameModeValue() {},
      applyMatchHistory() {},
      extractMatchInfo,
      persistSession() {},
      updateUi() {},
    },
  )

  const applyInfoUpdate = compileFunction(
    'applyInfoUpdate',
    {
      state,
      nowIso() {
        return '2026-08-22T10:39:13.000Z'
      },
      parseMaybeJson(value) {
        if (typeof value !== 'string') return value

        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      },
      asSteamIdString(value) {
        return String(value)
      },
      applyPhaseValue() {},
      applyGameModeValue() {},
      applyMatchHistory() {},
      setMatchId() {},
      applyMatchOutcome() {},
      applyTeamScore() {},
      applyLocalRoster() {},
      extractKnown,
      persistSession() {},
      updateUi() {},
      scheduleSync() {},
      detectTransitionEvent() {
        return 'heartbeat'
      },
      log() {},
    },
  )

  const nested = {
    feature: 'match_info',
    info: {
      match_info: {
        match_outcome:
          '{"winning_team":"SAPPHIRE"}',
      },
    },
  }

  applyInfoUpdate(nested)

  assert.deepEqual(
    outcomeCalls,
    [
      {
        value:
          '{"winning_team":"SAPPHIRE"}',
        source: 'info_update',
      },
    ],
  )
})
