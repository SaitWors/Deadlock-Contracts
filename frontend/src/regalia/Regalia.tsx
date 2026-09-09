import Icon from "../icons/Icon"
import { REGALIA, type RegaliaId } from "./catalog"
import "./regalia.css"

export default function Regalia({ id, className = "" }: { id: RegaliaId; className?: string }) {
  return (
    <span
      className={`bureau-regalia regalia-symbol ${className}`}
      aria-hidden="true"
      data-regalia={id}
    >
      <Icon name={REGALIA[id].icon} size={48} />
    </span>
  )
}
