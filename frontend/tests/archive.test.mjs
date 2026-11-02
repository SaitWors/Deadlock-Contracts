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
function runtime(fetch, language = "ru", reducedMotion = false) {
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
  const motionListeners = new Set()
  const media = {
    matches: reducedMotion,
    addEventListener: (_, listener) => motionListeners.add(listener),
    removeEventListener: (_, listener) => motionListeners.delete(listener),
  }
  w.matchMedia = () => media
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
    this.dispatchEvent(new w.Event("close"))
  }
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.localStorage.setItem("dc.ui.language", language)
  w.eval(code)
  return {
    w,
    api: w.ArchiveTest,
    doc: w.document,
    setReducedMotion(value) {
      media.matches = value
      motionListeners.forEach((listener) => listener({ matches: value }))
    },
  }
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
  can_manage_packs: false,
  account_key: "test-account",
  direct_costs: { F: 20, E: 30, D: 45, C: 70, B: 110, A: 180, S: 300, SS: 500, SSS: 900 },
  default_weights: { F: 2000, E: 1600, D: 1200, C: 900, B: 600, A: 350, S: 150, SS: 60, SSS: 15 },
}
const coinStatus = {
  policy_version: "coins-v1",
  enabled: true,
  quotas: {
    daily: { limit: 80, used: 75, remaining: 5, reset_at: "2026-10-13T00:00:00Z" },
    weekly: { limit: 400, used: 375, remaining: 25, reset_at: "2026-10-19T00:00:00Z" },
  },
  receipts: [
    {
      id: "coin-earned",
      source_type: "assignment",
      source_id: "contract-1",
      nominal_amount: 24,
      amount: 5,
      reason: "DAILY_LIMIT",
      status: "DELIVERED",
      created_at: "2026-10-12T12:00:00Z",
    },
    {
      id: "coin-pending",
      source_type: "case",
      source_id: "case-1",
      nominal_amount: 10,
      amount: 10,
      reason: "AWARDED",
      status: "RESERVED",
      created_at: "2026-10-12T12:01:00Z",
    },
  ],
}

test("an EX base receipt uses the wide base frame and explains a forced pack rank", async () => {
  const env = runtime(async () => response({ items: [], total: 0 }), "en")
  let root
  await env.api.act(async () => {
    root = env.api.mount(env.doc.getElementById("mount"), "receipt", {
      receipt: {
        id: "ex",
        kind: "DIRECT_CARD",
        delta: -1800,
        balance_after: 0,
        created_at: "2026-10-12T00:00:00Z",
        items: [
          {
            id: "base-instance",
            card: {
              id: "ex-card",
              hero: "hidden_king",
              hero_name: "Hidden King",
              rank: "EX",
              category: "BASE",
              title: "Court of shadows",
              image_url: null,
              crop_x: 50,
              crop_y: 50,
              zoom: 1,
            },
            duplicate: false,
            test_grant: false,
            recycle_value: 0,
            forced: true,
            natural_rank: "F",
            guaranteed_minimum_rank: "SSS",
          },
        ],
      },
    })
  })
  assert.equal(env.doc.querySelector(".archive-card").dataset.category, "BASE")
  assert.match(env.doc.body.textContent, /Guaranteed rank/)
  await env.api.act(() => root.unmount())
})
test("only effective OWNER sees arena tools and links matching published artwork with an explicit approval", async () => {
  const writes = [],
    definition = {
      id: "definition-1",
      key: "abrams",
      category: "HERO",
      version: 1,
      approved: true,
      rules: { name: "Abrams" },
    },
    card = {
      id: "card-1",
      hero: "abrams",
      hero_name: "Abrams",
      rank: "F",
      title: "Published Abrams",
      image_url: null,
      crop_x: 50,
      crop_y: 50,
      zoom: 1,
      status: "PUBLISHED",
    }
  const env = runtime(async (url, init = {}) => {
    if (init.method === "PUT") {
      writes.push({ url, body: JSON.parse(init.body) })
      return response({ approved: true })
    }
    if (url.includes("/definitions")) return response({ definitions: [definition] })
    if (url.includes("/meta")) return response(meta)
    if (url.includes("/cards")) return response({ items: [card], total: 1 })
    return response({ items: [], total: 0 })
  }, "en")
  let root
  await env.api.act(async () => {
    root = env.api.mount(env.doc.getElementById("mount"), "owner", {
      csrf: "csrf",
      permissions: ["packs.manage"],
      isOwner: false,
    })
  })
  assert.doesNotMatch(env.doc.body.textContent, /Arena owner tools/)
  await env.api.act(async () =>
    root.rerender({ csrf: "csrf", permissions: ["packs.manage"], isOwner: true }),
  )
  assert.match(env.doc.body.textContent, /Arena owner tools/)
  const button = [...env.doc.querySelectorAll("button")].find(
    (item) => item.textContent === "Approve battle artwork",
  )
  assert.ok(button)
  await env.api.act(async () => button.click())
  assert.deepEqual(writes[0], {
    url: "/api/arena/artwork-approval",
    body: { card_id: "card-1", definition_id: "definition-1", approved: true },
  })
  await env.api.act(() => root.unmount())
})

test("owner self grants only sandbox cards and never exposes currency controls or receipts", async () => {
  const writes = []
  const { api, doc, w } = runtime(async (url, init = {}) => {
    if (init.method === "POST") {
      writes.push({ url, body: JSON.parse(init.body), csrf: init.headers.get("X-CSRF-Token") })
      return response({
        ...packReceipt("owner-card", [
          receiptItem("owner-copy", "Sandbox Abrams", "F", false, true),
        ]),
        kind: "OWNER_CARD",
        scope: "SANDBOX",
      })
    }
    if (url.includes("/meta")) return response({ ...meta, can_manage_packs: true })
    if (url.includes("/archive/cards?"))
      return response({ items: [{ ...card, status: "PUBLISHED" }], total: 1 })
    return response({ items: [], total: 0 })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "owner", {
      csrf: "grant-csrf",
      permissions: ["packs.manage"],
    })
  })
  assert.doesNotMatch(doc.body.textContent, /coins|balance|real adjustment|token refund/i)
  assert.equal(doc.querySelector('[aria-label="Grant scope"]'), null)
  const reason = [...doc.querySelectorAll("input")].find((input) => input.maxLength === 300)
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set
  await api.act(async () => {
    set.call(reason, "Artwork review")
    reason.dispatchEvent(new w.Event("input", { bubbles: true }))
  })
  await api.act(async () => button(doc, "Select").click())
  await api.act(async () => button(doc, "Grant myself 1 copies").click())
  assert.equal(writes.length, 1)
  assert.equal(writes[0].url, `/api/owner/archive/cards/${card.id}/grant`)
  assert.equal(writes[0].body.scope, "SANDBOX")
  assert.equal(writes[0].body.quantity, 1)
  assert.equal(writes[0].body.note, "Artwork review")
  assert.equal(writes[0].csrf, "grant-csrf")
  assert.ok(writes[0].body.request_key)
  assert.doesNotMatch(doc.body.textContent, /coins|balance|real economy/i)
  assert.ok(button(doc, "Reveal cards"))
  await api.act(async () => root.unmount())
})

