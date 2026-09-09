import { createElement } from "react"
import { ICON_NODES, type IconName } from "./nodes"
export type { IconName } from "./nodes"

// Only the vendored, licensed SVG geometry is rendered. User input never becomes SVG.
export default function Icon({
  name,
  className = "",
  size = 20,
}: {
  name: IconName
  className?: string
  size?: number
}) {
  return (
    <svg
      className={`dc-svg-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {ICON_NODES[name].map(([tag, attributes], index) =>
        createElement(tag, { ...attributes, key: index }),
      )}
    </svg>
  )
}
