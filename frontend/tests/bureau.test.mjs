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
      lib: { entry: "tests/bureau-entry.tsx", name: "BureauUX", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => environments.forEach((dom) => dom.window.close()))
const future = () => new Date(Date.now() + 86_400_000).toISOString()
const session = (id = "account-one") => ({
  authenticated: true,
  csrf_token: "csrf",
  release: { version: "test" },
  user: {
    id,
    display_name: "Новый игрок",
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
})
const boards = () => ({
  server_time: new Date().toISOString(),
  date: "2026-09-08",
  refresh: { remaining: 1, reset_at: future() },
  boards: ["STANDARD", "RANKED", "STREET_BRAWL"].map((mode) => ({
    id: `board-${mode}`,
    game_match_mode: mode,
    status: "OFFERED",
    generation: 1,
    expires_at: future(),
    locked_at: null,
    attempts_used: 0,
    max_attempts: 3,
    options: [0, 1].map((i) => ({
      id: `${mode}-${i}`,
      title: `${mode} условие ${i}`,
      title_i18n: { ru: `${mode} условие ${i}` },
      description: "Условие контракта",
      reward_xp: 30,
      selected: false,
      status: "OFFERED",
      target: 1,
      metric: "kills",
      operator: "gte",
      category: i ? "SUPPORT" : "COMBAT",
      difficulty: "LIGHT",
      rarity: "COMMON",
      drop_chance_pct: 25,
    })),
  })),
})
function runtime({ hash = "", language = "ru", announcements = [] } = {}) {
  const dom = new JSDOM('<button id="trigger">Help</button><main id="mount"></main>', {
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
  w.localStorage.setItem("dc.ui.language", language)
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
  }
  const calls = []
  w.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    const body = url.startsWith("/api/announcements/active")
      ? { items: announcements, server_time: new Date().toISOString() }
      : url.startsWith("/api/boards/today")
        ? boards()
        : url.startsWith("/api/history")
          ? { cases: [], total: 0 }
          : url.startsWith("/api/progression")
            ? { level: 1, total_xp: 0, xp_to_next: 100, contracts_completed: 0, progress_pct: 0 }
            : url.startsWith("/api/reviews/mine")
              ? { items: [] }
              : url.startsWith("/api/companion/status")
                ? { device: null, devices: [] }
                : url.startsWith("/api/archive/wallet")
                  ? { balance: 0 }
                  : url.startsWith("/api/bureaus")
                    ? { my_bureau: null, items: [] }
                    : url.startsWith("/api/preferences")
                      ? { user: session().user }
                      : null
    if (body === null) throw new Error(`Unexpected request ${url}`)
    return { ok: true, json: async () => body }
  }
  w.eval(code)
  return { w, doc: w.document, api: w.BureauUX, calls }
}
const button = (doc, text) =>
  [...doc.querySelectorAll("button")].find((item) => item.textContent.includes(text))

test("first visit explains the bureau, can skip, remembers this account and reopens on request", async () => {
  const { api, doc } = runtime()
  let root
  await api.act(async () => {
    root = api.mountDashboard(doc.getElementById("mount"), session())
  })
  assert.ok(doc.querySelector(".bureau-guide[open]"))
  assert.match(doc.activeElement.textContent, /Ваш матч/)
  assert.equal(
    doc.querySelector(".dc-mobile-bottom-nav [aria-current=page]").textContent,
    "Главная",
  )
  assert.equal(doc.querySelectorAll(".dc-mobile-bottom-nav button").length, 5)
  assert.equal(doc.querySelector(".dc-home-archive-callout .dc-auth-account-button"), null)
  await api.act(async () => button(doc, "Осмотрюсь сам").click())
  assert.equal(doc.querySelector(".bureau-guide"), null)
  assert.equal(api.hasSeenGuide("account-one"), true)
  assert.equal(api.hasSeenGuide("account-two"), false)
  await api.act(async () => root.unmount())
  await api.act(async () => {
    root = api.mountDashboard(doc.getElementById("mount"), session())
  })
  assert.equal(doc.querySelector(".bureau-guide"), null)
  await api.act(async () => button(doc, "Как это работает?").click())
  assert.ok(doc.querySelector(".bureau-guide[open]"))
  await api.act(async () => root.unmount())
})

for (const language of ["ru", "en"])
  test(`${language} guide has three manual pages, actual destinations, Escape and focus restoration`, async () => {
    const { api, doc, w } = runtime({ language })
    const actions = []
    let root
    const props = { onClose: () => actions.push("close"), onNavigate: (tab) => actions.push(tab) }
    doc.getElementById("trigger").focus()
    await api.act(async () => {
      root = api.mountGuide(doc.getElementById("mount"), props)
    })
    assert.equal(doc.querySelectorAll(".bureau-guide-pages button").length, 3)
    await api.act(async () => doc.querySelector(".bureau-guide-content>.bureau-action").click())
    assert.equal(actions.pop(), "quests")
    await api.act(async () => button(doc, language === "ru" ? "Дальше" : "Next").click())
    assert.match(
      doc.querySelector(".bureau-guide-note").textContent,
      language === "ru" ? /Жетоны и XP/ : /Tokens and XP/,
    )
    await api.act(async () => doc.querySelector(".bureau-guide-content>.bureau-action").click())
    assert.equal(actions.pop(), "archive")
    await api.act(async () => button(doc, language === "ru" ? "Дальше" : "Next").click())
    await api.act(async () => doc.querySelector(".bureau-guide-content>.bureau-action").click())
    assert.equal(actions.pop(), "bureaus")
    assert.equal(doc.activeElement, doc.querySelector(".bureau-guide h2"))
    await api.act(async () =>
      doc.querySelector("dialog").dispatchEvent(new w.Event("cancel", { cancelable: true })),
    )
    assert.equal(actions.pop(), "close")
    await api.act(async () => root.unmount())
    assert.equal(doc.activeElement.id, "trigger")
  })

test("deep-linked board stays open; native mode changes board and resets category while keeping each mode's draft", async () => {
  const { api, doc, w, calls } = runtime({ hash: "#quests" })
  let root
  await api.act(async () => {
    root = api.mountDashboard(doc.getElementById("mount"), session())
  })
  assert.equal(doc.querySelector(".bureau-guide"), null)
  assert.equal(
    doc.querySelector(".dc-mobile-bottom-nav [aria-current=page]").textContent,
    "Контракты",
  )
  const cards = () => [...doc.querySelectorAll(".dc-contract-grid .contract-card")]
  assert.equal(cards().length, 2)
  await api.act(async () => cards()[0].click())
  await api.act(async () =>
    [...doc.querySelectorAll(".dc-filter-row button")]
      .find((b) => b.textContent.includes("Поддержка"))
      .click(),
  )
  assert.equal(cards().length, 1)
  const select = doc.querySelector(".bureau-mode-mobile select")
  await api.act(async () => {
    select.value = "STREET_BRAWL"
    select.dispatchEvent(new w.Event("change", { bubbles: true }))
  })
  assert.equal(cards().length, 2)
  assert.ok(cards().every((card) => card.textContent.includes("STREET_BRAWL")))
  assert.equal(doc.querySelectorAll(".dc-v3-mode-tabs [aria-pressed=true]").length, 1)
  await api.act(async () => cards()[1].click())
  await api.act(async () => {
    select.value = "STANDARD"
    select.dispatchEvent(new w.Event("change", { bubbles: true }))
  })
  assert.equal(cards()[0].getAttribute("aria-pressed"), "true")
  assert.equal(cards()[1].getAttribute("aria-pressed"), "false")
  assert.equal(calls.filter(({ init }) => init.method === "POST").length, 0)
  await api.act(async () => root.unmount())
})

test("pending mandatory announcements defer the introduction without marking it complete", async () => {
  const { api, doc } = runtime({
    announcements: [
      { id: "notice", revision: 1, title: "Maintenance", presentation: "MODAL", ends_at: future() },
    ],
  })
  let root
  await api.act(async () => {
    root = api.mountDashboard(doc.getElementById("mount"), session())
  })
  assert.equal(doc.querySelector(".bureau-guide"), null)
  assert.equal(api.hasSeenGuide("account-one"), false)
  await api.act(async () => root.unmount())
})

test("disabled storage never blocks the guide or account navigation", () => {
  const { api, w } = runtime()
  Object.defineProperty(w, "localStorage", {
    get() {
      throw new Error("storage blocked")
    },
  })
  assert.equal(api.hasSeenGuide("private"), false)
  assert.doesNotThrow(() => api.rememberGuide("private"))
})
