import React, { act } from "react"
import { createRoot } from "react-dom/client"
import App from "../src/App"
import Mascot from "../src/Mascot"
import {
  AppearanceButton,
  AppearanceProvider,
  useEffectsQuality,
  useReducedMotion,
} from "../src/Appearance"
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

function PreferenceProbe() {
  const reduced = useReducedMotion()
  const quality = useEffectsQuality()
  return <output data-effective-motion={reduced ? "reduced" : "full"} data-quality={quality} />
}

export function mountPreferences(element: HTMLElement) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <AppearanceProvider>
        <AppearanceButton />
        <PreferenceProbe />
      </AppearanceProvider>
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
