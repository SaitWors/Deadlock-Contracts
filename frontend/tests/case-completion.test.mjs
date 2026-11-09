import { afterEach, before, test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { build } from "vite"
import { JSDOM } from "jsdom"

let code
const environments = []
before(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    resolve: { alias: { "@": path.resolve("src") } },
    define: { "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: "tests/case-completion-entry.tsx", name: "CompletionTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
afterEach(async () => {
  for (const env of environments.splice(0)) {
    if (env.instance) await env.api.act(async () => env.instance.unmount())
    env.w.close()
  }
})

const bands = [
  { level: 1, start_xp: 0, end_xp: 130 },
  { level: 2, start_xp: 130, end_xp: 300 },
  { level: 3, start_xp: 300, end_xp: 520 },
  { level: 4, start_xp: 520, end_xp: 800 },
]
function progress(total_xp) {
  const band = [...bands].reverse().find((item) => total_xp >= item.start_xp)
  const level_xp = total_xp - band.start_xp
  const next_level_xp = band.end_xp - band.start_xp
  return {
    level: band.level,
    total_xp,
    level_xp,
    next_level_xp,
    progress_pct: (level_xp / next_level_xp) * 100,
    xp_to_next: next_level_xp - level_xp,
    lifetime_spent_threshold: band.start_xp,
  }
}
function progression(beforeXp, afterXp) {
  const before = progress(beforeXp)
  const after = progress(afterXp)
  return {
    before,
    after,
    levels: bands.filter((band) => band.level >= before.level && band.level <= after.level),
  }
}
function receipt(overrides = {}) {
  return {
    board_id: "board-a",
    ready: true,
    reason: null,
    user: { id: "user-a", display_name: "Тестовый исполнитель", avatar_url: null },
    attempts_used: 3,
    max_attempts: 3,
    tasks: [
      {
        id: "one",
        title: "Первая задача",
        title_i18n: { en: "First assignment" },
        status: "COMPLETED",
        xp: 20,
      },
      {
        id: "two",
        title: "Вторая задача",
        title_i18n: { en: "Second assignment" },
        status: "FAILED",
        xp: 0,
      },
      {
        id: "three",
        title: "Третья задача",
        title_i18n: { en: "Third assignment" },
        status: "COMPLETED",
        xp: 310,
      },
    ],
    total_xp: 330,
    progression: progression(120, 450),
    ...overrides,
  }
}
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
})
const plain = (value) => JSON.parse(JSON.stringify(value))
const skipLabel = /^(Skip animation|Пропустить анимацию)$/
const replayLabel = /^(Replay|Повторить)$/
const retryLabel =
  /Retry|Check again|Try again|Повторить|Проверить снова|Проверить.*раз|Попробовать.*раз/i

function browserClock(w, frameStep = 20) {
  let now = 0
  let id = 0
  let frames = 0
  const scheduled = new Map()
  Object.defineProperty(w.performance, "now", { configurable: true, value: () => now })
  w.Date.now = () => Date.UTC(2026, 10, 9) + now
  w.setTimeout = (callback, delay = 0, ...args) => {
    scheduled.set(++id, {
      at: now + Math.max(0, Number(delay) || 0),
      callback: () => callback(...args),
    })
    return id
  }
  w.clearTimeout = (timer) => scheduled.delete(timer)
  w.requestAnimationFrame = (callback) => {
    frames++
    scheduled.set(++id, { at: now + frameStep, callback: () => callback(now) })
    return id
  }
  w.cancelAnimationFrame = (frame) => scheduled.delete(frame)
  return {
    get frames() {
      return frames
    },
    get pending() {
      return scheduled.size
    },
    next(until) {
      const next = [...scheduled.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > until) {
        now = until
        return false
      }
      now = next[1].at
      scheduled.delete(next[0])
      next[1].callback()
      return true
    },
    get now() {
      return now
    },
  }
}

function runtime({
  language = "en",
  reducedMotion = true,
  frameStep = 20,
  fetcher = async () => response(receipt()),
} = {}) {
  // JSDOM checks receipt/state/control behavior; layout and the appearance of
  // flights and shattering remain browser-review concerns.
  const dom = new JSDOM('<button id="trigger">Finish contract</button><main id="mount"></main>', {
    url: "https://qa.invalid",
    runScripts: "outside-only",
  })
  const w = dom.window
  const realTimeout = w.setTimeout.bind(w)
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.Headers = Headers
  w.AbortController = AbortController
  w.AbortSignal = AbortSignal
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => realTimeout(() => this.port1.onmessage?.(), 0) }
  }
  const motionListeners = new Set()
  const media = {
    get matches() {
      return reducedMotion
    },
    addEventListener(_event, listener) {
      motionListeners.add(listener)
    },
    removeEventListener(_event, listener) {
      motionListeners.delete(listener)
    },
  }
  w.matchMedia = (query) =>
    query.includes("prefers-reduced-motion")
      ? media
      : { matches: false, addEventListener() {}, removeEventListener() {} }
  w.setReducedMotion = (next) => {
    reducedMotion = next
    for (const listener of motionListeners) listener({ matches: next })
  }
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
  }
  w.HTMLMediaElement.prototype.play = async function () {}
  w.HTMLMediaElement.prototype.pause = function () {}
  w.localStorage.setItem("dc.ui.language", language)
  const calls = []
  w.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", init })
    return fetcher(url, init)
  }
  const clock = browserClock(w, frameStep)
  w.eval(code)
  const env = { w, api: w.CompletionTest, document: w.document, calls, clock }
  environments.push(env)
  return env
}
async function mount(options = {}) {
  const env = runtime(options)
  env.trigger = env.document.getElementById("trigger")
  env.trigger.focus()
  env.closes = 0
  env.props = { boardId: "board-a", onClose: () => env.closes++ }
  await env.api.act(async () => {
    env.instance = env.api.mount(env.document.getElementById("mount"), env.props)
  })
  env.button = (label) =>
    [...env.document.querySelectorAll("button")].find((button) =>
      label.test(button.getAttribute("aria-label") || button.textContent.trim()),
    )
  env.phase = () => env.document.querySelector("dialog")?.dataset.phase
  env.tasks = () => [...env.document.querySelectorAll("[data-task-state]")]
  env.advance = async (milliseconds) => {
    const until = env.clock.now + milliseconds
    let steps = 0
    while (true) {
      let more
      await env.api.act(async () => {
        more = env.clock.next(until)
      })
      if (!more) break
      assert.ok(++steps < 2000, "animation should not schedule an unbounded timer loop")
    }
  }
  return env
}
function onlyReceiptReads(env, count = 1) {
  assert.equal(env.calls.length, count)
  for (const call of env.calls) {
    assert.equal(call.url, "/api/boards/board-a/completion")
    assert.equal(call.method, "GET")
    assert.equal(call.init.body, undefined)
  }
}
function displayedProgress(env, value, max) {
  const meter = env.document.querySelector("progress")
  assert.ok(meter, "the player's XP progression is visible")
  assert.equal(meter.value, value)
  assert.equal(meter.max, max)
}
async function unmount(env) {
  await env.api.act(async () => env.instance.unmount())
  env.instance = null
}

