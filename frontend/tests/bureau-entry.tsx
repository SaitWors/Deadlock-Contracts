import React, { act } from "react"
import { createRoot } from "react-dom/client"
import Dashboard from "../src/Dashboard"
import BureauGuide from "../src/BureauGuide"
import { LanguageProvider } from "../src/i18n"
import { AnnouncementProvider } from "../src/announcements/AnnouncementProvider"
export { act }
export { hasSeenGuide, rememberGuide, guideKey } from "../src/BureauGuide"
export { REGALIA, ACHIEVEMENT_ART } from "../src/regalia/catalog"

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
export function mountGuide(element: HTMLElement, props: React.ComponentProps<typeof BureauGuide>) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <BureauGuide {...props} />
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
