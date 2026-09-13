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
  assert.match(doc.querySelector("dialog").textContent, /OWNER test grant/)
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
  await api.act(async () => await new Promise((resolve) => setTimeout(resolve, 600)))
  assert.equal(doc.activeElement, button(doc, "Results"))
  await api.act(async () => button(doc, "Results").click())
  assert.equal(doc.activeElement, button(doc, "Close reveal"))
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
    if (delay === 550) openingTimers.push(timer)
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

test("pack opening shows actual odds and sends the displayed revision with CSRF", async () => {
  const writes = []
  const released = { ...card, status: "PUBLISHED" }
  const pack = {
    id: "pack-1",
    revision: 8,
    title: "Ночная почта",
    description: "First release",
    price: 30,
    draws: 2,
    card_count: 1,
    ready: true,
    active: true,
    starter: true,
    odds: [{ rank: "SSS", percent: 100, weight: 1, total_weight: 1 }],
    recommendation: { price: 990 },
    entries: [{ card_id: card.id, card: released, rank: "SSS", weight: 1, percent: 100 }],
  }
  const { api, doc } = runtime(async (url, init = {}) => {
    if (init.method === "POST") {
      writes.push({ url, body: JSON.parse(init.body), csrf: init.headers.get("X-CSRF-Token") })
      return response({
        id: "receipt",
        kind: "PACK_OPEN",
        delta: -30,
        balance_after: 60,
        created_at: "2026-09-08T00:00:00Z",
        items: [],
      })
    }
    if (url.includes("/meta")) return response(meta)
    if (url.includes("/wallet")) return response(wallet)
    if (url.includes("/packs/pack-1")) return response({ pack })
    if (url.includes("/packs?")) return response({ items: [pack], total: 1, starter_claimed: true })
    return response({ items: [], total: 0 })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "archive", {
      csrf: "pack-csrf",
      mode: "packs",
      onWalletChange() {},
    })
  })
  await api.act(async () => button(doc, "Состав и открытие").click())
  assert.equal(doc.activeElement, doc.querySelector("#archive-pack-details"))
  await api.act(async () => button(doc, "Закрыть состав").click())
  assert.equal(doc.activeElement, button(doc, "Состав и открытие"))
  await api.act(async () => button(doc, "Состав и открытие").click())
  assert.match(doc.querySelector(".archive-pack-odds").textContent, /100%/)
  assert.match(doc.querySelector(".archive-pack-odds").textContent, /Гарантированного ранга нет/)
  assert.equal(button(doc, "Получить стартовый бесплатно"), undefined)
  await api.act(async () => button(doc, "Открыть за 30").click())
  assert.equal(writes.length, 1)
  assert.equal(writes[0].csrf, "pack-csrf")
  assert.equal(writes[0].body.revision, 8)
  assert.equal(writes[0].body.starter, false)
  assert.ok(writes[0].body.request_key)
  assert.equal(writes[0].body.price, undefined)
  assert.equal(doc.activeElement, doc.querySelector(".archive-receipt"))
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

test("wallet distinguishes paid openings and owner adjustments without a doubled sign", async () => {
  const { api, doc } = runtime(async (url) =>
    response(
      url.includes("/meta")
        ? meta
        : url.includes("/wallet")
          ? {
              ...wallet,
              history: [
                { id: "paid", delta: -30, reason: "PACK_OPEN", created_at: "2026-09-08T00:00:00Z" },
                {
                  id: "grant",
                  delta: 150,
                  reason: "OWNER_TOKENS",
                  created_at: "2026-09-08T00:01:00Z",
                },
              ],
              history_total: 2,
            }
          : { items: [], total: 0 },
    ),
  )
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "archive", {
      csrf: "csrf",
      mode: "wallet",
      onWalletChange() {},
    })
  })
  const text = doc.querySelector(".archive-ledger").textContent
  assert.match(text, /Открытие конверта/)
  assert.match(text, /Корректировка OWNER/)
  assert.match(text, /-30/)
  assert.doesNotMatch(text, /\+-30/)
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
