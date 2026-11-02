import { afterEach, before, test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { build } from "vite"
import { JSDOM } from "jsdom"
let code
const environments = []
before(async () => {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    resolve: { alias: { "@": path.resolve("src") } },
    define: { "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: "tests/archive-entry.tsx", name: "WorkspaceTest", formats: ["iife"] },
    },
  })
  code = output[0].output.find((item) => item.type === "chunk").code
})
afterEach(async () => {
  for (const env of environments.splice(0)) {
    await env.api.act(async () => env.root.unmount())
    env.w.close()
  }
})
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data })
const meta = {
  heroes: [],
  ranks: [],
  account_key: "account-a",
  can_publish: false,
  can_manage_packs: false,
}
const status = (overrides = {}) => ({
  available: true,
  next_reset_at: new Date(Date.now() + 86400000).toISOString(),
  claimed_at: null,
  operation_id: null,
  pack: {
    id: "daily",
    title: "Daily delivery",
    description: "Three collection cards",
    draws: 3,
    ready: true,
  },
  ...overrides,
})
const receipt = {
  id: "receipt-a",
  kind: "DAILY_PACK",
  created_at: new Date().toISOString(),
  pack: { title: "Daily delivery" },
  items: [],
  delta: 0,
  balance_after: 0,
}
const button = (doc, text) =>
  [...doc.querySelectorAll("button")].find((node) => node.textContent.includes(text))
async function mount({ fetcher, mode = "packs", accountKey = "account-a", storage, setup } = {}) {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: "https://qa.invalid",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  })
  const w = dom.window
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.Headers = Headers
  w.AbortController = AbortController
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }
  }
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
    this.dispatchEvent(new w.Event("close"))
  }
  w.localStorage.setItem("dc.ui.language", "en")
  if (storage) storage(w.sessionStorage)
  const calls = []
  w.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    const result = await fetcher?.(url, init)
    if (result) return result
    if (url.includes("/wallet")) return response({ balance: 0, history: [], history_total: 0 })
    if (url.includes("/meta")) return response(meta)
    if (url.includes("/daily-pack")) return response(status())
    if (url.includes("/showcase")) return response({ card_ids: [], revision: 0, is_public: false })
    return response({ items: [], total: 0 })
  }
  setup?.(w)
  w.eval(code)
  const api = w.WorkspaceTest
  const props = { csrf: "csrf-token", mode, accountKey, onCollectionChange() {} }
  let root
  await api.act(async () => {
    root = api.mount(w.document.getElementById("mount"), "archive", props)
  })
  const env = { w, api, root, calls, doc: w.document, props }
  environments.push(env)
  return env
}
test("daily pack uses server entitlement, single-flight claim and a real receipt reveal", async () => {
  let resolveClaim
  const env = await mount({
    fetcher(url, init) {
      if (init.method === "POST")
        return new Promise((resolve) => {
          resolveClaim = resolve
        })
    },
  })
  assert.doesNotMatch(env.doc.body.textContent, /coins|cipher|catalogue|Sandbox/i)
  const claim = button(env.doc, "Claim daily pack")
  assert.ok(claim)
  await env.api.act(async () => {
    claim.click()
    claim.click()
  })
  const posts = env.calls.filter(({ init }) => init.method === "POST")
  assert.equal(posts.length, 1)
  assert.equal(posts[0].url, "/api/archive/daily-pack/claim")
  const body = JSON.parse(posts[0].init.body)
  assert.equal(body.scope, "REAL")
  assert.ok(body.idempotency_key)
  assert.equal(posts[0].init.headers.get("X-CSRF-Token"), "csrf-token")
  await env.api.act(async () => resolveClaim(response(receipt)))
  assert.ok(button(env.doc, "Reveal cards"))
  assert.doesNotMatch(env.doc.body.textContent, /Balance after|Real economy|coins/i)
})
test("daily response loss keeps the exact key and retry recovers the receipt", async () => {
  let attempts = 0
  const env = await mount({
    fetcher(url, init) {
      if (init.method === "POST") {
        attempts++
        if (attempts === 1) throw new Error("Connection lost")
        return response(receipt)
      }
    },
  })
  await env.api.act(async () => button(env.doc, "Claim daily pack").click())
  assert.match(env.doc.body.textContent, /Connection lost/)
  await env.api.act(async () => button(env.doc, "Retry claim").click())
  const posts = env.calls.filter(({ init }) => init.method === "POST")
  assert.equal(
    JSON.parse(posts[0].init.body).idempotency_key,
    JSON.parse(posts[1].init.body).idempotency_key,
  )
  assert.ok(button(env.doc, "Reveal cards"))
})
test("unavailable pool never exposes a claim action and provides a status refresh", async () => {
  const env = await mount({
    fetcher(url) {
      if (url.includes("/daily-pack")) return response(status({ available: false, pack: null }))
    },
  })
  assert.equal(button(env.doc, "Claim daily pack"), undefined)
  assert.match(env.doc.body.textContent, /unavailable/i)
  assert.ok(button(env.doc, "Refresh status"))
})
test("collection retires catalogue, wallet and duplicate recycling actions", async () => {
  const env = await mount({ mode: "wallet" })
  assert.match(env.doc.body.textContent, /My collection/)
  assert.doesNotMatch(
    env.doc.body.textContent,
    /coins|cipher|catalogue|Recycle|battle approval|Sandbox/i,
  )
  assert.equal(
    env.calls.some(({ url }) => /wallet|coverage$|\/cards\?/.test(url)),
    false,
  )
})

