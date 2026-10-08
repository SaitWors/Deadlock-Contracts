import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { JSDOM } from "jsdom"

// Run in the frontend CI job, which already installs the DOM test dependency.
const html = fs.readFileSync(new URL("../../companion/index.html", import.meta.url), "utf8")

function bootstrap(mode = "STANDARD") {
  const option = {
    id: "option-1",
    game_match_mode: mode,
    title_i18n: {
      en: '<img src=x onerror="window.injected=1"> Hold together',
      ru: '<img src=x onerror="window.injected=1"> Держим строй',
    },
    conditions: [{ metric: "player.assists", operator: "gte", target: 8 }],
    reward_xp: 50,
    status: "OFFERED",
  }
  return {
    api_version: "desktop.v1",
    schema_version: 2,
    server_time: "2026-10-08T12:00:00Z",
    desktop_features: ["adaptive_profiles_v1", "debrief_v1", "personal_progress_v1"],
    account: { display_name: "QA player", locale: "en" },
    active_cases: [],
    boards: [
      {
        id: "board-1",
        game_match_mode: mode,
        status: "OFFERED",
        generation: 1,
        max_attempts: 3,
        attempts_used: 0,
        attempts_remaining: 3,
        current_attempt: 1,
        options: [option],
      },
    ],
    progression: { total_xp: 250, level: 2, xp_to_next: 50 },
    history: {
      items: [
        {
          assignment_id: "assignment-1",
          board_id: "old-board",
          game_match_mode: mode,
          title_i18n: { ru: "Завершённое дело", en: "Completed case" },
          status: "COMPLETED",
          match_id: "100",
          reward_xp: 50,
          reward_granted_xp: 40,
          settled_at: "2026-10-08T11:00:00Z",
          conditions: [],
        },
      ],
    },
    personal_progress: {
      [mode]: {
        version: "personal-progress-1",
        mode,
        intent: "PRACTICE",
        sample_size: 9,
        minimum_sample_size: 8,
        confidence: "LOW",
        sources: [{ kind: "CLIENT_ATTESTED_GEP", count: 9 }],
        board: { id: "board-1", status: "OFFERED", generation: 1 },
        goal: {
          option_id: option.id,
          title_i18n: option.title_i18n,
          description_i18n: { en: "8 assists", ru: "8 помощей" },
          conditions: option.conditions,
          reward_xp: 50,
          status: "OFFERED",
          reason: {
            en: "<script>window.injected=1</script> Based on recent matches",
            ru: "<script>window.injected=1</script> По последним матчам",
          },
          basis: [],
          personalized: false,
        },
        alternatives: [],
        debrief: {
          match_id: "100",
          hero_id: 18,
          played_at: "2026-10-08T11:00:00Z",
          source: "CLIENT_ATTESTED_GEP",
          baseline_sample_size: 8,
          baseline_scope: "SAME_HERO",
          comparisons: [
            { metric: "player.assists", current: 9, median: 6, delta: 3, n: 8, improved: true },
          ],
          contracts: [],
          xp_granted: 999999,
        },
        heroes: [
          {
            hero_id: 18,
            matches: 9,
            contracts_completed: 1,
            records: [
              { metric: "player.assists", value: 9 },
              { metric: "player.deaths", value: 0 },
            ],
            sources: [{ kind: "CLIENT_ATTESTED_GEP", count: 9 }],
          },
        ],
      },
    },
  }
}

