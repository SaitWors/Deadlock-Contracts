import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../src/i18n"
import { AppearanceProvider } from "../src/Appearance"
import BattleField from "../src/arena/BattleField"
import ArenaPage from "../src/arena/ArenaPage"
import SquadEditor from "../src/arena/SquadEditor"
import type { Action, Bootstrap, Match } from "../src/arena/types"
export { act }
export function mount(
  element: HTMLElement,
  props: {
    match: Match
    data: Bootstrap
    busy?: boolean
    blocked?: boolean
    onPlan: (actions: Action[]) => void
  },
) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <AppearanceProvider>
        <BattleField
          {...props}
          busy={!!props.busy}
          blocked={!!props.blocked}
          onSurrender={() => {}}
          onRefresh={() => {}}
        />
      </AppearanceProvider>
    </LanguageProvider>,
  )
  return root
}

export function mountPage(element: HTMLElement) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <AppearanceProvider>
        <ArenaPage csrf="qa-only" accountKey="qa-fixture" />
      </AppearanceProvider>
    </LanguageProvider>,
  )
  return root
}

export function mountEditor(element: HTMLElement, data: Bootstrap) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <SquadEditor data={data} busy={false} onSave={() => {}} onTrial={() => {}} />
    </LanguageProvider>,
  )
  return root
}
