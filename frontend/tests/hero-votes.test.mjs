import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { build } from "vite"
import { JSDOM } from "jsdom"

let code
const environments = []
before(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    define: { "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: "tests/hero-votes-entry.tsx", name: "HeroVotesTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => environments.forEach((dom) => dom.window.close()))
function runtime(handler = async () => ({ items: [], preset })) {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: "https://qa.invalid/#hero-votes",
    runScripts: "outside-only",
  })
  environments.push(dom)
  const w = dom.window
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.Headers = Headers
  w.AbortController = AbortController
  w.structuredClone = structuredClone
  w.confirm = () => true
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }
  }
  w.localStorage.setItem("dc.ui.language", "ru")
  w.fetch = async (url, init) => ({ ok: true, json: async () => handler(url, init) })
  w.eval(code)
  return { w, doc: w.document, api: w.HeroVotesTest }
}
const candidates = [
  { hero_id: 85, name_ru: "Соломон", name_en: "Solomon", released: false },
  { hero_id: 88, name_ru: "Баба", name_en: "Baba", released: false },
  { hero_id: 84, name_ru: "Крысиный король", name_en: "Rat King", released: true },
]
const preset = {
  title_ru: "Город не спит",
  title_en: "The City Never Sleeps",
  candidates,
  starts_at: null,
  ends_at: null,
  providers: ["deadlock_labs", "statlocker"],
}
function observation() {
  return {
    enabled: true,
    server_time: "2026-10-03T00:00:00Z",
    campaign: {
      ...preset,
      id: "campaign",
      sources: [
        {
          provider: "deadlock_labs",
          name: "Deadlock Labs",
          kind: "COMMUNITY_POLL",
          url: "https://deadlocklabs.gg/updates/city-never-sleeps/",
          enabled: true,
          status: "OK",
          stale: false,
          updated_at: "2026-10-03T00:00:00Z",
          next_refresh_at: "2026-10-03T00:10:00Z",
          change: null,
          result: {
            total_votes: 2697,
            leader_ids: [85],
            gap_votes: 108,
            gap_percent: 4,
            rows: [
              { ...candidates[0], votes: 793, percent: 29.4 },
              { ...candidates[1], votes: 685, percent: 25.4 },
              { ...candidates[2], votes: 1219, percent: 45.2 },
            ],
          },
        },
        {
          provider: "statlocker",
          name: "Statlocker",
          kind: "RELEASE_PREDICTIONS",
          url: "https://statlocker.gg/cns-sweep/predict",
          enabled: true,
          status: "AUTH_REQUIRED",
          stale: false,
          updated_at: null,
          next_refresh_at: "2026-10-03T00:10:00Z",
          result: null,
          change: null,
        },
      ],
    },
  }
}
function button(doc, label) {
  const found = [...doc.querySelectorAll("button")].find(
    (item) => item.textContent.trim() === label,
  )
  assert.ok(found, label)
  return found
}
function input(w, element, value) {
  Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(element, value)
  element.dispatchEvent(new w.Event("input", { bubbles: true }))
}

test("poll scope, source denominator, released hero and protected predictions stay explicit in RU/EN", async () => {
  const { doc, api } = runtime()
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "page", observation())
  })
  assert.match(doc.querySelector(".hv-scope").textContent, /не общие результаты голосования в игре/)
  assert.equal(doc.querySelector(".hv-leader h2").textContent, "Соломон")
  assert.equal(doc.querySelectorAll(".hv-ranking li").length, 2)
  assert.equal(doc.querySelector(".hv-percent").textContent, "29,4%")
  assert.match(doc.querySelector(".hv-released").textContent, /1.*219/)
  assert.match(
    doc.querySelectorAll(".hv-sources article")[1].textContent,
    /Статистика требует входа/,
  )
  for (const link of doc.querySelectorAll(".hv-sources a")) assert.match(link.rel, /noopener/)
  await api.act(async () => doc.getElementById("switch-language").click())
  assert.equal(doc.querySelector(".hv-leader h2").textContent, "Solomon")
  assert.match(doc.querySelector(".hv-scope").textContent, /not the global in-game results/)
  assert.match(
    doc.querySelectorAll(".hv-sources article")[1].textContent,
    /Statistics require sign-in/,
  )
  await api.act(async () => root.unmount())
})

