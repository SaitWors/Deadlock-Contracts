import React, { act } from "react"
import { createRoot } from "react-dom/client"
import Dashboard from "../src/Dashboard"
import { LanguageProvider } from "../src/i18n"
import { AnnouncementProvider } from "../src/announcements/AnnouncementProvider"
import PersonalProgress from "../src/progress/PersonalProgress"

export { act }
export { rememberGuide } from "../src/BureauGuide"

export function mountDashboard(
  element: HTMLElement,
  session: React.ComponentProps<typeof Dashboard>["initialSession"],
) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <AnnouncementProvider>
        <Dashboard initialSession={session} />
      </AnnouncementProvider>
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}

export function mountProgress(
  element: HTMLElement,
  props: React.ComponentProps<typeof PersonalProgress>,
) {
  const root = createRoot(element)
  const render = (next: React.ComponentProps<typeof PersonalProgress>) =>
    root.render(
      <LanguageProvider>
        <PersonalProgress {...next} />
      </LanguageProvider>,
    )
  render(props)
  return { update: render, unmount: () => root.unmount() }
}
