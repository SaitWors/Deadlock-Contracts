import { AppearanceButton, AppearanceProvider } from "../src/Appearance"
import { createRoot } from "react-dom/client"
import { useState } from "react"
import { LanguageProvider, LanguageSwitch } from "../src/i18n"
import PackShop from "../src/archive/PackShop"
import PackReveal from "../src/archive/PackReveal"
import { ReceiptView } from "../src/archive/transactions"
import type { FavoriteControls } from "../src/archive/favorites"
import { RANKS, type Card, type Pack, type Rank, type Receipt } from "../src/archive/types"

const allRanks: Rank[] = [...RANKS, "EX"]
const titles: Record<Rank, string> = {
  F: "Dust Records",
  E: "Metal Imprint",
  D: "Whisper in the Vault",
  C: "Crystal Archive",
  B: "Overcharged Coil",
  A: "Invocation Seal",
  S: "Golden Relic",
  SS: "Reality Fracture",
  SSS: "A Message from the Patron",
  EX: "Command Chamber",
}

const cards = Object.fromEntries(
  allRanks.map((rank) => [
    rank,
    {
      id: `demo-card-${rank}`,
      hero: rank === "EX" ? "hidden_king" : "demo",
      hero_name: rank === "EX" ? "Demo Base" : "Demo Operative With A Deliberately Long Name",
      rank,
      category: rank === "EX" ? "BASE" : "HERO",
      title: titles[rank],
      description: "Offline visual fixture",
      artist: "Valve",
      source_url: "https://www.playdeadlock.com/cityneversleeps",
      image_url: "art.webp",
      release_poster: true,
      crop_x: 50,
      crop_y: 50,
      zoom: 1,
      frame_version: 1,
      status: "PUBLISHED",
      revision: 1,
    } satisfies Card,
  ]),
) as Record<Rank, Card>

const five: Rank[] = ["E", "C", "A", "SSS", "EX"]
const examples = [
  { key: "empty", label: "Empty pack", ranks: [] },
  { key: "single", label: "One card", ranks: ["F"] },
  { key: "five", label: "Five cards", ranks: five },
  { key: "all", label: "All ten ranks", ranks: allRanks },
  { key: "repeated", label: "Repeated ranks", ranks: ["B", "B", "SS", "SS", "B"] },
  { key: "high", label: "High ranks", ranks: ["S", "SS", "SSS", "EX", "SSS"] },
  { key: "duplicates", label: "Duplicate cards", ranks: ["F", "F", "F", "A", "A"] },
  { key: "art", label: "Damaged and missing artwork", ranks: ["D", "C", "EX"] },
  { key: "gift", label: "Gift receipt", ranks: five },
  { key: "sandbox", label: "Owner test grant", ranks: ["A", "A", "A"] },
] satisfies { key: string; label: string; ranks: Rank[] }[]

type Example = (typeof examples)[number]

function exampleReceipt({ key, ranks }: Example, revision = 0): Receipt {
  const gift = key === "gift"
  const sandbox = key === "sandbox"
  const distinctDesigns = key === "repeated" || key === "high"
  const seen = new Set<Rank>()
  return {
    id: `demo-${key}-${revision}`,
    kind: gift ? "GIFT_PACK_OPEN" : sandbox ? "OWNER_CARD" : "PACK_OPEN",
    scope: sandbox ? "SANDBOX" : "REAL",
    delta: gift || sandbox ? 0 : -90,
    balance_after: 240,
    created_at: "2026-09-13T12:00:00Z",
    pack: {
      id: "demo",
      title: gift ? "Demo: Gift Dispatch" : "Demo: Bureau Night Dispatch",
      price: gift || sandbox ? 0 : 90,
      revision: 1,
      draws: ranks.length,
      odds: [],
    },
    items: ranks.map((rank, index) => {
      const duplicate = !distinctDesigns && seen.has(rank)
      seen.add(rank)
      const card = { ...cards[rank] }
      if (distinctDesigns) {
        card.id = `${card.id}-${index}`
        card.title = `${card.title} · Design ${index + 1}`
      }
      if (key === "art" && index < 2) {
        card.image_url = index === 0 ? "data:image/webp;base64,AAAA" : null
      }
      return {
        id: `demo-${key}-item-${index}`,
        card,
        duplicate,
        test_grant: sandbox,
        forced: gift && rank === "SSS",
        natural_rank: gift && rank === "SSS" ? "F" : undefined,
        recycle_value: 0,
      }
    }),
  }
}

