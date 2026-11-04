import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cards01Icon,
  ContractsIcon,
  GameController01Icon,
  InformationCircleIcon,
  RankingIcon,
} from "@hugeicons/core-free-icons"

// Exact free Stroke Rounded exports, verified with the Hugeicons catalog.
const navigationIcons = {
  contracts: ContractsIcon,
  cards: Cards01Icon,
  leaderboards: RankingIcon,
  how: GameController01Icon,
  about: InformationCircleIcon,
} as const

export type NavigationIconName = keyof typeof navigationIcons

export default function NavigationIcon({ name }: { name: NavigationIconName }) {
  return (
    <HugeiconsIcon
      icon={navigationIcons[name]}
      size={16}
      className="bureau-navigation-icon"
      aria-hidden="true"
      focusable="false"
      data-navigation-icon={name}
    />
  )
}
