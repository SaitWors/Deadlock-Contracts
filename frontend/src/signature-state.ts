export type Stroke = [number, number][]
export type Autograph = { mode: "text" | "draw"; text: string; strokes: Stroke[] }
export const MAX_SIGNATURE_POINTS = 1600
const key = (accountId: string) => `dc.signature.v1:${accountId}`

export function readSignature(accountId: string | undefined, operator: string): Autograph {
  const fallback: Autograph = { mode: "text", text: operator.slice(0, 80), strokes: [] }
  if (!accountId) return fallback
  try {
    const raw = localStorage.getItem(key(accountId))
    if (!raw || raw.length > 50_000) return fallback
    const value = JSON.parse(raw)
    if (
      !value ||
      !["text", "draw"].includes(value.mode) ||
      typeof value.text !== "string" ||
      value.text.length > 80 ||
      !Array.isArray(value.strokes) ||
      value.strokes.length > 40
    )
      return fallback
    let total = 0
    for (const stroke of value.strokes) {
      if (!Array.isArray(stroke) || stroke.length < 2) return fallback
      total += stroke.length
      if (total > MAX_SIGNATURE_POINTS) return fallback
      for (const point of stroke) {
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          !point.every(
            (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
          )
        )
          return fallback
      }
    }
    return { mode: value.mode, text: value.text, strokes: value.strokes }
  } catch {
    return fallback
  }
}

export function saveSignature(accountId: string | undefined, value: Autograph): boolean {
  if (!accountId) return false
  try {
    localStorage.setItem(key(accountId), JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const strokePath = (stroke: Stroke) =>
  stroke
    .map(([x, y], i) => `${i ? "L" : "M"}${(x * 400).toFixed(1)} ${(y * 120).toFixed(1)}`)
    .join(" ")