test("owner edits published pack contents and odds without currency or starter controls", async () => {
  const writes = []
  const pack = {
    id: "owner-pack",
    title: "Daily release",
    description: "Hero collection",
    revision: 9,
    price: 175,
    draws: 2,
    starter: true,
    active: true,
    ready: true,
    odds: [{ rank: "F", percent: 100 }],
    entries: [
      {
        card_id: "draft-1",
        card: { ...card, status: "PUBLISHED" },
        rank: "F",
        weight: 10,
        percent: 100,
      },
    ],
  }
  const { api, doc, w } = runtime(async (url, init = {}) => {
    if (init.method === "PUT") {
      writes.push({ url, body: JSON.parse(init.body) })
      return response({ pack })
    }
    if (url.includes("/preview"))
      return response({
        odds: pack.odds,
        recommendation: { price: 90, expected_direct_cost: 180, weeks_at_150: 0.6 },
      })
    if (url.includes("/meta")) return response(meta)
    if (url.includes("/api/archive/packs/")) return response({ pack })
    if (url.includes("/api/owner/archive/packs")) return response({ items: [pack], total: 1 })
    return response({ items: [], total: 0 })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "owner", {
      csrf: "pack-csrf",
      permissions: ["packs.manage"],
    })
  })
  assert.doesNotMatch(doc.body.textContent, /coins|contents & price/i)
  await api.act(async () => button(doc, "Edit contents").click())
  await api.act(async () => new Promise((resolve) => w.setTimeout(resolve, 520)))
  assert.doesNotMatch(doc.body.textContent, /coin|price|starter|discount|cipher|balance/i)
  assert.match(doc.body.textContent, /100%/)
  const title = doc.querySelector('.archive-form input[maxlength="80"]')
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set
  await api.act(async () => {
    set.call(title, "Updated release")
    title.dispatchEvent(new w.Event("input", { bubbles: true }))
  })
  await api.act(async () => {
    const weight = doc.querySelector('.archive-selected-pool input[type="number"]')
    set.call(weight, "20")
    weight.dispatchEvent(new w.Event("input", { bubbles: true }))
    doc.querySelector('.archive-form input[type="checkbox"]').click()
  })
  await api.act(async () =>
    doc
      .querySelector("form.archive-form")
      .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })),
  )
  assert.equal(writes[0].body.title, "Updated release")
  assert.equal(writes[0].body.revision, 9)
  assert.equal(writes[0].body.price, 175)
  assert.equal(writes[0].body.starter, true)
  assert.deepEqual(writes[0].body.entries, [{ card_id: "draft-1", weight: 20 }])
  assert.equal(writes[0].body.active, false)
  await api.act(async () => root.unmount())
})

test("contract receipt distinguishes rejected historical results from pending rewards", async () => {
  const { api, doc } = runtime(async () => response({}), "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "coinReward", {
      reward: {
        source_type: "assignment",
        source_id: "old",
        nominal_amount: 0,
        amount: 0,
        reason: "NO_SIGNED_POLICY",
        status: "REJECTED",
      },
    })
  })
  assert.match(
    doc.getElementById("mount").textContent,
    /No coin reward.*Before coin rewards launched/,
  )
  assert.doesNotMatch(doc.getElementById("mount").textContent, /Pending/)
  await api.act(async () =>
    root.rerender({
      reward: {
        source_type: "assignment",
        source_id: "new",
        nominal_amount: 24,
        amount: 5,
        reason: "WEEKLY_LIMIT",
        status: "RESERVED",
      },
    }),
  )
  assert.match(doc.getElementById("mount").textContent, /Pending.*5.*24.*Weekly limit/)
  await api.act(async () =>
    root.rerender({
      reward: {
        source_type: "assignment",
        source_id: "corrected",
        nominal_amount: 24,
        amount: 24,
        reason: "RESULT_CHANGED",
        status: "CORRECTED",
      },
    }),
  )
  assert.match(doc.getElementById("mount").textContent, /Corrected.*Result changed/)
  await api.act(async () => root.unmount())
})

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

const packReceipt = (id = "receipt-reveal", items = []) => ({
  id,
  kind: "PACK_OPEN",
  delta: -30,
  balance_after: 60,
  created_at: "2026-09-08T00:00:00Z",
  pack: { id: "pack", title: "Night mail", price: 30, revision: 1, draws: items.length, odds: [] },
  items,
})
const receiptItem = (id, title, rank = "F", duplicate = false, test_grant = false) => ({
  id,
  card: { ...card, id: `card-${id}`, title, rank },
  duplicate,
  test_grant,
  recycle_value: 0,
})

function pointer(w, element, type, x, y = 100) {
  const event = new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "touch" },
    isPrimary: { value: true },
  })
  element.dispatchEvent(event)
}

function animationEnd(doc, element, name = "pack-scene") {
  const event = new doc.defaultView.Event("animationend", { bubbles: true })
  Object.defineProperty(event, "animationName", { value: name })
  element.dispatchEvent(event)
}

