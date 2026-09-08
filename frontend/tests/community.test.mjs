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
      lib: { entry: "tests/community-entry.tsx", name: "CommunityTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => {
  for (const environment of environments) environment.window.close()
})
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
  w.scrollTo = () => {}
  w.localStorage.setItem("dc.ui.language", language)
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  w.eval(code)
  return { w, api: w.CommunityTest, doc: w.document }
}
const response = (data) => ({ ok: true, json: async () => data })
const row = (rank, name, score) => ({
  rank,
  slug: `agent-${rank}`,
  display_name: name,
  score,
  avatar_url: null,
  level: 2,
  contracts_completed: 3,
})
const achievement = {
  id: "first_case",
  title: { ru: "Первое дело", en: "First case" },
  description: { ru: "Завершите 1 контракт", en: "Complete 1 contract" },
  current: 1,
  target: 1,
  earned: true,
  earned_at: "2026-09-07T12:00:00Z",
}
const profile = () => ({
  slug: "profile-test",
  headline: "Ready for the next case",
  bio: "",
  theme: "DOSSIER",
  is_public: false,
  show_stats: false,
  show_showcase: true,
  show_links: false,
  show_achievements: true,
  show_bureau: false,
  links: {},
  public_url: null,
  showcase_order: ["contracts", "achievements", "bureau"],
  pinned_contract_ids: [],
  available_contracts: [],
  featured_achievement: "first_case",
  player: {
    display_name: "<img src=x onerror=alert(1)>",
    avatar_url: null,
    xp: 7777,
    level: 7,
    badges: [],
  },
  stats: { contracts_completed: 1, contracts_failed: 0, mode_stats: {} },
  showcase: [],
  achievements: [achievement],
  bureau: {
    slug: "private-bureau",
    name: "Deadlock Hidden Membership",
    member_count: 1,
    capacity: 25,
  },
})
function button(doc, text) {
  return [...doc.querySelectorAll("button")].find((item) => item.textContent.includes(text))
}

test("authenticated leaderboard shows own rank beyond the first 50 and keeps filter requests isolated", async () => {
  let resolveOld
  const calls = []
  const { doc, w, api } = runtime((url, init) => {
    calls.push({ url, init })
    if (url.includes("all_time"))
      return new Promise((resolve) => {
        resolveOld = resolve
      })
    return Promise.resolve(
      response({
        rows: [row(1, "Today leader", 4)],
        total: 106,
        generated_at: "2026-09-07T12:00:00Z",
        me: { row: row(106, "My position", 1), reason: null },
      }),
    )
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "leaderboard", { authenticated: true })
  })
  await api.act(async () => button(doc, "Today").click())
  assert.match(doc.body.textContent, /#106/)
  assert.match(doc.body.textContent, /My position/)
  assert.equal(calls[0].init.credentials, "same-origin")
  assert.match(calls[0].url, /^\/api\/leaderboard/)
  assert.equal(calls[0].init.signal.aborted, true)
  await api.act(async () =>
    resolveOld(
      response({
        rows: [row(1, "Stale leader", 9999)],
        total: 1,
        generated_at: "2026-09-07T12:00:00Z",
      }),
    ),
  )
  assert.doesNotMatch(doc.body.textContent, /Stale leader/)
  assert.match(doc.body.textContent, /Today leader/)
  await api.act(async () => root.unmount())
})

test("leaderboard errors can be retried and private players get a settings action", async () => {
  let calls = 0,
    opened = 0
  const { doc, api } = runtime(
    async () =>
      ++calls === 1
        ? { ok: false, status: 503, json: async () => ({ detail: "Try later" }) }
        : response({
            rows: [],
            total: 0,
            generated_at: "2026-09-07T12:00:00Z",
            me: { row: null, reason: "PRIVATE_PROFILE" },
          }),
    "en",
  )
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "leaderboard", {
      authenticated: true,
      onProfile: () => opened++,
    })
  })
  assert.match(doc.querySelector('[role="alert"]').textContent, /Try later/)
  await api.act(async () => button(doc, "Try again").click())
  await api.act(async () => button(doc, "Profile settings").click())
  assert.equal(opened, 1)
  assert.equal(calls, 2)
  await api.act(async () => root.unmount())
})

