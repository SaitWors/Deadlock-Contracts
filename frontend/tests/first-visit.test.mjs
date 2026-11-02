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
      lib: { entry: "tests/first-visit-entry.tsx", name: "FirstVisit", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})

after(() => environments.forEach((dom) => dom.window.close()))

function response(data) {
  return { ok: true, json: async () => data }
}

function runtime({ hash = "", pathname = "/", language = "ru", fetchImpl } = {}) {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: `https://qa.invalid${pathname}${hash}`,
    runScripts: "outside-only",
  })
  environments.push(dom)
  const w = dom.window
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }
  }
  w.Headers = Headers
  w.AbortController = AbortController
  w.AbortSignal = AbortSignal
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.scrollTo = () => {}
  w.HTMLElement.prototype.scrollTo = () => {}
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  w.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  }
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
  }
  w.localStorage.setItem("dc.ui.language", language)
  w.localStorage.setItem("dc.bureau.guide.v1.returning-player", "seen")
  const calls = []
  w.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    if (fetchImpl) return fetchImpl(url, init)
    if (String(url).startsWith("/api/announcements/active"))
      return response({ items: [], server_time: "2026-09-12T10:00:00Z" })
    if (String(url).startsWith("/api/boards/today"))
      return response({
        server_time: "2026-09-12T10:00:00Z",
        date: "2026-09-12",
        refresh: { remaining: 1, reset_at: "2026-09-13T00:00:00Z" },
        boards: [],
      })
    if (String(url).startsWith("/api/history")) return response({ cases: [], total: 0 })
    if (String(url).startsWith("/api/progression"))
      return response({
        level: 1,
        total_xp: 0,
        xp_to_next: 100,
        contracts_completed: 0,
        progress_pct: 0,
      })
    if (String(url).startsWith("/api/reviews/mine")) return response({ items: [] })
    if (String(url).startsWith("/api/companion/status"))
      return response({ device: null, devices: [] })
    if (String(url).startsWith("/api/archive/wallet"))
      return response({
        balance: 73,
        currency: "ARCHIVE_TOKEN",
        weekly_limit: 5,
        reward: 30,
        completed: 2,
        reset_at: "2026-09-14T00:00:00Z",
        round: {
          id: "open-round",
          slot: 3,
          status: "OPEN",
          revision: 7,
          guesses: [],
          solution: null,
        },
        history: [],
        history_total: 0,
      })
    if (String(url).startsWith("/api/bureaus")) return response({ my_bureau: null, items: [] })
    throw new Error(`Unexpected request ${url}`)
  }
  w.eval(code)
  return { w, api: w.FirstVisit, doc: w.document, calls }
}

const session = {
  authenticated: true,
  csrf_token: "csrf",
  release: { version: "test" },
  user: {
    id: "returning-player",
    display_name: "Player",
    avatar_url: null,
    xp: 0,
    status: "ACTIVE",
    locale: "ru",
    timezone: "UTC",
    access_role: "PLAYER",
    badges: [],
    is_admin: false,
    is_staff: false,
    permissions: [],
    can_manage_roles: false,
    created_at: null,
  },
}

const button = (doc, text) =>
  [...doc.querySelectorAll("button")].find((item) => item.textContent.includes(text))

async function mountGuest(options = {}) {
  const env = runtime({ pathname: options?.language === "en" ? "/en/try" : "/ru/try", ...options })
  let root
  await env.api.act(async () => {
    root = env.api.mountLanding(env.doc.getElementById("mount"))
  })
  return { ...env, root }
}

test("the public trial document is a contract preview with no retired cipher", async () => {
  const { api, doc, root, calls } = await mountGuest()
  assert.equal(doc.querySelectorAll("[data-contract-choice]").length, 6)
  assert.equal(doc.querySelector(".guest-symbol-picker"), null)
  assert.match(doc.querySelector("main").textContent, /пример|Демонстрационная/)
  assert.equal(
    calls.some(([url]) => /cipher|wallet|coins/.test(String(url))),
    false,
  )
  await api.act(async () => root.unmount())
})

test("changing public match mode clears the trial selection", async () => {
  const { api, doc, root } = await mountGuest()
  const first = doc.querySelector("[data-contract-choice]")
  await api.act(async () => first.click())
  assert.equal(first.getAttribute("aria-pressed"), "true")
  await api.act(async () => button(doc.querySelector(".ritual-modes"), "Рейтинговый").click())
  assert.equal(doc.querySelectorAll('[data-contract-choice][aria-pressed="true"]').length, 0)
  assert.equal(button(doc, "Примерить подпись").disabled, true)
  await api.act(async () => root.unmount())
})

test("the prominent home action leads to contract selection without a cipher", async () => {
  const { api, doc } = runtime({ pathname: "/en/", language: "en" })
  let root
  await api.act(async () => {
    root = api.mountLanding(doc.getElementById("mount"))
  })
  assert.match(
    doc.querySelector('.ritual-hero-actions a[href="/en/contracts"]').textContent,
    /Choose a contract/,
  )
  assert.equal(doc.querySelector('.ritual-hero-actions a[href="/en/try"]'), null)
  assert.ok(doc.querySelector('a[href="/auth/steam"]'))
  await api.act(async () => root.unmount())
})

test("dashboard directs players to the free daily pack without requesting coin state", async () => {
  const { api, doc, calls } = runtime({ hash: "#home" })
  let root
  await api.act(async () => {
    root = api.mountDashboard(doc.getElementById("mount"), session)
  })
  assert.match(doc.querySelector(".ritual-next-step").textContent, /новый конверт/)
  assert.doesNotMatch(doc.body.textContent, /Продолжить шифр|монеты|Шифры и каталог/i)
  assert.equal(
    calls.some(({ url }) => url.includes("archive/wallet")),
    false,
  )
  await api.act(async () => root.unmount())
})

for (const language of ["ru", "en"])
  test(`${language}: home collection callout opens the daily pack and makes no economic claim`, async () => {
    const destinations = []
    const { api, doc, calls } = runtime({ language })
    let root
    await api.act(async () => {
      root = api.mountNextStep(doc.getElementById("mount"), {
        revision: 4,
        onNavigate: (destination) => destinations.push(destination),
      })
    })
    assert.equal(calls.length, 0)
    assert.doesNotMatch(doc.body.textContent, /coins|cipher|монет|шифр/i)
    await api.act(async () =>
      button(doc, language === "ru" ? "Открыть конверт" : "Open daily pack").click(),
    )
    assert.deepEqual(destinations, ["packs"])
    await api.act(async () => root.unmount())
  })
