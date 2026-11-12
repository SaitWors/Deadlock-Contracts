import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../src/i18n"
import DailyCollectionPreview from "../src/DailyCollectionPreview"
import PublicContent, { type PublicCopy } from "../src/PublicContent"

export { act }
export function mount(
  element: HTMLElement,
  page: string,
  language: "ru" | "en",
  copy?: PublicCopy,
) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      {page === "collection" ? (
        <DailyCollectionPreview language={language} />
      ) : (
        <>
          <PublicContent copy={copy ? { ...copy, sections: [] } : null} />
          <div data-functional-content>Useful content</div>
          <PublicContent copy={copy ?? null} heading={false} compact summary="How this works" />
        </>
      )}
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
