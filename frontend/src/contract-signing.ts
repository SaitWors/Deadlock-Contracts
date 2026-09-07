export type SigningBoard = {
  id: string
  generation: number
  game_match_mode: string
  status: string
  expires_at: string
  locked_at?: string | null
  server_time?: string
  options: { id: string; selected: boolean }[]
}

export type SigningSelection = {
  boardId: string
  generation: number
  mode: string
  optionIds: string[]
}

export class SelectionChangedError extends Error {}
export class SigningUnconfirmedError extends Error {}

export function selectionState(
  selection: SigningSelection,
  board?: SigningBoard | null,
  serverNow?: string,
) {
  if (
    !board ||
    board.id !== selection.boardId ||
    board.generation !== selection.generation ||
    board.game_match_mode !== selection.mode ||
    selection.optionIds.length < 1 ||
    selection.optionIds.length > 3 ||
    new Set(selection.optionIds).size !== selection.optionIds.length ||
    selection.optionIds.some((id) => !board.options.some((option) => option.id === id))
  )
    return "changed"
  if (board.status !== "OFFERED") {
    const lockedAt = Date.parse(board.locked_at || "")
    if (!Number.isFinite(lockedAt) || !(Date.parse(board.expires_at) > lockedAt)) return "changed"
    const selected = board.options.filter((option) => option.selected)
    return ["LOCKED", "VERIFYING", "REVIEW_REQUIRED"].includes(board.status) &&
      selected.length === selection.optionIds.length &&
      selected.every((option) => selection.optionIds.includes(option.id))
      ? "signed"
      : "changed"
  }
  const now = Date.parse(serverNow || board.server_time || "")
  return Date.parse(board.expires_at) > (Number.isFinite(now) ? now : Date.now())
    ? "offered"
    : "changed"
}

/** Reconcile an ambiguous POST before allowing another attempt. The server owns the lock. */
export async function signSelection<T extends SigningBoard>(
  selection: SigningSelection,
  readBoard: () => Promise<T | undefined>,
  submit: () => Promise<T>,
): Promise<T> {
  const current = await readBoard()
  const state = selectionState(selection, current)
  if (state === "signed") return current!
  if (state !== "offered") throw new SelectionChangedError()
  let result: T
  try {
    result = await submit()
  } catch (error) {
    let recovered: T | undefined
    try {
      recovered = await readBoard()
    } catch {
      throw new SigningUnconfirmedError()
    }
    const recoveredState = selectionState(selection, recovered)
    if (recoveredState === "signed") return recovered!
    if (recoveredState === "changed") throw new SelectionChangedError()
    throw error
  }
  if (selectionState(selection, result) !== "signed") throw new SigningUnconfirmedError()
  return result
}
