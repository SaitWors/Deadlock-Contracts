import React, { act } from "react"
import { createRoot } from "react-dom/client"
import App from "../src/App"
export { act }
export function mount(element: HTMLElement) {
  const root = createRoot(element)
  root.render(<App />)
  return { unmount: () => root.unmount() }
}
