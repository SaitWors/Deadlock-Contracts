import React, { act } from "react"
import { createRoot } from "react-dom/client"
import App from "../src/App"
import Mascot from "../src/Mascot"
import { AppearanceProvider } from "../src/Appearance"
import { LanguageProvider } from "../src/i18n"
export { act }
export function mount(element: HTMLElement) {
  const root = createRoot(element)
  root.render(<App />)
  return { unmount: () => root.unmount() }
}

export function mountMascot(element: HTMLElement) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <AppearanceProvider>
        <Mascot />
      </AppearanceProvider>
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
