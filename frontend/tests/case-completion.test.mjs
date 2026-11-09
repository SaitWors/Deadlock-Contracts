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
    replayable: true,
    result_source: "saved",
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
const isFinal = (phase) => phase === "done"
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
  holdFlight = false,
  storedMotion = true,
} = {}) {
  // JSDOM verifies receipts, modal lifecycle and WAAPI completion ordering.
  // The browser review verifies composition, curve appearance and wave rendering.
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
  w.Element.prototype.getBoundingClientRect = function () {
    const index = [...w.document.querySelectorAll(".cc-task")].indexOf(this.closest(".cc-task"))
    const left = index >= 0 ? 360 + index * 280 : 560
    const top = index >= 0 ? 420 : 140
    const width = index >= 0 ? 240 : 320
    const height = index >= 0 ? 180 : 220
    return {
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON() {},
    }
  }
  w.localStorage.setItem("dc.ui.language", language)
  w.localStorage.setItem("dc.ui.appearance", JSON.stringify({ motion: storedMotion }))
  const calls = []
  w.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", init })
    return fetcher(url, init)
  }
  const clock = browserClock(w, frameStep)
  const animations = []
  w.Element.prototype.animate = function (keyframes, options = {}) {
    let resolve
    let reject
    let timer
    let settled = false
    const animation = {
      target: this,
      keyframes,
      options,
      playState: "running",
      finished: new Promise((done, fail) => {
        resolve = done
        reject = fail
      }),
      finish() {
        if (settled) return
        settled = true
        animation.playState = "finished"
        w.clearTimeout(timer)
        resolve(animation)
        animation.onfinish?.()
      },
      cancel() {
        w.clearTimeout(timer)
        animation.playState = "idle"
        if (!settled) {
          settled = true
          reject(new w.DOMException("The animation was canceled", "AbortError"))
        }
        animation.oncancel?.()
      },
      commitStyles() {},
      pause() {
        animation.playState = "paused"
      },
      play() {
        animation.playState = "running"
      },
    }
    // Cleanup can cancel decorative effects without awaiting their promise.
    animation.finished.catch(() => {})
    animations.push(animation)
    const config = typeof options === "number" ? { duration: options } : options
    const flight =
      this.matches(".cf-flight") && this.closest('.cf-task-entry[data-outcome="success"]')
    if (config.iterations !== Infinity && !(holdFlight && flight))
      timer = w.setTimeout(
        () => animation.finish(),
        (config.delay || 0) + (config.duration || 0) * (config.iterations || 1),
      )
    return animation
  }
  w.eval(code)
  const env = { w, api: w.CompletionTest, document: w.document, calls, clock, animations }
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
  env.dialog = () => env.document.querySelector("dialog.case-completion")
  env.phase = () => env.dialog()?.dataset.phase
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
  env.until = async (predicate, maximum = 30000, step = 20) => {
    const deadline = env.clock.now + maximum
    while (!predicate() && env.clock.now < deadline) await env.advance(step)
    assert.ok(predicate(), `expected animation state within ${maximum} ms (phase: ${env.phase()})`)
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
function readMeter(env) {
  const node = env.document.querySelector("progress, [role=progressbar]")
  if (!node) return null
  return {
    node,
    value:
      node.value ??
      (node.hasAttribute("aria-valuenow") ? Number(node.getAttribute("aria-valuenow")) : null),
    max:
      node.max ??
      (node.hasAttribute("aria-valuemax") ? Number(node.getAttribute("aria-valuemax")) : null),
  }
}
function displayedProgress(env, value, max) {
  const meter = readMeter(env)
  assert.ok(meter, "the player's XP progression is visible")
  assert.equal(meter.value, value)
  assert.equal(meter.max, max)
}
async function unmount(env) {
  await env.api.act(async () => env.instance.unmount())
  env.instance = null
}

function staticMotionOnly(env) {
  assert.equal(env.clock.frames, 0)
  for (const animation of env.animations) {
    const config =
      typeof animation.options === "number" ? { duration: animation.options } : animation.options
    assert.ok(config.duration <= 200, "static results allow only a short fade")
    assert.notEqual(config.iterations, Infinity)
    assert.ok(
      animation.keyframes.every((frame) => frame.transform === undefined),
      "static results have no spatial motion",
    )
  }
}
async function nativeEscape(env) {
  await env.api.act(async () =>
    env.dialog().dispatchEvent(new env.w.Event("cancel", { cancelable: true })),
  )
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
  ])
    assert.deepEqual(plain(api.progressAt(xp, bands)), {
      level,
      value,
      cost,
      percent: (value / cost) * 100,
    })
})

