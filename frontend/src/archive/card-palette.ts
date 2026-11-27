import type { Rank } from "./types"

export const CARD_RANK_COLORS = {
  F: "#96AAA1",
  E: "#B4B595",
  D: "#8DB697",
  C: "#79BCBA",
  B: "#91ABD6",
  A: "#B798CC",
  S: "#D9B765",
  SS: "#E6C3A0",
  SSS: "#D2EF96",
  EX: "#D8BA77",
} satisfies Record<Rank, string>
