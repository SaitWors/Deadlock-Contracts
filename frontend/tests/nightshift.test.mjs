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
function runtime({
  theme,
  noStorage = false,
  systemReduced = false,
  coarse = false,
  cores = 8,
} = {}) {
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
  const motionQuery = "(prefers-reduced-motion: reduce)"
  const darkQuery = "(prefers-color-scheme: dark)"
  const coarseQuery = "(pointer: coarse)"
  const matches = new Map([
    [darkQuery, true],
    [motionQuery, systemReduced],
    [coarseQuery, coarse],
  ])
  const listeners = new Map()
  Object.defineProperty(w.navigator, "hardwareConcurrency", { value: cores })
  w.matchMedia = (query) => ({
    get matches() {
      return matches.get(query) ?? false
    },
    media: query,
    addEventListener(_, listener) {
      if (!listeners.has(query)) listeners.set(query, new Set())
      listeners.get(query).add(listener)
    },
    removeEventListener: (_, listener) => listeners.get(query)?.delete(listener),
  })
  const changeMedia = (query, value) => {
    matches.set(query, value)
    listeners.get(query)?.forEach((listener) => listener({ matches: value }))
  }
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
    osDark: (value) => changeMedia(darkQuery, value),
    osReduced: (value) => changeMedia(motionQuery, value),
    coarsePointer: (value) => changeMedia(coarseQuery, value),
  }
}
async function mounted(options, view = "mount") {
  const r = runtime(options)
  await r.api.act(async () => {
    r.root = r.api[view](r.doc.getElementById("mount"))
  })
  return r
}
async function click(r, selector) {
  const el = r.doc.querySelector(selector)
  assert.ok(el, `Missing control ${selector}`)
  await r.api.act(async () => el.click())
  return el
}

async function selectPreference(r, select, value) {
  await r.api.act(async () => {
    select.value = value
    select.dispatchEvent(new r.w.Event("change", { bubbles: true }))
  })
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
  assert.equal(r.doc.documentElement.style.getPropertyValue("--ns-radius"), "8px")
  assert.equal(r.doc.documentElement.dataset.motion, "reduced")
})

test("motion settings migrate defaults, override system motion, and keep quality independent", async () => {
  const r = await mounted(
    { theme: { motion: true }, systemReduced: true, coarse: true },
    "mountPreferences",
  )
  await click(r, ".ns-theme-trigger")
  const [motion, quality] = r.doc.querySelectorAll(".ns-appearance select")
  const probe = r.doc.querySelector("[data-effective-motion]")
  const root = r.doc.documentElement
  assert.equal(motion.value, "SYSTEM")
  assert.equal(quality.value, "AUTO")
  assert.equal(probe.dataset.effectiveMotion, "reduced")
  assert.equal(root.dataset.motion, "reduced")
  assert.equal(probe.dataset.quality, "LITE")
  const note = r.doc.getElementById(motion.getAttribute("aria-describedby"))
  assert.match(note.textContent, /bright flashes and intense movement/)

  await selectPreference(r, motion, "FULL")
  assert.equal(r.w.matchMedia("(prefers-reduced-motion: reduce)").matches, true)
  assert.equal(probe.dataset.effectiveMotion, "full")
  assert.equal(root.dataset.motion, "full")
  assert.equal(probe.dataset.quality, "LITE")

  await selectPreference(r, quality, "FULL")
  assert.equal(probe.dataset.quality, "FULL")
  await selectPreference(r, motion, "OFF")
  await r.api.act(async () => r.osReduced(false))
  assert.equal(root.dataset.motion, "reduced")
  assert.equal(probe.dataset.effectiveMotion, "reduced")
  assert.equal(probe.dataset.quality, "FULL")
  assert.deepEqual(JSON.parse(r.w.localStorage.getItem("dc.ui.appearance")), {
    theme: "dark",
    accent: "#aec69b",
    radius: 4,
    motion: "OFF",
    effectsQuality: "FULL",
    packSound: false,
  })

  await selectPreference(r, motion, "SYSTEM")
  assert.equal(probe.dataset.effectiveMotion, "full")
  await r.api.act(async () => r.osReduced(true))
  assert.equal(probe.dataset.effectiveMotion, "reduced")
  assert.equal(root.dataset.motion, "reduced")
  await selectPreference(r, quality, "LITE")
  await r.api.act(async () => r.coarsePointer(false))
  assert.equal(probe.dataset.quality, "LITE")
  await selectPreference(r, quality, "AUTO")
  assert.equal(probe.dataset.quality, "FULL")
  await r.api.act(async () => r.root.unmount())
})

test("saved manual motion and effects quality are restored across pages", async () => {
  const r = await mounted(
    { theme: { motion: "FULL", effectsQuality: "LITE" }, systemReduced: true },
    "mountPreferences",
  )
  assert.equal(r.doc.documentElement.dataset.motion, "full")
  assert.equal(r.doc.querySelector("[data-effective-motion]").dataset.quality, "LITE")
  await r.api.act(async () => r.root.unmount())
})

test("mascot has three natural poses with a working manual pose control", async () => {
  const r = runtime()
  await r.api.act(async () => {
    r.root = r.api.mountMascot(r.doc.getElementById("mount"))
  })
  const figure = r.doc.querySelector(".ns-mascot")
  assert.ok(figure)
  assert.equal(figure.querySelectorAll("img[data-pose]").length, 3)
  const before = figure.getAttribute("data-pose")
  await click(r, ".ns-mascot-button")
  assert.notEqual(figure.getAttribute("data-pose"), before)
})
