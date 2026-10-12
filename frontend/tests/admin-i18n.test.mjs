import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { build, normalizePath } from "vite"
import { JSDOM } from "jsdom"

let code
const environments = []
before(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    resolve: { alias: { "@": path.resolve("src") } },
    plugins: [
      {
        name: "admin-console-test-export",
        transform(source, id) {
          if (id === normalizePath(path.resolve("src/Dashboard.tsx")))
            return `${source}\nexport { AdminConsole }\n`
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: "tests/admin-i18n-entry.tsx", name: "AdminI18nTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => {
  for (const dom of environments) dom.window.close()
})
function runtime(fetch, pathname = "/admin") {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: `https://qa.invalid${pathname}`,
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
  w.fetch = fetch
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.localStorage.setItem("dc.ui.language", "ru")
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  w.eval(code)
  return { w, doc: w.document, api: w.AdminI18nTest }
}
const response = (data) => ({ ok: true, json: async () => data })
const button = (doc, text) =>
  [...doc.querySelectorAll("button")].find((item) => item.textContent.includes(text))
const field = (doc, text) =>
  [...doc.querySelectorAll("label")]
    .find((item) => item.textContent.includes(text))
    ?.querySelector("input,textarea,select")
function input(w, element, value) {
  const prototype =
    element.tagName === "TEXTAREA"
      ? w.HTMLTextAreaElement.prototype
      : element.tagName === "SELECT"
        ? w.HTMLSelectElement.prototype
        : w.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value)
  element.dispatchEvent(
    new w.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }),
  )
}
const list = {
  items: [],
  total: 0,
  offset: 0,
  limit: 250,
  phase_counts: {},
  server_time: "2026-09-29T00:00:00Z",
  feature_flags: { enabled: true, site: true, companion: true, telegram_mirror: false },
}

test("announcement language changes preserve the draft and submit untranslated API values", async () => {
  let submitted
  const { w, doc, api } = runtime(async (url, init) => {
    if (init.method === "POST") {
      submitted = JSON.parse(init.body)
      return response({
        ok: true,
        item: {
          ...submitted,
          id: "announcement",
          status: "DRAFT",
          phase: "DRAFT",
          revision: 1,
          starts_at: null,
          ends_at: null,
          supersedes_id: null,
          created_by: null,
          updated_by: null,
          published_by: null,
          cancelled_by: null,
          published_at: null,
          cancelled_at: null,
          created_at: list.server_time,
          updated_at: list.server_time,
        },
      })
    }
    return response(list)
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "announcements", {
      csrf: "csrf",
      permissions: ["*"],
      setError: assert.fail,
      setNotice() {},
    })
  })
  await api.act(async () => {
    input(w, field(doc, "Заголовок RU"), "Черновик сохраняется")
    input(w, field(doc, "Текст RU"), "Текст без изменений")
    input(w, field(doc, "Представление"), "MODAL")
  })
  await api.act(async () => doc.getElementById("switch-language").click())
  assert.match(doc.querySelector("h2").textContent, /Announcement center/)
  assert.equal(field(doc, "RU title").value, "Черновик сохраняется")
  assert.equal(field(doc, "RU body").value, "Текст без изменений")
  assert.equal(field(doc, "Presentation").value, "MODAL")
  await api.act(async () => button(doc, "CREATE DRAFT").click())
  assert.equal(submitted.title_ru, "Черновик сохраняется")
  assert.equal(submitted.body_ru, "Текст без изменений")
  assert.equal(submitted.presentation, "MODAL")
  assert.deepEqual(submitted.surfaces, ["SITE_DASHBOARD"])
  assert.deepEqual(submitted.audiences, ["STAFF"])
  await api.act(async () => root.unmount())
})

