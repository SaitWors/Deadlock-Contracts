import type { ReactNode } from "react"
import Regalia from "../regalia/Regalia"
import { ACHIEVEMENT_ART } from "../regalia/catalog"
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
export function Seal({ item }: { item: Achievement }) {
  return (
    <Regalia
      id={ACHIEVEMENT_ART[item.id] || "medal-first"}
      className={`community-seal ${item.earned ? "earned" : "locked"}`}
    />
  )
}
