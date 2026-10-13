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
      lib: { entry: "tests/gwent-entry.tsx", name: "GwentTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => environments.forEach((dom) => dom.window.close()))
const unit = (id, extra = {}) => ({
  id,
  kind: "UNIT",
  hero_key: "abrams",
  name: "Abrams",
  rank: "C",
  power: 6,
  base_power: 6,
  rows: [0, 1],
  effect: "NONE",
  effect_amount: 0,
  description: "Hold the street.",
  protected: false,
  card: {
    id: "original-card",
    rank: "C",
    hero_name: "Abrams",
    title: "Night patrol",
    image_url: "/original-art.png",
    crop_x: 23,
    crop_y: 67,
    zoom: 1.4,
  },
  ...extra,
})
const side = (key) => ({
  side: key,
  heroes: [],
  guardians: [0, 1, 2].map((line) => ({ id: `${key}:guard:${line}`, line, hp: 240, max_hp: 240 })),
  energy: 0,
  base: {
    id: `${key}:base`,
    key: "ORDINARY",
    name: "Ordinary base",
    ability: { name: "No ability", description: "No ability", target: "NONE" },
  },
  hand: key === "A" ? [unit("A:unit")] : [],
  hand_count: key === "A" ? 1 : 8,
  deck: [],
  deck_count: 14,
  rows: [[], [], []],
  graveyard: [],
  graveyard_count: 0,
  passed: false,
  wins: 0,
  score: 0,
  row_scores: [0, 0, 0],
  leader_used: false,
  mulligans_remaining: 2,
  mulligan_done: true,
})
const data = {
  rules: {
    version: "gwent-v1",
    budget: 24,
    max_rounds: 3,
    ranks: {},
    heroes: {},
    bases: { ORDINARY: { name: "Ordinary base" } },
  },
}
const match = {
  id: "match-gwent",
  mode: "TRAINING",
  scope: "REAL",
  status: "ACTIVE",
  round: 1,
  revision: 1,
  player_side: "A",
  state: {
    game: "GWENT",
    rules: data.rules,
    round: 1,
    turn: 0,
    phase: "PLAY",
    turn_side: "A",
    weather: [],
    history: [],
    status: "ACTIVE",
    sides: [side("A"), side("B")],
  },
  submitted: false,
  opponent_submitted: false,
  last_events: [],
  result: null,
  reward: null,
}
async function setup(battle = match, props = {}) {
  const dom = new JSDOM('<div id="mount"></div>', {
    url: "https://qa.invalid/",
    runScripts: "outside-only",
  })
  environments.push(dom)
  const w = dom.window
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }
  }
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.localStorage.setItem("dc.ui.language", "en")
  w.eval(code)
  const actions = []
  let root
  await w.GwentTest.act(async () => {
    root = w.GwentTest.mount(w.document.getElementById("mount"), {
      match: structuredClone(battle),
      data,
      onPlan: (a) => actions.push(a),
      ...props,
    })
  })
  return { w, doc: w.document, actions, root, api: w.GwentTest }
}
async function click(env, label) {
  const button = [...env.doc.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent.trim() === label,
  )
  assert.ok(button, `button ${label}`)
  await env.api.act(async () => button.click())
  return button
}
async function close(env) {
  await env.api.act(() => env.root.unmount())
}
test("selecting original art then a legal row sends one PLAY command", async () => {
  const env = await setup()
  assert.equal(env.doc.querySelectorAll(".gwent-row").length, 6)
  assert.equal(env.doc.querySelector(".gwent-hand img").getAttribute("src"), "/original-art.png")
  assert.equal(env.doc.querySelector(".gwent-hand img").style.objectPosition, "23% 67%")
  await click(env, "Select Abrams")
  await click(env, "Play on Street")
  assert.deepEqual(JSON.parse(JSON.stringify(env.actions)), [
    [{ type: "PLAY", card_id: "A:unit", row: 0 }],
  ])
  assert.doesNotMatch(env.doc.body.textContent, /HP|energy|guardian|Confirm plan/)
  assert.match(env.doc.body.textContent, /8 cards/)
  await close(env)
})
test("passing sends only PASS", async () => {
  const env = await setup()
  await click(env, "Pass round")
  assert.deepEqual(JSON.parse(JSON.stringify(env.actions)), [[{ type: "PASS" }]])
  await close(env)
})
test("mulligan and ready preserve the current card id", async () => {
  const battle = structuredClone(match)
  battle.state.phase = "MULLIGAN"
  battle.state.sides.forEach((s) => (s.mulligan_done = false))
  const env = await setup(battle)
  await click(env, "Select Abrams")
  await click(env, "Replace card")
  await click(env, "Ready")
  assert.deepEqual(JSON.parse(JSON.stringify(env.actions)), [
    [{ type: "MULLIGAN", card_id: "A:unit" }],
    [{ type: "READY" }],
  ])
  await close(env)
})
test("decoy selects a legal target and requires explicit play confirmation", async () => {
  const battle = structuredClone(match)
  battle.state.sides[0].hand = [
    unit("A:decoy", { kind: "SPECIAL", name: "Decoy", effect: "DECOY", rows: [], card: undefined }),
  ]
  battle.state.sides[0].rows[0] = [unit("A:board")]
  const env = await setup(battle)
  await click(env, "Select Decoy")
  await click(env, "Target Abrams")
  assert.equal(env.actions.length, 0)
  await click(env, "Play selected card")
  assert.deepEqual(JSON.parse(JSON.stringify(env.actions)), [
    [{ type: "PLAY", card_id: "A:decoy", target_id: "A:board" }],
  ])
  await close(env)
})
for (const condition of ["blocked", "opponent", "passed", "finished"])
  test(`${condition} state cannot submit battle commands`, async () => {
    const battle = structuredClone(match)
    if (condition === "opponent") battle.state.turn_side = "B"
    if (condition === "passed") battle.state.sides[0].passed = true
    if (condition === "finished") {
      battle.status = "FINISHED"
      battle.result = { winner_side: "A", reason: "ROUND_WINS" }
    }
    const env = await setup(battle, { blocked: condition === "blocked" })
    const pass = [...env.doc.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Pass round",
    )
    assert.ok(!pass || pass.disabled)
    await click(env, "Select Abrams")
    const play = [...env.doc.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Play on Street",
    )
    assert.ok(!play || play.disabled)
    assert.equal(env.actions.length, 0)
    if (condition === "opponent") assert.match(env.doc.body.textContent, /Opponent’s turn/)
    if (condition === "finished") assert.match(env.doc.body.textContent, /Victory/)
    await close(env)
  })
