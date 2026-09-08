import { useId } from "react"
import { REGALIA, type RegaliaId } from "./catalog"
import "./regalia.css"

export default function Regalia({ id, className = "" }: { id: RegaliaId; className?: string }) {
  const art = REGALIA[id]
  const clip = useId()
  const [x, y, width, height] = art.box.split(" ").map(Number)
  return (
    <svg
      className={`bureau-regalia ${art.cutout ? "regalia-cutout" : "regalia-plate"} ${className}`}
      viewBox={art.box}
      width="128"
      height="128"
      aria-hidden="true"
      focusable="false"
      data-regalia={id}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={width} height={height} />
        </clipPath>
      </defs>
      <image clipPath={`url(#${clip})`} href={art.src} width={art.width} height={art.height} />
    </svg>
  )
}
