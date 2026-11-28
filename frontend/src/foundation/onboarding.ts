export type BureauOnboardingFacts = {
  createdAt: string | null
  signed: boolean | null
  verified: boolean | null
  openedDailyPack: boolean | null
  visitedBoard: boolean
  visitedProfile: boolean
  visitedCollection: boolean
}

export type OnboardingPreference = "new" | "started" | "paused" | "skipped" | "hidden"
type OnboardingStage = "mode" | "sign" | "result" | "pack" | "profile" | "collection" | "done"

const newAccountPeriod = 7 * 24 * 60 * 60 * 1000

export function onboardingStage(
  facts: BureauOnboardingFacts,
  preference: OnboardingPreference,
  now = Date.now(),
): OnboardingStage | null {
  if (preference !== "new" && preference !== "started") return null
  if (facts.signed === null || facts.verified === null) return null
  if (preference === "new") {
    const createdAt = Date.parse(facts.createdAt ?? "")
    if (!Number.isFinite(createdAt) || createdAt > now || now - createdAt >= newAccountPeriod)
      return null
  }
  if (!facts.signed) return facts.visitedBoard ? "sign" : "mode"
  if (!facts.verified) return "result"
  if (facts.openedDailyPack !== true) return "pack"
  if (!facts.visitedProfile) return "profile"
  if (!facts.visitedCollection) return "collection"
  return "done"
}

function preferenceKey(account: string) {
  return `dc.bureau.guide.v2.${account}`
}

export function onboardingPreference(account: string): OnboardingPreference {
  try {
    const value = window.localStorage.getItem(preferenceKey(account))
    if (value === "started" || value === "paused" || value === "skipped" || value === "hidden")
      return value
    if (window.localStorage.getItem(`dc.bureau.guide.v1.${account}`) === "seen") return "skipped"
  } catch {
    // Preferences remain available for the current mount when storage is disabled.
  }
  return "new"
}

export function saveOnboardingPreference(account: string, value: OnboardingPreference) {
  try {
    window.localStorage.setItem(preferenceKey(account), value)
  } catch {
    // Private browsing may disallow storage.
  }
}

export function resumeOnboarding(account: string) {
  if (onboardingPreference(account) === "paused") saveOnboardingPreference(account, "started")
}

export type OnboardingVisit = "quests" | "profile" | "collection"

export function onboardingVisited(account: string, section: OnboardingVisit) {
  try {
    return window.localStorage.getItem(`${preferenceKey(account)}.visited.${section}`) === "1"
  } catch {
    return false
  }
}

export function rememberOnboardingVisit(account: string, section: OnboardingVisit) {
  try {
    window.localStorage.setItem(`${preferenceKey(account)}.visited.${section}`, "1")
  } catch {
    // The verified milestones are still read from the server.
  }
}