async function desktop(t, payload, lang = "en") {
  const dom = new JSDOM(html, {
    url: "https://companion.invalid/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  })
  t.after(() => dom.window.close())
  const window = dom.window
  for (const script of [
    "release-meta",
    "i18n",
    "schema",
    "progress",
    "storage",
    "shared",
    "product",
  ]) {
    window.eval(
      fs.readFileSync(new URL(`../../companion/src/${script}.js`, import.meta.url), "utf8"),
    )
  }
  window.DCI18n.setPreference(lang)
  let state = {
    paired: true,
    account: payload.account,
    game_running: false,
    health: { gep: { status: "NO_MATCH" } },
    product: window.DCProduct.normalizeBootstrap(payload),
  }
  let poll
  window.setInterval = (callback) => {
    poll = callback
    return 1
  }
  window.overwolf = {
    windows: {
      getMainWindow: () => ({ dcCompanion: { getSnapshot: async () => state } }),
      getCurrentWindow: (callback) => callback({ window: { id: "desktop" } }),
    },
  }
  window.eval(fs.readFileSync(new URL("../../companion/src/desktop.js", import.meta.url), "utf8"))
  await new Promise((resolve) => setImmediate(resolve))
  return {
    window,
    document: window.document,
    async update(changes) {
      state = { ...state, ...changes }
      poll()
      await new Promise((resolve) => setImmediate(resolve))
    },
    product() {
      return state.product
    },
  }
}

test("desktop renders prior-only comparison scope, source and factual hero records in RU and EN", async (t) => {
  for (const lang of ["ru", "en"]) {
    const app = await desktop(t, bootstrap(), lang)
    const comparisons = app.document.querySelector(".personal-comparisons")
    assert.ok(comparisons, "factual comparisons must be visible beside the contract verdict")
    assert.match(comparisons.textContent, lang === "ru" ? /Тот же герой/ : /Same hero/)
    assert.match(
      comparisons.textContent,
      lang === "ru" ? /Матч исключён из сравнения/ : /This match is excluded/,
    )
    assert.match(
      comparisons.textContent,
      lang === "ru"
        ? /Companion · без независимой проверки/
        : /Companion · not independently verified/,
    )
    assert.deepEqual(
      [...comparisons.querySelectorAll("tbody tr:first-child td")].map((cell) =>
        cell.textContent.trim(),
      ),
      ["9", "6", "+3", "8"],
    )
    const debrief = app.document.getElementById("debriefContent")
    assert.match(debrief.textContent, /\+40 XP/)
    assert.doesNotMatch(debrief.textContent, /999[,. ]?999|999999/)
    const dossier = app.document.querySelector("#adaptiveProfiles .hero-dossier")
    assert.ok(dossier)
    assert.match(dossier.textContent, lang === "ru" ? /Герой #18/ : /Hero #18/)
    assert.match(
      dossier.textContent,
      lang === "ru" ? /Последние 20 зачтённых матчей/ : /Last 20 scored matches/,
    )
    assert.match(
      dossier.textContent,
      lang === "ru" ? /Выполненные контракты/ : /Completed contracts/,
    )
    assert.doesNotMatch(dossier.textContent, /XP|MASTERY|COLD_START|CLIENT_ATTESTED_GEP/)
    assert.equal(
      dossier.querySelector('[data-personal-record="player.deaths"] b').textContent.trim(),
      "0",
    )
  }
})

test("next existing goal escapes server text and opens its mode without selecting or signing it", async (t) => {
  const app = await desktop(t, bootstrap("RANKED"))
  const goal = app.document.querySelector(".personal-next-goal")
  assert.ok(goal)
  assert.match(goal.textContent, /<img src=x onerror="window.injected=1">/)
  assert.match(goal.textContent, /<script>window.injected=1<\/script>/)
  assert.equal(goal.querySelectorAll("img, script").length, 0)
  goal.querySelector("button").click()
  assert.equal(
    app.document.querySelector('[data-view="contracts"]').classList.contains("active"),
    true,
  )
  assert.equal(
    app.document.querySelector('#modeTabs [data-mode="RANKED"]').getAttribute("aria-selected"),
    "true",
  )
  assert.ok(app.document.querySelector("#contractBoard [data-option-id]"))
  assert.equal(
    app.document.querySelector('#contractBoard [data-option-id][aria-pressed="true"]'),
    null,
  )
  assert.equal(app.window.injected, undefined)
})

test("cached and unpaired snapshots hide private progress instead of treating it as current", async (t) => {
  const app = await desktop(t, bootstrap())
  assert.ok(app.document.querySelector(".personal-comparisons"))
  const fresh = app.product()
  await app.update({ product: { ...fresh, status: "OFFLINE", stale: true } })
  assert.equal(app.document.querySelector(".personal-comparisons"), null)
  assert.equal(app.document.querySelector(".hero-dossier"), null)
  await app.update({ product: fresh, paired: false })
  assert.equal(app.document.querySelector(".personal-comparisons"), null)
  assert.equal(app.document.querySelector(".hero-dossier"), null)
})

test("debrief never attaches one match baseline to a different historical verdict", async (t) => {
  const payload = bootstrap()
  payload.personal_progress.STANDARD.debrief.match_id = "101"
  const app = await desktop(t, payload)
  assert.equal(app.document.querySelector(".personal-comparisons"), null)
  assert.match(app.document.getElementById("debriefContent").textContent, /MATCH #100/)
  assert.match(app.document.getElementById("debriefContent").textContent, /\+40 XP/)
})

test("a scored match without contract history still has a factual debrief and a cold-start explanation", async (t) => {
  const payload = bootstrap()
  payload.history.items = []
  payload.personal_progress.STANDARD.debrief.baseline_scope = "NONE"
  payload.personal_progress.STANDARD.debrief.baseline_sample_size = 0
  payload.personal_progress.STANDARD.debrief.comparisons = []
  payload.personal_progress.STANDARD.heroes[0].records = [{ metric: "player.assists", value: null }]
  const app = await desktop(t, payload)
  const comparisons = app.document.querySelector(".personal-comparisons")
  assert.ok(comparisons)
  assert.match(comparisons.textContent, /At least 8 prior matches/)
  assert.equal(comparisons.querySelector("table"), null)
  assert.equal(app.document.querySelector("[data-personal-record]"), null)
  assert.doesNotMatch(
    app.document.getElementById("debriefContent").textContent,
    /999[,. ]?999|999999/,
  )
})
