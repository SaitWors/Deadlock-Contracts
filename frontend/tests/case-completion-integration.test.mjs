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
      lib: {
        entry: "tests/first-visit-entry.tsx",
        name: "CompletionIntegration",
        formats: ["iife"],
      },
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

const response = (data) => ({ ok: true, status: 200, json: async () => data })

function finalBoard(statuses = ["COMPLETED"], attempts = 1, status = "SETTLED", maxAttempts = 3) {
  const board = boardsPayload().boards[0]
  return {
    ...board,
    status,
    locked_at: new Date().toISOString(),
    attempts_used: attempts,
    max_attempts: maxAttempts,
    attempts_remaining: Math.max(0, maxAttempts - attempts),
    options: board.options.map((option, index) => ({
      ...option,
      selected: index < statuses.length,
      status: statuses[index] || "OFFERED",
    })),
  }
}

function historyCase(board, id = board.id) {
  return {
    board_id: id,
    game_match_mode: board.game_match_mode,
    status: board.status,
    locked_at: board.locked_at,
    settled_at: new Date().toISOString(),
    case_expires_at: board.expires_at,
    attempts_used: board.attempts_used,
    max_attempts: board.max_attempts,
    items: board.options
      .filter((option) => option.selected)
      .map((option) => ({
        ...option,
        assignment_id: option.id,
        board_id: id,
        board_status: board.status,
        game_match_mode: board.game_match_mode,
        reward_granted_xp: option.status === "COMPLETED" ? option.reward_xp : 0,
        reward_granted_at: null,
        evaluations: [],
        match_id: null,
        last_attempt_match_id: null,
        locked_at: board.locked_at,
        settled_at: new Date().toISOString(),
      })),
  }
}

function completionReceipt(board) {
  return {
    board_id: board.id,
    ready: true,
    replayable: true,
    result_source: "saved",
    reason: null,
    user: { id: session.user.id, display_name: "Actual profile", avatar_url: null },
    attempts_used: 1,
    max_attempts: 3,
    tasks: [
      { id: "receipt-one", title: "First verified task", status: "COMPLETED", xp: 13 },
      { id: "receipt-two", title: "Second verified task", status: "COMPLETED", xp: 17 },
    ],
    total_xp: 30,
    progression: {
      before: {
        level: 1,
        total_xp: 110,
        level_xp: 110,
        next_level_xp: 130,
        progress_pct: 84.6,
        xp_to_next: 20,
        lifetime_spent_threshold: 0,
      },
      after: {
        level: 2,
        total_xp: 140,
        level_xp: 10,
        next_level_xp: 170,
        progress_pct: 5.9,
        xp_to_next: 160,
        lifetime_spent_threshold: 130,
      },
      levels: [
        { level: 1, start_xp: 0, end_xp: 130 },
        { level: 2, start_xp: 130, end_xp: 300 },
      ],
    },
  }
}

async function mount({
  board = finalBoard(),
  cases = [],
  tab = "quests",
  language = "ru",
  completionRequest,
  boardRequest,
  reducedMotion = true,
} = {}) {
  const dom = new JSDOM('<div id="mount"></div>', {
    url: `https://qa.invalid/#${tab}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  })
  const w = dom.window
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.Headers = Headers
  w.AbortController = AbortController
  w.AbortSignal = AbortSignal
  w.scrollTo = () => {}
  w.matchMedia = (query) => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : true,
    addEventListener() {},
    removeEventListener() {},
  })
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
  w.HTMLMediaElement.prototype.play = async function () {}
  w.HTMLMediaElement.prototype.pause = function () {}
  w.localStorage.setItem("dc.ui.language", language)
  const calls = []
  w.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.endsWith("/completion")) return completionRequest(url, init)
    if (url === "/api/boards/today")
      return boardRequest ? boardRequest() : response({ ...boardsPayload(), boards: [board] })
    if (url.startsWith("/api/history")) return response({ cases, total: cases.length })
    if (url.includes("/api/archive/meta"))
      return response({ heroes: [], ranks: [], account_key: "test" })
    if (url.includes("/api/archive/"))
      return response({ items: [], total: 0, card_ids: [], is_public: false, revision: 0 })
    return response(auxiliaryResponse(url))
  }
  w.eval(code)
  let root
  await w.CompletionIntegration.act(async () => {
    root = w.CompletionIntegration.mountDashboard(w.document.getElementById("mount"), {
      ...session,
      user: { ...session.user, locale: language },
    })
  })
  environments.push({ dom, api: w.CompletionIntegration, root })
  return { doc: w.document, calls, api: w.CompletionIntegration, w }
}

test("a fully successful signed case offers completion before attempts run out", async () => {
  const { doc, calls } = await mount({ board: finalBoard(["COMPLETED", "COMPLETED"], 1) })
  assert.match(
    doc.querySelector(".case-completion-trigger")?.textContent || "",
    /Завершить контракт/,
  )
  assert.equal(doc.querySelector("dialog[open]"), null)
  assert.equal(calls.filter(({ url }) => url.endsWith("/completion")).length, 0)
  assert.equal(calls.filter(({ init }) => init.method === "POST").length, 0)
})

test("a mixed final case offers completion after its last attempt", async () => {
  const { doc } = await mount({ board: finalBoard(["COMPLETED", "FAILED", "FAILED"], 3) })
  assert.ok(doc.querySelector(".case-completion-trigger"))
})

for (const maxAttempts of [2, 5]) {
  for (const tab of ["quests", "history"])
    test(`${tab} uses the case's ${maxAttempts}-attempt limit for terminal results`, async () => {
      const final = finalBoard(["COMPLETED", "FAILED"], maxAttempts, "SETTLED", maxAttempts)
      const retryable = finalBoard(["COMPLETED", "FAILED"], maxAttempts - 1, "SETTLED", maxAttempts)
      const unfinished = await mount({
        tab,
        board: retryable,
        cases: [historyCase(retryable)],
      })
      assert.equal(unfinished.doc.querySelector(".case-completion-trigger"), null)
      const finished = await mount({ tab, board: final, cases: [historyCase(final)] })
      assert.equal(finished.doc.querySelectorAll(".case-completion-trigger").length, 1)
    })
}

