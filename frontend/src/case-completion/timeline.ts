import type { CompletionProgress, CompletionReceipt, LevelBand } from "./types"

export function progressAt(totalXp: number, levels: LevelBand[]) {
  const band = [...levels].reverse().find((item) => totalXp >= item.start_xp) || levels[0]
  const cost = Math.max(1, band.end_xp - band.start_xp)
  const value = Math.max(0, Math.min(cost, totalXp - band.start_xp))
  return { level: band.level, value, cost, percent: (value / cost) * 100 }
}

// Targets describe credited receipts; opening this scene never awards anything.
export function replayTargets(receipt: CompletionReceipt): number[] {
  if (!receipt.replayable || !receipt.progression.before || !receipt.progression.after) return []
  let xp = receipt.progression.before.total_xp
  return receipt.tasks.map((task) => {
    if (task.status === "COMPLETED") xp += task.xp
    return xp
  })
}

export function readReceipt(value: unknown, boardId: string): CompletionReceipt {
  const r = value as CompletionReceipt
  const number = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0
  const progress = (p: CompletionProgress | null) =>
    p === null ||
    (!!p &&
      number(p.total_xp) &&
      number(p.level) &&
      p.level >= 1 &&
      number(p.level_xp) &&
      number(p.next_level_xp) &&
      p.next_level_xp > 0 &&
      p.level_xp <= p.next_level_xp &&
      typeof p.progress_pct === "number" &&
      Number.isFinite(p.progress_pct) &&
      p.progress_pct >= 0 &&
      p.progress_pct <= 100)
  if (
    !r ||
    r.board_id !== boardId ||
    typeof r.ready !== "boolean" ||
    typeof r.replayable !== "boolean" ||
    (r.replayable && (!r.ready || r.result_source === "legacy")) ||
    !["saved", "ledger", "legacy"].includes(r.result_source) ||
    !r.user ||
    typeof r.user.id !== "string" ||
    typeof r.user.display_name !== "string" ||
    !Array.isArray(r.tasks) ||
    r.tasks.length < 1 ||
    r.tasks.length > 3 ||
    !r.tasks.every(
      (task) =>
        task &&
        typeof task.id === "string" &&
        typeof task.title === "string" &&
        typeof task.status === "string" &&
        number(task.xp),
    ) ||
    new Set(r.tasks.map((task) => task.id)).size !== r.tasks.length ||
    !number(r.total_xp) ||
    !r.progression ||
    !progress(r.progression.before) ||
    !progress(r.progression.after) ||
    !Array.isArray(r.progression.levels) ||
    !r.progression.levels.every(
      (band, index, bands) =>
        number(band.level) &&
        band.level >= 1 &&
        number(band.start_xp) &&
        number(band.end_xp) &&
        band.end_xp > band.start_xp &&
        (index === 0 ||
          (band.level === bands[index - 1].level + 1 && band.start_xp === bands[index - 1].end_xp)),
    ) ||
    (r.ready &&
      (!r.tasks.every((task) => ["COMPLETED", "FAILED", "VOID", "EXPIRED"].includes(task.status)) ||
        r.total_xp !== r.tasks.reduce((sum, task) => sum + task.xp, 0) ||
        r.tasks.some((task) => task.status !== "COMPLETED" && task.xp !== 0)))
  )
    throw new Error("Invalid completion receipt")
  if (r.replayable) {
    const { before, after, levels } = r.progression
    if (
      !before ||
      !after ||
      !levels.length ||
      before.total_xp + r.total_xp !== after.total_xp ||
      levels[0].start_xp > before.total_xp ||
      levels[levels.length - 1].end_xp <= after.total_xp
    )
      throw new Error("Inconsistent completion progression")
    for (const point of [before, after]) {
      const expected = progressAt(point.total_xp, levels)
      if (
        expected.level !== point.level ||
        expected.value !== point.level_xp ||
        expected.cost !== point.next_level_xp
      )
        throw new Error("Inconsistent completion progression")
    }
  }
  return r
}
