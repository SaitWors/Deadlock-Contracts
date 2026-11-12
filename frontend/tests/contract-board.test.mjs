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

async function mount({ language = "ru", boardRequest, historyRequest, hash = "quests" } = {}) {
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
    if (url.startsWith("/api/history") && historyRequest) return historyRequest()
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

const verificationCases = [
  ["LOCKED", null, "Ожидаем подходящий матч", "Awaiting an eligible match"],
  [
    "LOCKED",
    { phase: "MATCH_DETECTED", match_id: "8675309" },
    "Матч найден — ждём итоговые данные",
    "Match found — awaiting final data",
  ],
  [
    "LOCKED",
    { phase: "QUEUED", queued_count: 2 },
    "Матч сохранён в очереди",
    "Match saved in the queue",
  ],
  [
    "LOCKED",
    { phase: "SEARCHING", delayed_by_provider: true },
    "Ожидаем данные о матче",
    "Awaiting match data",
  ],
  // A stale provider phase must never override the actual case state.
  ["VERIFYING", { phase: "SEARCHING" }, "Проверяем результат матча", "Verifying the match result"],
  ["REVIEW_REQUIRED", { phase: "SEARCHING" }, "Уточняем данные матча", "Clarifying match data"],
  ["SETTLED", { phase: "VERIFYING" }, "Проверка завершена", "Verification complete"],
]
for (const language of ["ru", "en"])
  for (const [status, provider, ruTitle, enTitle] of verificationCases)
    test(`${language}: ${status}/${provider?.phase || "no-provider"} explains the actual state without inventing a result`, async () => {
      const payload = boardsPayload()
      const board = payload.boards[0]
      Object.assign(board, {
        status,
        provider_status: provider,
        max_attempts: 4,
        attempts_used: 4,
        attempts_remaining: 0,
      })
      Object.assign(board.options[0], {
        selected: true,
        status: status === "SETTLED" ? "COMPLETED" : status,
      })
      const { doc } = await mount({ language, boardRequest: () => response(payload) })
      const context = doc.querySelector(".dc-verification-context")
      assert.equal(context.querySelector("h3").textContent, language === "ru" ? ruTitle : enTitle)
      assert.ok(context.querySelector('[role="status"]'))
      assert.equal(context.querySelector("details").open, false)
      assert.doesNotMatch(context.textContent, /ПРОВАЛЕНО|FAILED|\d+%|\d+ (?:минут|minutes)/)
      assert.match(
        doc.querySelector(".dc-board-rules").textContent,
        language === "ru" ? /Лимит матчей для этого дела: 4/ : /Match limit for this case: 4/,
      )
      assert.match(doc.querySelector(".dc-deadline-strip").textContent, /4\/4/)
      assert.equal(doc.querySelectorAll(".dc-motion-contract-card:disabled").length, 6)
      if (provider?.match_id) assert.match(context.querySelector("details").textContent, /#8675309/)
      if (provider?.queued_count)
        assert.match(
          context.querySelector("details").textContent,
          language === "ru" ? /Матчей в очереди: 2/ : /Matches queued: 2/,
        )
    })

for (const language of ["ru", "en"])
  test(`${language}: active cases share the board status and retain all server match IDs in disclosure`, async () => {
    const payload = boardsPayload()
    Object.assign(payload.boards[0], {
      status: "VERIFYING",
      provider_status: {
        phase: "VERIFYING",
        match_id: "12345",
        active_match_ids: ["12345", "67890"],
      },
    })
    Object.assign(payload.boards[0].options[0], { selected: true, status: "VERIFYING" })
    const { doc } = await mount({ language, hash: "active", boardRequest: () => response(payload) })
    const card = doc.querySelector(".dc-active-case-card")
    assert.doesNotMatch(card.textContent, /Неизвестная фаза|Unknown phase/)
    const details = card.querySelector(".dc-verification-context details")
    assert.equal(details.open, false)
    assert.match(details.textContent, /#12345, #67890/)
    assert.match(
      details.textContent,
      language === "ru" ? /Сигналы Companion предварительны/ : /Companion signals are provisional/,
    )
  })

for (const language of ["ru", "en"])
  test(`${language}: personalization distinguishes missing data, cold start, variety and actual adapted conditions`, async () => {
    const payload = boardsPayload()
    const options = payload.boards[0].options
    options[1].personalization = {
      enabled: true,
      kind: "CHALLENGE",
      sample_size: 20,
      confidence: "HIGH",
      basis: [],
    }
    options[2].personalization = {
      enabled: false,
      kind: "WILDCARD",
      sample_size: 0,
      confidence: "COLD_START",
      basis: [],
    }
    options[3].personalization = {
      enabled: false,
      kind: "WILDCARD",
      sample_size: 4,
      confidence: "COLD_START",
      basis: [],
    }
    options[4].personalization = {
      enabled: false,
      kind: "WILDCARD",
      sample_size: 20,
      confidence: "HIGH",
      basis: [],
    }
    options[5].personalization = {
      enabled: true,
      kind: "CHALLENGE",
      sample_size: 5,
      confidence: "LOW",
      basis: [
        { metric: options[5].metric, target: options[5].target, median: 0, n: 5 },
        { metric: options[5].metric, target: 999999, median: 999999, n: 5 },
      ],
    }
    const { doc, api } = await mount({ language, boardRequest: () => response(payload) })
    const details = doc.querySelector(".dc-personalization-context")
    assert.equal(details.open, false)
    const entries = [...details.querySelectorAll("li")]
    assert.equal(entries.length, 5)
    assert.match(entries[0].textContent, language === "ru" ? /Общая цель/ : /A general goal/)
    assert.match(
      entries[1].textContent,
      language === "ru" ? /ещё не было подходящих/ : /no eligible final matches/,
    )
    assert.match(
      entries[2].textContent,
      language === "ru" ? /было ещё мало/ : /too few eligible final matches/,
    )
    assert.match(entries[3].textContent, language === "ru" ? /Для разнообразия/ : /For variety/)
    assert.match(entries[4].textContent, language === "ru" ? /медиана: 0/ : /median: 0/)
    assert.doesNotMatch(details.textContent, /999/)
    assert.equal(doc.querySelectorAll('.dc-motion-contract-card[aria-pressed="true"]').length, 0)
    await api.act(async () => button(doc.querySelector(".bureau-mode-desktop"), "Ranked").click())
    assert.equal(doc.querySelector(".dc-personalization-context"), null)
  })

for (const status of ["LOCKED", "VERIFYING", "REVIEW_REQUIRED"])
  test(`history keeps an exhausted ${status} case pending and reveals even a single evaluation`, async () => {
    const item = {
      ...boardsPayload().boards[0].options[0],
      assignment_id: "assignment-qa",
      board_id: "history-qa",
      status,
      game_match_mode: "STANDARD",
      attempts_used: 5,
      max_attempts: 5,
      reward_granted_xp: 0,
      reward_granted_at: null,
      explanation: null,
      match_id: "12345",
      last_attempt_match_id: "12345",
      locked_at: "2026-11-12T12:00:00Z",
      settled_at: null,
      evaluations: [
        {
          id: "evaluation-qa",
          revision: 1,
          status,
          match_id: "12345",
          explanation: "Awaiting final data",
          created_at: "2026-11-12T13:00:00Z",
        },
      ],
    }
    const cases = [
      {
        board_id: "history-qa",
        game_match_mode: "STANDARD",
        status,
        locked_at: item.locked_at,
        settled_at: null,
        case_expires_at: null,
        attempts_used: 5,
        max_attempts: 5,
        items: [item],
      },
    ]
    const { doc } = await mount({
      language: "en",
      hash: "history",
      historyRequest: () => response({ cases, total: 1 }),
    })
    const card = doc.querySelector(".dc-case-file")
    assert.equal(card.querySelector(".dc-badge.failed"), null)
    assert.ok(card.querySelector(`.dc-badge.${status.toLowerCase()}`))
    assert.match(card.querySelector(".dc-eyebrow").textContent, /5\/5/)
    const log = card.querySelector(".dc-attempt-log")
    assert.equal(log.open, false)
    assert.match(log.textContent, /VERIFICATION LOG · 1/)
    assert.match(log.textContent, /MATCH #12345/)
    assert.equal(log.querySelector("time").dateTime, item.evaluations[0].created_at)
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
