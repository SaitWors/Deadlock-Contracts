import type { Card, Receipt } from "./types"

export const wideCard = ({ rank, category }: Card) => rank === "EX" || category === "BASE"

export function deckRows(items: Receipt["items"], capacity: number) {
  let rows = 1
  let used = 0
  for (const { card } of items) {
    const span = wideCard(card) ? 1.52 : 1
    if (used + span > capacity) {
      rows++
      used = 0
    }
    used += span
  }
  return rows
}

// Keep the centre and the card's travel corridor clear, without moving layout seats.
export function restingOffset(seat: DOMRect, picked: DOMRect, scene: DOMRect, width: number) {
  function separate(
    a: number,
    b: number,
    size: number,
    low: number,
    high: number,
    min: number,
    max: number,
    focus: number,
  ) {
    const center = (min + max) / 2
    const half = size * 0.42
    const middle = (a + b) / 2
    const left = Math.min(low, center - focus / 2) - half - 12
    const right = Math.max(high, center + focus / 2) + half + 12
    const target =
      middle < center
        ? Math.max(min + half + 8, Math.min(left, middle - 16))
        : Math.min(max - half - 8, Math.max(right, middle + 16))
    return { offset: target - middle, clear: target <= left || target >= right }
  }
  const x = separate(
    seat.left,
    seat.right,
    seat.width,
    picked.left,
    picked.right,
    scene.left,
    scene.right,
    width,
  )
  const y = separate(
    seat.top,
    seat.bottom,
    seat.height,
    picked.top,
    picked.bottom,
    scene.top,
    scene.bottom,
    (picked.height * width) / picked.width,
  )
  return { x: x.offset, y: y.offset, opacity: x.clear || y.clear ? 0.24 : 0 }
}
