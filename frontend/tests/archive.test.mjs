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
      lib: { entry: "tests/archive-entry.tsx", name: "ArchiveTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => environments.forEach((dom) => dom.window.close()))
function runtime(fetch, language = "ru") {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: "https://qa.invalid",
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
  w.localStorage.setItem("dc.ui.language", language)
  w.eval(code)
  return { w, api: w.ArchiveTest, doc: w.document }
}
const response = (data) => ({ ok: true, json: async () => data })
const wallet = {
  balance: 90,
  completed: 0,
  weekly_limit: 5,
  reward: 30,
  reset_at: "2026-09-14T00:00:00Z",
  round: null,
  history: [],
  history_total: 0,
}
const meta = {
  heroes: [{ key: "abrams", name: "Abrams" }],
  ranks: ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"],
  can_publish: false,
}
const card = {
  id: "draft-1",
  hero: "abrams",
  hero_name: "Abrams",
  rank: "SSS",
  title: "Night file",
  description: "<script>danger()</script>",
  artist: "Author",
  source_url: "",
  image_url: "/api/archive/cards/draft-1/image",
  crop_x: 50,
  crop_y: 50,
  zoom: 1,
  frame_version: 1,
  status: "DRAFT",
  revision: 7,
  rights_confirmed: true,
}
const button = (doc, text) =>
  [...doc.querySelectorAll("button")].find((b) => b.textContent.includes(text))

test("account popover shows actual tokens, closes on Escape and restores focus", async () => {
  const { w, api, doc } = runtime(async (url) =>
    response(url.includes("wallet") ? wallet : { my_bureau: { name: "Deadlock Night" } }),
  )
  const navigated = []
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "account", {
      user: { display_name: "Mandarin", avatar_url: null, xp: 120, is_staff: false },
      level: 2,
      csrf: "csrf",
      revision: 0,
      onNavigate: (tab) => navigated.push(tab),
    })
  })
  const trigger = doc.querySelector('[aria-label="Меню аккаунта"]')
  await api.act(async () => trigger.click())
  assert.equal(trigger.getAttribute("aria-expanded"), "true")
  assert.match(doc.querySelector(".bureau-wallet-strip").textContent, /90/)
  assert.match(doc.querySelector(".bureau-profile-section").textContent, /Deadlock Night/)
  assert.equal(button(doc, "Панель сотрудников"), undefined)
  await api.act(async () =>
    doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  )
  assert.equal(trigger.getAttribute("aria-expanded"), "false")
  assert.equal(doc.activeElement, trigger)
  await api.act(async () => trigger.click())
  await api.act(async () => button(doc, "Мои карточки").click())
  assert.deepEqual(navigated, ["studio"])
  assert.equal(trigger.getAttribute("aria-expanded"), "false")
  await api.act(async () => root.unmount())
})

test("editor saves a draft with its revision; cannot send a publication state", async () => {
  const writes = []
  let saved
  const { api, doc, w } = runtime(async (url, init) => {
    writes.push({ url, init, data: JSON.parse(init.body) })
    return response({ card: { ...card, revision: 8 } })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "studio", {
      card,
      meta,
      csrf: "save-csrf",
      onSaved: (value) => {
        saved = value
      },
      onCancel() {},
    })
  })
  assert.equal(doc.querySelectorAll("select")[1].options.length, 9)
  assert.equal(doc.querySelector('[data-rank="SSS"] .archive-rank').textContent, "SSS")
  assert.equal(doc.querySelector("script"), null)
  await api.act(async () =>
    doc
      .querySelector("form")
      .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })),
  )
  assert.equal(writes[0].init.method, "PUT")
  assert.equal(writes[0].init.headers.get("X-CSRF-Token"), "save-csrf")
  assert.equal(writes[0].data.revision, 7)
  assert.equal(writes[0].data.status, undefined)
  assert.equal(writes[0].data.image, undefined)
  assert.equal(saved.revision, 8)
  await api.act(async () => root.unmount())
})

test("own designs submit with the reviewed revision and cannot publish", async () => {
  const writes = []
  const { api, doc } = runtime(async (url, init = {}) => {
    if (init.method === "POST") {
      writes.push({ url, data: JSON.parse(init.body) })
      return response({ card: { ...card, status: "PENDING" } })
    }
    if (url.includes("meta")) return response(meta)
    if (url.includes("wallet")) return response(wallet)
    if (url.includes("coverage")) return response({ items: [] })
    return response({ items: [{ ...card, status: writes.length ? "PENDING" : "DRAFT" }], total: 1 })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "archive", {
      csrf: "csrf",
      mode: "studio",
      onWalletChange() {},
    })
  })
  assert.equal(button(doc, "Опубликовать"), undefined)
  await api.act(async () => button(doc, "На проверку").click())
  assert.equal(writes[0].url, "/api/archive/cards/draft-1/submit")
  assert.equal(writes[0].data.revision, 7)
  assert.ok(button(doc, "Отозвать заявку"))
  assert.equal(button(doc, "Редактировать"), undefined)
  await api.act(async () => root.unmount())
})

test("guided cipher posts saved revision and asks wallet to refresh", async () => {
  const writes = []
  let earned = 0
  const round = {
    id: "cipher-1",
    slot: 1,
    revision: 7,
    status: "OPEN",
    guesses: [],
    solution: [0, 2, 4, 5],
  }
  const { api, doc } = runtime(async (url, init) => {
    writes.push(JSON.parse(init.body))
    return response({ round: { ...round, status: "ASSISTED", revision: 8 } })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "cipher", {
      wallet: { ...wallet, round },
      csrf: "csrf",
      onEarned: () => {
        earned += 1
      },
    })
  })
  await api.act(async () => button(doc, "Complete with guidance").click())
  assert.equal(writes[0].revision, 7)
  assert.deepEqual(writes[0].symbols, [0, 2, 4, 5])
  assert.equal(earned, 1)
  assert.match(doc.querySelector('[role="status"]').textContent, /30 tokens/)
  await api.act(async () => root.unmount())
})

test("failed staff permission does not expose review actions", async () => {
  const { api, doc } = runtime(async () => ({
    ok: false,
    json: async () => ({ detail: "TOTP required" }),
  }))
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "review", { csrf: "csrf" })
  })
  assert.match(doc.querySelector('[role="alert"]').textContent, /TOTP required/)
  assert.equal(button(doc, "Опубликовать"), undefined)
  await api.act(async () => root.unmount())
})
