import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider, useLanguage } from "../src/i18n"
import HeroVotesPage from "../src/hero-votes/HeroVotesPage"
import HeroVotesDesk from "../src/admin/HeroVotesDesk"
import { useHeroVotes } from "../src/hero-votes/useHeroVotes"
import { NightshiftNav } from "../src/nightshift-layout"
import type { PublicVotes } from "../src/hero-votes/types"
export { act }
function Switch() {
  const { setMode } = useLanguage()
  return (
    <button id="switch-language" onClick={() => setMode("en")}>
      English
    </button>
  )
}
function Watch() {
  const votes = useHeroVotes()
  return (
    <>
      <NightshiftNav
        active="hero-votes"
        staff={false}
        votesEnabled={Boolean(votes.data?.enabled)}
        onNavigate={() => {}}
      />
      <HeroVotesPage data={votes.data} error={votes.error} onReload={votes.reload} />
    </>
  )
}
export function mount(element: HTMLElement, page: string, data?: PublicVotes, permissions = ["*"]) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <Switch />
      {page === "watch" ? (
        <Watch />
      ) : page === "admin" ? (
        <HeroVotesDesk csrf="qa-csrf" permissions={permissions} />
      ) : (
        <HeroVotesPage data={data || null} error={false} onReload={() => {}} />
      )}
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