for (const [label, board] of [
  ["retryable tasks", finalBoard(["COMPLETED", "FAILED"], 2)],
  ["final verification", finalBoard(["COMPLETED", "VERIFYING"], 3, "VERIFYING")],
  ["awaiting the final match", finalBoard(["COMPLETED", "FAILED"], 3, "AWAITING_LAST_MATCH")],
  ["an unresolved final task", finalBoard(["COMPLETED", "AWAITING_LAST_MATCH"], 3)],
  ["final review", finalBoard(["COMPLETED", "REVIEW_REQUIRED"], 3, "REVIEW_REQUIRED")],
  ["inconsistent final review", finalBoard(["COMPLETED", "REVIEW_REQUIRED"], 3)],
  ["no chosen tasks", finalBoard([], 3)],
  ["more than three chosen tasks", finalBoard(Array(4).fill("COMPLETED"), 3)],
])
  test(`${label} does not offer a completion ceremony`, async () => {
    const { doc } = await mount({ board })
    assert.equal(doc.querySelector(".case-completion-trigger"), null)
  })

test("active cases keep their count while recent final cases remain available to finish", async () => {
  const active = finalBoard(["LOCKED"], 1, "LOCKED")
  const final = finalBoard(["COMPLETED", "FAILED"], 3)
  const cases = Array.from({ length: 8 }, (_, index) => historyCase(final, `finished-${index}`))
  const { doc } = await mount({ board: active, cases, tab: "active" })
  assert.equal(doc.querySelectorAll(".dc-active-case-card").length, 1)
  assert.equal(doc.querySelectorAll(".case-ready-list .case-completion-trigger").length, 6)
  assert.match(doc.querySelector(".case-ready-list")?.textContent || "", /Завершённые дела/)
})

test("history retains an eligible case completion entry after its board has changed", async () => {
  const oldCase = historyCase(finalBoard(["COMPLETED", "FAILED"], 3), "old-case")
  const board = boardsPayload().boards[0]
  const { doc } = await mount({ board, cases: [oldCase], tab: "history", language: "en" })
  assert.match(doc.querySelector(".case-completion-trigger")?.textContent || "", /Finish contract/)
  assert.equal(doc.querySelectorAll(".case-completion-trigger").length, 1)
})

test("polling and tab changes preserve an opened case until the player closes it", async () => {
  let board = finalBoard(["COMPLETED"], 1)
  const { doc, calls, api, w } = await mount({
    language: "en",
    boardRequest: () => response({ ...boardsPayload(), boards: [board] }),
    completionRequest: () => new Promise(() => {}),
  })
  const trigger = doc.querySelector(".case-completion-trigger")
  trigger.focus()
  await api.act(async () => trigger.click())
  const dialog = doc.querySelector("dialog.case-completion[open]")
  assert.ok(dialog)
  const receiptCall = calls.find(({ url }) => url.endsWith("/completion"))
  board = boardsPayload().boards[0]
  board.id = "replacement-board"
  await api.act(async () => w.dispatchEvent(new w.Event("online")))
  assert.equal(doc.querySelector(".case-completion-trigger"), null)
  assert.equal(doc.querySelector("dialog.case-completion[open]"), dialog)
  assert.equal(receiptCall.init.signal.aborted, false)
  await api.act(async () => {
    w.location.hash = "#history"
    w.dispatchEvent(new w.Event("hashchange"))
  })
  assert.equal(doc.querySelector("dialog.case-completion[open]"), dialog)
  assert.equal(calls.filter(({ url }) => url.endsWith("/completion")).length, 1)
  await api.act(async () => dialog.dispatchEvent(new w.Event("cancel", { cancelable: true })))
  assert.equal(doc.querySelector("dialog.case-completion[open]"), null)
  assert.equal(receiptCall.init.signal.aborted, true)
  assert.ok(doc.activeElement.matches(".ns-sidebar-brand, .bureau-brand"))
})