test("progress uses the receipt's unequal level bands at every boundary", () => {
  const { api } = runtime()
  for (const [xp, level, value, cost] of [
    [120, 1, 120, 130],
    [130, 2, 0, 170],
    [299, 2, 169, 170],
    [300, 3, 0, 220],
    [450, 3, 150, 220],
    [520, 4, 0, 280],
  ]) {
    assert.deepEqual(plain(api.progressAt(xp, bands)), {
      level,
      value,
      cost,
      percent: (value / cost) * 100,
    })
  }
})

test("replay follows only actual credited XP and can cross several levels", () => {
  const { api } = runtime()
  const data = receipt()
  data.tasks.forEach((task) => {
    task.reward_xp = 9999
  })
  assert.deepEqual(plain(api.replayTargets(data)), [140, 140, 450])
  assert.equal(api.readReceipt(data, "board-a").total_xp, 330)
  const failed = receipt({
    tasks: receipt().tasks.map((task) => ({ ...task, status: "FAILED", xp: 0 })),
    total_xp: 0,
    progression: progression(120, 120),
  })
  assert.deepEqual(plain(api.replayTargets(failed)), [120, 120, 120])
  assert.equal(api.readReceipt(failed, "board-a").total_xp, 0)
  // The current balance can have been corrected since this case was credited.
  const corrected = receipt({
    progression: progression(0, 100),
  })
  assert.equal(api.readReceipt(corrected, "board-a").progression.after.total_xp, 100)
  assert.deepEqual(plain(api.replayTargets(corrected)), [20, 20, 100])
})

