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
    level_xp: 65,
    next_level_xp: 250,
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

const bureauFixture = () => ({
  slug: "night",
  name: "Deadlock Night Office",
  tagline: "Your people",
  description: "Our story",
  rules: "Be kind",
  theme: "DOSSIER",
  language: "en",
  recruitment: "APPLICATION",
  member_count: 2,
  capacity: 25,
  status: "ACTIVE",
  my_role: "DIRECTOR",
  can_manage: true,
  can_edit: true,
  application_pending: false,
  design_revision: 4,
  listed: true,
  welcome: "Members only welcome",
  avatar_url: "/avatar.webp",
  cover_url: "/cover.webp",
  appearance: {
    accent: "SAGE",
    cover: "AURORA",
    emblem: "compass",
    avatar_shape: "ROUNDED",
    roster_layout: "CARDS",
    cover_position: 50,
  },
  role_titles: { DIRECTOR: "Archivist", MODERATOR: "", OPERATIVE: "" },
  members: [
    {
      id: "director",
      display_name: "Mandarin",
      avatar_url: null,
      profile_url: null,
      role: "DIRECTOR",
      is_me: true,
    },
    {
      id: "member",
      display_name: "<img src=x onerror=alert(1)>",
      avatar_url: null,
      profile_url: null,
      role: "OPERATIVE",
      is_me: false,
    },
  ],
  applications: [{ id: "application", display_name: "New player", message: "Hello" }],
  bans: [],
  journal: [],
})
function bureauReply(url, value) {
  if (url.includes("bureau-reports")) return { items: [] }
  if (url.includes("/operations")) return { items: [], templates: {} }
  if (url.startsWith("/api/bureaus?"))
    return { items: [value], total: 1, my_bureau: value.my_role ? value : null, pending_slugs: [] }
  return { bureau: value }
}
function fieldByLabel(doc, text) {
  return [...doc.querySelectorAll("label")]
    .find((label) => label.textContent.includes(text))
    ?.querySelector("input,textarea,select")
}
function inputValue(w, input, value) {
  const prototype =
    input.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value)
  input.dispatchEvent(new w.Event("input", { bubbles: true }))
}

test("bureau tabs reveal the roster, applications and operations while preserving real roles", async () => {
  const value = bureauFixture(),
    requests = []
  const { doc, w, api } = runtime(async (url, init) => {
    requests.push({ url, init })
    return response(bureauReply(url, value))
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "bureaus", {
      slug: "night",
      csrf: "csrf",
      onSelect() {},
    })
  })
  assert.equal(doc.querySelector('.guild-tabs button[aria-pressed="true"]').textContent, "About")
  assert.match(doc.querySelector(".guild-welcome").textContent, /Members only/)
  assert.match(doc.querySelector(".guild-custom-rank").textContent, /Archivist/)
  assert.match(doc.querySelector(".guild-role").textContent, /Director/)
  assert.equal(doc.querySelector(".guild-members img"), null)
  await api.act(async () => button(doc.querySelector(".guild-tabs"), "Members").click())
  assert.equal(doc.querySelector(".guild-roster-panel").hidden, false)
  const action = doc.querySelector('select[aria-label^="Member action"]')
  assert.ok([...action.options].some((option) => option.value === "PROMOTE"))
  await api.act(async () => {
    action.value = "PROMOTE"
    action.dispatchEvent(new w.Event("change", { bubbles: true }))
  })
  assert.match(doc.querySelector(".bureau-action-panel").textContent, /Make moderator/)
  await api.act(async () => button(doc.querySelector(".guild-tabs"), "Applications").click())
  assert.equal(doc.querySelector(".guild-roster-panel").hidden, true)
  assert.match(doc.querySelector(".bureau-application").textContent, /New player/)
  await api.act(async () => button(doc.querySelector(".guild-tabs"), "Operations").click())
  assert.ok(requests.some(({ url }) => url === "/api/bureaus/night/operations"))
  await api.act(async () => root.unmount())
})

