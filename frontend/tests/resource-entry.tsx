import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../src/i18n"
import { useResource } from "../src/community/api"

export { act }
function Resource({ url }: { url: string }) {
  const result = useResource<{ value: string }>(url)
  return (
    <>
      <output>{result.loading ? "Loading" : result.error || result.data?.value}</output>
      <button onClick={result.reload}>Retry</button>
    </>
  )
}
export function mount(element: HTMLElement, url: string) {
  const root = createRoot(element)
  const render = (path: string) =>
    root.render(
      <LanguageProvider>
        <Resource url={path} />
      </LanguageProvider>,
    )
  render(url)
  return { render, unmount: () => root.unmount() }
}
