// Isolated QA fixture using production components. Layout data is explicitly synthetic;
// the original Nurse Harrow poster is copied unchanged and is never used as arena art.
import { build } from "vite"
import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises"
import path from "node:path"
const target = path.resolve("../.qa/arena-original-collection")
await mkdir(target, { recursive: true })
const source = await readFile("tests/arena.test.mjs", "utf8")
const fixtures = new Function(
  `${source.slice(source.indexOf("const heroKeys"), source.indexOf("function runtime"))}; return {bootstrap,match,inventory,heroKeys}`,
)()
const { bootstrap, match, inventory, heroKeys } = fixtures
const originalCard = {
  id: "364efc49-3038-51f4-8dec-c24538b7145a",
  hero: "nurse-harrow",
  hero_name: "Nurse Harrow",
  rank: "F",
  category: "HERO",
  battle_eligible: false,
  title: "City Never Sleeps · Nurse Harrow",
  description:
    "Официальная иллюстрация Valve / Official Valve artwork. Неофициальная коллекция / Unofficial collection.",
  artist: "Valve",
  source_url: "https://www.playdeadlock.com/cityneversleeps",
  image_url: "city-never-sleeps/nurse-harrow.webp",
  release_poster: true,
  crop_x: 50,
  crop_y: 50,
  zoom: 1,
  frame_version: 1,
  status: "PUBLISHED",
  revision: 1,
}
bootstrap.starter = { claimed: false, available: false, missing_heroes: heroKeys }
bootstrap.unavailable_inventory = [
  { item_id: "qa-owned-original-harrow", card: originalCard, reason: "UNSUPPORTED_HERO" },
]
bootstrap.rules.bases.HIDDEN_KING.passive = {
  ru: "Первая обычная атака по зданию +10%, если у атакующего ≤40% HP.",
  en: "First basic attack against a building gains 10% if the attacker has ≤40% HP.",
}
bootstrap.rules.bases.ARCHMOTHER.passive = {
  ru: "Первый щит от способности героя в раунде +15%.",
  en: "First hero ability shield each round gains 15%.",
}
bootstrap.inventory.push({
  item_id: "base-ex",
  card: {
    ...inventory[0].card,
    id: "hidden-king-ex",
    hero: "HIDDEN_KING",
    hero_name: "Hidden King",
    rank: "EX",
    category: "BASE",
    title: "Court of shadows",
    image_url: null,
  },
  hero_key: "HIDDEN_KING",
  category: "BASE",
  definition_key: "HIDDEN_KING",
  scope: "REAL",
  reserved: false,
  stats: { max_hp: 1000, attack: 0, armor: 0, cost: 2 },
})
bootstrap.squad.base_item_id = "base-ex"
bootstrap.progression.trials.HIDDEN_KING = true
bootstrap.progression.ex_access.HIDDEN_KING = { eligible: true, reasons: [] }
bootstrap.progression.ex_access.ARCHMOTHER = { eligible: false, reasons: ["PATRON_TRIAL"] }
bootstrap.season.earned_title = "TACTICIAN"
bootstrap.active_matches = [
  { id: "match-1", mode: "ASSIGNED", scope: "REAL", status: "ACTIVE", revision: 4, round: 4 },
]
match.round = 4
match.revision = 4
match.state.round = 4
match.state.sides[0].base = {
  ...match.state.sides[0].base,
  key: "HIDDEN_KING",
  hp: 810,
  ready_round: 6,
  ability: {
    cost: 3,
    name: { ru: "Сделка в тени", en: "Shadow bargain" },
    description: {
      ru: "60 HP союзника → 140 урона стражу или базе",
      en: "60 ally HP → 140 damage to guardian or base",
    },
  },
}
match.state.sides[1].base = {
  ...match.state.sides[1].base,
  key: "ARCHMOTHER",
  hp: 920,
  ability: {
    cost: 3,
    name: { ru: "Материнский покров", en: "Mother's protection" },
    description: { ru: "Щит 100 союзникам линии", en: "Shield lane allies for 100" },
  },
}
match.state.sides[0].heroes[0].hp = 180
match.state.sides[0].heroes[0].shield = 100
match.state.sides[0].heroes[1].hp = 0
match.state.sides[0].heroes[1].deaths = 1
match.state.sides[0].heroes[1].respawn_round = 6
match.last_events = [
  {
    type: "BASIC_ATTACK",
    text: {
      ru: "Abrams атаковал стража: 80 физического урона",
      en: "Abrams attacked the guardian for 80 physical damage",
    },
  },
]
await mkdir(path.join(target, "city-never-sleeps"), { recursive: true })
await cp(
  "../app/data/archive/city-never-sleeps/nurse-harrow.webp",
  path.join(target, "city-never-sleeps/nurse-harrow.webp"),
)
await cp("dist/assets", path.join(target, "assets"), { recursive: true })
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
for (const item of result[0].output)
  if (item.type === "chunk") await writeFile(path.join(target, "arena.js"), item.code)
  else if (item.fileName.endsWith(".css"))
    await writeFile(path.join(target, "arena.css"), item.source)
