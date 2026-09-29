import { after, before, test } from "node:test"
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
      lib: { entry: "tests/nightshift-entry.tsx", name: "NightshiftTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => environments.forEach((dom) => dom.window.close()))
function runtime({ theme, noStorage = false } = {}) {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: "https://qa.invalid/ru/",
    runScripts: "outside-only",
  })
  environments.push(dom)
  const w = dom.window
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.Headers = Headers
  w.AbortController = AbortController
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }
  }
  w.fetch = async () => ({
    ok: true,
    json: async () => ({ items: [], server_time: new Date().toISOString() }),
  })
  w.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  }
  let dark = true
  const listeners = new Set()
  w.matchMedia = (query) => ({
    get matches() {
      return query.includes("prefers-color-scheme") ? dark : false
    },
    media: query,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  })
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
  }
  if (theme) w.localStorage.setItem("dc.ui.appearance", JSON.stringify(theme))
  if (noStorage)
    Object.defineProperty(w, "localStorage", {
      get() {
        throw new Error("Storage blocked")
      },
    })
  w.eval(code)
  return {
    w,
    doc: w.document,
    api: w.NightshiftTest,
    osDark(value) {
      dark = value
      listeners.forEach((fn) => fn({ matches: dark }))
    },
  }
}
async function mounted(options) {
  const r = runtime(options)
  await r.api.act(async () => {
    r.root = r.api.mount(r.doc.getElementById("mount"))
  })
  return r
}
async function click(r, selector) {
  const el = r.doc.querySelector(selector)
  assert.ok(el, `Missing control ${selector}`)
  await r.api.act(async () => el.click())
  return el
}

test("guest can open all five themes and keep choice across remounts", async () => {
  const r = await mounted()
  await click(r, ".ns-theme-trigger")
  assert.equal(r.doc.querySelectorAll("[data-theme-choice]").length, 5)
  for (const theme of ["light", "dark", "black", "custom"]) {
    await click(r, `[data-theme-choice=${theme}]`)
    assert.equal(r.doc.documentElement.dataset.theme, theme)
  }
  await r.api.act(async () => r.root.unmount())
  await r.api.act(async () => {
    r.root = r.api.mount(r.doc.getElementById("mount"))
  })
  assert.equal(r.doc.documentElement.dataset.theme, "custom")
})
test("system theme follows OS changes while a manual theme stays fixed", async () => {
  const r = await mounted()
  await click(r, ".ns-theme-trigger")
  await click(r, "[data-theme-choice=system]")
  await r.api.act(async () => r.osDark(false))
  assert.equal(r.doc.documentElement.dataset.theme, "light")
  await r.api.act(async () => r.osDark(true))
  assert.equal(r.doc.documentElement.dataset.theme, "dark")
  await click(r, "[data-theme-choice=black]")
  await r.api.act(async () => r.osDark(false))
  assert.equal(r.doc.documentElement.dataset.theme, "black")
})
test("public language links persist explicit locale for the Steam session", async () => {
  const r = await mounted()
  const en = r.doc.querySelector(".bureau-account [hreflang=en]")
  assert.ok(en)
  en.addEventListener("click", (event) => event.preventDefault())
  await r.api.act(async () => en.click())
  assert.equal(r.w.localStorage.getItem("dc.ui.language"), "en")
  assert.equal(new URL(en.href).pathname, "/en/")
})
test("blocked or malformed storage still allows appearance changes", async () => {
  const r = await mounted({ noStorage: true })
  await click(r, ".ns-theme-trigger")
  await click(r, "[data-theme-choice=light]")
  assert.equal(r.doc.documentElement.dataset.theme, "light")
})
test("saved radius is bounded and manual motion preference is applied", async () => {
  const r = await mounted({
    theme: { theme: "custom", accent: "invalid", radius: 999, motion: false },
  })
  assert.equal(r.doc.documentElement.style.getPropertyValue("--ns-radius"), "28px")
  assert.equal(r.doc.documentElement.dataset.motion, "reduced")
})
test("mascot has three natural poses with a working manual pose control", async () => {
  const r = await mounted()
  const figure = r.doc.querySelector(".ns-mascot")
  assert.ok(figure)
  assert.equal(figure.querySelectorAll("img[data-pose]").length, 3)
  const before = figure.getAttribute("data-pose")
  await click(r, ".ns-mascot-button")
  assert.notEqual(figure.getAttribute("data-pose"), before)
})
