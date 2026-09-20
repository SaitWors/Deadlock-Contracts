// These IDs match shared/public-pages.json. Navigation loads a document so its
// server metadata, language and visible content always change together.
export const PUBLIC_SLUGS = {
  home: "",
  contracts: "contracts",
  how: "how-it-works",
  cards: "cards",
  about: "about",
  leaderboards: "leaderboard",
  try: "try",
  campaigns: "campaigns",
} as const
export type PublicPage = keyof typeof PUBLIC_SLUGS
export type PublicRoute = { page: PublicPage; language: "ru" | "en" }

export function publicUrl(page: PublicPage, language: "ru" | "en") {
  return `/${language}/${PUBLIC_SLUGS[page]}`
}

export function resolvePublicRoute(path: string): PublicRoute | null {
  if (path === "/") return { page: "home", language: "ru" }
  const match = path.match(/^\/(ru|en)\/(.*)$/)
  if (!match) return null
  const page = (Object.keys(PUBLIC_SLUGS) as PublicPage[]).find(
    (key) => PUBLIC_SLUGS[key] === match[2],
  )
  return page ? { page, language: match[1] as "ru" | "en" } : null
}

export function legacyPublicUrl(hash: string, language: "ru" | "en"): string | null {
  const page = hash.slice(1)
  return ["home", "contracts", "how", "campaigns", "leaderboards", "try"].includes(page)
    ? publicUrl(page as PublicPage, language)
    : null
}