test("a completion receipt must identify one to three unique terminal tasks and valid credited XP", () => {
  const { api } = runtime()
  for (const invalid of [
    null,
    receipt({ board_id: "other-board" }),
    receipt({ ready: "true" }),
    receipt({ tasks: [] }),
    receipt({
      tasks: [...receipt().tasks, { id: "four", title: "Extra", status: "FAILED", xp: 0 }],
    }),
    receipt({ tasks: receipt().tasks.map((task) => ({ ...task, id: "duplicate" })) }),
    receipt({ tasks: [{ id: "one", title: "Pending", status: "VERIFYING", xp: 330 }] }),
    receipt({ tasks: [{ id: "one", title: "Failed", status: "FAILED", xp: 330 }] }),
    receipt({ total_xp: 999 }),
    receipt({ total_xp: -1 }),
    receipt({ progression: { before: progress(450), after: progress(120), levels: bands } }),
    receipt({ progression: { before: progress(120), after: progress(450), levels: [] } }),
  ])
    assert.throws(() => api.readReceipt(invalid, "board-a"))
})

for (const count of [1, 2, 3]) {
  test(`reduced motion shows exactly ${count} selected task frame${count === 1 ? "" : "s"} and final credited XP`, async () => {
    const tasks = receipt().tasks.slice(0, count)
    const total = tasks.reduce((sum, task) => sum + task.xp, 0)
    const data = receipt({
      tasks,
      total_xp: total,
      progression: progression(120, 120 + total),
    })
    const env = await mount({ fetcher: async () => response(data) })
    assert.equal(env.phase(), "done")
    assert.equal(env.tasks().length, count)
    assert.deepEqual(
      env.tasks().map((task) => task.dataset.taskState),
      tasks.map((task) => (task.status === "COMPLETED" ? "absorbed" : "broken")),
    )
    for (const task of tasks)
      assert.match(env.document.querySelector("dialog").textContent, new RegExp(task.title_i18n.en))
    assert.equal(env.button(skipLabel), undefined)
    assert.ok(env.button(replayLabel))
    const final = progress(120 + total)
    displayedProgress(env, final.level_xp, final.next_level_xp)
    assert.equal(env.clock.frames, 0)
    onlyReceiptReads(env)
  })
}

test("a receipt still under verification waits for an explicit retry without starting animation", async () => {
  let reads = 0
  const env = await mount({
    reducedMotion: false,
    fetcher: async () =>
      response(++reads === 1 ? receipt({ ready: false, reason: "VERIFYING" }) : receipt()),
  })
  assert.equal(env.phase(), "waiting")
  assert.equal(env.document.querySelector('[role="alert"]'), null)
  assert.equal(env.clock.frames, 0)
  assert.equal(env.button(skipLabel), undefined)
  assert.equal(env.button(replayLabel), undefined)
  assert.ok(env.button(retryLabel))
  await env.advance(5000)
  onlyReceiptReads(env)
  await env.api.act(async () => env.button(retryLabel).click())
  assert.equal(env.phase(), "playing")
  onlyReceiptReads(env, 2)
})

test("invalid server data remains retryable without displaying a successful completion", async () => {
  let reads = 0
  const env = await mount({
    fetcher: async () => response(++reads === 1 ? { ready: true, board_id: "board-a" } : receipt()),
  })
  assert.ok(env.document.querySelector('[role="alert"]'))
  assert.notEqual(env.phase(), "done")
  assert.equal(env.tasks().length, 0)
  assert.equal(env.clock.frames, 0)
  await env.api.act(async () => env.button(retryLabel).click())
  assert.equal(env.phase(), "done")
  onlyReceiptReads(env, 2)
})

test("a failed receipt GET can be retried without any reward mutation", async () => {
  let reads = 0
  const env = await mount({
    fetcher: async () => {
      if (++reads === 1) throw new Error("offline")
      return response(receipt())
    },
  })
  assert.ok(env.document.querySelector('[role="alert"]'))
  await env.api.act(async () => env.button(retryLabel).click())
  assert.equal(env.phase(), "done")
  onlyReceiptReads(env, 2)
})