test("arena-v1 snapshots retain their legacy plan renderer", async () => {
  const battle = structuredClone(match)
  delete battle.state.game
  delete battle.state.phase
  delete battle.state.turn_side
  delete battle.state.rules
  battle.state.sides = ["A", "B"].map((key) => ({
    side: key,
    energy: 3,
    base: {
      id: `${key}:base`,
      key: "ORDINARY",
      hp: 1000,
      max_hp: 1000,
      ready_round: 1,
      ability: { cost: 0, name: "Ordinary base", description: "No ability", target: "NONE" },
    },
    guardians: [0, 1, 2].map((line) => ({
      id: `${key}:guard:${line}`,
      line,
      hp: 240,
      max_hp: 240,
      attack: 60,
    })),
    heroes: [],
  }))
  const env = await setup(battle)
  assert.match(env.doc.body.textContent, /Confirm plan/)
  assert.equal(env.doc.querySelectorAll(".gwent-row").length, 0)
  await close(env)
})
test("a waiting match names the opponent wait and blocks commands", async () => {
  const battle = structuredClone(match)
  battle.status = "WAITING"
  const env = await setup(battle)
  assert.match(env.doc.body.textContent, /Waiting for opponent/)
  assert.ok(
    [...env.doc.querySelectorAll("button")].find((b) => b.textContent.trim() === "Pass round")
      .disabled,
  )
  await close(env)
})
test("an EX targets an unprotected enemy and consumes one explicit command", async () => {
  const battle = structuredClone(match)
  battle.state.sides[0].base = {
    id: "A:base",
    key: "HIDDEN_KING",
    name: "Hidden King",
    ability: {
      name: "Shadow Bargain",
      description: "Reduce an enemy’s strength by 4.",
      target: "ENEMY",
    },
  }
  battle.state.sides[1].rows[0] = [
    unit("B:protected", { name: "Protected Abrams", protected: true }),
    unit("B:target"),
  ]
  const env = await setup(battle)
  await click(env, "Use EX")
  assert.ok(
    ![...env.doc.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Target Protected Abrams",
    ),
  )
  await click(env, "Target Abrams")
  assert.equal(env.actions.length, 0)
  await click(env, "Confirm EX")
  assert.deepEqual(JSON.parse(JSON.stringify(env.actions)), [
    [{ type: "LEADER", target_id: "B:target" }],
  ])
  await close(env)
  battle.state.sides[0].leader_used = true
  const used = await setup(battle)
  assert.ok(
    [...used.doc.querySelectorAll("button")].find((b) => b.textContent.trim() === "EX used")
      .disabled,
  )
  await close(used)
})

