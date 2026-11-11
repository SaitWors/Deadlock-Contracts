import { afterEach, before, test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { build } from "vite"
import { JSDOM } from "jsdom"
import { auxiliaryResponse, boardsPayload, session } from "./contract-board-fixtures.mjs"

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
      lib: { entry: "tests/first-visit-entry.tsx", name: "BoardTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
afterEach(async () => {
  for (const { dom, api, root } of environments.splice(0)) {
    await api.act(async () => root.unmount())
    dom.window.close()
  }
})

const response = (data, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data })
const button = (element, text) =>
  [...element.querySelectorAll("button")].find((item) => item.textContent.includes(text))

async function mount({ language = "ru", boardRequest, hash = "quests" } = {}) {
  const dom = new JSDOM('<div id="mount"></div>', {
    url: `https://qa.invalid/#${hash}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  })
  const w = dom.window
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.Headers = Headers
  w.AbortController = AbortController
  w.AbortSignal = AbortSignal
  w.scrollTo = () => {}
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
  }
  w.localStorage.setItem("dc.ui.language", language)
  const calls = []
  w.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    if (url === "/api/boards/today")
      return boardRequest ? boardRequest() : response(boardsPayload())
    if (url.includes("/api/archive/meta"))
      return response({ heroes: [], ranks: [], account_key: "board-account" })
    if (url.includes("/api/archive/"))
      return response({ items: [], total: 0, card_ids: [], is_public: false, revision: 0 })
    return response(auxiliaryResponse(url))
  }
  w.eval(code)
  let root
  await w.BoardTest.act(async () => {
    root = w.BoardTest.mountDashboard(w.document.getElementById("mount"), {
      ...session,
      user: { ...session.user, locale: language },
    })
  })
  environments.push({ dom, api: w.BoardTest, root })
  return { w, doc: w.document, api: w.BoardTest, root, calls }
}

test("slow initial board exposes loading rather than an empty board", async () => {
  const { doc } = await mount({ boardRequest: () => new Promise(() => {}) })
  assert.match(
    doc.querySelector('.dc-board-feedback[role="status"]')?.textContent || "",
    /Загружаем контракты/,
  )
  assert.equal(doc.querySelectorAll(".dc-motion-contract-card").length, 0)
  assert.equal(doc.querySelector(".dc-deadline-strip"), null)
})

test("failed initial board can be retried without changing selection APIs", async () => {
  let failed = true
  const { doc, api, calls } = await mount({
    boardRequest: () => response(failed ? { detail: "QA unavailable" } : boardsPayload(), !failed),
  })
  assert.match(doc.querySelector('[role="alert"]')?.textContent || "", /Не удалось загрузить доску/)
  failed = false
  await api.act(async () => button(doc, "Повторить загрузку").click())
  assert.equal(doc.querySelectorAll(".dc-motion-contract-card").length, 6)
  assert.equal(doc.querySelector('[role="alert"]'), null)
  assert.equal(calls.filter((c) => c.url === "/api/boards/today").length, 2)
  assert.equal(calls.filter((c) => c.init.method === "POST").length, 0)
})

for (const language of ["ru", "en"])
  test(`${language}: empty category recovery preserves the existing selected contract`, async () => {
    const { doc, api } = await mount({ language })
    await api.act(async () => doc.querySelector(".dc-motion-contract-card").click())
    const filter = button(
      doc.querySelector(".dc-filter-row"),
      language === "ru" ? "Выживание" : "Survival",
    )
    await api.act(async () => filter.click())
    assert.equal(filter.getAttribute("aria-pressed"), "true")
    assert.equal(doc.querySelectorAll(".dc-motion-contract-card").length, 0)
    const recovery = button(
      doc,
      language === "ru" ? "Показать все контракты" : "Show all contracts",
    )
    assert.ok(recovery, "the empty category must offer a route back")
    await api.act(async () => recovery.click())
    assert.equal(doc.querySelectorAll(".dc-motion-contract-card").length, 6)
    assert.equal(doc.querySelectorAll('.dc-motion-contract-card[aria-pressed="true"]').length, 1)
  })

test("a missing mode has an explicit empty state and no made-up attempt count", async () => {
  const payload = boardsPayload()
  payload.boards = []
  const { doc } = await mount({ boardRequest: () => response(payload) })
  assert.match(
    doc.querySelector('.dc-board-feedback[role="status"]')?.textContent || "",
    /Для этого режима пока нет доски/,
  )
  assert.equal(doc.querySelector(".dc-deadline-strip"), null)
})

test("selection stays capped at three and opens the existing signing dialog", async () => {
  const { doc, api, calls } = await mount()
  const sign = button(doc, "Подписать дело")
  const selection = doc.querySelector('.dc-motion-selection-copy [role="status"]')
  const cards = [...doc.querySelectorAll(".dc-motion-contract-card")]
  assert.equal(sign.disabled, true)
  assert.match(selection.textContent, /0 \/ 3 выбрано/)

  for (const card of cards.slice(0, 4)) await api.act(async () => card.click())
  assert.equal(doc.querySelectorAll('.dc-motion-contract-card[aria-pressed="true"]').length, 3)
  assert.match(selection.textContent, /3 \/ 3 выбрано\s*\+150 XP/)
  assert.equal(doc.querySelectorAll(".dc-motion-selected-pills li").length, 3)
  assert.equal(cards[0].querySelector(".dc-contract-state").textContent, "Выбрано")
  await api.act(async () => sign.click())
  assert.ok(doc.querySelector("dialog[open]"))
  assert.equal(calls.filter((c) => c.url === "/api/board/today/lock").length, 0)
})

test("locked contracts remain readable but cannot be changed or refreshed", async () => {
  const payload = boardsPayload()
  payload.boards[0].status = "LOCKED"
  payload.boards[0].options[0].selected = true
  const { doc } = await mount({ boardRequest: () => response(payload) })
  assert.equal(doc.querySelectorAll(".dc-motion-contract-card:disabled").length, 6)
  assert.equal(button(doc, "Обновить 6 контрактов").disabled, true)
  assert.match(doc.querySelector(".dc-board-locked").textContent, /ОЖИДАЕТ МАТЧ/)
})

test("late request failure cannot replace a newer successful board", async () => {
  let rejectFirst
  let count = 0
  const { w, doc, api } = await mount({
    boardRequest: () =>
      ++count === 1
        ? new Promise((resolve, reject) => {
            rejectFirst = reject
          })
        : response(boardsPayload()),
  })
  await api.act(async () => {
    w.dispatchEvent(new w.Event("online"))
  })
  await api.act(async () => {
    rejectFirst(new Error("stale failure"))
  })
  assert.equal(doc.querySelectorAll(".dc-motion-contract-card").length, 6)
  assert.equal(doc.querySelector('[role="alert"]'), null)
  assert.equal(doc.querySelector(".dc-error"), null)
})

test("background failure keeps the chosen contract and successful retry clears only the error", async () => {
  let fail = false
  const { w, doc, api } = await mount({
    boardRequest: () => response(fail ? { detail: "QA unavailable" } : boardsPayload(), !fail),
  })
  await api.act(async () => {
    doc.querySelector(".dc-motion-contract-card").click()
  })
  fail = true
  await api.act(async () => {
    w.dispatchEvent(new w.Event("online"))
  })
  assert.ok(doc.querySelector('[role="alert"]'))
  assert.equal(doc.querySelectorAll('.dc-motion-contract-card[aria-pressed="true"]').length, 1)
  fail = false
  await api.act(async () => {
    button(doc, "Повторить загрузку").click()
  })
  assert.equal(doc.querySelector('[role="alert"]'), null)
  assert.equal(doc.querySelectorAll('.dc-motion-contract-card[aria-pressed="true"]').length, 1)
})

test("switching modes resets the category but retains separate selections", async () => {
  const { doc, api } = await mount()
  await api.act(async () => {
    doc.querySelector(".dc-motion-contract-card").click()
  })
  await api.act(async () => {
    button(doc.querySelector(".dc-filter-row"), "Бой").click()
  })
  await api.act(async () => {
    button(doc.querySelector(".bureau-mode-desktop"), "Ranked").click()
  })
  assert.equal(doc.querySelectorAll(".dc-motion-contract-card").length, 6)
  assert.equal(doc.querySelectorAll('.dc-motion-contract-card[aria-pressed="true"]').length, 0)
  await api.act(async () => {
    button(doc.querySelector(".bureau-mode-desktop"), "Standard").click()
  })
  assert.equal(doc.querySelectorAll('.dc-motion-contract-card[aria-pressed="true"]').length, 1)
})

for (const route of ["archive", "wallet", "cipher", "catalog", "studio", "arena"])
  test(`retired #${route} deep link opens the supported workspace`, async () => {
    const { w, doc, calls } = await mount({ hash: route, language: "en" })
    assert.equal(w.location.hash, route === "arena" ? "#quests" : "#collection")
    assert.equal(doc.querySelector('.ns-sidebar [data-nav="arena"]'), null)
    assert.equal(doc.querySelector('.ns-sidebar [data-nav="archive"]'), null)
    assert.equal(doc.querySelector('.ns-sidebar [data-nav="wallet"]'), null)
    assert.equal(
      calls.some(({ url }) => /archive\/wallet|api\/arena|archive\/cipher/.test(url)),
      false,
    )
  })