test("opening waits for the complete tear and fan sequence, ignores child animations and can skip", async () => {
  const { api, doc } = runtime(async () => {
    throw new Error("reveal must not buy again")
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("timeline", [receiptItem("one", "One"), receiptItem("two", "Two")]),
      cinematic: true,
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  await api.act(async () => button(doc, "Break the seal").click())
  await api.act(async () => await new Promise((resolve) => setTimeout(resolve, 650)))
  assert.equal(doc.querySelector(".pack-reveal-shell").dataset.stage, "opening")
  assert.equal(doc.querySelectorAll(".pack-fan-back").length, 2)
  await api.act(async () => animationEnd(doc, doc.querySelector(".pack-tear-strip"), "pack-rip"))
  assert.equal(doc.querySelector(".pack-reveal-shell").dataset.stage, "opening")
  await api.act(async () => animationEnd(doc, doc.querySelector(".pack-opening-scene")))
  assert.ok(doc.querySelector("button[aria-label='Reveal card']"))
  await api.act(async () => button(doc, "Skip to results").click())
  assert.equal(doc.querySelectorAll("dialog .archive-card").length, 2)
  await api.act(async () => root.unmount())
})

test("a revealed card responds to touch with a moving highlight and resets it on cancel", async () => {
  const { api, doc, w } = runtime(async () => response({}), "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("touch-shine", [receiptItem("one", "Foil", "SSS")]),
      cinematic: true,
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  await api.act(async () => button(doc, "Break the seal").click())
  await api.act(async () => animationEnd(doc, doc.querySelector(".pack-opening-scene")))
  await api.act(async () => doc.querySelector(".card-surface-control").click())
  const surface = doc.querySelector(".card-surface")
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 300 })
  const control = doc.querySelector(".card-surface-control")
  await api.act(async () => {
    pointer(w, control, "pointerdown", 100, 100)
    pointer(w, control, "pointermove", 150, 100)
  })
  assert.equal(surface.style.getPropertyValue("--shine-x"), "75%")
  assert.ok(surface.querySelector(".card-surface-glare"))
  await api.act(async () => pointer(w, control, "pointercancel", 150, 100))
  assert.equal(surface.style.getPropertyValue("--shine-x"), "")
  await api.act(async () => button(doc, "Skip to results").click())
  const resultSurface = doc.querySelector(".pack-reveal-results .card-surface")
  resultSurface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 300 })
  assert.equal(resultSurface.querySelector("button"), null)
  await api.act(async () => {
    pointer(w, resultSurface, "pointerdown", 100, 100)
    pointer(w, resultSurface, "pointermove", 150, 100)
  })
  assert.equal(resultSurface.style.getPropertyValue("--shine-x"), "75%")
  await api.act(async () => root.unmount())
})

test("stacked cards require a flip and only a horizontal revealed swipe advances", async () => {
  const calls = []
  const { api, doc, w } = runtime(async (...args) => {
    calls.push(args)
    return response({})
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("gestures", [
        receiptItem("first", "First dossier"),
        receiptItem("second", "Second dossier"),
      ]),
      cinematic: true,
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  await api.act(async () => button(doc, "Break the seal").click())
  await api.act(async () => animationEnd(doc, doc.querySelector(".pack-opening-scene")))
  const flip = () => doc.querySelector("button[aria-label='Reveal card']")
  assert.ok(flip(), "a face-down card must offer a named flip control")
  assert.equal(doc.querySelector(".card-surface-front").getAttribute("aria-hidden"), "true")
  await api.act(async () => {
    pointer(w, flip(), "pointerdown", 120)
    pointer(w, flip(), "pointermove", 240)
    pointer(w, flip(), "pointerup", 240)
  })
  assert.match(doc.querySelector(".pack-reveal-card").textContent, /1 \/ 2/)
  await api.act(async () => flip().click())
  assert.equal(doc.querySelector(".card-surface-front").getAttribute("aria-hidden"), "false")
  const control = () => doc.querySelector(".card-surface-control")
  await api.act(async () => {
    pointer(w, control(), "pointerdown", 120, 100)
    pointer(w, control(), "pointermove", 145, 230)
    pointer(w, control(), "pointerup", 145, 230)
  })
  assert.match(doc.querySelector(".pack-reveal-card").textContent, /1 \/ 2/)
  await api.act(async () => {
    pointer(w, control(), "pointerdown", 120)
    pointer(w, control(), "pointermove", 250)
    pointer(w, control(), "pointercancel", 250)
  })
  assert.match(doc.querySelector(".pack-reveal-card").textContent, /1 \/ 2/)
  await api.act(async () => {
    pointer(w, control(), "pointerdown", 120)
    pointer(w, control(), "pointermove", 250)
    pointer(w, control(), "pointerup", 250)
    control().dispatchEvent(new w.MouseEvent("click", { bubbles: true, detail: 1 }))
  })
  await api.act(async () => await new Promise((resolve) => setTimeout(resolve, 300)))
  assert.match(doc.querySelector(".pack-reveal-card").textContent, /2 \/ 2/)
  assert.ok(flip(), "the next card remains face down after a swipe-generated click")
  assert.equal(calls.length, 0)
  await api.act(async () => root.unmount())
})

test("collection favorites save with CSRF, retry failure and filter the server inventory", async () => {
  const writes = [],
    reads = []
  let marked = false,
    fail = true
  const { api, doc } = runtime(async (url, init = {}) => {
    if (init.method === "PUT") {
      writes.push({ url, body: JSON.parse(init.body), csrf: init.headers.get("X-CSRF-Token") })
      if (fail) return { ok: false, status: 503, json: async () => ({ detail: "Try again" }) }
      marked = JSON.parse(init.body).favorite
      return response({ card_id: card.id, favorite: marked })
    }
    reads.push(url)
    if (url.includes("/favorites")) return response({ card_ids: marked ? [card.id] : [] })
    if (url.includes("/meta")) return response(meta)
    if (url.includes("/wallet")) return response(wallet)
    if (url.includes("/showcase"))
      return response({ card_ids: [], is_public: false, revision: 0, profile_public: false })
    if (url.includes("/inventory?"))
      return response({
        items: [{ card, quantity: 1, test_count: 0, recycle: null, favorite: marked }],
        total: 1,
      })
    return response({ items: [], total: 0 })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "archive", {
      csrf: "favorite-csrf",
      mode: "collection",
      onWalletChange() {},
    })
  })
  assert.ok(button(doc, "Add to favorites"))
  await api.act(async () => button(doc, "Add to favorites").click())
  assert.match(doc.querySelector("[role=alert]").textContent, /Try again/)
  assert.ok(button(doc, "Add to favorites"), "failed save must not claim the favorite was saved")
  fail = false
  await api.act(async () => button(doc, "Add to favorites").click())
  assert.equal(writes.length, 2)
  assert.equal(writes[1].csrf, "favorite-csrf")
  assert.equal(writes[1].url, `/api/archive/favorites/${card.id}`)
  assert.deepEqual(writes[1].body, { favorite: true, scope: "REAL" })
  assert.equal(button(doc, "Remove from favorites").getAttribute("aria-pressed"), "true")
  await api.act(async () => doc.querySelector("input[name=favorites_only]").click())
  assert.ok(reads.some((url) => url.includes("favorites_only=true")))
  assert.equal(writes.filter((x) => /open|recycle|showcase/.test(x.url)).length, 0)
  await api.act(async () => root.unmount())
})

test("receipt favorite changes refresh a mounted favorites-only collection", async () => {
  const item = receiptItem("receipt-favorite", "Receipt favorite")
  const receipt = packReceipt("recovered-favorite", [item])
  let marked = true,
    inventoryReads = 0
  const inventoryUrls = []
  const { api, doc, w } = runtime(
    async (url, init = {}) => {
      if (init.method === "PUT" && url.includes("/favorites/")) {
        marked = JSON.parse(init.body).favorite
        return response({ card_id: item.card.id, favorite: marked })
      }
      if (url.includes("/openings")) return response({ items: [receipt], total: 1 })
      if (url.includes("/favorites")) return response({ card_ids: marked ? [item.card.id] : [] })
      if (url.includes("/meta")) return response(meta)
      if (url.includes("/wallet")) return response(wallet)
      if (url.includes("/showcase"))
        return response({ card_ids: [], is_public: false, revision: 0, profile_public: false })
      if (url.includes("/inventory?")) {
        inventoryReads += 1
        inventoryUrls.push(url)
        const favoritesOnly = url.includes("favorites_only=true")
        return response({
          items:
            favoritesOnly && !marked
              ? []
              : [{ card: item.card, quantity: 1, test_count: 0, recycle: null, favorite: marked }],
          total: favoritesOnly ? (marked ? 19 : 0) : 1,
        })
      }
      return response({ items: [], total: 0 })
    },
    "en",
    true,
  )
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "archive", {
      csrf: "favorite-csrf",
      mode: "collection",
      onWalletChange() {},
    })
  })
  await api.act(async () => doc.querySelector("input[name=favorites_only]").click())
  await api.act(async () => button(doc, "Next").click())
  assert.match(inventoryUrls.at(-1), /offset=18/)
  const inventoryReadsBefore = inventoryReads
  await api.act(async () => button(doc, "Night mail").click())
  await api.act(async () => button(doc, "Reveal cards").click())
  const dialog = doc.querySelector("dialog")
  assert.equal(dialog.querySelectorAll(".archive-card").length, 1)
  await api.act(async () => button(dialog, "Remove from favorites").click())
  assert.ok(inventoryReads > inventoryReadsBefore, "the filtered inventory must be invalidated")
  assert.match(inventoryUrls.at(-1), /offset=0.*favorites_only=true/)
  assert.ok(
    doc.querySelector("h3.archive-item-title") === null,
    "the unfavorited collection row must disappear",
  )
  assert.equal(dialog.querySelectorAll(".archive-card").length, 1, "the receipt remains immutable")
  await api.act(async () => root.unmount())
})

