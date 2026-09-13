import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { build } from "vite"
import { JSDOM } from "jsdom"

let code
let authenticatedCss
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

  const authenticated = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    resolve: { alias: { "@": path.resolve("src") } },
    define: { "process.env.NODE_ENV": '"production"' },
    build: {
      write: false,
      minify: true,
      lib: { entry: "tests/bureau-entry.tsx", name: "AuthenticatedHome", formats: ["iife"] },
    },
  })
  authenticatedCss = authenticated[0].output
    .filter((item) => item.type === "asset" && item.fileName.endsWith(".css"))
    .map((item) => String(item.source))
    .join("\n")
})

after(() => environments.forEach((dom) => dom.window.close()))

function response(data) {
  return { ok: true, json: async () => data }
}

function runtime({ hash = "", language = "ru", fetchImpl } = {}) {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: `https://qa.invalid/${hash}`,
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
  const env = runtime({ hash: "#try", ...options })
  let root
  await env.api.act(async () => {
    root = env.api.mountLanding(env.doc.getElementById("mount"))
  })
  return { ...env, root }
}

async function choose(api, doc, names) {
  for (const name of names)
    await api.act(async () => button(doc.querySelector(".guest-symbol-picker"), name).click())
}

test("authenticated home production bundle owns its archive stats styles", () => {
  assert.ok(
    authenticatedCss.includes(".bureau-callout-stats"),
    "authenticated Dashboard CSS omitted ArchiveNextStep stats",
  )
})

test("the real Landing #try route opens a guest cipher instead of falling back home", async () => {
  const { api, doc } = runtime({ hash: "#try" })
  let root
  await api.act(async () => {
    root = api.mountLanding(doc.getElementById("mount"))
  })
  assert.match(doc.querySelector("main").textContent, /Учебный шифр/)
  await api.act(async () => root.unmount())
})

test("guest selection blocks duplicates, a fifth symbol and incomplete submission", async () => {
  const { api, doc, root } = await mountGuest()
  const submit = button(doc, "Проверить")
  assert.equal(submit.disabled, true)
  await choose(api, doc, ["Компас", "Часы", "Руки", "Документы"])
  assert.equal(doc.querySelectorAll(".guest-choice li").length, 4)
  assert.equal(button(doc.querySelector(".guest-symbol-picker"), "Компас").disabled, true)
  assert.equal(button(doc.querySelector(".guest-symbol-picker"), "Хамелеон").disabled, true)
  assert.equal(submit.disabled, false)
  await api.act(async () => root.unmount())
})

test("guest guess reports exact and misplaced symbols with visible history", async () => {
  const { api, doc, root } = await mountGuest()
  await choose(api, doc, ["Компас", "Руки", "Часы", "Документы"])
  await api.act(async () => button(doc, "Проверить").click())
  assert.match(doc.querySelector('[aria-live="polite"]').textContent, /2 на месте · 2 не на месте/)
  assert.match(doc.querySelector(".guest-history").textContent, /Попытка 1/)
  assert.equal(doc.querySelectorAll(".guest-history li").length, 1)
  await api.act(async () => root.unmount())
})

test("guest can solve the teaching code and receives only a Steam continuation", async () => {
  const { api, doc, root, calls } = await mountGuest()
  await choose(api, doc, ["Компас", "Часы", "Руки", "Документы"])
  await api.act(async () => button(doc, "Проверить").click())
  assert.match(doc.querySelector('[aria-live="polite"]').textContent, /Шифр раскрыт/)
  assert.match(doc.querySelector(".guest-solution").textContent, /Компас.*Часы.*Руки.*Документы/)
  assert.equal(
    doc.querySelector('.guest-solution a[href="/auth/steam"]').textContent.includes("Steam"),
    true,
  )
  assert.match(doc.querySelector(".guest-solution").textContent, /жетоны не начислены/i)
  assert.equal(calls.length, 0)
  await api.act(async () => root.unmount())
})

test("six failed guesses unlock guidance, reveal the answer and reset cleanly", async () => {
  const { api, doc, root } = await mountGuest()
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await choose(api, doc, ["Хамелеон", "Документы", "Сыщики", "Руки"])
    await api.act(async () => button(doc, "Проверить").click())
  }
  assert.match(doc.querySelector('[aria-live="polite"]').textContent, /Шесть попыток закончились/)
  await api.act(async () => button(doc, "Показать разбор").click())
  assert.match(doc.querySelector(".guest-solution").textContent, /Компас.*Часы.*Руки.*Документы/)
  await api.act(async () => button(doc, "Начать заново").click())
  assert.equal(doc.querySelectorAll(".guest-history li").length, 0)
  assert.equal(button(doc, "Проверить").disabled, true)
  await api.act(async () => root.unmount())
})

test("guest can request an early guided explanation in English", async () => {
  const { api, doc, root } = await mountGuest({ language: "en" })
  await api.act(async () => button(doc, "Show explanation").click())
  assert.match(
    doc.querySelector(".guest-solution").textContent,
    /Compass.*Hourglass.*Hands.*Documents/,
  )
  assert.match(doc.querySelector(".guest-solution").textContent, /no tokens were awarded/i)
  await api.act(async () => root.unmount())
})

