import React, { act } from "react"
import { createRoot } from "react-dom/client"
import ContractSigning from "../src/ContractSigning"
import BureauHeader from "../src/BureauHeader"
import Landing from "../src/Landing"
import { LanguageProvider } from "../src/i18n"
export * from "../src/contract-signing"
export { act }
import { useRipple, useTilt } from "../src/motion"

export function mountSigning(
  element: HTMLElement,
  props: React.ComponentProps<typeof ContractSigning>,
) {
  const root = createRoot(element)
  const render = (next: typeof props) =>
    root.render(
      <LanguageProvider>
        <ContractSigning {...next} />
      </LanguageProvider>,
    )
  render(props)
  return { render, unmount: () => root.unmount() }
}
export function mountHeader(
  element: HTMLElement,
  props: React.ComponentProps<typeof BureauHeader>,
) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <BureauHeader {...props} />
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}

function MotionProbe() {
  const ripple = useRipple()
  const tilt = useTilt(2)
  return (
    <button {...tilt} onClick={ripple}>
      Motion
    </button>
  )
}
export function mountMotion(element: HTMLElement) {
  const root = createRoot(element)
  root.render(<MotionProbe />)
  return { unmount: () => root.unmount() }
}

export function mountLanding(element: HTMLElement) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <Landing />
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
