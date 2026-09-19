import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../src/i18n"
import AccountMenu from "../src/AccountMenu"
import ArchivePage from "../src/archive/ArchivePage"
import CardStudio from "../src/archive/CardStudio"
import CardReviewDesk from "../src/admin/CardReviewDesk"
import Cipher from "../src/archive/Cipher"
import OwnerArchiveDesk from "../src/admin/OwnerArchiveDesk"
import { ReceiptView, TransactionStatus, useTransaction } from "../src/archive/transactions"
import { useFavorites } from "../src/archive/favorites"

function FavoriteReceiptHarness({
  receipt,
  csrf,
  accountKey,
}: {
  receipt: Parameters<typeof ReceiptView>[0]["receipt"]
  csrf: string
  accountKey: string
}) {
  const favorites = useFavorites(csrf, accountKey)
  return <ReceiptView key={accountKey} receipt={receipt} cinematic favorites={favorites} />
}

function TransactionHarness({
  csrf,
  accountKey,
  onChanged,
}: {
  csrf: string
  accountKey: string
  onChanged: () => void
}) {
  const transaction = useTransaction(csrf, accountKey, onChanged)
  return (
    <>
      <button
        disabled={transaction.busy || !!transaction.pending}
        onClick={() =>
          void transaction.execute("/api/archive/packs/test/open", { revision: 4, starter: false })
        }
      >
        Open test pack
      </button>
      <TransactionStatus transaction={transaction} />
    </>
  )
}

function ReceiptHarness({
  receipt,
  cinematic = false,
  onClose,
}: {
  receipt: Parameters<typeof ReceiptView>[0]["receipt"]
  cinematic?: boolean
  onClose?: () => void
}) {
  return <ReceiptView receipt={receipt} cinematic={cinematic} onClose={onClose} />
}

export { act }
export function mount(element: HTMLElement, page: string, props: Record<string, unknown>) {
  const Component = {
    account: AccountMenu,
    archive: ArchivePage,
    studio: CardStudio,
    review: CardReviewDesk,
    cipher: Cipher,
    owner: OwnerArchiveDesk,
    transaction: TransactionHarness,
    receipt: ReceiptHarness,
    favoriteReceipt: FavoriteReceiptHarness,
  }[page] as React.ComponentType<Record<string, unknown>>
  const root = createRoot(element)
  const render = (nextProps: Record<string, unknown>) =>
    root.render(
      <LanguageProvider>
        <Component {...nextProps} />
      </LanguageProvider>,
    )
  render(props)
  return { rerender: render, unmount: () => root.unmount() }
}