test("the prominent home trial reaches #try and guest return restores existing home route", async () => {
  const { api, doc, w } = runtime({ hash: "#home", language: "en" })
  let root
  await api.act(async () => {
    root = api.mountLanding(doc.getElementById("mount"))
  })
  assert.match(doc.getElementById("mount").textContent, /never asks for your Steam password/)
  await api.act(async () => button(doc, "Try without signing in").click())
  assert.equal(w.location.hash, "#try")
  assert.match(doc.querySelector("main").textContent, /Teaching cipher/)
  await api.act(async () => button(doc, "Return home").click())
  assert.equal(w.location.hash, "#home")
  assert.match(doc.querySelector("h1").textContent, /Every match has a story/)
  await api.act(async () => root.unmount())
})

test("dashboard continues the open server round instead of offering a new cipher", async () => {
  const { api, doc } = runtime({ hash: "#home" })
  let root
  await api.act(async () => {
    root = api.mountDashboard(doc.getElementById("mount"), session)
  })
  assert.match(doc.querySelector(".dc-home-archive-callout").textContent, /Продолжить шифр/)
  await api.act(async () => root.unmount())
})

const wallet = {
  balance: 73,
  currency: "ARCHIVE_TOKEN",
  weekly_limit: 5,
  reward: 41,
  completed: 2,
  reset_at: "2026-09-14T00:00:00Z",
  round: null,
  history: [],
  history_total: 0,
}

test("next step loading state withholds economic claims and keeps collection and bureaus available", async () => {
  let resolveWallet
  const destinations = []
  const { api, doc } = runtime({
    fetchImpl: () =>
      new Promise((resolve) => {
        resolveWallet = resolve
      }),
  })
  let root
  await api.act(async () => {
    root = api.mountNextStep(doc.getElementById("mount"), {
      revision: 9,
      onNavigate: (destination) => destinations.push(destination),
    })
  })
  assert.match(doc.querySelector('[role="status"]').textContent, /Загружаем/)
  assert.equal(button(doc, "Разобрать шифр"), undefined)
  assert.equal(doc.querySelector(".bureau-callout-stats"), null)
  await api.act(async () => button(doc, "Моя коллекция").click())
  await api.act(async () => button(doc, "Бюро игроков").click())
  assert.deepEqual(destinations, ["collection", "bureaus"])
  await api.act(async () => resolveWallet(response(wallet)))
  await api.act(async () => root.unmount())
})

test("next step reports wallet error, retries the same view and then uses server reward fields", async () => {
  let attempts = 0
  const { api, doc, calls } = runtime({
    language: "en",
    fetchImpl: async () => {
      attempts += 1
      if (attempts === 1) return { ok: false, json: async () => ({ detail: "wallet unavailable" }) }
      return response(wallet)
    },
  })
  const destinations = []
  let root
  await api.act(async () => {
    root = api.mountNextStep(doc.getElementById("mount"), {
      revision: 4,
      onNavigate: (destination) => destinations.push(destination),
    })
  })
  assert.match(doc.querySelector('[role="alert"]').textContent, /Could not load archive status/)
  assert.ok(button(doc, "My collection"))
  assert.ok(button(doc, "Player bureaus"))
  await api.act(async () => button(doc, "Retry").click())
  assert.equal(calls.length, 2)
  assert.ok(calls.every(({ url }) => url === "/api/archive/wallet?view=4"))
  assert.match(doc.querySelector(".bureau-callout-stats").textContent, /73 tokens/)
  assert.match(doc.querySelector(".bureau-callout-stats").textContent, /Reward per cipher/)
  assert.match(doc.querySelector(".bureau-callout-stats").textContent, /\+41 tokens/)
  assert.match(doc.querySelector(".bureau-callout-stats").textContent, /2 \/ 5/)
  await api.act(async () => button(doc, "Decode a cipher").click())
  await api.act(async () => button(doc, "My collection").click())
  await api.act(async () => button(doc, "Player bureaus").click())
  assert.deepEqual(destinations, ["archive", "collection", "bureaus"])
  await api.act(async () => root.unmount())
})

test("next step continues an open round and uses the archive callback", async () => {
  const destinations = []
  const openWallet = {
    ...wallet,
    round: {
      id: "round-3",
      slot: 3,
      status: "OPEN",
      revision: 8,
      guesses: [{ symbols: [0, 1, 2, 3], exact: 1, misplaced: 2 }],
      solution: null,
    },
  }
  const { api, doc } = runtime({ fetchImpl: async () => response(openWallet) })
  let root
  await api.act(async () => {
    root = api.mountNextStep(doc.getElementById("mount"), {
      revision: 2,
      onNavigate: (destination) => destinations.push(destination),
    })
  })
  await api.act(async () => button(doc, "Продолжить шифр").click())
  assert.deepEqual(destinations, ["archive"])
  await api.act(async () => root.unmount())
})

test("next step sends an exhausted player to collection and shows localized reset time", async () => {
  const destinations = []
  const { api, doc } = runtime({
    fetchImpl: async () => response({ ...wallet, completed: 5 }),
  })
  let root
  await api.act(async () => {
    root = api.mountNextStep(doc.getElementById("mount"), {
      revision: 1,
      onNavigate: (destination) => destinations.push(destination),
    })
  })
  assert.match(doc.querySelector(".dc-home-archive-callout").textContent, /14\.09\.2026/)
  assert.match(doc.querySelector(".bureau-callout-stats").textContent, /Награда за шифр/)
  await api.act(async () => button(doc, "Открыть коллекцию").click())
  assert.deepEqual(destinations, ["collection"])
  await api.act(async () => root.unmount())
})
