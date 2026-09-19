import { createRoot } from "react-dom/client"
import { useState } from "react"
import { LanguageProvider, LanguageSwitch } from "../src/i18n"
import PackShop from "../src/archive/PackShop"
import { ReceiptView } from "../src/archive/transactions"
import type { FavoriteControls } from "../src/archive/favorites"
import type { Pack, Rank, Receipt } from "../src/archive/types"

const ranks: Rank[] = ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"]
const receipt: Receipt = {
  id: "demo-pack-reveal",
  kind: "PACK_OPEN",
  delta: -90,
  balance_after: 240,
  created_at: "2026-09-13T12:00:00Z",
  pack: {
    id: "demo",
    title: "Demo: Bureau Night Dispatch",
    price: 90,
    revision: 1,
    draws: 9,
    odds: [],
  },
  items: ranks.map((rank, index) => ({
    id: `demo-${rank}`,
    card: {
      id: `demo-card-${rank}`,
      hero: "demo",
      hero_name: "Demo Operative With A Deliberately Long Name",
      rank,
      title: `${rank} · Demo Archive File With A Deliberately Long Title`,
      description: "Offline visual fixture",
      artist: "Demo",
      source_url: "",
      image_url: "art.webp",
      crop_x: 50,
      crop_y: 50,
      zoom: 1,
      frame_version: 1,
      status: "PUBLISHED",
      revision: 1,
    },
    duplicate: index % 3 === 1,
    test_grant: index === 8,
    recycle_value: 0,
  })),
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
  cover: receipt.items[index + 5].card,
  odds: ranks.map((rank) => ({ rank, weight: 1, total_weight: 9, percent: 100 / 9 })),
  recommendation: {
    price: 90,
    model: 1,
    discount_percent: 0,
    expected_direct_cost: 90,
    weeks_at_150: 0.6,
  },
  entries: receipt.items.map(({ card }) => ({
    card,
    card_id: card.id,
    rank: card.rank,
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
  const [shown, setShown] = useState<Receipt | null>(receipt)
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
  const example = (count: number) => {
    setRevision((value) => value + 1)
    setShown({ ...receipt, id: `demo-example-${revision}`, items: receipt.items.slice(0, count) })
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
        ...receipt,
        id: `demo-opening-${revision}`,
        pack,
        items: receipt.items.slice(0, pack.draws),
        balance_after: nextBalance,
      })
    },
    async recover() {},
    async retry() {},
    clearReceipt: () => setShown(null),
  }
  return (
    <main
      className="archive-page bureau-app"
      style={{ maxWidth: 1120, margin: "0 auto", padding: 16 }}
    >
      <LanguageSwitch />
      <p>
        <a href="welcome.html">Главная / Welcome</a> · Учебный баланс: {balance}
      </p>
      <p role="note">
        Demo fixture · Choose viewport 320 px to inspect the narrow layout. Your operating-system
        reduced-motion preference opens directly to results. Favorites here live only in memory. The
        nine-card example demonstrates all ranks, not a real pack composition.
      </p>
      <nav aria-label="Demo receipt size" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[0, 1, 9].map((count) => (
          <button key={count} onClick={() => example(count)}>
            Demo · {count}
          </button>
        ))}
      </nav>
      {shown && (
        <ReceiptView
          receipt={shown}
          favorites={favorites}
          cinematic
          onClose={transaction.clearReceipt}
        />
      )}
      <PackShop revision={revision} balance={balance} transaction={transaction} />
    </main>
  )
}

export function mount(element: HTMLElement) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <Fixture />
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
