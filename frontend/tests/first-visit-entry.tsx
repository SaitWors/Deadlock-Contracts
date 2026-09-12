import React, { act } from "react"
import { createRoot } from "react-dom/client"
import Landing from "../src/Landing"
import Dashboard from "../src/Dashboard"
import ArchiveNextStep from "../src/archive/ArchiveNextStep"
import { LanguageProvider } from "../src/i18n"
import { AnnouncementProvider } from "../src/announcements/AnnouncementProvider"

export { act }

export function mountLanding(element: HTMLElement) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <Landing />
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}

export function mountDashboard(
  element: HTMLElement,
  initialSession: React.ComponentProps<typeof Dashboard>["initialSession"],
) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <AnnouncementProvider>
        <Dashboard initialSession={initialSession} />
      </AnnouncementProvider>
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}

export function mountNextStep(
  element: HTMLElement,
  props: React.ComponentProps<typeof ArchiveNextStep>,
) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <ArchiveNextStep {...props} />
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
