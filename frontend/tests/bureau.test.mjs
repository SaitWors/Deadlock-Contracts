import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { build } from "vite"
import { JSDOM } from "jsdom"

let code
const environments = []
const guideCopy = JSON.parse(
  readFileSync(new URL("../src/foundation/guide-copy.json", import.meta.url), "utf8"),
)
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
const session = (id = "account-one", experienced = false) => ({
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
    created_at: experienced ? "2024-01-01T00:00:00Z" : new Date(Date.now() - 60_000).toISOString(),
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
function runtime({ hash = "", language = "ru", experienced = false } = {}) {
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
    if (/guide-copy.*\.json/.test(url)) return { ok: true, json: async () => guideCopy }
    if (url.startsWith("/api/foundation/overview")) {
      return {
        ok: true,
        json: async () => ({
          completed_cases: experienced ? 1 : 0,
          weekly: [],
          collection: { items: 0, designs: 0 },
          bureau: null,
          has_signed_case: experienced,
          has_verified_result: experienced,
          has_claimed_daily_pack: false,
        }),
      }
    }
    const body = url.startsWith("/api/announcements/active")
      ? { items: [], server_time: new Date().toISOString() }
      : url.startsWith("/api/boards/today")
        ? boards()
        : url.startsWith("/api/history")
          ? { cases: [], total: 0 }
          : url.startsWith("/api/progression")
            ? {
                level: 1,
                total_xp: 0,
                level_xp: 0,
                next_level_xp: 100,
                xp_to_next: 100,
                contracts_completed: 0,
                progress_pct: 0,
              }
            : url.startsWith("/api/reviews/mine")
              ? { items: [] }
              : url.startsWith("/api/companion/status")
                ? { device: null, devices: [] }
                : url.startsWith("/api/archive/wallet")
                  ? { balance: 0 }
                  : url.startsWith("/api/bureaus")
                    ? { my_bureau: null, items: [] }
                    : url.startsWith("/api/preferences")
                      ? {
                          user: {
                            ...session("account-one", experienced).user,
                            ...JSON.parse(init.body || "{}"),
                          },
                        }
                      : null
    if (body === null) throw new Error(`Unexpected request ${url}`)
    return { ok: true, json: async () => body }
  }
  w.eval(code)
  return { w, doc: w.document, api: w.BureauUX, calls }
}
const button = (doc, text) =>
  [...doc.querySelectorAll("button")].find((item) => item.textContent.includes(text))

test("first visit can skip the optional briefing and open the full help route later", async () => {
  const { api, doc, w } = runtime()
  let root
  await api.act(async () => {
    root = api.mountDashboard(doc.getElementById("mount"), session())
  })
  assert.ok(doc.querySelector(".foundation-onboarding"))
  assert.ok(!doc.querySelector("dialog[open]"))
  assert.equal(doc.querySelector(".dc-mobile-bottom-nav [aria-current=page]").textContent, "Обзор")
  assert.equal(doc.querySelectorAll(".dc-mobile-bottom-nav button").length, 5)
  await api.act(async () => button(doc, "Пропустить").click())
  assert.ok(!doc.querySelector(".foundation-onboarding"))
  assert.equal(api.onboardingPreference("account-one"), "skipped")
  assert.equal(api.onboardingPreference("account-two"), "new")
  await api.act(async () => root.unmount())
  await api.act(async () => {
    root = api.mountDashboard(doc.getElementById("mount"), session())
  })
  assert.ok(!doc.querySelector(".foundation-onboarding"))
  await api.act(async () => doc.querySelector(".ns-sidebar [data-nav=help]").click())
  assert.equal(w.location.hash, "#help")
  assert.equal(doc.querySelector(".foundation-guide h1").textContent, "Как это работает")
  assert.equal(
    doc.querySelector(".ns-sidebar [data-nav=help]").getAttribute("aria-current"),
    "page",
  )
  await api.act(async () => root.unmount())
})

test("deep-linked board stays open; native mode changes board and resets category while keeping each mode's draft", async () => {
  const { api, doc, w, calls } = runtime({ hash: "#quests" })
  let root
  await api.act(async () => {
    root = api.mountDashboard(doc.getElementById("mount"), session())
  })
  assert.ok(!doc.querySelector(".foundation-guide"))
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
  assert.equal(
    calls.filter(({ url, init }) => url.startsWith("/api/boards/") && init.method === "POST")
      .length,
    0,
  )
  await api.act(async () => root.unmount())
})

test("an experienced account opens the overview without a novice briefing", async () => {
  const { api, doc } = runtime({ experienced: true })
  let root
  await api.act(async () => {
    root = api.mountDashboard(doc.getElementById("mount"), session("account-one", true))
  })
  assert.ok(!doc.querySelector(".foundation-onboarding"))
  assert.ok(!doc.querySelector("dialog[open]"))
  assert.equal(api.onboardingPreference("account-one"), "new")
  await api.act(async () => root.unmount())
})

test("disabled storage keeps onboarding and account navigation usable", () => {
  const { api, w } = runtime()
  Object.defineProperty(w, "localStorage", {
    get() {
      throw new Error("storage blocked")
    },
  })
  assert.equal(api.onboardingPreference("private"), "new")
  assert.doesNotThrow(() => api.saveOnboardingPreference("private", "skipped"))
})

test("background history refresh retains all loaded pages and updates older verdicts", async () => {
  const { api, doc, w } = runtime({ hash: "#history", language: "en" })
  Object.defineProperty(doc, "visibilityState", { value: "visible" })
  const fetch = w.fetch
  const historyCalls = []
  let refresh,
    updated = false
  const setInterval = w.setInterval.bind(w)
  w.setInterval = (callback, delay, ...args) => {
    if (delay === 20_000) refresh = callback
    return setInterval(callback, delay, ...args)
  }
  const cases = Array.from({ length: 201 }, (_, i) => ({
    board_id: `history-${i}`,
    game_match_mode: "STANDARD",
    status: "COMPLETED",
    locked_at: "2026-09-08T00:00:00Z",
    settled_at: "2026-09-08T01:00:00Z",
    case_expires_at: null,
    attempts_used: 1,
    max_attempts: 3,
    items: [
      {
        assignment_id: `assignment-${i}`,
        board_id: `history-${i}`,
        game_match_mode: "STANDARD",
        title: `History contract ${i}`,
        status: "COMPLETED",
        reward_xp: 30,
        reward_granted_xp: 30,
        difficulty: "LIGHT",
        rarity: "COMMON",
        explanation: null,
        match_id: null,
        last_attempt_match_id: null,
        locked_at: "2026-09-08T00:00:00Z",
        settled_at: "2026-09-08T01:00:00Z",
        evaluations: [],
        attempts_used: 1,
        max_attempts: 3,
      },
    ],
  }))
  cases[200].coin_reward = {
    source_type: "case",
    source_id: "history-200",
    nominal_amount: 10,
    amount: 10,
    status: "DELIVERED",
    reason: "AWARDED",
  }
  cases[200].items[0].coin_reward = {
    source_type: "assignment",
    source_id: "assignment-200",
    nominal_amount: 24,
    amount: 5,
    status: "RESERVED",
    reason: "DAILY_LIMIT",
  }
  w.fetch = async (url, init) => {
    if (url.startsWith("/api/archive/wallet"))
      return { ok: true, json: async () => ({ balance: updated ? 5 : 0 }) }
    if (!url.startsWith("/api/history?")) return fetch(url, init)
    historyCalls.push(url)
    const query = new URL(url, w.location.origin).searchParams
    const offset = Number(query.get("offset")),
      limit = Math.min(200, Number(query.get("limit")))
    return {
      ok: true,
      json: async () => ({
        cases: cases.slice(offset, offset + limit).map((item) =>
          updated && item.board_id === "history-200"
            ? {
                ...item,
                items: [
                  {
                    ...item.items[0],
                    title: "Updated older verdict",
                    coin_reward: { ...item.items[0].coin_reward, status: "DELIVERED" },
                  },
                ],
              }
            : item,
        ),
        total: cases.length,
      }),
    }
  }
  let root
  try {
    await api.act(async () => {
      root = api.mountDashboard(doc.getElementById("mount"), session())
    })
    await api.act(async () => button(doc, "LOAD MORE").click())
    await api.act(async () => button(doc, "LOAD MORE").click())
    assert.equal(doc.querySelectorAll(".dc-case-file").length, 201)
    const lastCase = [...doc.querySelectorAll(".dc-case-file")].at(-1)
    assert.match(lastCase.textContent, /History contract 200/)
    assert.doesNotMatch(lastCase.textContent, /coins|Case bonus|Daily limit/)
    updated = true
    const beforeRefresh = historyCalls.length
    await api.act(async () => refresh())
    assert.equal(doc.querySelectorAll(".dc-case-file").length, 201)
    assert.ok(doc.querySelector(".dc-case-archive").textContent.includes("Updated older verdict"))
    assert.doesNotMatch(
      [...doc.querySelectorAll(".dc-case-file")].at(-1).textContent,
      /coins|Daily limit/,
    )
    assert.ok(historyCalls.slice(beforeRefresh).some((url) => url.includes("offset=200")))
    assert.match(doc.querySelector(".bureau-profile-trigger small").textContent, /XP$/)
    assert.equal(button(doc, "LOAD MORE"), undefined)
  } finally {
    if (root) await api.act(async () => root.unmount())
  }
})
