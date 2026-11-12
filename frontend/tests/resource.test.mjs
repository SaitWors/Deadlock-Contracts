import { before, test } from "node:test"
import assert from "node:assert/strict"
import { build } from "vite"
import { JSDOM } from "jsdom"

let code
before(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    define: { "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: "tests/resource-entry.tsx", name: "ResourceTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})

function runtime(language) {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: "https://qa.invalid",
    runScripts: "outside-only",
  })
  const w = dom.window
  const realTimeout = w.setTimeout.bind(w)
  const timers = new Map()
  let id = 10000
  w.setTimeout = (callback, delay, ...args) => {
    if (delay !== 12000) return realTimeout(callback, delay, ...args)
    timers.set(++id, callback)
    return id
  }
  const clear = w.clearTimeout.bind(w)
  w.clearTimeout = (key) => {
    timers.delete(key)
    clear(key)
  }
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => realTimeout(() => this.port1.onmessage?.(), 0) }
  }
  w.Headers = Headers
  w.AbortController = AbortController
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.localStorage.setItem("dc.ui.language", language)
  const requests = []
  // Intentionally ignore abort: some proxies/mocks settle late or never settle.
  w.fetch = (url, options) => new Promise((resolve) => requests.push({ url, options, resolve }))
  w.eval(code)
  return { dom, w, timers, requests, api: w.ResourceTest, doc: w.document }
}
const response = (value) => ({ ok: true, json: async () => ({ value }) })

for (const language of ["ru", "en"]) {
  test(`a hanging GET becomes a retryable error without accepting a late result (${language})`, async () => {
    const { dom, timers, requests, api, doc } = runtime(language)
    let root
    try {
      await api.act(async () => {
        root = api.mount(doc.getElementById("mount"), "/first")
      })
      assert.equal(doc.querySelector("output").textContent, "Loading")
      await api.act(async () => {
        ;[...timers.values()][0]()
      })
      assert.equal(requests[0].options.signal.aborted, true)
      assert.match(
        doc.querySelector("output").textContent,
        language === "ru" ? /Превышено/ : /timed out/,
      )
      await api.act(async () => doc.querySelector("button").click())
      assert.equal(doc.querySelector("output").textContent, "Loading")
      await api.act(async () => requests[1].resolve(response("Current result")))
      await api.act(async () => requests[0].resolve(response("Stale result")))
      assert.equal(doc.querySelector("output").textContent, "Current result")
      assert.equal(timers.size, 0)
    } finally {
      if (root) await api.act(async () => root.unmount())
      dom.window.close()
    }
  })
}

test("changing resources and unmounting abort obsolete requests and clear deadlines", async () => {
  const { dom, timers, requests, api, doc } = runtime("en")
  let root
  try {
    await api.act(async () => {
      root = api.mount(doc.getElementById("mount"), "/old")
    })
    await api.act(async () => root.render("/new"))
    assert.equal(requests[0].options.signal.aborted, true)
    assert.equal(timers.size, 1)
    await api.act(async () => requests[0].resolve(response("Old")))
    assert.equal(doc.querySelector("output").textContent, "Loading")
    await api.act(async () => root.unmount())
    root = null
    assert.equal(requests[1].options.signal.aborted, true)
    assert.equal(timers.size, 0)
    await api.act(async () => requests[1].resolve(response("After unmount")))
    assert.equal(doc.getElementById("mount").textContent, "")
  } finally {
    if (root) await api.act(async () => root.unmount())
    dom.window.close()
  }
})
