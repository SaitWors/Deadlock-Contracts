import type { ReactNode } from "react"
import { useLanguage } from "../i18n"
import type { Achievement } from "./types"

export function PageHead({
  number,
  title,
  text,
  children,
}: {
  number: string
  title: string
  text: string
  children?: ReactNode
}) {
  return (
    <header className="community-head">
      <div>
        <p className="community-eyebrow">DEADLOCK CONTRACTS / {number}</p>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {children}
    </header>
  )
}
export function LoadState({ error, retry }: { error?: string; retry?: () => void }) {
  const { language } = useLanguage()
  return (
    <div className="community-empty" role={error ? "alert" : "status"}>
      <p>{error || (language === "ru" ? "Открываем дело…" : "Opening the file…")}</p>
      {error && retry && (
        <button className="dc-ghost" onClick={retry}>
          {language === "ru" ? "Повторить" : "Try again"}
        </button>
      )}
    </div>
  )
}
const GLYPHS: Record<string, string> = {
  team_city_cases: "M14 48V28h12V18h12v10h12v20H14 M20 34v6m12-14v8m12 0v6",
  team_field_hospital: "M26 14h12v12h12v12H38v12H26V38H14V26h12z",
  team_five_witnesses:
    "M24 20a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M18 48v-5a14 14 0 0 1 28 0v5 M12 24v12m40-12v12",
  first_case: "M22 14h20v36H22z M28 24h8m-8 8h8m-8 8h5",
  ten_cases: "M18 26h28v24H18z M24 26V16h16v10 M26 34v8m12-8v8",
  fifty_cases: "M16 18h32v32H16z M22 25h20m-20 9h20m-20 9h20",
  hard_cases: "m32 12 18 10-6 24-12 8-12-8-6-24z m-8 20 6 6 12-14",
  extreme_case: "m32 10 4 15 14-7-9 14 13 6-17 2-5 14-5-14-17-2 13-6-9-14 14 7z",
  rare_cases: "m32 12 18 15-18 25-18-25z M14 27h36 M32 12l-8 15 8 25 8-25z",
  three_modes: "M32 13v38M13 32h38m-33-14 28 28m0-28L18 46 M27 18l5-5 5 5",
  four_categories: "M18 18h10v10H18z M36 18h10v10H36z M18 36h10v10H18z M36 36h10v10H36z",
}
export function Seal({ item }: { item: Achievement }) {
  return (
    <svg
      className={`community-seal ${item.earned ? "earned" : "locked"}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        className="seal-wax"
        d="M32 2 40 5 49 6 54 14 60 21 59 31 62 40 55 47 51 55 41 57 32 62 23 58 13 57 9 48 3 41 5 31 2 22 9 15 14 6 24 5Z"
      />
      <circle cx="32" cy="32" r="24" />
      <circle cx="32" cy="32" r="21" />
      <path className="seal-glyph" d={GLYPHS[item.id] || GLYPHS.first_case} />
    </svg>
  )
}