test("visitor preview honors privacy and profile save prevents duplicate posts", async () => {
  let posts = 0,
    completeSave,
    savedBody
  const value = profile()
  const { doc, w, api } = runtime(async (url, init) => {
    if (init.method === "PUT") {
      posts++
      savedBody = JSON.parse(init.body)
      return new Promise((resolve) => {
        completeSave = resolve
      })
    }
    return response({ profile: value })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "profile", {
      csrf: "csrf-fixture",
      onNotice() {},
      onError() {},
      onRefresh: async () => {},
      onBureau() {},
    })
  })
  assert.equal(doc.querySelector("h1 img"), null)
  assert.match(doc.body.textContent, /Deadlock Hidden Membership/)
  await api.act(async () => button(doc, "Preview as visitor").click())
  assert.doesNotMatch(doc.body.textContent, /Deadlock Hidden Membership/)
  assert.doesNotMatch(doc.body.textContent, /7,777/)
  assert.doesNotMatch(doc.body.textContent, /FEATURED SEAL/)
  await api.act(async () => button(doc, "Edit profile").click())
  const form = doc.querySelector(".profile-editor form")
  await api.act(async () => {
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
  })
  assert.equal(posts, 1)
  assert.equal(savedBody.is_public, false)
  assert.equal(savedBody.show_stats, false)
  assert.deepEqual(savedBody.showcase_order, ["contracts", "achievements", "bureau"])
  await api.act(async () => completeSave(response({ profile: value })))
  assert.equal(doc.querySelector(".profile-editor"), null)
  await api.act(async () => root.unmount())
})

test("earned achievement filter shows an honest empty state", async () => {
  const { doc, api } = runtime(
    async () =>
      response({
        items: [{ ...achievement, earned: false, earned_at: null, current: 0 }],
        earned: 0,
        total: 1,
      }),
    "en",
  )
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "achievements", { onProfile() {} })
  })
  assert.equal(doc.querySelector(".achievement-progress progress").value, 0)
  await api.act(async () => button(doc, "Earned").click())
  assert.equal(doc.querySelectorAll(".achievement-card").length, 0)
  assert.match(doc.body.textContent, /No awards here yet/)
  await api.act(async () => root.unmount())
})

test("bureau creation keeps errors in the form and can retry without losing entered fields", async () => {
  let posts = 0,
    destination
  const { doc, w, api } = runtime(async (url, init) => {
    if (init.method === "POST")
      return ++posts === 1
        ? { ok: false, status: 409, json: async () => ({ detail: "Address already taken" }) }
        : response({ bureau: { slug: "new-bureau" } })
    return response({ items: [], total: 0, my_bureau: null, pending_slugs: [] })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "bureaus", {
      csrf: "csrf-fixture",
      slug: "",
      onSelect: (slug) => {
        destination = slug
      },
    })
  })
  await api.act(async () => button(doc, "Found a bureau").click())
  const form = doc.querySelector(".bureau-editor")
  await api.act(async () =>
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })),
  )
  assert.match(doc.querySelector('[role="alert"]').textContent, /Address already taken/)
  assert.ok(doc.querySelector(".bureau-editor"))
  await api.act(async () =>
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })),
  )
  assert.equal(destination, "new-bureau")
  assert.equal(posts, 2)
  await api.act(async () => root.unmount())
})

test("operation creation sends fixed choices with CSRF and guards repeated submission", async () => {
  const posts = []
  let release
  const { doc, w, api } = runtime((url, init) => {
    if (init.method === "POST") {
      posts.push({ url, init })
      return new Promise((resolve) => {
        release = resolve
      })
    }
    return Promise.resolve(
      response({
        items: [],
        templates: {
          city_cases: {
            title: { ru: "Городское расследование", en: "City investigation" },
            target: 20,
            min_contributors: 3,
            category: null,
            metric: "contracts",
          },
        },
      }),
    )
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "operations", {
      slug: "night",
      csrf: "real-csrf",
      manager: true,
      director: true,
      frozen: false,
    })
  })
  const form = doc.querySelector("form")
  await api.act(async () => {
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
  })
  assert.equal(posts.length, 1)
  assert.deepEqual(JSON.parse(posts[0].init.body), { template: "city_cases", days: 7 })
  assert.equal(posts[0].init.headers.get("X-CSRF-Token"), "real-csrf")
  assert.equal(posts[0].url, "/api/bureaus/night/operations")
  await api.act(async () =>
    release({
      ok: false,
      status: 409,
      json: async () => ({ detail: "Another operation has started" }),
    }),
  )
  assert.match(doc.querySelector('[role="alert"]').textContent, /Another operation/)
  assert.ok(doc.querySelector("form"))
  await api.act(async () => root.unmount())
})