test("bureau customization previews changes, sends revision and CSRF once, and preserves a failed draft", async () => {
  const value = bureauFixture(),
    writes = []
  let complete
  const { doc, w, api } = runtime((url, init) => {
    if (init.method === "PUT") {
      writes.push({ url, init })
      return new Promise((resolve) => {
        complete = resolve
      })
    }
    return Promise.resolve(response(bureauReply(url, value)))
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "bureaus", {
      slug: "night",
      csrf: "csrf-fixture",
      onSelect() {},
    })
  })
  await api.act(async () => button(doc, "Bureau settings").click())
  await api.act(async () => button(doc.querySelector(".guild-settings-nav"), "Appearance").click())
  await api.act(async () => {
    button(doc.querySelector(".guild-swatches"), "Plum").click()
    button(doc.querySelector(".guild-emblem-options"), "Feather").click()
  })
  assert.ok(doc.querySelector(".guild-preview .accent-plum"))
  assert.ok(doc.querySelector('.guild-preview [data-icon="feather"]'))
  await api.act(async () => button(doc.querySelector(".guild-settings-nav"), "Rank names").click())
  await api.act(async () => inputValue(w, fieldByLabel(doc, "Director"), "<script>owner</script>"))
  await api.act(async () => button(doc.querySelector(".guild-settings-nav"), "Admission").click())
  await api.act(async () => {
    fieldByLabel(doc, "Show bureau in the directory").click()
    inputValue(w, fieldByLabel(doc, "Welcome message"), "New member note")
  })
  const form = doc.querySelector(".guild-editor")
  await api.act(async () => {
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
  })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].url, "/api/bureaus/night/customization")
  assert.equal(writes[0].init.headers.get("X-CSRF-Token"), "csrf-fixture")
  const payload = JSON.parse(writes[0].init.body)
  assert.equal(payload.expected_revision, 4)
  assert.equal(payload.appearance.accent, "PLUM")
  assert.equal(payload.appearance.emblem, "feather")
  assert.equal(payload.role_titles.DIRECTOR, "<script>owner</script>")
  assert.equal(payload.listed, false)
  assert.equal(payload.welcome, "New member note")
  assert.equal(payload.slug, undefined)
  assert.equal(payload.avatar_url, undefined)
  assert.equal(payload.avatar_image, undefined)
  await api.act(async () =>
    complete({
      ok: false,
      status: 409,
      json: async () => ({ detail: "Settings changed; reload before saving" }),
    }),
  )
  assert.match(doc.querySelector('[role="alert"]').textContent, /Settings changed/)
  assert.equal(fieldByLabel(doc, "Welcome message").value, "New member note")
  assert.ok(doc.querySelector(".guild-editor"))
  await api.act(async () => root.unmount())
})

test("removing bureau media sends explicit clears and a successful save renders returned branding", async () => {
  const value = bureauFixture()
  let body
  const { doc, w, api } = runtime(async (url, init) => {
    if (init.method === "PUT") {
      body = JSON.parse(init.body)
      Object.assign(value, {
        avatar_url: null,
        cover_url: null,
        appearance: body.appearance,
        design_revision: 5,
      })
      return response({ bureau: value })
    }
    return response(bureauReply(url, value))
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "bureaus", {
      slug: "night",
      csrf: "csrf",
      onSelect() {},
    })
  })
  await api.act(async () => button(doc, "Bureau settings").click())
  await api.act(async () => button(doc.querySelector(".guild-settings-nav"), "Appearance").click())
  for (const upload of doc.querySelectorAll(".guild-upload"))
    await api.act(async () => button(upload, "Remove image").click())
  assert.equal(doc.querySelector(".guild-preview img"), null)
  await api.act(async () =>
    doc
      .querySelector(".guild-editor")
      .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })),
  )
  assert.equal(body.avatar_image, "")
  assert.equal(body.cover_image, "")
  assert.equal(doc.querySelector(".guild-editor"), null)
  assert.equal(doc.querySelector(".guild-hero img"), null)
  assert.match(doc.querySelector('[role="status"]').textContent, /Changes saved/)
  await api.act(async () => root.unmount())
})

