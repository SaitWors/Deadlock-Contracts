import type { PublicRoute } from "./publicRoutes"
import "./public-content.css"

export type PublicCopy = {
  heading: string
  intro: string
  sections: { heading: string; text: string }[]
}

export function readPublicCopy(route: PublicRoute): PublicCopy | null {
  try {
    const payload = JSON.parse(document.getElementById("dc-public-page")?.textContent || "null")
    const copy = payload?.content
    if (
      payload?.page !== route.page ||
      payload.language !== route.language ||
      typeof copy?.heading !== "string" ||
      typeof copy.intro !== "string" ||
      !Array.isArray(copy.sections) ||
      !copy.sections.every(
        (section: PublicCopy["sections"][number]) =>
          section && typeof section.heading === "string" && typeof section.text === "string",
      )
    )
      return null
    return copy
  } catch {
    return null
  }
}

export default function PublicContent({
  copy,
  heading = true,
  compact = false,
  summary,
}: {
  copy: PublicCopy | null
  heading?: boolean
  compact?: boolean
  summary?: string
}) {
  if (!copy) return null
  const sections = copy.sections.map((section, index) => (
    <section key={section.heading}>
      {!compact && (
        <span className="ns-document-number" aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>
      )}
      <h2>{section.heading}</h2>
      <p>{section.text}</p>
    </section>
  ))
  return (
    <section
      className={`public-document ${heading ? "" : "public-document-continuation"} ${compact ? "public-document-compact" : ""} ${!copy.sections.length ? "public-document-heading" : ""}`}
    >
      {heading && (
        <header className="ns-document-header">
          <h1>{copy.heading}</h1>
          <p>{copy.intro}</p>
        </header>
      )}
      {compact && sections.length ? (
        <details className="public-explainer">
          <summary>{summary || copy.heading}</summary>
          <div className="public-explainer-content">{sections}</div>
        </details>
      ) : (
        sections
      )}
    </section>
  )
}
