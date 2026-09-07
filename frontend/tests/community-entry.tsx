import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../src/i18n"
import Leaderboard from "../src/community/Leaderboard"
import Achievements from "../src/community/Achievements"
import ProfileStudio from "../src/ProfileStudio"
import Bureaus from "../src/community/Bureaus"
export { act }
export function mount(element: HTMLElement, page: string, props: Record<string, unknown>) {
  const Component = {
    leaderboard: Leaderboard,
    achievements: Achievements,
    profile: ProfileStudio,
    bureaus: Bureaus,
  }[page] as React.ComponentType<Record<string, unknown>>
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <Component {...props} />
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