test("a pending favorite swipe cannot advance after skipping and never buys again", async () => {
  const writes = []
  let finish
  const { api, doc, w } = runtime(async (url, init = {}) => {
    if (init.method === "PUT") {
      writes.push({ url, body: JSON.parse(init.body) })
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    return response({ card_ids: [] })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "favoriteReceipt", {
      receipt: packReceipt("slow", [receiptItem("one", "First"), receiptItem("two", "Second")]),
      csrf: "csrf",
      accountKey: "account-one",
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  await api.act(async () => button(doc, "Break the seal").click())
  await api.act(async () => animationEnd(doc, doc.querySelector(".pack-opening-scene")))
  await api.act(async () => doc.querySelector("button[aria-label='Reveal card']").click())
  await api.act(async () => {
    const control = doc.querySelector(".card-surface-control")
    pointer(w, control, "pointerdown", 240)
    pointer(w, control, "pointermove", 100)
    pointer(w, control, "pointerup", 100)
  })
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0], {
    url: "/api/archive/favorites/card-one",
    body: { favorite: true, scope: "REAL" },
  })
  assert.ok(button(doc, "Saving…").disabled)
  await api.act(async () => button(doc, "Skip to results").click())
  await api.act(async () => finish(response({ card_id: "card-one", favorite: true })))
  await api.act(async () => await new Promise((resolve) => setTimeout(resolve, 300)))
  assert.equal(doc.querySelector(".pack-reveal-shell").dataset.stage, "results")
  assert.equal(doc.querySelectorAll("dialog .archive-card").length, 2)
  assert.ok(button(doc, "Remove from favorites"))
  assert.equal(writes.length, 1)
  await api.act(async () => root.unmount())
})

test("favorite writes are single-flight and stale account responses are ignored", async () => {
  const writes = []
  let finish
  const { api, doc } = runtime(async (url, init = {}) => {
    if (init.method === "PUT") {
      writes.push(init)
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    return response({ card_ids: [] })
  }, "en")
  let root
  const receipt = packReceipt("account-test", [receiptItem("one", "Owned file")])
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "favoriteReceipt", {
      receipt,
      csrf: "csrf-a",
      accountKey: "a",
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  await api.act(async () => button(doc, "Skip to results").click())
  await api.act(async () => {
    button(doc, "Add to favorites").click()
    button(doc, "Add to favorites").click()
  })
  assert.equal(writes.length, 1)
  await api.act(async () => root.rerender({ receipt, csrf: "csrf-b", accountKey: "b" }))
  assert.equal(writes[0].signal.aborted, true)
  await api.act(async () => finish(response({ card_id: "card-one", favorite: true })))
  await api.act(async () => button(doc, "Reveal cards").click())
  await api.act(async () => button(doc, "Skip to results").click())
  assert.equal(button(doc, "Remove from favorites"), undefined)
  assert.equal(button(doc, "Add to favorites").getAttribute("aria-pressed"), "false")
  await api.act(async () => root.unmount())
})

test("favorite errors remain visible in inline results after closing the reveal", async () => {
  const { api, doc } = runtime(
    async (_url, init = {}) =>
      init.method === "PUT"
        ? { ok: false, status: 503, json: async () => ({ detail: "Please retry favorite" }) }
        : response({ card_ids: [] }),
    "en",
  )
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "favoriteReceipt", {
      receipt: packReceipt("inline-error", [receiptItem("one", "Saved card")]),
      csrf: "csrf",
      accountKey: "account",
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  await api.act(async () => button(doc, "Close reveal").click())
  await api.act(async () =>
    button(doc.querySelector(".pack-reveal-inline"), "Add to favorites").click(),
  )
  const visibleAlert = [...doc.querySelectorAll("[role=alert]")].find(
    (node) => !node.closest("dialog"),
  )
  assert.ok(visibleAlert, "Save failures must be visible outside the closed dialog")
  assert.match(visibleAlert.textContent, /Please retry favorite/)
  assert.ok(button(doc.querySelector(".pack-reveal-inline"), "Add to favorites"))
  await api.act(async () => root.unmount())
})

test("empty receipt shows complete results without an inert opening sequence", async () => {
  const { api, doc } = runtime(async () => response({}), "ru")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("empty"),
      cinematic: true,
    })
  })
  await api.act(async () => button(doc, "Раскрыть карточки").click())
  assert.match(doc.querySelector("dialog").textContent, /Получено: 0/)
  assert.equal(doc.querySelector(".card-surface-control"), null)
  await api.act(async () => button(doc, "Закрыть показ").click())
  assert.equal(doc.querySelector("dialog").open, false)
  await api.act(async () => root.unmount())
})

test("cinematic pack reveal uses receipt order and replay has no network or wallet effects", async () => {
  const calls = []
  let closed = 0
  const receipt = packReceipt("ordered", [
    receiptItem("one", "First file", "F"),
    receiptItem("two", "Second file", "SSS", true, true),
  ])
  const { api, doc } = runtime(async (...args) => {
    calls.push(args)
    return response({})
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt,
      cinematic: true,
      onClose: () => closed++,
    })
  })
  assert.equal(doc.querySelector("dialog").hasAttribute("open"), false)
  assert.ok(button(doc, "Reveal cards"))
  await api.act(async () => button(doc, "Reveal cards").click())
  assert.equal(doc.querySelector("dialog").hasAttribute("open"), true)
  await api.act(async () => button(doc, "Skip to results").click())
  const titles = [...doc.querySelectorAll("dialog .archive-card strong")].map(
    (node) => node.textContent,
  )
  assert.deepEqual(titles, ["First file", "Second file"])
  assert.match(doc.querySelector("dialog").textContent, /Duplicate/)
  assert.match(doc.querySelector("dialog").textContent, /Sandbox copy/)
  await api.act(async () => button(doc, "Close reveal").click())
  assert.equal(closed, 0)
  assert.ok(button(doc, "Replay reveal"))
  await api.act(async () => button(doc, "Replay reveal").click())
  await api.act(async () => button(doc, "Close reveal").click())
  assert.equal(calls.length, 0)
  assert.match(doc.querySelector(".archive-receipt").textContent, /Night mail/)
  await api.act(async () => root.unmount())
})