test("Escape interrupts a running cinematic and returns to the case result in the cabinet", async () => {
  const board = finalBoard(["COMPLETED", "COMPLETED"], 1)
  const { doc, api, w } = await mount({
    board,
    cases: [historyCase(board)],
    tab: "history",
    language: "en",
    reducedMotion: false,
    completionRequest: () => response(completionReceipt(board)),
  })
  const result = doc.querySelector(".dc-case-file")
  const resultText = result.textContent
  const trigger = result.querySelector(".case-completion-trigger")
  trigger.focus()
  await api.act(async () => trigger.click())
  const dialog = doc.querySelector("dialog.case-completion[open]")
  assert.ok(dialog)
  assert.equal(dialog.dataset.static, "false")
  assert.notEqual(dialog.dataset.phase, "done")
  await api.act(async () => dialog.dispatchEvent(new w.Event("cancel", { cancelable: true })))
  assert.equal(Boolean(doc.querySelector("dialog.case-completion[open]")), false)
  assert.equal(doc.querySelector(".dc-case-file"), result)
  assert.equal(doc.activeElement, trigger)
  assert.equal(result.textContent.replace("Replay result", "Finish contract"), resultText)
  assert.equal(doc.body.style.overflow, "")
})

test("opening and replaying use only the authoritative receipt and never grant nominal XP", async () => {
  const board = finalBoard(["COMPLETED", "COMPLETED"], 1)
  const receipt = completionReceipt(board)
  const { doc, calls, api } = await mount({
    board,
    language: "en",
    completionRequest: () => response(receipt),
  })
  const accountProfile = doc.querySelector(".bureau-profile-trigger").textContent
  const trigger = doc.querySelector(".case-completion-trigger")
  trigger.focus()
  await api.act(async () => {
    trigger.click()
    trigger.click()
  })
  assert.equal(doc.querySelectorAll("dialog.case-completion[open]").length, 1)
  const dialog = doc.querySelector("dialog.case-completion[open]")
  assert.match(dialog.querySelector(".cc-profile")?.textContent || "", /Actual profile/)
  assert.equal(doc.querySelector(".cc-total")?.textContent, "10 / 170 XP")
  assert.equal(doc.querySelector(".cc-level strong")?.textContent, "2")
  assert.equal(dialog.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"), "10")
  assert.equal(dialog.querySelector('[role="progressbar"]').getAttribute("aria-valuemax"), "170")
  assert.equal(dialog.querySelectorAll(".cc-task").length, 2)
  assert.match(dialog.textContent, /First verified task/)
  assert.match(dialog.textContent, /Second verified task/)
  assert.equal(
    Boolean(
      dialog.querySelector("header, footer, button:not(.sr-only), .cc-description, .cc-note"),
    ),
    false,
    "the ready scene contains only the profile and selected tasks",
  )
  assert.equal(doc.querySelector(".bureau-profile-trigger").textContent, accountProfile)
  assert.equal(calls.filter(({ url }) => url.endsWith("/completion")).length, 1)
  await api.act(async () =>
    dialog.dispatchEvent(new doc.defaultView.Event("cancel", { cancelable: true })),
  )
  assert.equal(doc.activeElement, trigger)
  assert.match(trigger.textContent, /Replay result/)
  assert.equal(doc.querySelector(".bureau-profile-trigger").textContent, accountProfile)
  await api.act(async () => trigger.click())
  assert.equal(calls.filter(({ url }) => url.endsWith("/completion")).length, 2)
  assert.ok(
    calls
      .filter(({ url }) => url.endsWith("/completion"))
      .every(({ init }) => (init.method || "GET") === "GET"),
  )
  assert.equal(calls.filter(({ init }) => init.method && init.method !== "GET").length, 0)
  assert.equal(doc.querySelectorAll("dialog.case-completion[open]").length, 1)
  assert.match(doc.querySelector(".cc-profile").textContent, /Actual profile/)
  assert.equal(doc.querySelector(".cc-total").textContent, "10 / 170 XP")
  assert.equal(doc.querySelector(".bureau-profile-trigger").textContent, accountProfile)
})
