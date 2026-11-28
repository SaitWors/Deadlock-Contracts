export type BureauNavigationBadges = Partial<Record<"active" | "history" | "packs", string>>

export function BureauNavigationStatus({ label }: { label?: string }) {
  if (!label) return null
  return (
    <>
      <span className="bureau-nav-status" aria-hidden="true" title={label} />
      <span className="sr-only">{label}</span>
    </>
  )
}
