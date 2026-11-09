import type { CompletionReceipt, LevelBand } from "./types"

export function progressAt(totalXp: number, levels: LevelBand[]) {
  const band = [...levels].reverse().find((item) => totalXp >= item.start_xp) || levels[0]
  const cost = Math.max(1, band.end_xp - band.start_xp)
  const value = Math.max(0, Math.min(cost, totalXp - band.start_xp))
  return { level: band.level, value, cost, percent: (value / cost) * 100 }
}

// Animation is a replay of an already credited receipt, never a reward operation.
export function replayTargets(receipt: CompletionReceipt): number[] {
  let xp = receipt.progression.before.total_xp
  return receipt.tasks.map((task) => {
    if (task.status === "COMPLETED") xp += task.xp
    return Math.min(receipt.progression.after.total_xp, xp)
  })
}

export function readReceipt(value: unknown, boardId: string): CompletionReceipt {
  const r = value as CompletionReceipt
  const number = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0
  if (
    !r ||
    r.board_id !== boardId ||
    typeof r.ready !== "boolean" ||
    !r.user ||
    typeof r.user.id !== "string" ||
    typeof r.user.display_name !== "string" ||
    !Array.isArray(r.tasks) ||
    r.tasks.length < 1 ||
    r.tasks.length > 3 ||
    new Set(r.tasks.map((task) => task.id)).size !== r.tasks.length ||
    !r.tasks.every(
      (task) =>
        task &&
        typeof task.id === "string" &&
        typeof task.title === "string" &&
        typeof task.status === "string" &&
        number(task.xp),
    ) ||
    !number(r.total_xp) ||
    !r.progression ||
    !r.progression.before ||
    !r.progression.after ||
    !number(r.progression.before.total_xp) ||
    !number(r.progression.after.total_xp) ||
    r.progression.before.total_xp > r.progression.after.total_xp ||
    !Array.isArray(r.progression.levels) ||
    !r.progression.levels.length ||
    !r.progression.levels.every(
      (band) =>
        number(band.level) &&
        band.level >= 1 &&
        number(band.start_xp) &&
        number(band.end_xp) &&
        band.end_xp > band.start_xp,
    ) ||
    (r.ready &&
      (!r.tasks.every((task) => ["COMPLETED", "FAILED", "VOID", "EXPIRED"].includes(task.status)) ||
        r.total_xp !== r.tasks.reduce((sum, task) => sum + task.xp, 0) ||
        r.tasks.some((task) => task.status !== "COMPLETED" && task.xp !== 0)))
  )
    throw new Error("Invalid completion receipt")
  return r
}
