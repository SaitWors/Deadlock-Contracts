import React, { act } from "react"
import { createRoot } from "react-dom/client"
import Dashboard from "../src/Dashboard"
import { LanguageProvider } from "../src/i18n"
import { AnnouncementProvider } from "../src/announcements/AnnouncementProvider"
export { act }
export { onboardingPreference, saveOnboardingPreference } from "../src/foundation/onboarding"
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