test("bureau visitor sees no management controls or private welcome and must accept rules to join", async () => {
  const value = {
    ...bureauFixture(),
    my_role: null,
    can_manage: false,
    can_edit: false,
    welcome: "",
    applications: [],
    members: [
      {
        id: null,
        display_name: null,
        avatar_url: null,
        profile_url: null,
        role: "DIRECTOR",
        is_me: false,
      },
    ],
  }
  const writes = []
  const { doc, api } = runtime(async (url, init) => {
    if (init.method === "POST") writes.push({ url, body: JSON.parse(init.body) })
    return response(bureauReply(url, value))
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "bureaus", {
      slug: "night",
      csrf: "csrf",
      onSelect() {},
    })
  })
  assert.equal(doc.querySelector(".guild-welcome"), null)
  assert.equal(button(doc, "Bureau settings"), undefined)
  assert.equal(button(doc.querySelector(".guild-tabs"), "Applications"), undefined)
  assert.equal(button(doc, "Send application").disabled, true)
  await api.act(async () => fieldByLabel(doc, "I agree to the bureau rules").click())
  assert.equal(button(doc, "Send application").disabled, false)
  await api.act(async () => button(doc, "Send application").click())
  assert.equal(writes.length, 1)
  assert.equal(writes[0].url, "/api/bureaus/night/join")
  assert.equal(writes[0].body.agree_rules, true)
  await api.act(async () => root.unmount())
})

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
  const value = {
    ...profile(),
    show_cards: false,
    cards: [{ id: "card-1", rank: "EX", title: "Hidden portrait", hero_name: "Haze" }],
  }
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
      onBureau() {},
      onCollection() {},
      progression: {
        level: 8,
        total_xp: 8115,
        level_xp: 17,
        next_level_xp: 350,
        contracts_completed: 3,
        contracts_failed: 0,
        mode_stats: {},
      },
    })
  })
  assert.equal(doc.querySelector("h1 img"), null)
  assert.match(doc.body.textContent, /Deadlock Hidden Membership/)
  assert.equal(doc.querySelector(".dossier-level progress").value, 17)
  assert.equal(doc.querySelector(".dossier-level progress").max, 350)
  assert.equal(doc.querySelector(".dossier-sidebar dd").textContent, "3")
  assert.match(doc.body.textContent, /8,115 XP/)
  assert.match(doc.body.textContent, /Hidden from visitors/)
  assert.match(doc.querySelector(".dossier-card-showcase").textContent, /Hidden portrait/)
  await api.act(async () => button(doc, "Preview as visitor").click())
  assert.doesNotMatch(doc.body.textContent, /Deadlock Hidden Membership/)
  assert.doesNotMatch(doc.body.textContent, /8,115/)
  assert.equal(doc.querySelector(".dossier-card-showcase"), null)
  assert.doesNotMatch(doc.body.textContent, /Featured seal/i)
  assert.equal(doc.querySelector(".dossier-level progress"), null)
  await api.act(async () => button(doc, "Back to profile").click())
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

test("profile draft survives locale change, guest preview and a rejected save", async () => {
  const value = { ...profile(), is_public: true, public_url: "/u/profile-test" }
  const { doc, w, api } = runtime(async (_url, init) => {
    if (init.method === "PUT") {
      return { ok: false, status: 422, json: async () => ({ detail: "Адрес уже занят" }) }
    }
    return response({ profile: value })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "profile", {
      csrf: "csrf-fixture",
      onNotice() {},
      onBureau() {},
    })
  })
  await api.act(async () => button(doc, "Share").click())
  assert.equal(fieldByLabel(doc, "Profile link").value, "https://qa.invalid/u/profile-test")
  await api.act(async () => button(doc, "Edit profile").click())
  const editedHeadline = "My unsaved profile headline"
  await api.act(async () => inputValue(w, fieldByLabel(doc, "Headline"), editedHeadline))
  await api.act(async () => {
    w.localStorage.setItem("dc.ui.language", "ru")
    w.dispatchEvent(new w.StorageEvent("storage", { key: "dc.ui.language" }))
  })
  assert.equal(fieldByLabel(doc, "Коротко о себе").value, editedHeadline)
  await api.act(async () => button(doc, "Вид для гостя").click())
  assert.match(doc.querySelector(".dossier-identity").textContent, /My unsaved profile headline/)
  assert.equal(button(doc, "Поделиться"), undefined)
  await api.act(async () => button(doc, "Вернуться к редактированию").click())
  assert.equal(fieldByLabel(doc, "Коротко о себе").value, editedHeadline)
  const form = doc.querySelector(".profile-editor form")
  await api.act(async () => {
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
  })
  assert.equal(doc.querySelector(".profile-editor [role=alert]").textContent, "Адрес уже занят")
  assert.equal(fieldByLabel(doc, "Коротко о себе").value, editedHeadline)
  await api.act(async () => button(doc, "Отмена").click())
  assert.match(doc.querySelector(".dossier-identity").textContent, /Ready for the next case/)
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

test("public dossier shows collectibles without Arena showcase requests or links", async () => {
  const calls = []
  const { api, doc } = runtime(async (url) => {
    calls.push(String(url))
    return String(url).includes("/arena/")
      ? response({ showcase: null })
      : response({ profile: profile() })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "publicDossier", { slug: "profile-test" })
  })
  assert.ok(doc.querySelector(".dossier-identity"))
  assert.equal(
    calls.some((url) => url.includes("/arena/")),
    false,
  )
  assert.equal(doc.querySelector('a[href*="#arena"]'), null)
  await api.act(async () => root.unmount())
})