const packs: Pack[] = ["Ночная почта", "Личные дела", "Архив города"].map((title, index) => ({
  id: `demo-${index}`,
  revision: 1,
  title,
  description: "Учебный выпуск для просмотра оформления. Никаких реальных покупок.",
  price: 90,
  draws: 5,
  active: true,
  starter: false,
  ready: true,
  card_count: 9,
  cover: cards[RANKS[index + 5]],
  odds: RANKS.map((rank) => ({ rank, weight: 1, total_weight: 9, percent: 100 / 9 })),
  recommendation: {
    price: 90,
    model: 1,
    discount_percent: 0,
    expected_direct_cost: 90,
    weeks_at_150: 0.6,
  },
  entries: RANKS.map((rank) => ({
    card: cards[rank],
    card_id: cards[rank].id,
    rank,
    weight: 1,
    percent: 100 / 9,
  })),
}))

// All fixture reads terminate here; no request can reach the production site.
globalThis.fetch = async (input) => {
  const url = new URL(String(input), "https://offline.invalid")
  const pack = packs.find((item) => url.pathname === `/api/archive/packs/${item.id}`)
  if (url.pathname === "/api/archive/packs")
    return new Response(JSON.stringify({ items: packs, total: 3, starter_claimed: true }))
  if (pack) return new Response(JSON.stringify({ pack }))
  throw new Error("Offline preview blocked a live-data request")
}

function Fixture() {
  const [shown, setShown] = useState<Receipt | null>(() => exampleReceipt(examples[2]))
  const [balance, setBalance] = useState(330)
  const [revision, setRevision] = useState(0)
  const [favoriteIds, setFavoriteIds] = useState<string[]>([])
  const [favoriteRevision, setFavoriteRevision] = useState(0)
  const favorites: FavoriteControls = {
    ids: favoriteIds,
    revision: favoriteRevision,
    loading: false,
    pendingId: null,
    error: "",
    reload() {},
    async setFavorite(id, marked) {
      setFavoriteIds((ids) =>
        marked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id),
      )
      setFavoriteRevision((value) => value + 1)
      return true
    },
  }
  const showExample = (example: Example) => {
    setRevision((value) => value + 1)
    setShown(exampleReceipt(example, revision + 1))
  }
  const transaction = {
    busy: false,
    pending: null,
    error: "",
    receipt: shown,
    async execute(url: string) {
      const pack = packs.find((item) => url === `/api/archive/packs/${item.id}/open`)
      if (!pack || balance < pack.price) return
      const nextBalance = balance - pack.price
      setBalance(nextBalance)
      setRevision(revision + 1)
      setShown({
        ...exampleReceipt({ key: "five", label: "Five cards", ranks: five.slice(0, pack.draws) }),
        id: `demo-opening-${revision}`,
        pack,
        balance_after: nextBalance,
      })
    },
    async recover() {},
    async retry() {},
    clearReceipt: () => setShown(null),
  }
  return (
    <main
      className="archive-page bureau-app ritual-workspace"
      style={{ maxWidth: 1120, margin: "0 auto", padding: 16 }}
    >
      <LanguageSwitch />
      <AppearanceButton />
      <p>
        <a href="welcome.html">Главная / Welcome</a> · Учебный баланс: {balance}
      </p>
      <p role="note">
        Offline appearance and motion fixture. The example packs and balance use fictional data.
        Favorites are held in memory until you reload this page.
      </p>
      <nav aria-label="Demo pack scenarios" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {examples.map((example) => (
          <button key={example.key} onClick={() => showExample(example)}>
            {example.label}
          </button>
        ))}
      </nav>
      {shown?.kind === "OWNER_CARD" ? (
        <section className="owner-archive-desk" aria-label="Granted sandbox cards">
          <PackReveal key={shown.id} receipt={shown} />
        </section>
      ) : (
        shown && (
          <ReceiptView
            receipt={shown}
            favorites={favorites}
            cinematic
            onClose={transaction.clearReceipt}
          />
        )
      )}
      <PackShop revision={revision} balance={balance} transaction={transaction} scope="REAL" />
    </main>
  )
}

export function mount(element: HTMLElement) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <AppearanceProvider>
        <Fixture />
      </AppearanceProvider>
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
