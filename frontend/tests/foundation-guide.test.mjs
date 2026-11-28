import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, test } from "node:test"
import { JSDOM } from "jsdom"
import { build } from "vite"
import { onboardingStage } from "../src/foundation/onboarding.ts"

const guideCopy = JSON.parse(
  readFileSync(new URL("../src/foundation/guide-copy.json", import.meta.url), "utf8"),
)

const now = Date.parse("2026-11-28T12:00:00Z")
const fresh = {
  createdAt: "2026-11-28T11:00:00Z",
  signed: false,
  verified: false,
  openedDailyPack: false,
  visitedBoard: false,
  visitedProfile: false,
  visitedCollection: false,
}

test("onboarding uses server facts and keeps steps in journey order", () => {
  assert.equal(onboardingStage(fresh, "new", now), "mode")
  assert.equal(onboardingStage({ ...fresh, visitedBoard: true }, "started", now), "sign")
  assert.equal(onboardingStage({ ...fresh, signed: true }, "started", now), "result")
  assert.equal(onboardingStage({ ...fresh, signed: true, verified: true }, "started", now), "pack")
  const withPack = { ...fresh, signed: true, verified: true, openedDailyPack: true }
  assert.equal(onboardingStage(withPack, "started", now), "profile")
  assert.equal(onboardingStage({ ...withPack, visitedProfile: true }, "started", now), "collection")
  assert.equal(
    onboardingStage({ ...withPack, visitedProfile: true, visitedCollection: true }, "started", now),
    "done",
  )
})

test("existing accounts, unresolved facts, and skipped onboarding do not show a novice step", () => {
  assert.equal(onboardingStage({ ...fresh, createdAt: "2025-11-27" }, "new", now), null)
  assert.equal(onboardingStage({ ...fresh, createdAt: null }, "new", now), null)
  assert.equal(onboardingStage({ ...fresh, signed: null }, "new", now), null)
  assert.equal(onboardingStage(fresh, "skipped", now), null)
  assert.equal(onboardingStage(fresh, "hidden", now), null)
})

test("a started briefing can resume later, including past the new-account window", () => {
  const returning = { ...fresh, signed: true, createdAt: "2026-11-20T12:00:00Z" }
  assert.equal(onboardingStage(returning, "new", now), null)
  assert.equal(onboardingStage(returning, "started", now), "result")
  assert.equal(onboardingStage(returning, "paused", now), null)
})

let journeyCode
const windows = []
before(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    define: { "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      lib: {
        entry: "tests/foundation-journey-entry.tsx",
        name: "FoundationJourney",
        formats: ["iife"],
      },
    },
  })
  journeyCode = result[0].output.find((item) => item.type === "chunk").code
})
after(() => windows.forEach((window) => window.close()))

function browser(language, guideFailures = 0) {
  const { window } = new JSDOM('<main id="app"></main>', {
    url: `https://test.invalid/${language}/how-it-works`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  })
  windows.push(window)
  window.localStorage.setItem("dc.ui.language", language)
  window.IS_REACT_ACT_ENVIRONMENT = true
  window.Headers = Headers
  window.fetch = async (url) => {
    assert.match(url, /guide-copy.*\.json/)
    if (guideFailures-- > 0) return { ok: false, status: 503, json: async () => ({}) }
    return { ok: true, json: async () => guideCopy }
  }
  window.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => window.setTimeout(() => this.port1.onmessage?.(), 0) }
  }
  window.eval(journeyCode)
  return { window, document: window.document, api: window.FoundationJourney }
}

test("the guide keeps navigation usable and retries unavailable copy", async () => {
  const { document, api } = browser("en", 1)
  let app
  await api.act(async () => {
    app = api.mountGuide(document.getElementById("app"), {})
  })
  assert.equal(document.querySelector(".guide-hero a").pathname, "/en/contracts")
  assert.match(
    document.querySelector(".foundation-guide [role=alert]").textContent,
    /Could not load/,
  )
  await api.act(async () => document.querySelector(".foundation-guide [role=alert] button").click())
  assert.equal(document.querySelectorAll(".guide-journey li").length, 6)
  await api.act(async () => app.unmount())
})

for (const language of ["ru", "en"]) {
  test(`${language}: the guide provides the real workflow, a support link and optional navigation`, async () => {
    const { document, api } = browser(language)
    const navigations = []
    let app
    await api.act(async () => {
      app = api.mountGuide(document.getElementById("app"), {
        onNavigate: (section) => navigations.push(section),
      })
    })
    assert.equal(document.querySelectorAll(".guide-journey > li").length, 6)
    assert.equal(document.querySelectorAll(".guide-faq details").length, 10)
    assert.equal(document.querySelector(".guide-faq a").pathname, `/${language}/support`)
    assert.equal(
      document.querySelector("h1").textContent,
      language === "ru" ? "Как это работает" : "How it works",
    )
    await api.act(async () => document.querySelector(".guide-hero button").click())
    assert.deepEqual(navigations, ["quests"])
    await api.act(async () => app.unmount())
  })
}

test("optional onboarding can be skipped, status labels are contextual and selected chips can be removed", async () => {
  const { document, window, api } = browser("en")
  const actions = []
  let app
  await api.act(async () => {
    app = api.mountJourney(
      document.getElementById("app"),
      {
        accountId: "new-account",
        csrf: "",
        facts: { ...fresh, createdAt: new Date(Date.now() - 5000).toISOString() },
        onNavigate: (section) => actions.push(section),
        onHelp: () => actions.push("help"),
      },
      {
        active: "active",
        badges: { active: "Case in progress", packs: "Daily pack available" },
        onNavigate: (section) => actions.push(section),
      },
      {
        items: [{ id: "a", title: "A long contract title" }],
        onRemove: (id) => actions.push(id),
      },
    )
  })
  assert.equal(
    document.querySelector(".foundation-onboarding h2").textContent,
    "Choose a game mode",
  )
  assert.equal(
    document.querySelector(".dc-mobile-bottom-nav [aria-current=location] .sr-only").textContent,
    "Case in progress",
  )
  assert.equal(document.querySelectorAll(".dc-mobile-bottom-nav .bureau-nav-status").length, 2)
  assert.match(
    document.querySelector(".dc-motion-selected-pills button").getAttribute("aria-label"),
    /A long contract title/,
  )
  await api.act(async () => document.querySelector(".dc-motion-selected-pills button").click())
  assert.deepEqual(actions, ["a"])
  await api.act(async () => {
    const skip = [...document.querySelectorAll(".foundation-onboarding button")].find(
      (button) => button.textContent === "Skip",
    )
    skip.click()
  })
  assert.equal(document.querySelector(".foundation-onboarding"), null)
  assert.equal(window.localStorage.getItem("dc.bureau.guide.v2.new-account"), "skipped")
  await api.act(async () => app.unmount())
})
