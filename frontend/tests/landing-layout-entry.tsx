import { createRoot } from "react-dom/client"
import { useState } from "react"
import Landing from "../src/Landing"
import { LanguageProvider } from "../src/i18n"

// Real UI, local artwork and no connection to production accounts or APIs.
globalThis.fetch = async () => {
  throw new Error("Offline preview: live data is unavailable")
}

function Fixture() {
  const [notice, setNotice] = useState("Предпросмотр · Offline preview")
  return (
    <div
      onClickCapture={(event) => {
        const control = (event.target as Element).closest("button, a")
        if (
          control?.getAttribute("aria-label")?.includes("Steam") ||
          control?.getAttribute("href") === "/auth/steam"
        ) {
          event.preventDefault()
          event.stopPropagation()
          setNotice("Вход отключён в предпросмотре · Sign-in is disabled in this preview")
        }
      }}
    >
      <Landing />
      <aside
        style={{
          position: "fixed",
          bottom: 8,
          left: 8,
          right: 8,
          zIndex: 100,
          padding: 12,
          borderRadius: 12,
          background: "#202a22",
          color: "#edf0e9",
          font: "13px system-ui",
        }}
      >
        <span role="status">{notice}</span> · <a href="pack-reveal.html">Открытие паков / Packs</a>
      </aside>
    </div>
  )
}

export function mount(element: HTMLElement) {
  createRoot(element).render(
    <LanguageProvider>
      <Fixture />
    </LanguageProvider>,
  )
}
