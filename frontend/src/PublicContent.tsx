import type { PublicRoute } from "./publicRoutes"

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
}: {
  copy: PublicCopy | null
  heading?: boolean
}) {
  if (!copy) return null
  return (
    <section className={`public-document ${heading ? "" : "public-document-continuation"}`}>
      {heading && (
        <>
          <h1>{copy.heading}</h1>
          <p>{copy.intro}</p>
        </>
      )}
      {copy.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          <p>{section.text}</p>
        </section>
      ))}
    </section>
  )
}