test("members see aggregate progress and their own journal without manager controls", async () => {
  const { doc, api } = runtime(
    async () =>
      response({
        templates: {},
        items: [
          {
            id: "op",
            template: "city_cases",
            title: { ru: "Городское расследование", en: "City investigation" },
            target: 20,
            min_contributors: 3,
            progress: 23,
            contributors: 4,
            my_contribution: 2,
            status: "COMPLETED",
            ends_at: "2026-09-09T00:00:00Z",
            checked_at: "2026-09-07T10:00:00Z",
            cancel_reason: "",
            journal: [
              { action: "REVOKE", at: "2026-09-07T09:00:00Z", contract_id: "private-case" },
            ],
          },
        ],
      }),
    "en",
  )
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "operations", {
      slug: "night",
      csrf: "csrf",
      manager: false,
      director: false,
      frozen: false,
    })
  })
  assert.equal(doc.querySelector("progress").value, 20)
  assert.match(doc.body.textContent, /23 \/ 20/)
  assert.match(doc.body.textContent, /Your contracts: 2/)
  assert.match(doc.body.textContent, /Credit revoked after review/)
  assert.match(doc.body.textContent, /team seal is available/)
  assert.equal(doc.querySelector("form"), null)
  await api.act(async () => root.unmount())
})

test("appeals expose eligible form choices and render private responses as text", async () => {
  const { doc, api } = runtime(
    async () =>
      response({
        items: [
          {
            id: "report",
            bureau_name: "Deadlock Night",
            bureau_slug: "night",
            kind: "BAN_APPEAL",
            status: "RESOLVED",
            message: "<img src=x onerror=alert(1)>",
            decision_note: "Your ban has been lifted",
          },
        ],
      }),
    "en",
  )
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "safety", {
      slug: "night",
      csrf: "csrf",
      banned: true,
      appeal: false,
    })
  })
  assert.ok(doc.querySelector('option[value="BAN_APPEAL"]'))
  assert.equal(doc.querySelector('option[value="BUREAU_APPEAL"]'), null)
  assert.match(doc.body.textContent, /Your ban has been lifted/)
  assert.match(doc.body.textContent, /<img src=x/)
  assert.equal(doc.querySelector("img"), null)
  await api.act(async () => root.unmount())
})

test("staff queue sends the report revision and preserves a stale decision for review", async () => {
  const posts = []
  const { doc, w, api } = runtime(async (url, init) => {
    if (init.method === "POST") {
      posts.push(JSON.parse(init.body))
      return {
        ok: false,
        status: 409,
        json: async () => ({ detail: "Обращение уже изменилось. Обновите очередь." }),
      }
    }
    return response({
      total: 1,
      items: [
        {
          id: "report",
          bureau_name: "Deadlock Night",
          kind: "CONTENT",
          message: "Review these rules",
          status: "OPEN",
          bureau_status: "ACTIVE",
          revision: 7,
          snapshot: { rules: "<script>secret()</script>" },
        },
      ],
    })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "moderation", { csrf: "staff-csrf" })
  })
  await api.act(async () => button(doc, "Рассмотреть").click())
  await api.act(async () =>
    doc
      .querySelector("form")
      .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })),
  )
  assert.equal(posts[0].revision, 7)
  assert.equal(posts[0].action, "DISMISS")
  assert.match(doc.querySelector('[role="alert"]').textContent, /Обновите очередь/)
  assert.ok(doc.querySelector("form"))
  assert.equal(doc.querySelector("script"), null)
  await api.act(async () => root.unmount())
})
