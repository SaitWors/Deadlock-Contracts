import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../src/i18n"
import AccountMenu from "../src/AccountMenu"
import ArchivePage from "../src/archive/ArchivePage"
import CardStudio from "../src/archive/CardStudio"
import CardReviewDesk from "../src/admin/CardReviewDesk"
import Cipher from "../src/archive/Cipher"

export { act }
export function mount(element: HTMLElement, page: string, props: Record<string, unknown>) {
  const Component = {
    account: AccountMenu,
    archive: ArchivePage,
    studio: CardStudio,
    review: CardReviewDesk,
    cipher: Cipher,
  }[page] as React.ComponentType<Record<string, unknown>>
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <Component {...props} />
    </LanguageProvider>,
  )
  return { unmount: () => root.unmount() }
}
