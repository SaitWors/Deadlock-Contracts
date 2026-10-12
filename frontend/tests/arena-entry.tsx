import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../src/i18n"
import { AppearanceProvider } from "../src/Appearance"
import ArenaPage from "../src/arena/ArenaPage"
import PublicSquad from "../src/arena/PublicSquad"
export { act }
export function mount(element: HTMLElement, props: { csrf: string; accountKey: string }) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <AppearanceProvider>
        <ArenaPage {...props} />
      </AppearanceProvider>
    </LanguageProvider>,
  )
  return root
}
export function mountPublic(element: HTMLElement, slug: string) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <PublicSquad slug={slug} />
    </LanguageProvider>,
  )
  return root
}