test("history and non-pack receipts render immediately without a cinematic dialog", async () => {
  const { api, doc } = runtime(async () => response({}), "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("history", [receiptItem("one", "History card")]),
    })
  })
  assert.match(doc.querySelector(".archive-receipt").textContent, /History card/)
  assert.equal(doc.querySelector("dialog"), null)
  await api.act(async () => root.unmount())
  const direct = { ...packReceipt("direct", [receiptItem("two", "Direct card")]), kind: "DIRECT" }
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", { receipt: direct, cinematic: true })
  })
  assert.match(doc.querySelector(".archive-receipt").textContent, /Direct card/)
  assert.equal(doc.querySelector("dialog"), null)
  await api.act(async () => root.unmount())
})

test("reduced motion opens a pack reveal directly at complete results", async () => {
  const { api, doc } = runtime(async () => response({}), "en", true)
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("reduced", [receiptItem("one", "Quiet card")]),
      cinematic: true,
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  assert.match(doc.querySelector("dialog").textContent, /Quiet card/)
  assert.equal(button(doc, "Break the seal"), undefined)
  await api.act(async () => root.unmount())
})

test("manual motion off opens pack results immediately and disables pointer tilt", async () => {
  const { api, doc, w } = runtime(async () => response({}), "en")
  w.localStorage.setItem("dc.ui.appearance", JSON.stringify({ motion: false }))
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("manual-reduced", [receiptItem("one", "Still card")]),
      cinematic: true,
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  assert.equal(doc.querySelector(".pack-reveal-shell").dataset.stage, "results")
  const surface = doc.querySelector("dialog .card-surface")
  assert.equal(surface.dataset.reduced, "true")
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 300 })
  await api.act(async () => {
    pointer(w, surface, "pointerdown", 50, 50)
    pointer(w, surface, "pointermove", 150, 150)
  })
  assert.equal(surface.style.getPropertyValue("--tilt-x"), "")
  await api.act(async () => root.unmount())
})

test("manual motion change during opening cancels the animation wait", async () => {
  const { api, doc, w } = runtime(async () => response({}), "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("manual-change", [receiptItem("one", "Immediate result")]),
      cinematic: true,
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  await api.act(async () => button(doc, "Break the seal").click())
  assert.equal(doc.querySelector(".pack-reveal-shell").dataset.stage, "opening")
  await api.act(async () => {
    w.localStorage.setItem("dc.ui.appearance", JSON.stringify({ motion: false }))
    w.dispatchEvent(new w.StorageEvent("storage", { key: "dc.ui.appearance" }))
  })
  assert.equal(doc.querySelector(".pack-reveal-shell").dataset.stage, "results")
  assert.match(doc.querySelector("dialog").textContent, /Immediate result/)
  await api.act(async () => root.unmount())
})

test("receipt identity resets reveal state while the same identity preserves it", async () => {
  const { api, doc } = runtime(async () => response({}), "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("first", [receiptItem("one", "First receipt")]),
      cinematic: true,
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  await api.act(async () => button(doc, "Skip to results").click())
  await api.act(async () => button(doc, "Close reveal").click())
  assert.ok(button(doc, "Replay reveal"))
  await api.act(async () => {
    root.rerender({
      receipt: packReceipt("first", [receiptItem("one", "Updated same receipt")]),
      cinematic: true,
    })
  })
  assert.ok(button(doc, "Replay reveal"))
  await api.act(async () => {
    root.rerender({
      receipt: packReceipt("second", [receiptItem("two", "Second receipt")]),
      cinematic: true,
    })
  })
  assert.ok(button(doc, "Reveal cards"))
  await api.act(async () => root.unmount())
})

test("a reduced-motion change during opening skips directly to results", async () => {
  const { api, doc, setReducedMotion } = runtime(async () => response({}), "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("motion-change", [receiptItem("one", "Motion-safe result")]),
      cinematic: true,
    })
  })
  await api.act(async () => button(doc, "Reveal cards").click())
  await api.act(async () => button(doc, "Break the seal").click())
  await api.act(async () => setReducedMotion(true))
  assert.match(doc.querySelector("dialog").textContent, /Motion-safe result/)
  assert.equal(button(doc, "Skip to results"), undefined)
  await api.act(async () => root.unmount())
})

