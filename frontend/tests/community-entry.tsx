import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../src/i18n"
import Leaderboard from "../src/community/Leaderboard"
import Achievements from "../src/community/Achievements"
import ProfileStudio from "../src/ProfileStudio"
import Bureaus from "../src/community/Bureaus"
import Operations from "../src/community/Operations"
import BureauSafety from "../src/community/BureauSafety"
import BureauModerationDesk from "../src/admin/BureauModerationDesk"
import PublicDossier from "../src/PublicDossier"
export { act }
export function mount(element: HTMLElement, page: string, props: Record<string, unknown>) {
  const Component = {
    leaderboard: Leaderboard,
    achievements: Achievements,
    profile: ProfileStudio,
    bureaus: Bureaus,
    operations: Operations,
    safety: BureauSafety,
    moderation: BureauModerationDesk,
    publicDossier: PublicDossier,
  }[page] as React.ComponentType<Record<string, unknown>>
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <Component {...props} />
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
