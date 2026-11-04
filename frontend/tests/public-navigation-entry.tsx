import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { PublicNavigationProvider, usePublicNavigation } from "../src/public-navigation"

function PublicFixture() {
  const { pathname, pending } = usePublicNavigation()
  const payload = JSON.parse(document.getElementById("dc-public-page")?.textContent || "null")
  return (
    <>
      <header data-persistent-header>
        <video data-persistent-background />
      </header>
      <p data-pathname>{pathname}</p>
      <p data-pending>{String(pending)}</p>
      <main>
        <h1>{payload?.content?.heading}</h1>
        <section id="details">Details</section>
        <section id="contract-board">Contract board</section>
      </main>
      <a href="/ru/contracts">Contracts</a>
      <a href="/ru/cards">Cards</a>
      <a href="/en/about">About in English</a>
    </>
  )
}

export { act }
export function mount(element: HTMLElement, enabled = true) {
  const root = createRoot(element)
  root.render(
    <PublicNavigationProvider enabled={enabled}>
      <PublicFixture />
    </PublicNavigationProvider>,
  )
  return { unmount: () => root.unmount() }
}