test("tied leaders and unavailable data never present a made-up winner or zero tally", async () => {
  const { doc, api } = runtime()
  const data = observation()
  data.campaign.sources[0].result.leader_ids = [85, 88]
  data.campaign.sources[0].result.gap_votes = 0
  data.campaign.sources[0].result.gap_percent = 0
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "page", data)
  })
  assert.match(doc.querySelector(".hv-leader").textContent, /Равенство голосов/)
  assert.match(doc.querySelector(".hv-leader h2").textContent, /Соломон.*Баба/)
  await api.act(async () => root.unmount())
  data.campaign.sources[0].result = null
  data.campaign.sources[0].status = "UNAVAILABLE"
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "page", data)
  })
  assert.equal(doc.querySelector(".hv-metrics"), null)
  assert.match(doc.querySelector(".hv-empty").textContent, /Подтверждённых чисел пока нет/)
  await api.act(async () => root.unmount())
})

test("saved observations show staleness and changes without announcing a live global leader", async () => {
  const { doc, api } = runtime()
  const data = observation(),
    source = data.campaign.sources[0]
  source.stale = true
  source.change = { since: source.updated_at, leader_changed: true, votes_delta: -20, gap_delta: 8 }
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "page", data)
  })
  assert.match(doc.querySelector(".hv-source-line").textContent, /Последний сохранённый результат/)
  assert.match(doc.querySelector(".hv-change").textContent, /Лидер изменился.*-20.*отрыв \+8/)
  await api.act(async () => root.unmount())
})

test("navigation follows campaign availability and failed refresh retains a visibly flagged observation", async () => {
  let value = { enabled: false, campaign: null },
    fail = false,
    requests = 0
  const { w, doc, api } = runtime(async () => {
    requests++
    if (fail) throw new Error("offline")
    return value
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "watch")
  })
  assert.equal(doc.querySelector('[data-nav="hero-votes"]'), null)
  assert.match(doc.querySelector(".hv-empty").textContent, /нет активного опроса/)
  value = observation()
  await api.act(async () => w.dispatchEvent(new w.Event("dc:hero-votes-changed")))
  assert.ok(doc.querySelector('[data-nav="hero-votes"]'))
  fail = true
  await api.act(async () => w.dispatchEvent(new w.Event("dc:hero-votes-changed")))
  assert.ok(doc.querySelector(".hv-leader"))
  assert.match(doc.querySelector('[role="alert"]').textContent, /Сохранённые данные могут устареть/)
  fail = false
  value = { enabled: false, campaign: null }
  await api.act(async () => button(doc, "Повторить").click())
  assert.equal(doc.querySelector('[data-nav="hero-votes"]'), null)
  const before = requests
  await api.act(async () => root.unmount())
  w.dispatchEvent(new w.Event("dc:hero-votes-changed"))
  assert.equal(requests, before)
})

test("staff create a draft, activate, hide and end it with CSRF and current revisions", async () => {
  let items = [],
    calls = []
  const { w, doc, api } = runtime(async (url, init) => {
    if (!init.method) return { items, preset }
    assert.equal(init.headers.get("X-CSRF-Token"), "qa-csrf")
    const body = JSON.parse(init.body)
    calls.push(body)
    if (!url.endsWith("actions"))
      items = [
        {
          ...observation().campaign,
          ...body,
          id: "campaign",
          visible: false,
          active: false,
          live: false,
          revision: 1,
          ended_at: null,
        },
      ]
    else {
      assert.equal(body.expected_revision, items[0].revision)
      items[0] = {
        ...items[0],
        revision: items[0].revision + 1,
        visible: body.action === "ACTIVATE",
        live: body.action === "ACTIVATE",
        active: body.action !== "END",
        ended_at: body.action === "END" ? "2026-10-03T00:10:00Z" : null,
      }
    }
    return { item: items[0] }
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "admin")
  })
  await api.act(async () => {
    input(w, doc.querySelector("input"), "Новый городской опрос")
    doc
      .querySelector("form")
      .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
  })
  assert.equal(calls[0].title_ru, "Новый городской опрос")
  await api.act(async () => button(doc, "Активировать вкладку").click())
  await api.act(async () => button(doc, "Скрыть вкладку").click())
  await api.act(async () => button(doc, "Завершить кампанию").click())
  assert.deepEqual(
    calls.slice(1).map((item) => item.action),
    ["ACTIVATE", "HIDE", "END"],
  )
  assert.match(doc.querySelector("form h3").textContent, /Завершена/)
  await api.act(async () => root.unmount())
})

test("staff with read permission alone cannot mutate campaigns", async () => {
  const { doc, api } = runtime()
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "admin", undefined, ["hero_votes.read"])
  })
  assert.equal(
    [...doc.querySelectorAll("button")].some((item) =>
      item.textContent.includes("Создать черновик"),
    ),
    false,
  )
  assert.equal(doc.querySelector("input").disabled, true)
  await api.act(async () => root.unmount())
})