test("TransactionStatus offers the cinematic reveal for a saved starter pack receipt", async () => {
  const starter = {
    ...packReceipt("starter", [receiptItem("starter-card", "Starter dossier", "A")]),
    kind: "STARTER_PACK",
  }
  const { api, doc } = runtime(async () => response(starter), "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "transaction", {
      csrf: "csrf",
      accountKey: "starter-account",
      onChanged() {},
    })
  })
  await api.act(async () => button(doc, "Open test pack").click())
  assert.ok(button(doc, "Reveal cards"))
  assert.equal(doc.querySelector(".archive-receipt .archive-card"), null)
  await api.act(async () => root.unmount())
})

test("opening stages move focus to the available keyboard action", async () => {
  const { api, doc } = runtime(async () => response({}), "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("keyboard", [receiptItem("one", "Keyboard card", "SS")]),
      cinematic: true,
    })
  })
  await api.act(async () => button(doc, "Reveal cards")?.click())
  await api.act(async () => button(doc, "Break the seal").click())
  await api.act(async () => animationEnd(doc, doc.querySelector(".pack-opening-scene")))
  const flip = doc.querySelector("button[aria-label='Reveal card']")
  assert.equal(doc.activeElement, flip)
  await api.act(async () => flip.click())
  assert.equal(doc.activeElement, button(doc, "Results"))
  await api.act(async () =>
    doc.activeElement.dispatchEvent(
      new doc.defaultView.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    ),
  )
  await api.act(async () => await new Promise((resolve) => setTimeout(resolve, 300)))
  assert.ok(
    doc.activeElement === button(doc, "Close reveal"),
    "ArrowRight reaches results and focuses Close",
  )
  await api.act(async () => root.unmount())
})

test("close, cancel and unmount each clear the pending opening timer", async () => {
  const { api, doc, w } = runtime(async () => response({}), "en")
  const nativeSetTimeout = w.setTimeout.bind(w)
  const nativeClearTimeout = w.clearTimeout.bind(w)
  const openingTimers = []
  const clearedOpeningTimers = new Set()
  w.setTimeout = (callback, delay, ...args) => {
    const timer = nativeSetTimeout(callback, delay, ...args)
    if (delay === 3600) openingTimers.push(timer)
    return timer
  }
  w.clearTimeout = (timer) => {
    if (openingTimers.includes(timer)) clearedOpeningTimers.add(timer)
    nativeClearTimeout(timer)
  }
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("focus", [receiptItem("one", "Focus card")]),
      cinematic: true,
    })
  })
  const trigger = button(doc, "Reveal cards")
  trigger.focus()
  await api.act(async () => trigger.click())
  await api.act(async () => button(doc, "Break the seal").click())
  await api.act(async () => button(doc, "Close reveal").click())
  assert.ok(clearedOpeningTimers.has(openingTimers[0]))
  assert.equal(doc.activeElement, trigger)
  assert.match(doc.querySelector(".pack-reveal-inline").textContent, /Focus card/)

  await api.act(async () => trigger.click())
  await api.act(async () => button(doc, "Break the seal").click())
  await api.act(async () =>
    doc.querySelector("dialog").dispatchEvent(new w.Event("cancel", { cancelable: true })),
  )
  assert.ok(clearedOpeningTimers.has(openingTimers[1]))

  await api.act(async () => button(doc, "Close reveal").click())
  await api.act(async () => trigger.click())
  await api.act(async () => button(doc, "Break the seal").click())
  await api.act(async () => root.unmount())
  assert.ok(clearedOpeningTimers.has(openingTimers[2]))
})

test("account popover shows XP, omits retired navigation, closes on Escape and restores focus", async () => {
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
  assert.match(trigger.textContent, /120 XP/)
  assert.equal(doc.querySelector(".bureau-wallet-strip"), null)
  assert.doesNotMatch(
    doc.querySelector(".bureau-profile-popover").textContent,
    /Монеты|Шифр|Арена|Мои карточки/,
  )
  assert.match(doc.querySelector(".bureau-profile-section").textContent, /Deadlock Night/)
  assert.equal(button(doc, "Панель сотрудников"), undefined)
  await api.act(async () =>
    doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  )
  assert.equal(trigger.getAttribute("aria-expanded"), "false")
  assert.equal(doc.activeElement, trigger)
  await api.act(async () => trigger.click())
  await api.act(async () => button(doc, "Моя коллекция").click())
  assert.deepEqual(navigated, ["collection"])
  assert.equal(trigger.getAttribute("aria-expanded"), "false")
  await api.act(async () => root.unmount())
})

