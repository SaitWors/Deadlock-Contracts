import React, { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import BureauBottomNav from "../src/BureauBottomNav"
import BureauGuide from "../src/BureauGuide"
import ContractSelectionList from "../src/ContractSelectionList"
import BureauOnboarding from "../src/foundation/BureauOnboarding"
import { LanguageProvider } from "../src/i18n"

export { act }

function render(parent: HTMLElement, children: ReactNode) {
  const root = createRoot(parent)
  root.render(<LanguageProvider>{children}</LanguageProvider>)
  return { unmount: () => root.unmount() }
}

export function mountGuide(parent: HTMLElement, props: React.ComponentProps<typeof BureauGuide>) {
  return render(parent, <BureauGuide {...props} />)
}

export function mountJourney(
  parent: HTMLElement,
  onboarding: React.ComponentProps<typeof BureauOnboarding>,
  nav: React.ComponentProps<typeof BureauBottomNav>,
  selection: React.ComponentProps<typeof ContractSelectionList>,
) {
  return render(
    parent,
    <>
      <BureauOnboarding {...onboarding} />
      <BureauBottomNav {...nav} />
      <ContractSelectionList {...selection} />
    </>,
  )
}
