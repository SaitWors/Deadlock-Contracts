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
      lib: { entry: "tests/personal-progress-entry.tsx", name: "ProgressUX", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => environments.forEach((dom) => dom.window.close()))

const future = () => new Date(Date.now() + 86_400_000).toISOString()
const session = () => ({
  authenticated: true,
  csrf_token: "csrf",
  release: { version: "test" },
  user: {
    id: "account-one",
    display_name: "Игрок",
    avatar_url: null,
    xp: 12,
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
function boards() {
  return {
    date: "2026-10-09",
    server_time: new Date().toISOString(),
    refresh: { remaining: 1, used: 0, free_per_day: 1, reset_at: future(), last_mode: null },
    boards: ["STANDARD", "RANKED", "STREET_BRAWL"].map((mode) => ({
      id: `board-${mode}`,
      date: "2026-10-09",
      game_match_mode: mode,
      status: "OFFERED",
      generation: 1,
      expires_at: future(),
      locked_at: null,
      attempts_used: 0,
      max_attempts: 3,
      attempts_remaining: 3,
      options: [0, 1, 2].map((i) => ({
        id: `${mode}-${i}`,
        title: `Цель ${mode} ${i}`,
        title_i18n: { ru: `Цель ${mode} ${i}`, en: `Goal ${mode} ${i}` },
        description: "Условие контракта",
        description_i18n: { ru: "Условие контракта", en: "Contract condition" },
        reward_xp: 30 + i,
        selected: false,
        status: "OFFERED",
        target: 8 + i,
        metric: "player.assists",
        operator: "gte",
        progress_current: null,
        explanation: null,
        bound_match_id: null,
        category: "SUPPORT",
        difficulty: "LIGHT",
        rarity: "COMMON",
        drop_chance_pct: 25,
        conditions: [{ metric: "player.assists", operator: "gte", target: 8 + i }],
      })),
    })),
  }
}
function progress(mode = "STANDARD", intent = "PRACTICE", changes = {}) {
  const goals = [0, 1, 2].map((i) => ({
    option_id: `${mode}-${i}`,
    title_i18n: { ru: `Цель ${mode} ${i}`, en: `Goal ${mode} ${i}` },
    description_i18n: { ru: "Условие контракта", en: "Contract condition" },
    reward_xp: 30 + i,
    status: "OFFERED",
    conditions: [{ metric: "player.assists", operator: "gte", target: 8 + i }],
    basis: [{ metric: "player.assists", median: 6, n: 9 }],
    reason: { ru: "Небольшой шаг выше вашей медианы.", en: "A small step above your median." },
    personalized: true,
  }))
  return {
    version: "personal-progress-1",
    mode,
    intent,
    sample_size: 10,
    minimum_sample_size: 8,
    confidence: "MEDIUM",
    sources: [
      { kind: "INDEPENDENT_PROVIDER", count: 3 },
      { kind: "CLIENT_ATTESTED_GEP", count: 7 },
    ],
    board: { id: `board-${mode}`, status: "OFFERED", generation: 1 },
    goal: goals[0],
    alternatives: goals.slice(1),
    debrief: {
      match_id: "match-42",
      hero_id: 27,
      played_at: "2026-10-09T14:00:00Z",
      source: "CLIENT_ATTESTED_GEP",
      baseline_sample_size: 9,
      baseline_scope: "SAME_HERO",
      comparisons: [
        { metric: "player.kills", current: 11, median: 7, delta: 4, n: 9, improved: true },
        {
          metric: "player.healing",
          current: null,
          median: null,
          delta: null,
          n: 0,
          improved: false,
        },
      ],
      contracts: [
        {
          assignment_id: "done-1",
          title_i18n: { ru: "Связной", en: "Liaison" },
          status: "COMPLETED",
          reward_granted_xp: 30,
          explanation: null,
        },
      ],
      xp_granted: 30,
    },
    heroes: [
      {
        hero_id: 27,
        matches: 5,
        contracts_completed: 2,
        records: [{ metric: "player.assists", value: 14 }],
        sources: [{ kind: "CLIENT_ATTESTED_GEP", count: 5 }],
      },
    ],
    ...changes,
  }
}
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function runtime({ language = "ru", boardData = boards(), getProgress } = {}) {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: "https://qa.invalid/#home",
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
    if (url.startsWith("/api/personal-progress")) {
      const query = new URL(url, "https://qa.invalid").searchParams
      return getProgress
        ? getProgress(query.get("mode"), query.get("intent"), init)
        : response(progress(query.get("mode"), query.get("intent")))
    }
    if (url === "/api/board/today/lock") {
      const payload = JSON.parse(init.body)
      const board = boardData.boards.find((item) => item.game_match_mode === payload.mode)
      board.status = "LOCKED"
      board.locked_at = new Date().toISOString()
      board.options = board.options.map((option) => ({
        ...option,
        selected: payload.option_ids.includes(option.id),
        status: payload.option_ids.includes(option.id) ? "LOCKED" : "OFFERED",
      }))
      return response(board)
    }
    const body = url.startsWith("/api/announcements/active")
      ? { items: [], server_time: new Date().toISOString() }
      : url.startsWith("/api/public/hero-votes")
        ? { enabled: false }
        : url.startsWith("/api/boards/today")
          ? boardData
          : url.startsWith("/api/history")
            ? { cases: [], total: 0 }
            : url.startsWith("/api/progression")
              ? {
                  level: 2,
                  total_xp: 80,
                  level_xp: 20,
                  next_level_xp: 100,
                  xp_to_next: 80,
                  contracts_completed: 2,
                  contracts_failed: 0,
                  review_pending: 0,
                  progress_pct: 20,
                  mode_stats: {},
                  hardest_completed: null,
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
                        ? { user: session().user }
                        : null
    if (body === null) throw new Error(`Unexpected request ${url}`)
    return response(body)
  }
  w.eval(code)
  const api = w.ProgressUX
  api.rememberGuide("account-one")
  return { w, doc: w.document, api, calls }
}
const findButton = (element, text) =>
  [...element.querySelectorAll("button")].find((item) => item.textContent.includes(text))
function panel(doc) {
  const element = doc.querySelector(".personal-progress")
  assert.ok(element, "home should show the personal goal, debrief and hero panel")
  return element
}
async function mount(env) {
  let root
  await env.api.act(async () => {
    root = env.api.mountDashboard(env.doc.getElementById("mount"), session())
  })
  return root
}

// Removing the exact option handoff would open/sign a different contract.
test("personal goal leads the workspace and signs exactly one offered option through Dashboard", async () => {
  const env = runtime()
  const root = await mount(env)
  const p = panel(env.doc)
  assert.ok(
    p.compareDocumentPosition(env.doc.querySelector(".ritual-account-summary")) &
      env.w.Node.DOCUMENT_POSITION_FOLLOWING,
  )
  assert.match(p.textContent, /Цель STANDARD 0/)
  assert.match(p.textContent, /10/)
  await env.api.act(async () => findButton(p, "Выбрать цель").click())
  assert.equal(env.doc.querySelectorAll(".signing-terms li").length, 1)
  assert.match(env.doc.querySelector(".signing-terms").textContent, /Цель STANDARD 0/)
  await env.api.act(async () =>
    findButton(env.doc.querySelector(".signing-dialog"), "Поставить печать").click(),
  )
  const lock = env.calls.find(({ url }) => url === "/api/board/today/lock")
  assert.deepEqual(JSON.parse(lock.init.body), { option_ids: ["STANDARD-0"], mode: "STANDARD" })
  assert.equal(env.doc.querySelector(".signing-dialog").dataset.state, "signed")
  assert.match(env.doc.querySelector(".ritual-account-summary").textContent, /80 XP/)
  await env.api.act(async () => root.unmount())
})

// Wrong alternative IDs or accumulated draft IDs would sign extra conditions.
test("an alternative opens the existing signing dialog with its exact ID only", async () => {
  const env = runtime()
  const root = await mount(env)
  const p = panel(env.doc)
  await env.api.act(async () =>
    findButton(p.querySelector('[data-goal-id="STANDARD-2"]'), "Выбрать цель").click(),
  )
  assert.equal(env.doc.querySelectorAll(".signing-terms li").length, 1)
  assert.match(env.doc.querySelector(".signing-terms").textContent, /Цель STANDARD 2/)
  await env.api.act(async () =>
    findButton(env.doc.querySelector(".signing-dialog"), "Поставить печать").click(),
  )
  assert.deepEqual(
    JSON.parse(env.calls.find(({ url }) => url === "/api/board/today/lock").init.body),
    { option_ids: ["STANDARD-2"], mode: "STANDARD" },
  )
  await env.api.act(async () => root.unmount())
})

// A missing generation/ID/status guard permits stale recommendations to sign a fresh board.
for (const [label, change] of [
  ["generation", (value) => ({ ...value, board: { ...value.board, generation: 2 } })],
  ["board ID", (value) => ({ ...value, board: { ...value.board, id: "replaced-board" } })],
  ["unoffered option", (value) => ({ ...value, goal: { ...value.goal, option_id: "not-issued" } })],
])
  test(`stale ${label} cannot open signing and offers a board refresh`, async () => {
    const env = runtime({ getProgress: (mode, intent) => response(change(progress(mode, intent))) })
    const root = await mount(env)
    const p = panel(env.doc)
    const choose = findButton(p.querySelector(".progress-primary-goal"), "Выбрать цель")
    assert.ok(!choose || choose.disabled)
    assert.ok(findButton(p, "Обновить"))
    assert.match(p.textContent, /обнов|измени/i)
    assert.equal(env.doc.querySelector(".signing-dialog"), null)
    assert.equal(env.calls.filter(({ init }) => init.method === "POST").length, 0)
    await env.api.act(async () => root.unmount())
  })

// Allowing an intent or another goal on a locked board silently changes an active case.
for (const language of ["ru", "en"]) {
  for (const status of ["COMPLETED", "FAILED", "EXPIRED", "VOID"]) {
    test(`${language} terminal ${status} goal shows its factual state and opens debrief without signing`, async () => {
      const boardData = boards()
      Object.assign(boardData.boards[0], { status: "SETTLED", locked_at: new Date().toISOString() })
      Object.assign(boardData.boards[0].options[0], { status, selected: true })
      const env = runtime({
        language,
        boardData,
        getProgress: (mode, intent) => {
          const value = progress(mode, intent)
          value.debrief.contracts[0].status = status
          value.debrief.contracts[0].reward_granted_xp = status === "COMPLETED" ? 7 : 0
          value.debrief.xp_granted = status === "COMPLETED" ? 7 : 0
          return response({
            ...value,
            board: { ...value.board, status: "SETTLED" },
            goal: { ...value.goal, status },
            alternatives: [],
          })
        },
      })
      const root = await mount(env)
      const p = panel(env.doc)
      const card = p.querySelector(".progress-primary-goal")
      const labels =
        language === "ru"
          ? {
              COMPLETED: /Выполнено/,
              FAILED: /Цель не достигнута/,
              EXPIRED: /Срок истёк/,
              VOID: /Цель отменена/,
            }
          : {
              COMPLETED: /Completed/,
              FAILED: /Goal not achieved/,
              EXPIRED: /Expired/,
              VOID: /Goal voided/,
            }
      assert.match(card.querySelector(".progress-status").textContent, labels[status])
      assert.doesNotMatch(
        card.textContent,
        /Дождитесь результата|Await the match result|Goal is locked|Цель зафиксирована/,
      )
      assert.equal(
        card.querySelector(".progress-reward"),
        null,
        "terminal state must not imply the offered XP was awarded",
      )
      assert.equal(findButton(card, language === "ru" ? "Выбрать цель" : "Choose goal"), undefined)
      const action = findButton(card, language === "ru" ? "Разбор матча" : "Match debrief")
      assert.ok(action)
      await env.api.act(async () => action.click())
      assert.ok(p.querySelector(".progress-debrief"))
      assert.match(
        p.querySelector(".progress-contract-results .progress-status").textContent,
        labels[status],
      )
      assert.match(
        p.querySelector(".progress-debrief-footer strong").textContent,
        status === "COMPLETED" ? /\+7 XP/ : /\+0 XP/,
      )
      assert.equal(env.doc.querySelector(".signing-dialog"), null)
      assert.equal(env.calls.filter(({ init }) => init.method === "POST").length, 0)
      await env.api.act(async () => root.unmount())
    })
  }
}

test("a locked case shows its selected goal and disables changing intent or signing again", async () => {
  const boardData = boards()
  Object.assign(boardData.boards[0], { status: "LOCKED", locked_at: new Date().toISOString() })
  boardData.boards[0].options[1].selected = true
  boardData.boards[0].options[1].status = "LOCKED"
  const env = runtime({
    boardData,
    getProgress: (mode, intent) => {
      const value = progress(mode, intent)
      return response({
        ...value,
        board: { ...value.board, status: "LOCKED" },
        goal: { ...value.alternatives[0], status: "LOCKED" },
        alternatives: [],
      })
    },
  })
  const root = await mount(env)
  const p = panel(env.doc)
  assert.match(p.querySelector(".progress-primary-goal").textContent, /Цель STANDARD 1/)
  assert.ok([...p.querySelectorAll(".progress-intents button")].every((item) => item.disabled))
  assert.equal(findButton(p, "Выбрать цель"), undefined)
  assert.match(p.textContent, /зафиксирован/i)
  assert.ok(findButton(p, "Открыть дело"))
  await env.api.act(async () => findButton(p, "Открыть дело").click())
  assert.equal(env.w.location.hash, "#active")
  await env.api.act(async () => root.unmount())
})

// Converting absent data to zero or attributing client telemetry to a provider misleads the player.
for (const language of ["ru", "en"])
  test(`${language} debrief and hero dossier show factual prior comparisons, provenance and absent metrics`, async () => {
    const env = runtime({ language })
    const root = await mount(env)
    const p = panel(env.doc)
    assert.match(p.textContent, language === "ru" ? /медианы/ : /median/)
    await env.api.act(async () =>
      findButton(p, language === "ru" ? "Разбор матча" : "Match debrief").click(),
    )
    assert.match(p.textContent, /match-42/)
    assert.match(p.textContent, /Companion/)
    assert.match(p.textContent, language === "ru" ? /данные клиента/i : /client data/i)
    assert.match(p.textContent, /11/)
    assert.match(p.textContent, /7/)
    assert.match(p.textContent, /\+4/)
    assert.match(p.querySelector('[data-metric="player.kills"]').textContent, /n=9/)
    assert.match(p.textContent, language === "ru" ? /9 предыдущих/ : /9 prior/)
    const missing = p.querySelector('[data-metric="player.healing"]')
    assert.match(missing.textContent, language === "ru" ? /Нет данных/ : /No data/)
    assert.doesNotMatch(missing.textContent, /\b0\b/)
    await env.api.act(async () =>
      findButton(p, language === "ru" ? "Досье героев" : "Hero dossier").click(),
    )
    assert.match(p.textContent, /27/)
    assert.match(p.textContent, /14/)
    assert.match(p.textContent, language === "ru" ? /20.*матч/i : /20.*match/i)
    assert.doesNotMatch(
      p.querySelector(".progress-heroes").textContent,
      /Hero XP|XP героя|rank|ранг/i,
    )
    await env.api.act(async () => root.unmount())
  })

// Empty history must explain the baseline without displaying placeholder stats as real results.
test("cold start explains sample size and empty goal, debrief and hero states honestly", async () => {
  const env = runtime({
    getProgress: (mode, intent) =>
      response(
        progress(mode, intent, {
          sample_size: 0,
          confidence: "COLD_START",
          sources: [],
          board: null,
          goal: null,
          alternatives: [],
          debrief: null,
          heroes: [],
        }),
      ),
  })
  const root = await mount(env)
  const p = panel(env.doc)
  assert.match(p.textContent, /0.*8/)
  assert.match(p.textContent, /данных|матч/i)
  assert.equal(findButton(p, "Выбрать цель"), undefined)
  await env.api.act(async () => findButton(p, "Разбор матча").click())
  assert.match(p.textContent, /Нет.*матч|Пока.*матч/i)
  await env.api.act(async () => findButton(p, "Досье героев").click())
  assert.match(p.textContent, /Нет данных|Пока.*данн/i)
  await env.api.act(async () => root.unmount())
})

// Removing retry leaves the personal flow permanently broken after a transient server error.
test("failed progress request clears data and a retry recovers the personal goal", async () => {
  let failing = true
  const env = runtime({
    getProgress: (mode, intent) => (failing ? response({}, 503) : response(progress(mode, intent))),
  })
  const root = await mount(env)
  const p = panel(env.doc)
  assert.match(p.textContent, /Не удалось/i)
  assert.equal(p.querySelector(".progress-primary-goal"), null)
  failing = false
  await env.api.act(async () => findButton(p, "Повторить").click())
  assert.match(p.textContent, /Цель STANDARD 0/)
  const request = env.calls.find(({ url }) => url.startsWith("/api/personal-progress"))
  assert.equal(request.init.cache, "no-store")
  assert.equal(request.init.credentials, "same-origin")
  await env.api.act(async () => root.unmount())
})

// An old resolved promise must never replace the requested mode/intent, even when fetch ignores abort.
test("mode and intent changes abort previous requests and ignore out-of-order responses", async () => {
  const pending = []
  const env = runtime({
    getProgress: (mode, intent, init) => {
      const wait = deferred()
      pending.push({ mode, intent, init, ...wait })
      return wait.promise
    },
  })
  const root = await mount(env)
  const p = panel(env.doc)
  assert.match(p.textContent, /Загружаем/i)
  await env.api.act(async () =>
    findButton(p.querySelector(".progress-intents"), "Результат").click(),
  )
  const old = pending.at(-1)
  const select = p.querySelector("select")
  await env.api.act(async () => {
    select.value = "RANKED"
    select.dispatchEvent(new env.w.Event("change", { bubbles: true }))
  })
  const current = pending.at(-1)
  assert.equal(current.mode, "RANKED")
  assert.equal(current.intent, "RESULT")
  assert.equal(old.init.signal.aborted, true)
  await env.api.act(async () => current.resolve(response(progress("RANKED", "RESULT"))))
  assert.match(p.textContent, /Цель RANKED 0/)
  await env.api.act(async () => {
    for (const request of pending.filter((item) => item !== current))
      request.resolve(response(progress(request.mode, request.intent)))
  })
  assert.match(p.textContent, /Цель RANKED 0/)
  assert.doesNotMatch(p.textContent, /Цель STANDARD/)
  await env.api.act(async () => root.unmount())
})

// A body claiming another requested mode is stale even if the HTTP request itself succeeds.
test("a mismatched response cannot become a displayed or signable goal", async () => {
  const env = runtime({ getProgress: () => response(progress("RANKED", "RESULT")) })
  const root = await mount(env)
  const p = panel(env.doc)
  assert.equal(p.querySelector(".progress-primary-goal"), null)
  assert.match(p.textContent, /обнов|измени/i)
  assert.ok(findButton(p, "Повторить"))
  await env.api.act(async () => root.unmount())
})

// Keeping a prior read model after 401 would expose private results after session expiry.
test("401 removes previously loaded private goals, debrief and hero data", async () => {
  let authorized = true
  const env = runtime({
    getProgress: (mode, intent) =>
      authorized ? response(progress(mode, intent)) : response({}, 401),
  })
  const root = await mount(env)
  const p = panel(env.doc)
  assert.match(p.textContent, /Цель STANDARD 0/)
  authorized = false
  await env.api.act(async () => findButton(p, "Обновить").click())
  assert.doesNotMatch(p.textContent, /Цель STANDARD|match-42|Связной/)
  assert.equal(p.querySelector(".progress-primary-goal"), null)
  assert.match(p.textContent, /войти|сессия/i)
  await env.api.act(async () => root.unmount())
})

// A private request must follow the selected account, including the render before the new fetch completes.
test("changing account clears the old private read model while the new account is still loading", async () => {
  const later = deferred()
  let requests = 0
  const env = runtime({
    getProgress: (mode, intent) =>
      ++requests === 1 ? response(progress(mode, intent)) : later.promise,
  })
  const props = {
    accountId: "account-one",
    mode: "STANDARD",
    currentBoard: boards().boards[0],
    reloadKey: 1,
    onModeChange: () => {},
    onRecommend: () => true,
    onRefresh: async () => {},
  }
  let root
  await env.api.act(async () => {
    root = env.api.mountProgress(env.doc.getElementById("mount"), props)
  })
  const p = panel(env.doc)
  assert.match(p.textContent, /Цель STANDARD 0/)
  await env.api.act(async () => root.update({ ...props, accountId: "account-two" }))
  assert.equal(p.querySelector(".progress-primary-goal"), null)
  assert.doesNotMatch(p.textContent, /match-42|Связной|Цель STANDARD/)
  assert.match(p.textContent, /Загружаем/)
  await env.api.act(async () =>
    later.resolve(
      response(
        progress("STANDARD", "PRACTICE", {
          goal: null,
          alternatives: [],
          debrief: null,
          heroes: [],
          sources: [],
        }),
      ),
    ),
  )
  assert.equal(p.querySelector(".progress-primary-goal"), null)
  await env.api.act(async () => root.unmount())
})

// Exposing only the option ID to a caller loses the immutable board generation that signing must validate.
test("the real progress panel hands the exact mode, board ID, generation and option ID to signing", async () => {
  const env = runtime()
  const choices = []
  let root
  await env.api.act(async () => {
    root = env.api.mountProgress(env.doc.getElementById("mount"), {
      accountId: "account-one",
      mode: "STANDARD",
      currentBoard: boards().boards[0],
      reloadKey: 1,
      onModeChange: () => {},
      onRecommend: (choice) => {
        choices.push(JSON.parse(JSON.stringify(choice)))
        return true
      },
      onRefresh: async () => {},
    })
  })
  await env.api.act(async () =>
    findButton(panel(env.doc).querySelector(".progress-primary-goal"), "Выбрать цель").click(),
  )
  assert.deepEqual(choices, [
    { mode: "STANDARD", boardId: "board-STANDARD", generation: 1, optionId: "STANDARD-0" },
  ])
  await env.api.act(async () => root.unmount())
})

// A new offer received while reviewing the paper must abort the old signing selection before the lock endpoint.
test("a changed board discovered during signing never posts the stale recommended goal", async () => {
  const boardData = boards()
  const env = runtime({ boardData })
  const root = await mount(env)
  await env.api.act(async () =>
    findButton(panel(env.doc).querySelector(".progress-primary-goal"), "Выбрать цель").click(),
  )
  boardData.boards[0] = { ...boardData.boards[0], generation: 2 }
  await env.api.act(async () =>
    findButton(env.doc.querySelector(".signing-dialog"), "Поставить печать").click(),
  )
  assert.equal(env.calls.filter(({ url }) => url === "/api/board/today/lock").length, 0)
  assert.match(env.doc.querySelector(".signing-dialog").textContent, /измени|Обнов/i)
  await env.api.act(async () => root.unmount())
})

// A mode-only schema guard would admit a response for the wrong selected intent.
test("a response for another intent is discarded even in the requested mode", async () => {
  const env = runtime({ getProgress: (mode) => response(progress(mode, "VARIETY")) })
  const root = await mount(env)
  assert.equal(panel(env.doc).querySelector(".progress-primary-goal"), null)
  assert.match(panel(env.doc).textContent, /измени|обнов/i)
  await env.api.act(async () => root.unmount())
})

// Accepting structurally malformed private data would crash the entire dashboard instead of offering retry.
test("malformed source rows become a retryable response error", async () => {
  const env = runtime({
    getProgress: (mode, intent) => response(progress(mode, intent, { sources: [null] })),
  })
  let root
  await assert.doesNotReject(async () => {
    root = await mount(env)
  })
  const p = panel(env.doc)
  assert.equal(p.querySelector(".progress-primary-goal"), null)
  assert.ok(findButton(p, "Повторить"))
  await env.api.act(async () => root.unmount())
})

// Reporting first-match current facts must not substitute a zero baseline or imply a measured improvement.
test("first-match debrief keeps known current facts and an honest zero prior sample", async () => {
  const env = runtime({
    getProgress: (mode, intent) => {
      const value = progress(mode, intent)
      return response({
        ...value,
        sample_size: 1,
        confidence: "COLD_START",
        debrief: {
          ...value.debrief,
          baseline_sample_size: 0,
          baseline_scope: "NONE",
          comparisons: [
            {
              metric: "player.kills",
              current: 3,
              median: null,
              delta: null,
              n: 0,
              improved: false,
            },
          ],
        },
      })
    },
  })
  const root = await mount(env)
  const p = panel(env.doc)
  await env.api.act(async () => findButton(p, "Разбор матча").click())
  const row = p.querySelector('[data-metric="player.kills"]')
  assert.equal(row.querySelectorAll("td")[0].textContent, "3")
  assert.match(row.querySelectorAll("td")[1].textContent, /Нет данных.*n=0/)
  assert.equal(row.querySelectorAll("td")[2].textContent, "Нет данных")
  assert.equal(row.querySelector(".is-positive"), null)
  assert.match(p.querySelector("table caption").textContent, /предыдущих матчей/i)
  await env.api.act(async () => root.unmount())
})

// Keyboard navigation and translation must retain the selected factual view without re-requesting goals.
test("keyboard tabs and a RU to EN switch preserve the active debrief and its data", async () => {
  const env = runtime()
  const root = await mount(env)
  const p = panel(env.doc)
  const first = p.querySelector('[role="tab"]')
  first.focus()
  await env.api.act(async () =>
    first.dispatchEvent(new env.w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  )
  assert.equal(env.doc.activeElement.getAttribute("aria-selected"), "true")
  assert.match(p.querySelector('[role="tabpanel"]').textContent, /match-42/)
  const requests = env.calls.filter(({ url }) => url.startsWith("/api/personal-progress")).length
  await env.api.act(async () => {
    env.w.localStorage.setItem("dc.ui.language", "en")
    env.w.dispatchEvent(
      new env.w.StorageEvent("storage", { key: "dc.ui.language", newValue: "en" }),
    )
  })
  assert.equal(p.querySelector('[role="tab"][aria-selected="true"]').textContent, "Match debrief")
  assert.match(p.querySelector('[role="tabpanel"]').textContent, /match-42/)
  assert.equal(
    env.calls.filter(({ url }) => url.startsWith("/api/personal-progress")).length,
    requests,
  )
  await env.api.act(async () => root.unmount())
})