test("replay uses actual credited task XP instead of nominal reward values", () => {
  const { api } = runtime()
  const data = receipt()
  data.tasks.forEach((task) => {
    task.reward_xp = 9999
  })
  assert.deepEqual(plain(api.replayTargets(data)), [140, 140, 450])
  assert.equal(api.readReceipt(data, "board-a").total_xp, 330)
  const failed = receipt({
    tasks: data.tasks.map((task) => ({ ...task, status: "FAILED", xp: 0 })),
    total_xp: 0,
    progression: progression(120, 120),
  })
  assert.deepEqual(plain(api.replayTargets(failed)), [120, 120, 120])
})

test("receipt validation requires one to three unique terminal tasks and authoritative XP", () => {
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

test("receipt source metadata cannot authorize a fabricated replay", () => {
  const { api } = runtime()
  for (const invalid of [
    receipt({ result_source: "current-profile" }),
    receipt({ replayable: "true" }),
    receipt({ ready: false, replayable: true }),
    receipt({ result_source: "legacy", replayable: true }),
    receipt({ replayable: true, progression: { before: null, after: progress(450), levels: [] } }),
    receipt({ replayable: true, progression: progression(0, 100) }),
    receipt({ replayable: true, progression: progression(120, 520) }),
  ])
    assert.throws(() => api.readReceipt(invalid, "board-a"))
  for (const result_source of ["saved", "ledger"])
    assert.equal(
      api.readReceipt(receipt({ result_source }), "board-a").result_source,
      result_source,
    )
  const legacy = receipt({
    replayable: false,
    result_source: "legacy",
    progression: { before: null, after: null, levels: [] },
  })
  assert.equal(api.readReceipt(legacy, "board-a").progression.before, null)
})

for (const count of [1, 2, 3]) {
  test(`reduced motion displays exactly ${count} task panel${count === 1 ? "" : "s"} and the actual final profile`, async () => {
    const tasks = receipt().tasks.slice(0, count)
    const total = tasks.reduce((sum, task) => sum + task.xp, 0)
    const env = await mount({
      fetcher: async () =>
        response(receipt({ tasks, total_xp: total, progression: progression(120, 120 + total) })),
    })
    assert.ok(isFinal(env.phase()))
    assert.equal(env.tasks().length, count)
    assert.deepEqual(
      env.tasks().map((task) => task.dataset.taskState),
      tasks.map((task) => (task.status === "COMPLETED" ? "absorbed" : "broken")),
    )
    for (const task of tasks) assert.ok(env.dialog().textContent.includes(task.title_i18n.en))
    const final = progress(120 + total)
    displayedProgress(env, final.level_xp, final.next_level_xp)
    staticMotionOnly(env)
    onlyReceiptReads(env)
  })
}

test("the ready scene has no visible header, footer or playback controls", async () => {
  const env = await mount()
  assert.equal(Boolean(env.dialog().querySelector("header, footer")), false)
  assert.equal(Boolean(env.dialog().querySelector("button:not(.sr-only)")), false)
  assert.equal(env.dialog().querySelectorAll(".cc-profile").length, 1)
  assert.equal(env.dialog().querySelectorAll(".cc-task").length, 3)
  assert.ok(
    env.dialog().getAttribute("aria-label") || env.dialog().getAttribute("aria-labelledby"),
    "the minimal modal retains an accessible name",
  )
  assert.ok(env.dialog().contains(env.document.activeElement))
  assert.equal(env.document.body.style.overflow, "hidden")
})

test("the saved motion preference uses a static final even when the OS permits motion", async () => {
  const env = await mount({ reducedMotion: false, storedMotion: false })
  assert.ok(isFinal(env.phase()))
  displayedProgress(env, 150, 220)
  staticMotionOnly(env)
  onlyReceiptReads(env)
})

test("the assistive return control and an empty backdrop can close the minimal scene", async () => {
  const env = await mount()
  const control = env.dialog().querySelector(".cf-return.sr-only")
  assert.ok(control, "keyboard and assistive users retain a named return action")
  assert.ok(control.textContent.trim() || control.getAttribute("aria-label"))
  await env.api.act(async () => control.click())
  assert.equal(env.closes, 1)
  await env.api.act(async () =>
    env.document
      .querySelector(".cc-profile")
      .dispatchEvent(new env.w.MouseEvent("click", { bubbles: true })),
  )
  assert.equal(env.closes, 1, "clicking a profile does not dismiss it")
  await env.api.act(async () =>
    env.dialog().dispatchEvent(new env.w.MouseEvent("click", { bubbles: true })),
  )
  assert.equal(env.closes, 2)
  onlyReceiptReads(env)
})

test("a verification-pending receipt waits for an explicit retry without animation", async () => {
  let reads = 0
  const pending = receipt({
    ready: false,
    reason: "VERIFYING",
    replayable: false,
    progression: { before: null, after: null, levels: [] },
  })
  const env = await mount({
    reducedMotion: false,
    fetcher: async () => response(++reads === 1 ? pending : receipt()),
  })
  assert.equal(env.phase(), "waiting")
  assert.equal(Boolean(env.document.querySelector('[role="alert"]')), false)
  assert.equal(env.clock.frames, 0)
  assert.equal(env.animations.length, 0)
  assert.ok(env.button(retryLabel))
  await env.advance(5000)
  onlyReceiptReads(env)
  await env.api.act(async () => env.button(retryLabel).click())
  assert.equal(env.phase(), "entering")
  onlyReceiptReads(env, 2)
})

test("invalid server data stays retryable without showing a successful result", async () => {
  let reads = 0
  const env = await mount({
    fetcher: async () => response(++reads === 1 ? { ready: true, board_id: "board-a" } : receipt()),
  })
  assert.equal(env.phase(), "error")
  assert.ok(env.document.querySelector('[role="alert"]'))
  assert.equal(env.tasks().length, 0)
  assert.equal(env.animations.length, 0)
  await env.api.act(async () => env.button(retryLabel).click())
  assert.ok(isFinal(env.phase()))
  onlyReceiptReads(env, 2)
})

test("a failed receipt GET can be retried without a reward mutation", async () => {
  let reads = 0
  const env = await mount({
    fetcher: async () => {
      if (++reads === 1) throw new Error("offline")
      return response(receipt())
    },
  })
  assert.equal(env.phase(), "error")
  assert.ok(env.document.querySelector('[role="alert"]'))
  await env.api.act(async () => env.button(retryLabel).click())
  assert.ok(isFinal(env.phase()))
  onlyReceiptReads(env, 2)
})

test("Escape closes playback in one action and unmount restores the opener", async () => {
  const env = await mount({ reducedMotion: false })
  assert.equal(env.phase(), "entering")
  await env.until(() => env.tasks()[0]?.dataset.taskState === "flying")
  await nativeEscape(env)
  assert.equal(env.closes, 1, "Escape closes instead of skipping to the final frame")
  onlyReceiptReads(env)
  await unmount(env)
  assert.ok(env.document.activeElement === env.trigger, "focus returns to the opener")
  assert.equal(env.document.body.style.overflow, "")
  assert.equal(env.clock.pending, 0)
})

test("Escape closes the reduced final scene and restores the opener in Russian", async () => {
  const env = await mount({ language: "ru" })
  assert.ok(isFinal(env.phase()))
  await nativeEscape(env)
  assert.equal(env.closes, 1)
  await unmount(env)
  assert.ok(env.document.activeElement === env.trigger, "focus returns to the opener")
  assert.equal(env.document.body.style.overflow, "")
  onlyReceiptReads(env)
})

test("profile and tasks enter in sequence then float on independent transform layers", async () => {
  const env = await mount({ reducedMotion: false, holdFlight: true })
  const entries = env.animations.filter((animation) => animation.target.matches(".cf-entry"))
  assert.equal(entries.length, 4)
  assert.ok(entries[0].target.matches(".cf-profile-entry"))
  const delays = entries.map((animation) => animation.options.delay || 0)
  assert.equal(delays[0], 0)
  for (let index = 1; index < delays.length; index++) assert.ok(delays[index] > delays[index - 1])
  for (const entry of entries) {
    assert.match(entry.keyframes[0].transform, /translate3d\(0,-/)
    assert.equal(entry.keyframes[0].opacity, 0)
    assert.equal(entry.keyframes.at(-1).opacity, 1)
    assert.ok(entry.keyframes.length >= 4, "entry includes the landing overshoot and spring back")
  }
  await env.until(() => env.phase() === "floating")
  const drifts = env.animations.filter((animation) => animation.target.matches(".cf-drift"))
  assert.equal(drifts.length, 4)
  for (const drift of drifts) {
    assert.equal(drift.options.iterations, Infinity)
    assert.equal(drift.playState, "running")
  }
  await env.until(() => env.tasks()[0]?.dataset.taskState === "flying")
  assert.equal(
    drifts.find((animation) => animation.target.matches(".cf-task-drift")).playState,
    "paused",
  )
  assert.equal(
    drifts.find((animation) => animation.target.matches(".cf-profile-drift")).playState,
    "running",
  )
  onlyReceiptReads(env)
})

test("task flight awaits WAAPI finished before absorption, XP gain and the next flight", async () => {
  const env = await mount({ reducedMotion: false, holdFlight: true })
  await env.until(() => env.tasks()[0]?.dataset.taskState === "flying")
  const flight = env.animations.find(
    (animation) =>
      animation.target.matches(".cf-flight") &&
      animation.target.closest('.cf-task-entry[data-outcome="success"]'),
  )
  assert.ok(flight, "a successful task uses WAAPI on its separate flight layer")
  assert.ok(
    Array.isArray(flight.keyframes) && flight.keyframes.length > 2,
    "flight samples a curve rather than a two-point translation",
  )
  assert.ok(
    flight.target.closest(".cf-drift"),
    "floating and flight transforms use nested elements",
  )
  assert.ok(flight.target.closest(".cf-entry"), "entry and flight transforms use nested elements")
  await env.advance(5000)
  assert.equal(env.tasks()[0].dataset.taskState, "flying")
  assert.equal(env.tasks()[2].dataset.taskState, "pending")
  displayedProgress(env, 120, 130)
  await env.api.act(async () => flight.finish())
  await env.until(() => env.tasks()[0].dataset.taskState === "absorbed")
  await env.until(() => readMeter(env).value !== 120)
  onlyReceiptReads(env)
})

test("normal playback absorbs credited tasks, splits failures and ends at actual XP", async () => {
  const env = await mount({ reducedMotion: false })
  const seen = env.tasks().map(() => new Set())
  const displayedBands = new Set()
  const announcements = new Set()
  let splitFragments = 0
  for (let elapsed = 0; elapsed <= 30000 && !isFinal(env.phase()); elapsed += 20) {
    env.tasks().forEach((task, index) => seen[index].add(task.dataset.taskState))
    const meter = readMeter(env)
    if (meter) displayedBands.add(meter.max)
    env.document
      .querySelectorAll("[aria-live]")
      .forEach((node) => announcements.add(node.textContent))
    const breaking = env.tasks().find((task) => task.dataset.taskState === "breaking")
    if (breaking)
      splitFragments = Math.max(splitFragments, breaking.querySelectorAll(".cc-shard").length)
    await env.advance(20)
  }
  env.tasks().forEach((task, index) => seen[index].add(task.dataset.taskState))
  assert.ok(isFinal(env.phase()), "ceremony finishes without CSS animationend events")
  for (const index of [0, 2]) {
    assert.ok(seen[index].has("pending"))
    assert.ok(seen[index].has("flying"))
    assert.ok(seen[index].has("absorbed"))
    assert.equal(seen[index].has("breaking"), false)
  }
  assert.ok(seen[1].has("breaking"))
  assert.ok(seen[1].has("broken"))
  assert.equal(seen[1].has("flying"), false)
  assert.equal(splitFragments, 2, "a failed task splits into two presentation halves")
  displayedProgress(env, 150, 220)
  assert.deepEqual([...displayedBands], [130, 170, 220])
  assert.match([...announcements].join("\n"), /level\s+2/i)
  assert.match([...announcements].join("\n"), /level\s+3/i)
  assert.match(env.document.querySelector(".cc-level").textContent, /\b3\b/)
  assert.equal(Boolean(env.dialog().querySelector("button:not(.sr-only)")), false)
  onlyReceiptReads(env)
})

test("a within-band reward produces an ordinary impact without level waves", async () => {
  const data = receipt({
    tasks: [{ ...receipt().tasks[0], xp: 7 }],
    total_xp: 7,
    progression: progression(50, 57),
  })
  const env = await mount({ reducedMotion: false, fetcher: async () => response(data) })
  let ordinaryImpact = false
  while (!isFinal(env.phase()) && env.clock.now < 15000) {
    ordinaryImpact ||= Boolean(env.document.querySelector(".cf-impact--hit"))
    assert.equal(env.document.querySelectorAll(".cf-wave").length, 0)
    assert.notEqual(env.phase(), "threshold")
    assert.notEqual(env.phase(), "levelup")
    await env.advance(20)
  }
  assert.ok(isFinal(env.phase()))
  assert.ok(ordinaryImpact)
  displayedProgress(env, 57, 130)
  onlyReceiptReads(env)
})

test("the old bar holds at exactly 100% before the same plaque changes level and shows overflow", async () => {
  const data = receipt({
    tasks: [{ ...receipt().tasks[0], xp: 25 }],
    total_xp: 25,
    progression: progression(120, 145),
  })
  const env = await mount({ reducedMotion: false, fetcher: async () => response(data) })
  const profile = env.document.querySelector(".cc-profile")
  await env.until(() => env.phase() === "threshold")
  displayedProgress(env, 130, 130)
  assert.match(env.document.querySelector(".cc-level").textContent, /\b1\b/)
  assert.match(env.document.querySelector(".cc-total").textContent, /130/)
  await env.advance(240)
  assert.equal(env.phase(), "threshold", "100% is presented for a visible hold")
  displayedProgress(env, 130, 130)
  await env.until(() => env.phase() === "levelup")
  displayedProgress(env, 130, 130)
  assert.ok(
    env.document.querySelector(".cc-profile") === profile,
    "centering keeps the same profile plaque",
  )
  await env.until(() => /\b2\b/.test(env.document.querySelector(".cc-level").textContent))
  displayedProgress(env, 0, 170)
  assert.equal(env.document.querySelectorAll(".cf-impact--level .cf-wave").length, 2)
  await env.advance(800)
  displayedProgress(env, 0, 170)
  await env.until(() => isFinal(env.phase()))
  displayedProgress(env, 15, 170)
  assert.ok(env.document.querySelector(".cc-profile") === profile)
  onlyReceiptReads(env)
})

test("an exact-threshold reward ends in the new level with no fabricated overflow", async () => {
  const data = receipt({
    tasks: [{ ...receipt().tasks[0], xp: 10 }],
    total_xp: 10,
    progression: progression(120, 130),
  })
  const env = await mount({ reducedMotion: false, fetcher: async () => response(data) })
  await env.until(() => env.phase() === "threshold")
  displayedProgress(env, 130, 130)
  await env.until(() => isFinal(env.phase()))
  displayedProgress(env, 0, 170)
  assert.match(env.document.querySelector(".cc-level").textContent, /\b2\b/)
  onlyReceiptReads(env)
})

test("a delayed frame still presents every crossed level before the final overflow", async () => {
  const data = receipt({ tasks: [{ ...receipt().tasks[0], xp: 330 }], total_xp: 330 })
  const env = await mount({
    reducedMotion: false,
    frameStep: 900,
    fetcher: async () => response(data),
  })
  const displayedBands = new Set()
  const announcements = new Set()
  for (let elapsed = 0; elapsed <= 40000 && !isFinal(env.phase()); elapsed += 20) {
    const meter = readMeter(env)
    if (meter) displayedBands.add(meter.max)
    env.document
      .querySelectorAll("[aria-live]")
      .forEach((node) => announcements.add(node.textContent))
    await env.advance(20)
  }
  assert.ok(isFinal(env.phase()))
  assert.deepEqual([...displayedBands], [130, 170, 220])
  assert.match([...announcements].join("\n"), /level\s+2/i)
  assert.match([...announcements].join("\n"), /level\s+3/i)
  displayedProgress(env, 150, 220)
  onlyReceiptReads(env)
})

test("enabling reduced motion cancels playback and reveals the actual final profile", async () => {
  const env = await mount({ reducedMotion: false, holdFlight: true })
  await env.until(() => env.tasks()[0]?.dataset.taskState === "flying")
  await env.api.act(async () => env.w.setReducedMotion(true))
  assert.ok(isFinal(env.phase()))
  assert.deepEqual(
    env.tasks().map((task) => task.dataset.taskState),
    ["absorbed", "broken", "absorbed"],
  )
  displayedProgress(env, 150, 220)
  assert.equal(
    env.animations.filter(
      (animation) =>
        animation.playState === "running" && animation.keyframes.some((frame) => frame.transform),
    ).length,
    0,
  )
  onlyReceiptReads(env)
})

test("motion preference changes clear a completed level-up offset before static results and replay", async () => {
  const data = receipt({
    tasks: [{ ...receipt().tasks[0], xp: 25 }],
    total_xp: 25,
    progression: progression(120, 145),
  })
  const env = await mount({ reducedMotion: false, fetcher: async () => response(data) })
  const shift = env.document.querySelector(".cf-profile-shift")
  await env.until(() => isFinal(env.phase()))
  const centeredTransform = shift.style.transform
  assert.match(
    centeredTransform,
    /scale\(1\.09\)/,
    "the completed level-up keeps its centered scale",
  )
  displayedProgress(env, 15, 170)

  await env.api.act(async () => env.w.setReducedMotion(true))
  assert.ok(isFinal(env.phase()))
  assert.equal(env.dialog().dataset.static, "true")
  assert.equal(
    shift.style.transform,
    "",
    "static results return the profile to the layout position",
  )
  assert.deepEqual(
    env.tasks().map((task) => task.dataset.taskState),
    ["absorbed"],
  )
  assert.equal(env.document.querySelector(".cf-flight").style.opacity, "")
  displayedProgress(env, 15, 170)

  await env.api.act(async () => env.w.setReducedMotion(false))
  assert.equal(env.phase(), "entering")
  assert.equal(env.dialog().dataset.static, "false")
  assert.equal(shift.style.transform, "", "the new entrance starts without the old center offset")
  assert.deepEqual(
    env.tasks().map((task) => task.dataset.taskState),
    ["pending"],
  )
  displayedProgress(env, 120, 130)
  await env.until(() => isFinal(env.phase()))
  assert.equal(
    shift.style.transform,
    centeredTransform,
    "replay centers once instead of accumulating offsets",
  )
  displayedProgress(env, 15, 170)
  onlyReceiptReads(env)
})

test("all failures replay shattering with a stable saved profile and zero XP gain", async () => {
  const data = receipt({
    tasks: receipt().tasks.map((task) => ({ ...task, status: "FAILED", xp: 0 })),
    total_xp: 0,
    progression: progression(120, 120),
  })
  const env = await mount({ reducedMotion: false, fetcher: async () => response(data) })
  const broken = new Set()
  while (!isFinal(env.phase()) && env.clock.now < 20000) {
    env.tasks().forEach((task, index) => {
      if (task.dataset.taskState === "breaking") broken.add(index)
    })
    displayedProgress(env, 120, 130)
    await env.advance(20)
  }
  assert.ok(isFinal(env.phase()))
  assert.deepEqual([...broken], [0, 1, 2])
  assert.deepEqual(
    env.tasks().map((task) => task.dataset.taskState),
    ["broken", "broken", "broken"],
  )
  assert.equal(
    env.animations.some((animation) => animation.target.matches(".cf-flight")),
    false,
  )
  onlyReceiptReads(env)
})

test("an unknown legacy result stays static without fabricating old XP or a level", async () => {
  const data = receipt({
    replayable: false,
    result_source: "legacy",
    progression: { before: null, after: null, levels: [] },
  })
  const env = await mount({ reducedMotion: false, fetcher: async () => response(data) })
  assert.ok(isFinal(env.phase()))
  assert.equal(readMeter(env)?.value ?? null, null, "unknown XP has no invented numeric progress")
  for (const selector of [".cc-level", ".cc-total"]) {
    const text = env.document.querySelector(selector)?.textContent || ""
    assert.doesNotMatch(text, /\d/, "unknown progression displays no invented numeric value")
  }
  assert.equal(env.tasks().length, 3)
  staticMotionOnly(env)
  onlyReceiptReads(env)
})

test("a historical result with only a known final balance never invents a start", async () => {
  const data = receipt({
    replayable: false,
    result_source: "ledger",
    progression: { before: null, after: progress(450), levels: [] },
  })
  const env = await mount({ reducedMotion: false, fetcher: async () => response(data) })
  assert.ok(isFinal(env.phase()))
  displayedProgress(env, 150, 220)
  assert.match(env.document.querySelector(".cc-level").textContent, /\b3\b/)
  staticMotionOnly(env)
  onlyReceiptReads(env)
})

test("a receipt resolving after unmount cannot animate or steal restored focus", async () => {
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
  assert.equal(Boolean(env.document.querySelector("dialog")), false)
  assert.equal(env.clock.frames, 0)
  assert.equal(env.clock.pending, 0)
  assert.ok(env.document.activeElement === env.trigger, "focus returns to the opener")
  onlyReceiptReads(env)
})