test("bureau moderation language changes retain the selected decision and reviewer note", async () => {
  let submitted
  const report = {
    id: "report",
    revision: 3,
    kind: "CONTENT",
    status: "OPEN",
    bureau_status: "ACTIVE",
    bureau_name: "Night Office",
    message: "Please review",
    snapshot: {},
    current_artwork: {},
    decision_note: null,
  }
  const { w, doc, api } = runtime(async (url, init) => {
    if (init?.method === "POST") submitted = JSON.parse(init.body)
    return response({ items: [report], total: 1 })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "bureau", { csrf: "csrf" })
  })
  await api.act(async () => button(doc, "Рассмотреть").click())
  await api.act(async () => {
    input(w, field(doc, "Решение"), "FREEZE")
    input(w, field(doc, "Пояснение для автора"), "Moderator note to preserve")
  })
  await api.act(async () => doc.getElementById("switch-language").click())
  assert.match(doc.querySelector("h2").textContent, /Bureau reports/)
  assert.equal(field(doc, "Decision").value, "FREEZE")
  assert.equal(field(doc, "Note for the reporter").value, "Moderator note to preserve")
  await api.act(async () => button(doc, "Confirm decision").click())
  assert.deepEqual(submitted, { revision: 3, action: "FREEZE", note: "Moderator note to preserve" })
  await api.act(async () => root.unmount())
})

test("review language changes retain queue filters and their API codes", async () => {
  const requests = []
  const { w, doc, api } = runtime(async (url) => {
    requests.push(url)
    return response({ items: [], total: 0, offset: 0, limit: 20 })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "reviews", {
      initialItems: [],
      csrf: "csrf",
      currentUserId: "moderator",
      canForceClaim: false,
      setError: assert.fail,
      setNotice() {},
      reloadAll: async () => {},
    })
  })
  await api.act(async () => input(w, doc.querySelectorAll("select")[1], "RANKED"))
  await api.act(async () => doc.getElementById("switch-language").click())
  assert.equal(doc.querySelectorAll("select")[1].value, "RANKED")
  assert.ok(
    [...doc.querySelectorAll("option")].some(
      (item) => item.value === "ALL" && item.textContent === "All modes",
    ),
  )
  assert.ok(
    requests.some(
      (url) => new URL(url, "https://qa.invalid").searchParams.get("mode") === "RANKED",
    ),
  )
  await api.act(async () => root.unmount())
})

test("the admin console keeps all 17 sections and the selected user filter when language changes", async () => {
  const requests = []
  const { w, doc, api } = runtime(async (url) => {
    requests.push(url)
    if (url === "/api/admin/auth/status")
      return response({
        configured: true,
        elevated: true,
        expires_at: "2026-09-29T12:00:00Z",
        ttl_minutes: 30,
        can_manage_roles: true,
        is_staff: true,
        permissions: ["*"],
        admin: {
          id: "owner",
          display_name: "Owner",
          steam_id64: "76561198000000000",
          access_role: "OWNER",
          badges: [],
        },
      })
    return response({ items: [], total: 0, offset: 0, limit: 20 })
  }, "/admin/reviews")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "console", {
      csrf: "csrf",
      setError: assert.fail,
      setNotice() {},
      reloadAll: async () => {},
    })
  })
  const sections = () =>
    [...doc.querySelectorAll(".dc-admin-mobile-section option")].map((item) => item.value)
  const expectedSections = [
    "overview",
    "users",
    "reviews",
    "bureau_reports",
    "cards",
    "packs",
    "announcements",
    "hero_votes",
    "matches",
    "boards",
    "companions",
    "missions",
    "generator",
    "jobs",
    "outbox",
    "audit",
    "system",
  ]
  assert.deepEqual(sections(), expectedSections)
  await api.act(async () => button(doc, "Игроки").click())
  await api.act(async () => {
    input(w, doc.querySelector(".dc-admin-filterbar input"), "Mandarin")
    input(w, doc.querySelector(".dc-admin-filterbar select"), "MODERATOR")
  })
  await api.act(async () => doc.getElementById("switch-language").click())
  assert.equal(doc.querySelector(".dc-admin-tabs .active").textContent.trim(), "Players")
  assert.equal(doc.querySelector(".dc-admin-mobile-section select").value, "users")
  assert.equal(doc.querySelector(".dc-admin-filterbar input").value, "Mandarin")
  assert.equal(doc.querySelector(".dc-admin-filterbar select").value, "MODERATOR")
  assert.deepEqual(sections(), expectedSections)
  assert.equal(doc.querySelectorAll(".dc-admin-tabs button").length, 17)
  assert.ok(button(doc, "Hero votes"))
  await api.act(async () => button(doc, "Apply").click())
  assert.ok(
    requests.some((url) => {
      const query = new URL(url, "https://qa.invalid").searchParams
      return query.get("query") === "Mandarin" && query.get("role") === "MODERATOR"
    }),
  )
  await api.act(async () => root.unmount())
})