test("release posters keep their full artwork while custom designs retain their crop", async () => {
  const { api, doc } = runtime(async () => response({}))
  const source = "https://www.playdeadlock.com/cityneversleeps"
  const release = {
    ...card,
    id: "364efc49-3038-51f4-8dec-c24538b7145a",
    source_url: source,
    release_poster: true,
    crop_x: 50,
    crop_y: 50,
    zoom: 1,
  }
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "receipt", {
      receipt: packReceipt("release-mat", [
        { id: "release", card: release, duplicate: false },
        {
          id: "user-source",
          card: { ...release, id: "user-design", release_poster: false },
          duplicate: false,
        },
        { id: "custom", card: { ...card, crop_x: 27, crop_y: 72, zoom: 1.4 }, duplicate: false },
        { id: "edited", card: { ...release, crop_x: 31, zoom: 1.2 }, duplicate: false },
        {
          id: "replaced",
          card: { ...release, release_poster: false, image_url: "/replacement.webp?r=2" },
          duplicate: false,
        },
      ]),
    })
  })
  const [poster, userSource, custom, edited, replaced] = doc.querySelectorAll(".archive-card")
  assert.equal(poster.dataset.release, "city-never-sleeps")
  assert.equal(poster.querySelector("img").style.objectFit, "contain")
  assert.equal(userSource.dataset.release, undefined)
  assert.equal(userSource.querySelector("img").style.objectFit, "")
  assert.equal(replaced.dataset.release, undefined)
  assert.equal(replaced.querySelector("img").style.objectFit, "")
  for (const [figure, position, zoom] of [
    [custom, "27% 72%", "scale(1.4)"],
    [edited, "31% 50%", "scale(1.2)"],
  ]) {
    assert.equal(figure.dataset.release, undefined)
    assert.equal(figure.querySelector("img").style.objectPosition, position)
    assert.equal(figure.querySelector("img").style.transform, zoom)
  }
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
  assert.match(doc.querySelector('[role="status"]').textContent, /30 coins/)
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

test("non-owner staff cannot open pack tools or trigger their API requests", async () => {
  const calls = []
  const { api, doc } = runtime(async (url) => {
    calls.push(url)
    return response({})
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "owner", {
      csrf: "csrf",
      permissions: ["admin.access", "cards.publish"],
    })
  })
  assert.match(doc.querySelector('[role="alert"]').textContent, /только OWNER/)
  assert.equal(button(doc, "Создать пак"), undefined)
  assert.equal(calls.length, 0)
  await api.act(async () => root.unmount())
})

test("an uncertain opening keeps the same key across a remount and retries only once", async () => {
  const writes = []
  const { api, doc, w } = runtime(async (url, init) => {
    writes.push(JSON.parse(init.body))
    if (writes.length === 1) throw new Error("Connection lost")
    return response({
      id: "receipt-1",
      kind: "PACK_OPEN",
      delta: -30,
      balance_after: 60,
      created_at: "2026-09-08T00:00:00Z",
      items: [],
    })
  })
  let root
  const props = { csrf: "pay-csrf", accountKey: "owner-account", onChanged() {} }
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "transaction", props)
  })
  await api.act(async () => {
    button(doc, "Open test pack").click()
    button(doc, "Open test pack").click()
  })
  assert.equal(writes.length, 1)
  assert.match(doc.body.textContent, /Connection lost/)
  assert.ok(w.sessionStorage.getItem("dc-archive-request:owner-account"))
  await api.act(async () => root.unmount())
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "transaction", props)
  })
  assert.equal(button(doc, "Open test pack").disabled, true)
  await api.act(async () => button(doc, "Повторить запрос").click())
  assert.equal(writes.length, 2)
  assert.deepEqual(writes[0], writes[1])
  assert.equal(w.sessionStorage.getItem("dc-archive-request:owner-account"), null)
  assert.match(doc.querySelector(".archive-receipt").textContent, /-30/)
  await api.act(async () => root.unmount())
})

test("saved purchase recovery and retry share one in-flight request", async () => {
  const calls = []
  let complete
  const { api, doc, w } = runtime((url, init) => {
    calls.push({ url, init })
    return new Promise((resolve) => {
      complete = resolve
    })
  }, "en")
  const pending = {
    url: "/api/archive/packs/test/open",
    body: { request_key: "saved-request", revision: 4, starter: false },
  }
  w.sessionStorage.setItem("dc-archive-request:account", JSON.stringify(pending))
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "transaction", {
      csrf: "csrf",
      accountKey: "account",
      onChanged() {},
    })
  })
  await api.act(async () => {
    button(doc, "Check result").click()
    button(doc, "Retry request").click()
  })
  assert.equal(calls.length, 1, "checking the receipt must exclude a concurrent POST")
  await api.act(async () => complete(response({ operation: null })))
  await api.act(async () => {
    button(doc, "Retry request").click()
    button(doc, "Retry request").click()
  })
  assert.equal(calls.length, 2, "two retry activations must send only one POST")
  assert.equal(calls[1].init.method, "POST")
  assert.deepEqual(JSON.parse(calls[1].init.body), pending.body)
  await api.act(async () => complete(response(packReceipt("saved-result"))))
  assert.equal(w.sessionStorage.getItem("dc-archive-request:account"), null)
  await api.act(async () => root.unmount())
})

test("changing archive account aborts the old purchase and preserves its recovery key", async () => {
  let complete, oldSignal
  let changes = 0
  const { api, doc, w } = runtime((url, init) => {
    oldSignal = init.signal
    return new Promise((resolve) => {
      complete = resolve
    })
  }, "en")
  let root
  const props = { csrf: "csrf-a", accountKey: "a", onChanged: () => changes++ }
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "transaction", props)
  })
  await api.act(async () => button(doc, "Open test pack").click())
  const saved = w.sessionStorage.getItem("dc-archive-request:a")
  assert.ok(saved)
  await api.act(async () => root.rerender({ ...props, csrf: "csrf-b", accountKey: "b" }))
  assert.equal(oldSignal?.aborted, true)
  assert.equal(doc.querySelector(".archive-pending"), null)
  assert.equal(button(doc, "Open test pack").disabled, false)
  await api.act(async () => complete(response(packReceipt("old-account-receipt"))))
  assert.equal(doc.querySelector(".archive-receipt"), null)
  assert.equal(changes, 0)
  assert.equal(w.sessionStorage.getItem("dc-archive-request:a"), saved)
  await api.act(async () => root.unmount())
})

test("collection limits the showcase to three owned designs and preserves its revision", async () => {
  const writes = []
  const items = [1, 2, 3, 4].map((i) => ({
    card: { ...card, id: `card-${i}`, title: `Card ${i}`, status: "PUBLISHED" },
    quantity: 1,
    test_count: 0,
    recycle: null,
  }))
  const { api, doc } = runtime(async (url, init = {}) => {
    if (init.method === "PUT") {
      writes.push(JSON.parse(init.body))
      return response({ ...writes[0], revision: 4, profile_public: false })
    }
    if (url.includes("/meta")) return response(meta)
    if (url.includes("/wallet")) return response(wallet)
    if (url.includes("/showcase"))
      return response({ card_ids: [], is_public: false, revision: 3, profile_public: false })
    if (url.includes("/inventory?")) return response({ items, total: 4 })
    return response({ items: [], total: 0 })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "archive", {
      csrf: "csrf",
      mode: "collection",
      onWalletChange() {},
    })
  })
  const checks = [...doc.querySelectorAll(".archive-grid input[type=checkbox]")]
  assert.equal(checks.length, 4)
  for (let i = 0; i < 3; i++) await api.act(async () => checks[i].click())
  assert.equal(checks[3].disabled, true)
  assert.equal(button(doc, "Обменять один дубль"), undefined)
  await api.act(async () => button(doc, "Сохранить витрину").click())
  assert.equal(writes[0].revision, 3)
  assert.deepEqual(writes[0].card_ids, ["card-1", "card-2", "card-3"])
  assert.equal(writes[0].is_public, false)
  await api.act(async () => root.unmount())
})