test("normal playback absorbs successes, breaks failed frames, and ends with authoritative XP", async () => {
  const env = await mount({ reducedMotion: false })
  assert.equal(env.phase(), "playing")
  assert.equal(env.tasks().length, 3)
  const seen = env.tasks().map(() => new Set())
  const displayedBands = new Set()
  const announcements = new Set()
  let splitFragments = 0
  for (let elapsed = 0; elapsed <= 20000 && env.phase() !== "done"; elapsed += 40) {
    env.tasks().forEach((task, index) => seen[index].add(task.dataset.taskState))
    displayedBands.add(env.document.querySelector("progress").max)
    env.document
      .querySelectorAll("[aria-live]")
      .forEach((node) => announcements.add(node.textContent))
    const breaking = env.tasks().find((task) => task.dataset.taskState === "breaking")
    if (breaking)
      splitFragments = Math.max(
        splitFragments,
        [...breaking.querySelectorAll('[aria-hidden="true"]')].filter(
          (part) =>
            part.textContent.includes("Second assignment") && /0\s*XP/.test(part.textContent),
        ).length,
      )
    await env.advance(40)
  }
  env.tasks().forEach((task, index) => seen[index].add(task.dataset.taskState))
  assert.equal(env.phase(), "done", "ceremony must finish without a CSS animationend event")
  for (const index of [0, 2]) {
    assert.ok(seen[index].has("pending"))
    assert.ok(seen[index].has("flying"), `successful frame ${index + 1} flies`)
    assert.ok(seen[index].has("absorbed"), `successful frame ${index + 1} is absorbed`)
    assert.equal(seen[index].has("breaking"), false)
  }
  assert.ok(seen[1].has("breaking"))
  assert.ok(seen[1].has("broken"))
  assert.equal(splitFragments, 2, "a failed frame splits into two presentation fragments")
  assert.equal(seen[1].has("flying"), false)
  assert.match(env.document.querySelector("dialog").textContent, /330/)
  assert.match(env.document.querySelector("dialog").textContent, /450\s*total XP/)
  displayedProgress(env, 150, 220)
  assert.deepEqual([...displayedBands], [130, 170, 220])
  assert.match([...announcements].join("\n"), /level\s+2/i)
  assert.match([...announcements].join("\n"), /level\s+3/i)
  assert.ok(env.button(replayLabel))
  onlyReceiptReads(env)
})

test("replay never raises a corrected current balance above the authoritative receipt", async () => {
  const data = receipt({
    progression: progression(0, 100),
  })
  const env = await mount({ reducedMotion: false, fetcher: async () => response(data) })
  for (let elapsed = 0; elapsed <= 20000 && env.phase() !== "done"; elapsed += 100) {
    assert.ok(env.document.querySelector("progress").value <= 100)
    await env.advance(100)
  }
  assert.equal(env.phase(), "done")
  displayedProgress(env, 100, 130)
  assert.match(env.document.querySelector("dialog").textContent, /100\s*total XP/)
  assert.match(env.document.querySelector("dialog").textContent, /330\s*XP earned/)
  onlyReceiptReads(env)
})

test("skip, replay, and Escape never fetch or credit the receipt again", async () => {
  const env = await mount({ reducedMotion: false })
  await env.api.act(async () => env.button(skipLabel).click())
  assert.equal(env.phase(), "done")
  assert.deepEqual(
    env.tasks().map((task) => task.dataset.taskState),
    ["absorbed", "broken", "absorbed"],
  )
  displayedProgress(env, 150, 220)
  await env.api.act(async () => env.button(replayLabel).click())
  assert.equal(env.phase(), "playing")
  const cancel = () =>
    env.document
      .querySelector("dialog")
      .dispatchEvent(new env.w.Event("cancel", { cancelable: true }))
  await env.api.act(async () => cancel())
  assert.equal(env.phase(), "done")
  assert.equal(env.closes, 0)
  await env.api.act(async () => cancel())
  assert.equal(env.closes, 1)
  onlyReceiptReads(env)
  await unmount(env)
  assert.equal(env.document.activeElement, env.trigger)
  assert.equal(env.document.body.style.overflow, "")
  assert.equal(env.clock.pending, 0)
})

test("a focused skip control transfers focus to Done when the final receipt replaces it", async () => {
  const env = await mount({ reducedMotion: false })
  const skip = env.button(skipLabel)
  skip.focus()
  assert.equal(env.document.activeElement, skip)
  await env.api.act(async () => skip.click())
  assert.equal(env.phase(), "done")
  assert.ok(env.document.activeElement === env.button(/^Done$/), "focus moves from Skip to Done")
  onlyReceiptReads(env)
})

