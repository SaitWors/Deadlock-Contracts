import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../src/i18n"
import { AppearanceProvider } from "../src/Appearance"
import CaseCompletion from "../src/case-completion/CaseCompletion"

export { act }
export { progressAt, replayTargets, readReceipt } from "../src/case-completion/timeline"

export function mount(element: HTMLElement, props: React.ComponentProps<typeof CaseCompletion>) {
  const root = createRoot(element)
  const render = (next: React.ComponentProps<typeof CaseCompletion>) =>
    root.render(
      <LanguageProvider>
        <AppearanceProvider>
          <CaseCompletion {...next} />
        </AppearanceProvider>
      </LanguageProvider>,
    )
  render(props)
  return { update: render, unmount: () => root.unmount() }
}
