import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import GuestCipher from "../src/archive/GuestCipher"
import ArchiveNextStep from "../src/archive/ArchiveNextStep"
import { LanguageProvider, LanguageSwitch } from "../src/i18n"
import type { Wallet } from "../src/archive/types"

const baseWallet: Wallet = {
  balance: 73,
  currency: "ARCHIVE_TOKEN",
  weekly_limit: 5,
  reward: 30,
  completed: 2,
  reset_at: "2026-09-14T00:00:00Z",
  round: null,
  history: [],
  history_total: 0,
}

const wallets: Record<string, Wallet> = {
  "101": {
    ...baseWallet,
    round: {
      id: "preview-open",
      slot: 3,
      status: "OPEN",
      revision: 7,
      guesses: [{ symbols: [0, 1, 4, 2], exact: 2, misplaced: 1 }],
      solution: null,
    },
  },
  "102": baseWallet,
  "103": { ...baseWallet, completed: 5 },
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input), "https://offline.invalid")
  const wallet = wallets[url.searchParams.get("view") || ""]
  if (!wallet) throw new Error(`Offline fixture blocked request: ${url.pathname}${url.search}`)
  return { ok: true, json: async () => wallet } as Response
}

function Fixture() {
  const [destination, setDestination] = useState("none")
  return (
    <LanguageProvider>
      <div className="bureau-app">
        <div style={{ position: "fixed", zIndex: 20, top: 12, right: 12 }}>
          <LanguageSwitch />
        </div>
        <GuestCipher onHome={() => setDestination("home")} />
        <section style={{ maxWidth: 1180, margin: "auto", padding: "36px 12px 80px" }}>
          <h1>Archive next-step states</h1>
          <p>Last callback: {destination}</p>
          {[101, 102, 103].map((revision) => (
            <ArchiveNextStep key={revision} revision={revision} onNavigate={setDestination} />
          ))}
        </section>
      </div>
    </LanguageProvider>
  )
}

export function mount(element: HTMLElement) {
  createRoot(element).render(<Fixture />)
}
