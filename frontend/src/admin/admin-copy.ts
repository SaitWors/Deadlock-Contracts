import { useCallback, useEffect, useSyncExternalStore } from "react"
import { useLanguage } from "../i18n"
import catalogUrl from "./admin-copy.json?url&no-inline"

type TranslationPair = readonly [string, string]
type CatalogDocument = {
  translations: TranslationPair[]
  codeLabels: Record<string, TranslationPair>
}
type Catalog = {
  english: Map<string, string>
  russian: Map<string, string>
  codeLabels: CatalogDocument["codeLabels"]
}

type CatalogState =
  | { status: "idle" | "loading" | "retrying" | "error" }
  | { status: "ready"; catalog: Catalog }

const listeners = new Set<() => void>()
let state: CatalogState = { status: "idle" }
const getSnapshot = () => state

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setState(next: CatalogState) {
  state = next
  listeners.forEach((listener) => listener())
}

function loadCatalog() {
  if (state.status !== "idle" && state.status !== "error") return
  setState({ status: state.status === "idle" ? "loading" : "retrying" })
  void fetch(catalogUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Admin translation catalog unavailable")
      const { translations, codeLabels } = (await response.json()) as CatalogDocument
      if (!Array.isArray(translations) || !codeLabels)
        throw new Error("Invalid translation catalog")
      setState({
        status: "ready",
        catalog: {
          english: new Map(translations),
          russian: new Map(translations.map(([ru, en]) => [en, ru])),
          codeLabels,
        },
      })
    })
    .catch(() => setState({ status: "error" }))
}

export function useAdminCopy() {
  const { language, locale } = useLanguage()
  const catalogState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const catalog = catalogState.status === "ready" ? catalogState.catalog : null
  useEffect(() => {
    if (getSnapshot().status === "idle") loadCatalog()
  }, [])

  const copy = useCallback(
    (source: string, values: Record<string, unknown> = {}) => {
      const key = source.trim()
      const translated =
        catalog?.codeLabels[key]?.[language === "ru" ? 0 : 1] ??
        (language === "ru" ? catalog?.russian : catalog?.english)?.get(key) ??
        key
      const text = source.replace(key, translated)
      return text.replace(/\{(\d+)\}/g, (token, index: string) =>
        index in values ? String(values[index]) : token,
      )
    },
    [language, catalog],
  )
  return { copy, language, locale, catalogStatus: catalogState.status, retryCatalog: loadCatalog }
}
