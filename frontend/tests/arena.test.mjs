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
      lib: { entry: "tests/arena-entry.tsx", name: "ArenaTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => environments.forEach((dom) => dom.window.close()))
const response = (data) => ({ ok: true, json: async () => data })
const heroKeys = ["abrams", "bebop", "dynamo", "haze", "ivy", "seven"]
const inventory = heroKeys.map((key, index) => ({
  item_id: `item-${index}`,
  hero_key: key,
  category: "HERO",
  definition_key: key,
  scope: "REAL",
  reserved: false,
  stats: { max_hp: 500, attack: 80, armor: 10, cost: 0 },
  card: {
    id: key,
    hero: key,
    hero_name: key,
    rank: "F",
    title: key,
    image_url: null,
    crop_x: 50,
    crop_y: 50,
    zoom: 1,
  },
}))
const bootstrap = {
  rules: {
    version: "battle-v1",
    budget: 24,
    max_rounds: 12,
    ranks: { F: { cost: 0, coefficient_milli: 1000 } },
    heroes: {},
    bases: {
      ORDINARY: { name: { ru: "Обычная база", en: "Ordinary base" }, cost: 0 },
      HIDDEN_KING: {
        name: { ru: "Двор теней", en: "Court of shadows" },
        cost: 2,
        passive: { ru: "Пассивный эффект", en: "Passive effect" },
        ability: {
          name: { ru: "Сделка в тени", en: "Shadow bargain" },
          description: { ru: "140 урона", en: "140 damage" },
        },
      },
      ARCHMOTHER: { name: { ru: "Стеклянный собор", en: "Glass cathedral" }, cost: 2 },
    },
  },
  squad: {
    revision: 3,
    scope: "REAL",
    base_item_id: null,
    slots: inventory.map((item, i) => ({
      item_id: item.item_id,
      line: Math.floor(i / 2),
      position: i % 2 ? "BACK" : "FRONT",
    })),
  },
  inventory,
  assignments: [
    { id: "assignment-1", mode: "ASSIGNED", slot: 1, status: "OPEN", opponent: "Defence" },
  ],
  active_matches: [],
  progression: {
    account_days: 8,
    confirmed_contracts: 20,
    eligible_pve_wins: 0,
    trials: { HIDDEN_KING: false, ARCHMOTHER: false },
    ex_access: {
      HIDDEN_KING: { eligible: false, reasons: ["TRIAL_REQUIRED"] },
      ARCHMOTHER: { eligible: false, reasons: ["TRIAL_REQUIRED"] },
    },
  },
  season: {
    id: "season-1",
    title: "First season",
    starts_at: "2026-10-01T00:00:00Z",
    ends_at: "2026-11-01T00:00:00Z",
    rating: 1000,
    games: 0,
  },
  showcase: { revision: 1, is_public: false, base_item_id: null, slots: [] },
}
const side = (key) => ({
  side: key,
  energy: 3,
  base: {
    id: `${key}:base`,
    key: "ORDINARY",
    hp: 1000,
    max_hp: 1000,
    ready_round: 1,
    ability: {
      cost: 0,
      name: { ru: "Обычная база", en: "Ordinary base" },
      description: { ru: "Без способности", en: "No ability" },
    },
  },
  guardians: [0, 1, 2].map((line) => ({
    id: `${key}:guard:${line}`,
    line,
    hp: 240,
    max_hp: 240,
    attack: 60,
  })),
  heroes: inventory.map((item, i) => ({
    id: `${key}:${i}`,
    item_id: item.item_id,
    hero_key: item.hero_key,
    name: item.hero_key,
    rank: "F",
    line: Math.floor(i / 2),
    position: i % 2 ? "BACK" : "FRONT",
    hp: 500,
    max_hp: 500,
    attack: 80,
    armor: 10,
    shield: 0,
    ready_round: 1,
    deaths: 0,
    respawn_round: null,
    ability: {
      name: { ru: "Щит", en: "Shield" },
      description: { ru: "Щит 100", en: "100 shield" },
      cost: 2,
      target: "SELF",
    },
  })),
})
const match = {
  id: "match-1",
  mode: "ASSIGNED",
  scope: "REAL",
  status: "ACTIVE",
  round: 1,
  revision: 1,
  player_side: "A",
  state: { round: 1, status: "ACTIVE", sides: [side("A"), side("B")] },
  last_events: [],
  submitted: false,
  opponent_submitted: false,
  result: null,
  reward: null,
}
function runtime(fetch, hash = "#arena", saved = null) {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: `https://qa.invalid/${hash}`,
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
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.localStorage.setItem("dc.ui.language", "en")
  if (saved) w.sessionStorage.setItem("dc-arena-command:test", JSON.stringify(saved))
  w.eval(code)
  return { w, api: w.ArenaTest, doc: w.document }
}
const click = async (env, text) => {
  const button = [...env.doc.querySelectorAll("button")].find(
    (item) => item.textContent.trim() === text,
  )
  assert.ok(button, `button ${text}`)
  await env.api.act(async () => button.click())
}
const mount = async (env) => {
  let root
  await env.api.act(async () => {
    root = env.api.mount(env.doc.getElementById("mount"), { csrf: "csrf", accountKey: "test" })
  })
  return root
}

test("starting PvE first shows patron preparation and names the committed base", async () => {
  const writes = []
  const env = runtime(async (url, init = {}) => {
    if (init.method === "POST") {
      writes.push(JSON.parse(init.body))
      return response({ match })
    }
    if (url.includes("/matches/")) return response({ match })
    return response(bootstrap)
  })
  const root = await mount(env)
  await click(env, "Choose patron & squad")
  assert.equal(writes.length, 0)
  assert.ok(env.doc.querySelector('[aria-label="Patron selection"]'))
  await click(env, "Start battle · Ordinary base")
  assert.equal(writes.length, 1)
  assert.equal(writes[0].assignment_id, "assignment-1")
  assert.equal(writes[0].squad_revision, 3)
  assert.equal(writes[0].base_item_id, null)
  await env.api.act(() => root.unmount())
})

test("checking a saved command reads its receipt without sending another mutation", async () => {
  const saved = {
      url: "/api/arena/matches/match-1/plans",
      method: "POST",
      body: { request_key: "receipt-key", expected_revision: 1, actions: [] },
      match_id: "match-1",
    },
    writes = []
  const env = runtime(
    async (url, init = {}) => {
      if (init.method) writes.push(init.method)
      if (url.includes("/requests/")) return response({ result: { match } })
      if (url.includes("/matches/")) return response({ match })
      return response(bootstrap)
    },
    "#arena/match/match-1",
    saved,
  )
  const root = await mount(env)
  await click(env, "Check saved result")
  assert.equal(writes.length, 0)
  assert.equal(env.w.sessionStorage.getItem("dc-arena-command:test"), null)
  await env.api.act(() => root.unmount())
})
test("public arena showcase uses only the public read model and offers an honestly labelled bot copy", async () => {
  const reads = []
  const env = runtime(async (url) => {
    reads.push(url)
    return response({
      showcase: {
        user_id: "public-user",
        base_key: "HIDDEN_KING",
        budget: 22,
        heroes: inventory.map((item, index) => ({
          hero_key: item.hero_key,
          rank: "F",
          line: Math.floor(index / 2),
          position: index % 2 ? "BACK" : "FRONT",
          card: item.card,
        })),
      },
    })
  })
  let root
  await env.api.act(async () => {
    root = env.api.mountPublic(env.doc.getElementById("mount"), "public-player")
  })
  assert.deepEqual(reads, ["/api/public/players/public-player/arena/showcase"])
  assert.match(env.doc.body.textContent, /22 \/ 24/)
  assert.match(env.doc.body.textContent, /Play bot using squad copy/)
  assert.equal(env.doc.querySelector("a").getAttribute("href"), "/#arena/copy/public-user")
  await env.api.act(() => root.unmount())
})
test("arena presents explicit patron selection, eligibility and six distinct squad slots", async () => {
  const writes = []
  const env = runtime(async (url, init = {}) => {
    if (init.method) {
      writes.push(JSON.parse(init.body))
      return response({ squad: { ...bootstrap.squad, revision: 4 } })
    }
    return response(bootstrap)
  })
  const root = await mount(env)
  await click(env, "Squad & patron")
  assert.match(env.doc.body.textContent, /6 \/ 6/)
  assert.match(env.doc.body.textContent, /0 \/ 24/)
  assert.match(env.doc.body.textContent, /Court of shadows/)
  assert.match(env.doc.body.textContent, /Win this patron's trial/)
  await click(env, "Save squad")
  assert.equal(writes[0].expected_revision, 3)
  assert.equal(writes[0].slots.length, 6)
  assert.equal(writes[0].base_item_id, null)
  await env.api.act(() => root.unmount())
})
test("battle sends an ordered two-action plan and version without client damage or rewards", async () => {
  const writes = []
  const env = runtime(async (url, init = {}) => {
    if (init.method === "POST") {
      writes.push(JSON.parse(init.body))
      return response({
        match: { ...match, round: 2, revision: 2, state: { ...match.state, round: 2 } },
      })
    }
    if (url.includes("/matches/")) return response({ match })
    return response(bootstrap)
  }, "#arena/match/match-1")
  const root = await mount(env)
  assert.match(env.doc.body.textContent, /Round 1/)
  await click(env, "Use Shield")
  await click(env, "Add swap")
  await click(env, "Confirm plan")
  assert.equal(writes.length, 1)
  assert.equal(writes[0].expected_revision, 1)
  assert.equal(writes[0].actions.length, 2)
  assert.equal(writes[0].actions[0].type, "HERO_ABILITY")
  assert.equal(writes[0].actions[1].type, "SWAP")
  assert.ok(writes[0].request_key)
  assert.ok(!("damage" in writes[0]))
  assert.match(env.doc.body.textContent, /Round 2/)
  await env.api.act(() => root.unmount())
})
test("a late same-revision GET cannot reopen a sealed PvP plan", async () => {
  let reads = 0,
    resolveLate
  const env = runtime(async (url, init = {}) => {
    if (init.method === "POST")
      return response({ match: { ...match, mode: "FRIENDLY", submitted: true } })
    if (url.includes("/matches/")) {
      reads++
      if (reads === 2)
        return new Promise((resolve) => {
          resolveLate = resolve
        })
      return response({ match: { ...match, mode: "FRIENDLY" } })
    }
    return response(bootstrap)
  }, "#arena/match/match-1")
  const root = await mount(env)
  await click(env, "Refresh battle")
  await click(env, "Confirm plan")
  assert.match(env.doc.body.textContent, /Plan sealed/)
  await env.api.act(async () =>
    resolveLate(response({ match: { ...match, mode: "FRIENDLY", submitted: false } })),
  )
  assert.match(env.doc.body.textContent, /Plan sealed/)
  assert.ok(
    ![...env.doc.querySelectorAll("button")].find((item) => item.textContent === "Confirm plan"),
  )
  await env.api.act(() => root.unmount())
})
test("an uncertain persisted plan retries the exact key and payload after reload", async () => {
  const saved = {
    url: "/api/arena/matches/match-1/plans",
    method: "POST",
    body: { request_key: "fixed-key", expected_revision: 1, actions: [] },
    match_id: "match-1",
  }
  const writes = []
  const env = runtime(
    async (url, init = {}) => {
      if (init.method === "POST") {
        writes.push(JSON.parse(init.body))
        return response({ match })
      }
      if (url.includes("/matches/")) return response({ match })
      return response(bootstrap)
    },
    "#arena/match/match-1",
    saved,
  )
  const root = await mount(env)
  assert.match(env.doc.body.textContent, /Request saved/)
  await click(env, "Retry saved request")
  assert.deepEqual(writes, [saved.body])
  assert.equal(env.w.sessionStorage.getItem("dc-arena-command:test"), null)
  await env.api.act(() => root.unmount())
})
test("friendly rooms show both confirmations and open only the returned match", async () => {
  const writes = []
  const env = runtime(async (url, init = {}) => {
    if (init.method === "POST") {
      writes.push({ url, body: JSON.parse(init.body) })
      return response({
        room: {
          code: "ABC123",
          status: "WAITING",
          match_id: null,
          own_confirmed: false,
          opponent_confirmed: false,
        },
      })
    }
    if (url.includes("/leaderboard")) return response({ items: [] })
    if (url.includes("/rooms/"))
      return response({
        room: {
          code: "ABC123",
          status: "WAITING",
          match_id: null,
          own_confirmed: false,
          opponent_confirmed: false,
        },
      })
    return response(bootstrap)
  })
  const root = await mount(env)
  await click(env, "Rooms & season")
  await click(env, "Create room")
  assert.match(env.doc.body.textContent, /ABC123/)
  assert.match(env.doc.body.textContent, /No coins for friendly matches/)
  assert.equal(writes[0].body.scope, "REAL")
  await click(env, "Confirm squad & base")
  assert.equal(writes.length, 1)
  await click(env, "Start battle · Ordinary base")
  assert.equal(writes[1].body.squad_revision, 3)
  assert.equal(writes[1].body.base_item_id, null)
  await env.api.act(() => root.unmount())
})

test("a sealed PvP plan still allows a confirmed surrender", async () => {
  const writes = []
  const env = runtime(async (url, init = {}) => {
    if (init.method === "POST") {
      writes.push({ url, body: JSON.parse(init.body) })
      return response({
        match: { ...match, status: "FINISHED", result: { winner_side: "B", reason: "SURRENDER" } },
      })
    }
    if (url.includes("/matches/"))
      return response({ match: { ...match, mode: "FRIENDLY", submitted: true } })
    return response(bootstrap)
  }, "#arena/match/match-1")
  const root = await mount(env)
  await click(env, "Surrender")
  assert.equal(writes.length, 0)
  await click(env, "Yes, surrender")
  assert.equal(writes.length, 1)
  assert.match(writes[0].url, /\/surrender$/)
  assert.equal(writes[0].body.expected_revision, 1)
  assert.match(env.doc.body.textContent, /Defeat/)
  await env.api.act(() => root.unmount())
})

test("a restored sandbox room confirms the sandbox squad revision after explicit preparation", async () => {
  const writes = []
  const room = {
    code: "TEST42",
    scope: "SANDBOX",
    status: "WAITING",
    match_id: null,
    own_confirmed: false,
    opponent_confirmed: false,
  }
  const env = runtime(async (url, init = {}) => {
    if (init.method === "POST") {
      writes.push(JSON.parse(init.body))
      return response({ room: { ...room, own_confirmed: true } })
    }
    if (url.includes("/rooms/")) return response({ room })
    if (url.includes("/queue")) return response({ queued: false })
    const sandbox = url.includes("scope=SANDBOX")
    return response({
      ...bootstrap,
      squad: { ...bootstrap.squad, scope: sandbox ? "SANDBOX" : "REAL", revision: sandbox ? 9 : 3 },
    })
  }, "#arena/social/TEST42")
  const root = await mount(env)
  assert.equal(env.doc.querySelector('[aria-label="Arena scope"]').value, "SANDBOX")
  await click(env, "Confirm squad & base")
  assert.equal(writes.length, 0)
  await click(env, "Start battle · Ordinary base")
  assert.equal(writes[0].squad_revision, 9)
  await env.api.act(() => root.unmount())
})

test("weekly preparation names its fixed loan and ordinary base rather than an owned patron", async () => {
  const writes = []
  const env = runtime(async (url, init = {}) => {
    if (init.method === "POST") {
      writes.push(JSON.parse(init.body))
      return response({ match })
    }
    if (url.includes("/matches/")) return response({ match })
    return response({ ...bootstrap, squad: { ...bootstrap.squad, base_item_id: "owned-ex" } })
  })
  const root = await mount(env)
  const weekly = [...env.doc.querySelectorAll("article")].find(
    (item) => item.querySelector("h3")?.textContent === "Weekly challenge",
  )
  await env.api.act(() => weekly.querySelector("button").click())
  assert.match(env.doc.body.textContent, /fixed loaned squad and Ordinary base/)
  assert.ok(!env.doc.querySelector('[aria-label="Patron selection"]'))
  await click(env, "Start battle · Ordinary base")
  assert.equal(writes[0].mode, "WEEKLY")
  await env.api.act(() => root.unmount())
})

test("a plan conflict clears its saved command and reloads the current round", async () => {
  let posted = false
  const env = runtime(async (url, init = {}) => {
    if (init.method === "POST") {
      posted = true
      return { ok: false, status: 409, json: async () => ({ detail: "Round changed" }) }
    }
    if (url.includes("/matches/"))
      return response({ match: posted ? { ...match, round: 2, revision: 2 } : match })
    return response(bootstrap)
  }, "#arena/match/match-1")
  const root = await mount(env)
  await click(env, "Confirm plan")
  assert.equal(env.w.sessionStorage.getItem("dc-arena-command:test"), null)
  assert.match(env.doc.body.textContent, /Round changed/)
  assert.match(env.doc.body.textContent, /Round 2/)
  await env.api.act(() => root.unmount())
})

test("Lady Geist cannot pay her ability HP cost at forty health", async () => {
  const battle = structuredClone(match)
  Object.assign(battle.state.sides[0].heroes[0], {
    hero_key: "lady-geist",
    hp: 40,
    ability: { name: "Blood gift", description: "Pay 40 HP", cost: 2, target: "SELF" },
  })
  const env = runtime(
    async (url) => (url.includes("/matches/") ? response({ match: battle }) : response(bootstrap)),
    "#arena/match/match-1",
  )
  const root = await mount(env)
  assert.ok(
    [...env.doc.querySelectorAll("button")].find((item) => item.textContent === "Use Blood gift")
      .disabled,
  )
  await env.api.act(() => root.unmount())
})

test("squad preview uses each owned approved definition rather than the global hero version", async () => {
  const data = structuredClone(bootstrap)
  data.rules.heroes.abrams = { role: "Global role", ability: { description: "Global ability" } }
  data.inventory[0].definition = {
    id: "approved-v2",
    key: "abrams",
    category: "HERO",
    version: 2,
    rules: { role: "Approved v2 role", ability: { description: "Approved v2 ability" } },
  }
  const env = runtime(async () => response(data), "#arena/squad")
  const root = await mount(env)
  assert.match(env.doc.body.textContent, /Approved v2 role/)
  assert.match(env.doc.body.textContent, /Approved v2 ability/)
  assert.doesNotMatch(env.doc.body.textContent, /Global ability/)
  await env.api.act(() => root.unmount())
})