test("selecting an approved EX version previews the frozen name and combat effect", async () => {
  const env = await setup()
  await close(env)
  const heroes = ["abrams", "bebop", "dynamo", "haze", "ivy", "seven"].map((key, i) => ({
    item_id: `hero-${i}`,
    hero_key: key,
    category: "HERO",
    card: { ...unit(key).card, id: key, hero_name: key },
    stats: { cost: 0, power: 4 },
  }))
  const patron = (version, amount) => ({
    item_id: `base-v${version}`,
    hero_key: "HIDDEN_KING",
    category: "BASE",
    definition_key: "HIDDEN_KING",
    reserved: false,
    card: { ...unit("base").card, rank: "EX", hero_name: `King v${version}` },
    stats: { cost: 2 },
    definition: {
      version,
      rules: {
        name: `Historical King v${version}`,
        ability: { name: "Legacy", description: "140 HP damage" },
      },
      combat_rules: {
        name: `Approved King v${version}`,
        ability: {
          name: "Shadow Bargain",
          description: `Reduce enemy strength by ${amount}.`,
          effect: "DAMAGE",
          effect_amount: amount,
          target: "ENEMY",
        },
      },
    },
  })
  const boot = {
    ...data,
    inventory: [...heroes, patron(1, 4), patron(2, 7)],
    squad: {
      revision: 1,
      scope: "REAL",
      base_item_id: "base-v1",
      slots: heroes.map((hero, i) => ({
        item_id: hero.item_id,
        line: Math.floor(i / 2),
        position: i % 2 ? "BACK" : "FRONT",
      })),
    },
    progression: {
      account_days: 8,
      confirmed_contracts: 20,
      eligible_pve_wins: 15,
      ex_access: {},
      trials: {},
    },
    rules: {
      ...data.rules,
      heroes: {},
      bases: {
        ORDINARY: { name: "Ordinary base" },
        HIDDEN_KING: {
          name: "Canonical King",
          ability: { name: "Shadow Bargain", description: "Reduce enemy strength by 4." },
        },
        ARCHMOTHER: { name: "Archmother" },
      },
    },
  }
  await env.api.act(
    async () => (env.root = env.api.mountEditor(env.doc.getElementById("mount"), boot)),
  )
  assert.match(env.doc.body.textContent, /Reduce enemy strength by 4/)
  const select = env.doc.querySelector('.arena-patron[data-patron="HIDDEN_KING"] select')
  await env.api.act(async () => {
    select.value = "base-v2"
    select.dispatchEvent(new env.w.Event("change", { bubbles: true }))
  })
  assert.match(env.doc.body.textContent, /Approved King v2/)
  assert.match(env.doc.body.textContent, /Reduce enemy strength by 7/)
  assert.doesNotMatch(env.doc.body.textContent, /140 HP damage/)
  await close(env)
})
test("hand arrow keys move focus without playing a card", async () => {
  const battle = structuredClone(match)
  battle.state.sides[0].hand.push(unit("A:second"))
  const env = await setup(battle),
    buttons = [...env.doc.querySelectorAll(".gwent-hand-cards .gwent-card")]
  buttons[0].focus()
  await env.api.act(async () =>
    buttons[0].dispatchEvent(
      new env.w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    ),
  )
  assert.equal(env.doc.activeElement, buttons[1])
  assert.equal(env.actions.length, 0)
  await env.api.act(async () =>
    buttons[1].dispatchEvent(
      new env.w.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    ),
  )
  assert.equal(env.doc.activeElement, buttons[0])
  await close(env)
})
test("the optional card dossier closes with Escape and returns keyboard focus", async () => {
  const env = await setup()
  await click(env, "Select Abrams")
  assert.equal(env.doc.querySelector('[role="dialog"]'), null)
  const inspect = [...env.doc.querySelectorAll("button")].find(
    (button) => button.textContent.trim() === "Inspect card",
  )
  inspect.focus()
  await click(env, "Inspect card")
  const dialog = env.doc.querySelector('[role="dialog"]')
  assert.ok(dialog)
  assert.match(dialog.textContent, /Hold the street/)
  assert.equal(dialog.querySelector("img").style.objectPosition, "23% 67%")
  assert.equal(env.doc.activeElement.getAttribute("aria-label"), "Close card inspection")
  await env.api.act(async () =>
    env.doc.dispatchEvent(new env.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  )
  assert.equal(env.doc.querySelector('[role="dialog"]'), null)
  assert.equal(env.doc.activeElement, inspect)
  await close(env)
})

for (const [sideIndex, label] of [
  [0, "Your graveyard"],
  [1, "Opponent graveyard"],
]) {
  test(`${label} opens the discarded card dossier without playing it`, async () => {
    const battle = structuredClone(match)
    battle.state.sides[sideIndex].graveyard = [
      unit("discarded-unit", {
        name: "Discarded patrol",
        description: "This patrol left the battlefield.",
      }),
    ]
    battle.state.sides[sideIndex].graveyard_count = 1
    const env = await setup(battle)
    await click(env, label)
    await click(env, "Inspect Discarded patrol")
    const dialog = env.doc.querySelector('[role="dialog"]')
    assert.ok(dialog, "discarded card inspection must be visible")
    assert.match(dialog.textContent, /This patrol left the battlefield/)
    assert.equal(env.actions.length, 0)
    await close(env)
  })
}