test("claimed server status shows a countdown and can replay the saved daily receipt", async () => {
  const env = await mount({
    fetcher(url, init) {
      if (init.method === "POST") return response(receipt)
      if (url.includes("/daily-pack"))
        return response(
          status({
            available: false,
            claimed_at: new Date().toISOString(),
            operation_id: receipt.id,
          }),
        )
    },
  })
  assert.equal(button(env.doc, "Claim daily pack"), undefined)
  assert.ok(env.doc.querySelector('[aria-label="Time to next reset"]'))
  await env.api.act(async () => button(env.doc, "Show today's pack").click())
  assert.ok(button(env.doc, "Reveal cards"))
})

test("a saved uncertain daily claim survives remount and repeats the stored key", async () => {
  const key = "5d59c23d-4576-432f-8a0a-e63e59b3a9c1"
  const env = await mount({
    storage(storage) {
      storage.setItem("dc-daily-pack:account-a", key)
    },
    fetcher(url, init) {
      if (init.method === "POST") return response(receipt)
    },
  })
  await env.api.act(async () => button(env.doc, "Retry claim").click())
  const post = env.calls.find(({ init }) => init.method === "POST")
  assert.equal(JSON.parse(post.init.body).idempotency_key, key)
  assert.equal(env.w.sessionStorage.getItem("dc-daily-pack:account-a"), null)
})

test("switching accounts hides an old in-flight receipt and aborts its request", async () => {
  let resolveClaim
  const env = await mount({
    fetcher(url, init) {
      if (init.method === "POST")
        return new Promise((resolve) => {
          resolveClaim = resolve
        })
    },
  })
  await env.api.act(async () => button(env.doc, "Claim daily pack").click())
  const first = env.calls.find(({ init }) => init.method === "POST")
  await env.api.act(async () => env.root.rerender({ ...env.props, accountKey: "account-b" }))
  assert.equal(first.init.signal.aborted, true)
  await env.api.act(async () => resolveClaim(response(receipt)))
  assert.equal(button(env.doc, "Reveal cards"), undefined)
  assert.ok(button(env.doc, "Claim daily pack"))
  assert.ok(env.w.sessionStorage.getItem("dc-daily-pack:account-a"))
  assert.equal(env.w.sessionStorage.getItem("dc-daily-pack:account-b"), null)
})

test("midnight rollover refetches the server before exposing a new entitlement", async () => {
  let resetCallback
  let dailyRequests = 0
  const env = await mount({
    setup(w) {
      const original = w.setTimeout.bind(w)
      w.setTimeout = (callback, delay, ...args) => {
        if (delay >= 100 && delay <= 1000) {
          resetCallback = callback
          return 991
        }
        return original(callback, delay, ...args)
      }
    },
    fetcher(url) {
      if (url.includes("/daily-pack")) {
        dailyRequests++
        return response(
          dailyRequests === 1
            ? status({
                available: false,
                claimed_at: new Date().toISOString(),
                next_reset_at: new Date(Date.now() + 300).toISOString(),
              })
            : status(),
        )
      }
    },
  })
  assert.equal(button(env.doc, "Claim daily pack"), undefined)
  assert.equal(dailyRequests, 1)
  assert.equal(typeof resetCallback, "function")
  await env.api.act(async () => resetCallback())
  assert.equal(dailyRequests, 2)
  assert.ok(button(env.doc, "Claim daily pack"))
})