const styles = (await readdir(path.join(target, "assets")))
  .filter((name) => name.endsWith(".css"))
  .map((name) => `<link rel="stylesheet" href="assets/${name}">`)
  .join("")
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<link rel="stylesheet" href="arena.css"><title>Original collection / Arena QA</title></head><body><div class="ns-private"><section class="arena-page"><section class="arena-panel"><h2 id="qa-title"></h2><p id="qa-note"></p><div id="original-card" style="max-width:260px;margin:auto"></div></section></section><div id="mount"></div></div><script src="arena.js"></script><script>
const bootstrap=${JSON.stringify(bootstrap)},match=${JSON.stringify(match)},originalCard=${JSON.stringify(originalCard)};
const params=new URLSearchParams(location.search),mode=params.get('mode')||'collection',ru=(params.get('lang')||'ru')==='ru';
localStorage.setItem('dc.ui.language',params.get('lang')||'ru');localStorage.setItem('dc.ui.appearance',JSON.stringify({theme:params.get('theme')||'dark',motion:params.get('motion')!=='false'}));
document.getElementById('qa-title').textContent=ru?'QA · оригинальная коллекционная карта':'QA · original collection card';
document.getElementById('qa-note').textContent=ru?'Исходный постер Nurse Harrow сохранён без изменений. Карта остаётся в коллекции; одобренных правил боя для этого героя пока нет. Это изолированный QA-сценарий, не данные аккаунта. Дополнительные режимы squad/battle используют условные составы без арта.':'The original Nurse Harrow poster is unchanged. The card remains in the collection; this hero has no approved battle rules yet. This is an isolated QA scenario, not account data. Additional squad/battle modes use synthetic squads without artwork.';
if(mode==='collection'){bootstrap.inventory=[];bootstrap.squad={...bootstrap.squad,base_item_id:null,slots:[]};bootstrap.active_matches=[];bootstrap.assignments=[];}
location.hash=mode==='squad'?'arena/squad':mode==='room'?'arena/social/QA1234':mode==='hub'||mode==='collection'?'arena':'arena/match/match-1';
if(mode==='result'){match.status='FINISHED';match.result={winner_side:'A',reason:'BASE_DESTROYED'};match.reward={source_type:'pve',source_id:'match-1',status:'RESERVED',reason:'AWARDED',amount:8,nominal_amount:8};}
window.fetch=async(url,init={})=>({ok:true,json:async()=>url.includes('/matches/')?{match}:url.includes('/rooms/')?{room:{code:'QA1234',status:'WAITING',match_id:null,own_confirmed:true,opponent_confirmed:false}}:url.includes('/queue')?{queued:false,match:null}:url.includes('/leaderboard')?{players:[{slug:'qa-player',display_name:'Bureau tactician',rating:1120,games:12,earned_title:'TACTICIAN'}]}:bootstrap});
ArenaTest.mount(document.getElementById('mount'),{csrf:'qa-only',accountKey:'qa-fixture'});
ArenaTest.mountCollectionCard(document.getElementById('original-card'),originalCard);
</script></body></html>`
await writeFile(path.join(target, "index.html"), html)
console.log(target)
