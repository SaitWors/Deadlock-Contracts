export type CaseSignal = {
  status: string
  provider_status?: { phase?: string; delayed_by_provider?: boolean } | null
}

export function casePhase(board: CaseSignal) {
  const provider = board.provider_status
  if (board.status === "REVIEW_REQUIRED") return "review"
  if (board.status === "VERIFYING") return "verifying"
  if (provider?.phase === "QUEUED" || provider?.delayed_by_provider) return "provider"
  if (provider?.phase === "MATCH_DETECTED") return "detected"
  return "active"
}

const priority = { review: 0, verifying: 1, provider: 2, detected: 3, active: 4 }

export function prioritizeCases<T extends CaseSignal>(boards: T[]) {
  return [...boards].sort((left, right) => priority[casePhase(left)] - priority[casePhase(right)])
}

export function nextOverviewStep(
  active: CaseSignal | undefined,
  hasRecentResult: boolean,
  isNew: boolean,
  packAvailable: boolean,
  returning: boolean,
) {
  if (active) return casePhase(active)
  if (hasRecentResult) return "result"
  if (isNew) return "first"
  if (packAvailable) return "pack"
  return returning ? "returning" : "board"
}