function deadlineTimers(w) {
  const pending = new Map()
  let nextId = 90000
  const set = w.setTimeout.bind(w),
    clear = w.clearTimeout.bind(w)
  w.setTimeout = (callback, delay, ...args) => {
    if (delay === 15000) {
      const id = ++nextId
      pending.set(id, callback)
      return id
    }
    return set(callback, delay, ...args)
  }
  w.clearTimeout = (id) => {
    pending.delete(id)
    return clear(id)
  }
  return {
    get size() {
      return pending.size
    },
    expire() {
      assert.equal(pending.size, 1)
      const [id, callback] = pending.entries().next().value
      pending.delete(id)
      callback()
    },
  }
}

test("a hanging daily claim times out, releases its action and retries with the saved key", async () => {
  let timers,
    firstSignal,
    attempts = 0
  const env = await mount({
    setup(w) {
      timers = deadlineTimers(w)
    },
    fetcher(url, init) {
      if (init.method === "POST") {
        attempts++
        if (attempts === 1) {
          firstSignal = init.signal
          return new Promise(() => {})
        }
        return response(receipt)
      }
    },
  })
  await env.api.act(async () => button(env.doc, "Claim daily pack").click())
  assert.equal(button(env.doc, "Claiming").disabled, true)
  await env.api.act(async () => timers.expire())
  assert.equal(firstSignal.aborted, true)
  assert.match(env.doc.querySelector('[role="alert"]').textContent, /timed out/i)
  assert.equal(button(env.doc, "Retry claim").disabled, false)
  await env.api.act(async () => button(env.doc, "Retry claim").click())
  const posts = env.calls.filter(({ init }) => init.method === "POST")
  assert.equal(
    JSON.parse(posts[0].init.body).idempotency_key,
    JSON.parse(posts[1].init.body).idempotency_key,
  )
  assert.ok(button(env.doc, "Reveal cards"))
  assert.equal(timers.size, 0)
})

test("a hanging status request times out and can be explicitly refreshed", async () => {
  let timers,
    statusSignal,
    reads = 0
  const env = await mount({
    setup(w) {
      timers = deadlineTimers(w)
    },
    fetcher(url, init) {
      if (url.includes("/daily-pack")) {
        reads++
        if (reads === 1) {
          statusSignal = init.signal
          return new Promise(() => {})
        }
        return response(status())
      }
    },
  })
  assert.equal(button(env.doc, "Refresh status").disabled, true)
  await env.api.act(async () => timers.expire())
  assert.equal(statusSignal.aborted, true)
  assert.match(env.doc.querySelector('[role="alert"]').textContent, /timed out/i)
  assert.equal(button(env.doc, "Refresh status").disabled, false)
  await env.api.act(async () => button(env.doc, "Refresh status").click())
  assert.ok(button(env.doc, "Claim daily pack"))
  assert.equal(timers.size, 0)
})

test("a confirmed pack remains revealable while the follow-up status request times out", async () => {
  let timers,
    reads = 0
  const env = await mount({
    setup(w) {
      timers = deadlineTimers(w)
    },
    fetcher(url, init) {
      if (init.method === "POST") return response(receipt)
      if (url.includes("/daily-pack")) {
        reads++
        return reads === 1 ? response(status()) : new Promise(() => {})
      }
    },
  })
  await env.api.act(async () => button(env.doc, "Claim daily pack").click())
  assert.ok(button(env.doc, "Reveal cards"))
  await env.api.act(async () => timers.expire())
  assert.ok(button(env.doc, "Reveal cards"))
  assert.equal(button(env.doc, "Refresh status").disabled, false)
  assert.match(env.doc.querySelector('[role="alert"]').textContent, /timed out/i)
  assert.equal(env.w.sessionStorage.getItem("dc-daily-pack:account-a"), null)
})

test("daily deadlines are cleared when an account changes or the page unmounts", async () => {
  let timers
  const signals = []
  const env = await mount({
    setup(w) {
      timers = deadlineTimers(w)
    },
    fetcher(url, init) {
      if (url.includes("/daily-pack")) {
        signals.push(init.signal)
        return new Promise(() => {})
      }
    },
  })
  assert.equal(timers.size, 1)
  await env.api.act(async () => env.root.rerender({ ...env.props, accountKey: "account-b" }))
  assert.equal(signals[0].aborted, true)
  assert.equal(timers.size, 1)
  await env.api.act(async () => env.root.unmount())
  assert.equal(signals[1].aborted, true)
  assert.equal(timers.size, 0)
})
