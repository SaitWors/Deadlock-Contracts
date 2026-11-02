import { useState } from "react"
import { useResource } from "../community/api"
import { useLanguage } from "../i18n"
import CollectionPage from "./CollectionPage"
import DailyPack from "./DailyPack"
import { useFavorites } from "./favorites"
import type { Meta } from "./types"
import "./archive.css"
import "./packs.css"

export default function ArchivePage({
  csrf,
  mode = "collection",
  accountKey = "",
  onCollectionChange,
  onWalletChange,
}: {
  csrf: string
  mode?: "archive" | "studio" | "wallet" | "packs" | "collection"
  accountKey?: string
  onCollectionChange?: () => void
  onWalletChange?: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [view, setView] = useState(mode === "packs" ? "packs" : "collection")
  const [revision, setRevision] = useState(0)
  const meta = useResource<Meta>("/api/archive/meta")
  const account = accountKey || meta.data?.account_key || ""
  const favorites = useFavorites(csrf, account, "REAL")
  const changed = () => {
    setRevision((value) => value + 1)
    onCollectionChange?.()
    // Retain the prop for old embedders without fetching or displaying a wallet.
    onWalletChange?.()
  }
  return (
    <section className="archive-page ritual-collection" data-view={view}>
      <header className="archive-heading">
        <div>
          <small>DEADLOCK CONTRACTS / {ru ? "КОЛЛЕКЦИЯ" : "COLLECTION"}</small>
          <h1>
            {view === "packs"
              ? ru
                ? "Ежедневный конверт"
                : "Daily pack"
              : ru
                ? "Твоя коллекция"
                : "Your collection"}
          </h1>
          <p>
            {ru
              ? "Карточки героев из ежедневных конвертов. Собирай и выбирай любимые."
              : "Hero cards from your daily packs. Collect them and keep your favorites."}
          </p>
        </div>
      </header>
      <nav className="archive-tabs" aria-label={ru ? "Коллекция" : "Collection"}>
        <button
          aria-current={view === "collection" ? "page" : undefined}
          onClick={() => setView("collection")}
        >
          {ru ? "Моя коллекция" : "My collection"}
        </button>
        <button
          aria-current={view === "packs" ? "page" : undefined}
          onClick={() => setView("packs")}
        >
          {ru ? "Ежедневный конверт" : "Daily pack"}
        </button>
      </nav>
      {view === "packs" && (
        <DailyPack
          key={account}
          accountKey={account}
          csrf={csrf}
          favorites={favorites}
          onClaimed={changed}
        />
      )}
      {view === "collection" && !meta.data && (
        <p role={meta.error ? "alert" : "status"}>
          {meta.error || (ru ? "Загрузка коллекции…" : "Loading collection…")}
          {meta.error && <button onClick={meta.reload}>{ru ? "Повторить" : "Retry"}</button>}
        </p>
      )}
      {view === "collection" && meta.data && (
        <CollectionPage
          key={account}
          csrf={csrf}
          meta={meta.data}
          scope="REAL"
          favorites={favorites}
          revision={revision}
        />
      )}
    </section>
  )
}

export function Pager({
  offset,
  total,
  size,
  setOffset,
}: {
  offset: number
  total: number
  size: number
  setOffset: (value: number) => void
}) {
  const { language } = useLanguage()
  if (total <= size) return null
  return (
    <nav className="archive-pager" aria-label={language === "ru" ? "Страницы" : "Pages"}>
      <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - size))}>
        {language === "ru" ? "Назад" : "Previous"}
      </button>
      <span>
        {Math.floor(offset / size) + 1} / {Math.ceil(total / size)}
      </span>
      <button disabled={offset + size >= total} onClick={() => setOffset(offset + size)}>
        {language === "ru" ? "Далее" : "Next"}
      </button>
    </nav>
  )
}