test("a focused replay control transfers focus to Skip when playback replaces it", async () => {
  const env = await mount({ reducedMotion: false })
  await env.api.act(async () => env.button(skipLabel).click())
  const replay = env.button(replayLabel)
  replay.focus()
  assert.equal(env.document.activeElement, replay)
  await env.api.act(async () => replay.click())
  assert.equal(env.phase(), "playing")
  assert.ok(env.document.activeElement === env.button(skipLabel), "focus moves from Replay to Skip")
  onlyReceiptReads(env)
})

test("automatic playback completion keeps a keyboard user's focus on the replacement Done control", async () => {
  const env = await mount({ reducedMotion: false })
  env.button(skipLabel).focus()
  for (let elapsed = 0; elapsed <= 20000 && env.phase() !== "done"; elapsed += 100) {
    await env.advance(100)
  }
  assert.equal(env.phase(), "done")
  assert.ok(
    env.document.activeElement === env.button(/^Done$/),
    "automatic completion moves focus from Skip to Done",
  )
  onlyReceiptReads(env)
})

test("a delayed animation frame still presents and announces every crossed level", async () => {
  const data = receipt({
    tasks: [{ ...receipt().tasks[0], xp: 330 }],
    total_xp: 330,
  })
  const env = await mount({
    reducedMotion: false,
    frameStep: 900,
    fetcher: async () => response(data),
  })
  const displayedBands = new Set()
  const announcements = new Set()
  for (let elapsed = 0; elapsed <= 20000 && env.phase() !== "done"; elapsed += 100) {
    displayedBands.add(env.document.querySelector("progress").max)
    env.document
      .querySelectorAll("[aria-live]")
      .forEach((node) => announcements.add(node.textContent))
    await env.advance(100)
  }
  assert.equal(env.phase(), "done")
  assert.deepEqual([...displayedBands], [130, 170, 220])
  assert.match([...announcements].join("\n"), /level\s+2/i)
  assert.match([...announcements].join("\n"), /level\s+3/i)
  displayedProgress(env, 150, 220)
  onlyReceiptReads(env)
})

test("enabling reduced motion during playback immediately reveals the final receipt", async () => {
  const env = await mount({ reducedMotion: false })
  assert.equal(env.phase(), "playing")
  await env.api.act(async () => env.w.setReducedMotion(true))
  assert.equal(env.phase(), "done")
  assert.deepEqual(
    env.tasks().map((task) => task.dataset.taskState),
    ["absorbed", "broken", "absorbed"],
  )
  onlyReceiptReads(env)
})

test("Russian controls close the final receipt and restore focus to its trigger", async () => {
  const env = await mount({ language: "ru" })
  assert.ok(env.button(/^Повторить$/))
  assert.ok(env.button(/^Закрыть итог$/))
  assert.ok(env.document.querySelector("dialog").contains(env.document.activeElement))
  assert.equal(env.document.body.style.overflow, "hidden")
  await env.api.act(async () => env.button(/^Закрыть итог$/).click())
  assert.equal(env.closes, 1)
  await unmount(env)
  assert.equal(env.document.activeElement, env.trigger)
  assert.equal(env.document.body.style.overflow, "")
  onlyReceiptReads(env)
})

test("all failed tasks show zero credited XP without advancing progression", async () => {
  const data = receipt({
    tasks: receipt().tasks.map((task) => ({ ...task, status: "FAILED", xp: 0 })),
    total_xp: 0,
    progression: progression(120, 120),
  })
  const env = await mount({ fetcher: async () => response(data) })
  assert.equal(env.phase(), "done")
  assert.deepEqual(
    env.tasks().map((task) => task.dataset.taskState),
    ["broken", "broken", "broken"],
  )
  assert.match(env.document.querySelector("dialog").textContent, /\b0\s*XP\b/)
  displayedProgress(env, 120, 130)
  onlyReceiptReads(env)
})

test("a receipt resolving after unmount cannot start playback or steal restored focus", async () => {
  let resolve
  const env = await mount({
    reducedMotion: false,
    fetcher: () =>
      new Promise((done) => {
        resolve = done
      }),
  })
  await unmount(env)
  await env.api.act(async () => resolve(response(receipt())))
  await env.advance(10000)
  assert.equal(env.document.querySelector("dialog"), null)
  assert.equal(env.clock.frames, 0)
  assert.equal(env.clock.pending, 0)
  assert.equal(env.document.activeElement, env.trigger)
  onlyReceiptReads(env)
})
