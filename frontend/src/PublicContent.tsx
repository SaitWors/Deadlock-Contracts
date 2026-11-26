import type { PublicRoute } from "./publicRoutes"
import Icon from "./icons/Icon"
import "./public-content.css"

type PublicSection = { heading: string; text: string; link?: { href: string; label: string } }

export type PublicCopy = {
  heading: string
  intro: string
  sections: PublicSection[]
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
        (section: PublicSection) =>
          section &&
          typeof section.heading === "string" &&
          typeof section.text === "string" &&
          (section.link === undefined ||
            (typeof section.link?.href === "string" &&
              section.link.href.startsWith("https://") &&
              typeof section.link.label === "string")),
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
      {section.link && (
        <a className="public-document-link" href={section.link.href}>
          {section.link.label}
          <Icon name="arrow-up-right" size={16} />
        </a>
      )}
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
