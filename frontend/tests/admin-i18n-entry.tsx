import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider, useLanguage } from "../src/i18n"
import AnnouncementCenter from "../src/admin/AnnouncementCenter"
import BureauModerationDesk from "../src/admin/BureauModerationDesk"
import ReviewDesk from "../src/admin/ReviewDesk"
import OwnerRewards from "../src/admin/OwnerRewards"
import { AdminConsole } from "../src/Dashboard"
import ContractRelay from "../src/ContractRelay"

export { act }

function SwitchLanguage() {
  const { setMode } = useLanguage()
  return (
    <button id="switch-language" onClick={() => setMode("en")}>
      English
    </button>
  )
}

export function mount(element: HTMLElement, page: string, props: Record<string, unknown>) {
  const Component = {
    announcements: AnnouncementCenter,
    bureau: BureauModerationDesk,
    reviews: ReviewDesk,
    console: AdminConsole,
    rewards: OwnerRewards,
    relayProfile: ContractRelay,
  }[page] as React.ComponentType<Record<string, unknown>>
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <SwitchLanguage />
      <Component {...props} />
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
