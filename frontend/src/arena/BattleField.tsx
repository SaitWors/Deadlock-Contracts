import GwentBattleField from "./GwentBattleField"
import LegacyBattleField from "./LegacyBattleField"
import type { Action, Bootstrap, LegacyMatch, Match } from "./types"
import { isGwentMatch } from "./types"

export type BattleFieldProps = {
  match: Match
  data: Bootstrap
  busy: boolean
  blocked: boolean
  onPlan: (actions: Action[]) => void
  onSurrender: () => void
  onRefresh: () => void
}
export default function BattleField(props: BattleFieldProps) {
  return isGwentMatch(props.match) ? (
    <GwentBattleField {...props} match={props.match} />
  ) : (
    <LegacyBattleField {...props} match={props.match as LegacyMatch} />
  )
}