test("seal picker preserves symbol numbers and cannot double-select or submit twice", async () => {
  const writes = []
  let resolve
  const { api, doc, w } = runtime((url, init) => {
    writes.push({ url, init, body: JSON.parse(init.body) })
    return new Promise((done) => {
      resolve = done
    })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "cipher", {
      wallet: {
        ...wallet,
        round: { id: "round", revision: 2, status: "OPEN", guesses: [], solution: null },
      },
      csrf: "csrf",
      onEarned() {},
    })
  })
  const picker = () => [...doc.querySelectorAll(".archive-symbol-picker button")]
  assert.equal(picker().length, 6)
  assert.equal(
    picker()[0].querySelector("[data-regalia]").getAttribute("data-regalia"),
    "seal-compass",
  )
  await api.act(async () => {
    picker()[0].click()
    picker()[0].click()
  })
  assert.equal(
    [...doc.querySelectorAll(".archive-choice span")].filter((s) => s.textContent === "Компас")
      .length,
    1,
  )
  for (const id of [2, 4, 5]) await api.act(async () => picker()[id].click())
  assert.ok(picker().every((button) => button.disabled))
  await api.act(async () => {
    button(doc, "Проверить").click()
    button(doc, "Проверить").click()
  })
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].body, { revision: 2, symbols: [0, 2, 4, 5] })
  assert.equal(new w.Headers(writes[0].init.headers).get("X-CSRF-Token"), "csrf")
  await api.act(async () =>
    resolve(
      response({
        round: {
          id: "round",
          revision: 3,
          status: "OPEN",
          guesses: [{ symbols: [0, 2, 4, 5], exact: 2, misplaced: 1 }],
        },
      }),
    ),
  )
  assert.match(
    doc.querySelector(".cipher-guess-art").getAttribute("aria-label"),
    /Компас, Документы, Руки, Часы/,
  )
  await api.act(async () => root.unmount())
})

test("staff card studio creates, edits and submits a draft while preserving the review queue", async () => {
  const writes = [],
    reads = []
  let drafts = []
  const { api, doc, w } = runtime(async (url, init = {}) => {
    reads.push(url)
    if (url === "/api/archive/cards" && init.method === "POST") {
      const body = JSON.parse(init.body)
      writes.push({ url, body })
      const saved = { ...card, ...body, id: "studio-draft", status: "DRAFT", revision: 1 }
      drafts = [saved]
      return response({ card: saved })
    }
    if (url === "/api/archive/cards/studio-draft" && init.method === "PUT") {
      const body = JSON.parse(init.body)
      writes.push({ url, body })
      const saved = { ...drafts[0], ...body, revision: 2 }
      drafts = [saved]
      return response({ card: saved })
    }
    if (url.endsWith("/studio-draft/submit") && init.method === "POST") {
      const body = JSON.parse(init.body)
      writes.push({ url, body })
      drafts = [{ ...drafts[0], status: "PENDING", revision: 3 }]
      return response({ card: drafts[0] })
    }
    if (url.includes("/meta")) return response({ ...meta, can_publish: true })
    if (url.includes("mine=true")) return response({ items: drafts, total: drafts.length })
    return response({ items: [], total: 0 })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "review", { csrf: "studio-csrf" })
  })
  assert.match(doc.body.textContent, /Card review/)
  await api.act(async () => button(doc, "Card studio").click())
  await api.act(async () => button(doc, "Create card").click())
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set
  await api.act(async () => {
    const title = doc.querySelector('input[maxlength="80"]')
    set.call(title, "Staff draft")
    title.dispatchEvent(new w.Event("input", { bubbles: true }))
  })
  await api.act(async () => button(doc, "Save draft").click())
  assert.equal(writes[0].url, "/api/archive/cards")
  assert.equal(writes[0].body.title, "Staff draft")
  assert.equal(writes[0].body.status, undefined)
  await api.act(async () => button(doc, "Edit").click())
  await api.act(async () => {
    const title = doc.querySelector('input[maxlength="80"]')
    set.call(title, "Edited staff draft")
    title.dispatchEvent(new w.Event("input", { bubbles: true }))
  })
  await api.act(async () => button(doc, "Save draft").click())
  assert.equal(writes[1].body.revision, 1)
  assert.equal(writes[1].body.title, "Edited staff draft")
  await api.act(async () => button(doc, "Submit").click())
  assert.deepEqual(writes[2], {
    url: "/api/archive/cards/studio-draft/submit",
    body: { revision: 2 },
  })
  assert.ok(button(doc, "Withdraw"))
  assert.equal(button(doc, "Edit"), undefined)
  assert.equal(button(doc, "Publish"), undefined)
  assert.ok(reads.some((url) => url.includes("/api/admin/archive/cards")))
  assert.ok(reads.some((url) => url.includes("mine=true")))
  await api.act(async () => button(doc, "Review queue").click())
  assert.ok(button(doc, "Refresh queue"))
  await api.act(async () => root.unmount())
})

test("staff studio respects can_publish and withholds draft creation for other roles", async () => {
  const reads = []
  const { api, doc } = runtime(async (url) => {
    reads.push(url)
    if (url.includes("/meta")) return response({ ...meta, can_publish: false })
    return response({ items: [], total: 0 })
  }, "en")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "review", { csrf: "csrf" })
  })
  await api.act(async () => button(doc, "Card studio").click())
  assert.equal(button(doc, "Create card"), undefined)
  assert.equal(
    reads.some((url) => url.includes("mine=true")),
    false,
  )
  assert.match(doc.body.textContent, /administrator|owner/i)
  await api.act(async () => root.unmount())
})
