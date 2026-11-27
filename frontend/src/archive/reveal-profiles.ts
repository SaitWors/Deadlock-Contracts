import { CARD_RANK_COLORS } from "./card-palette"
import type { EffectName } from "./reveal-fx/library"
import type { Card, Rank } from "./types"

export type RevealMaterial =
  | "matte"
  | "satin"
  | "lacquer"
  | "foil"
  | "crystalline"
  | "prism"
  | "gold"
  | "holographic"
  | "patron"
  | "brass"

type Cue = {
  readonly name: EffectName
  readonly delayMs: number
  readonly intensity: number
  readonly size: number
}

export type RevealProfile = {
  readonly color: string
  readonly secondary: string
  readonly chargeMs: number
  readonly turnMs: number
  readonly intensity: number
  readonly glow: number
  readonly material: RevealMaterial
  readonly sound: number
  readonly hum: readonly Cue[]
  readonly reveal: readonly Cue[]
  readonly liteHum: readonly Cue[]
  readonly liteReveal: readonly Cue[]
}

const cue = (name: EffectName, delayMs = 0, intensity = 1, size = 1): Cue => ({
  name,
  delayMs,
  intensity,
  size,
})

export const REVEAL_PROFILES = {
  F: {
    color: CARD_RANK_COLORS.F,
    secondary: "#CBD3CA",
    chargeMs: 0,
    turnMs: 460,
    intensity: 0.42,
    glow: 0.08,
    material: "matte",
    sound: 0,
    hum: [],
    reveal: [cue("slam", 140), cue("dust", 170)],
    liteHum: [],
    liteReveal: [cue("dust", 120)],
  },
  E: {
    color: CARD_RANK_COLORS.E,
    secondary: "#E8DDAD",
    chargeMs: 110,
    turnMs: 480,
    intensity: 0.48,
    glow: 0.16,
    material: "satin",
    sound: 1,
    hum: [cue("flare", 0, 0.22)],
    reveal: [cue("ripples", 110), cue("starburst", 185, 0.7)],
    liteHum: [],
    liteReveal: [cue("ripples", 115)],
  },
  D: {
    color: CARD_RANK_COLORS.D,
    secondary: "#CBF0B5",
    chargeMs: 160,
    turnMs: 495,
    intensity: 0.62,
    glow: 0.25,
    material: "lacquer",
    sound: 2,
    hum: [cue("halo", 0, 0.28)],
    reveal: [cue("pulse", 125, 0.7), cue("fireflies", 205)],
    liteHum: [],
    liteReveal: [cue("fireflies", 145)],
  },
  C: {
    color: CARD_RANK_COLORS.C,
    secondary: "#D7FFF1",
    chargeMs: 270,
    turnMs: 525,
    intensity: 0.68,
    glow: 0.34,
    material: "foil",
    sound: 3,
    hum: [cue("converge", 0, 0.62)],
    reveal: [
      cue("frost", 120, 0.8),
      cue("hex", 190),
      cue("shards", 235, 0.65),
      cue("rim", 235, 0.45),
    ],
    liteHum: [cue("converge", 0, 0.62)],
    liteReveal: [cue("hex", 145), cue("shards", 185, 0.6)],
  },
  B: {
    color: CARD_RANK_COLORS.B,
    secondary: "#DEEDFF",
    chargeMs: 360,
    turnMs: 550,
    intensity: 0.73,
    glow: 0.42,
    material: "crystalline",
    sound: 4,
    hum: [cue("rim", 0, 0.5), cue("lightning", 35, 0.38)],
    reveal: [
      cue("shockwave", 145),
      cue("rim", 180, 0.55),
      cue("sparks", 220),
      cue("orbit", 290, 0.55),
    ],
    liteHum: [cue("rim", 0, 0.64)],
    liteReveal: [cue("shockwave", 130), cue("sparks", 160)],
  },
  A: {
    color: CARD_RANK_COLORS.A,
    secondary: "#EBD4FA",
    chargeMs: 500,
    turnMs: 570,
    intensity: 0.78,
    glow: 0.46,
    material: "prism",
    sound: 5,
    hum: [cue("implosion", 0, 0.72)],
    reveal: [
      cue("sigil", 100, 0.74),
      cue("diamond", 180),
      cue("starburst", 235, 0.62),
      cue("spiral", 310, 0.82),
    ],
    liteHum: [cue("implosion", 0, 0.6)],
    liteReveal: [cue("sigil", 100, 0.85), cue("spiral", 140, 0.65)],
  },
  S: {
    color: CARD_RANK_COLORS.S,
    secondary: "#FFF1B1",
    chargeMs: 710,
    turnMs: 600,
    intensity: 0.84,
    glow: 0.55,
    material: "gold",
    sound: 6,
    hum: [cue("halo", 0, 0.42, 0.8)],
    reveal: [
      cue("pillar", 120, 0.56, 0.82),
      cue("sunburst", 215, 0.45, 0.74),
      cue("embers", 235, 0.9),
      cue("starburst", 340, 0.33, 0.72),
      cue("beams", 420, 0.54, 0.9),
    ],
    liteHum: [cue("halo", 0, 0.39, 0.8)],
    liteReveal: [cue("pillar", 120, 0.5, 0.8), cue("embers", 190, 0.85)],
  },
  SS: {
    color: CARD_RANK_COLORS.SS,
    secondary: "#CBAFEF",
    chargeMs: 1000,
    turnMs: 620,
    intensity: 0.86,
    glow: 0.62,
    material: "holographic",
    sound: 7,
    hum: [cue("converge", 0, 0.54, 0.92), cue("implosion", 195, 0.82), cue("cracks", 475, 0.92)],
    reveal: [
      cue("chroma", 165, 0.34),
      cue("echo", 210, 0.79),
      cue("shards", 265),
      cue("nova", 495, 0.21, 0.77),
    ],
    liteHum: [cue("cracks", 155, 0.88)],
    liteReveal: [cue("echo", 130, 0.68), cue("shards", 200, 0.92)],
  },
  SSS: {
    color: CARD_RANK_COLORS.SSS,
    secondary: "#FAFFD6",
    chargeMs: 1530,
    turnMs: 650,
    intensity: 0.93,
    glow: 0.78,
    material: "patron",
    sound: 8,
    hum: [
      cue("vignette", 0, 0.29),
      cue("patron-seal", 80, 0.95),
      cue("converge", 300, 0.34, 0.84),
      cue("orbit", 440, 0.46),
      cue("implosion", 695, 0.87),
    ],
    reveal: [
      cue("pillar", 215, 0.46, 0.82),
      cue("nova", 310, 0.69, 0.91),
      cue("comets", 380, 0.81),
      cue("spiral", 540, 0.42),
      cue("smoke", 690, 0.38),
    ],
    liteHum: [cue("patron-seal", 55, 0.83), cue("implosion", 390, 0.67)],
    liteReveal: [cue("nova", 255, 0.59, 0.86), cue("comets", 335, 0.68)],
  },
  EX: {
    color: CARD_RANK_COLORS.EX,
    secondary: "#FAE2B0",
    chargeMs: 780,
    turnMs: 620,
    intensity: 0.76,
    glow: 0.48,
    material: "brass",
    sound: 9,
    hum: [cue("spotlight", 75, 0.55, 0.69)],
    reveal: [
      cue("flare", 130, 0.39, 0.69),
      cue("rays", 200, 0.52, 0.8),
      cue("archive-seal", 285, 0.85),
      cue("stardust", 365, 0.89),
    ],
    liteHum: [cue("spotlight", 50, 0.5, 0.69)],
    liteReveal: [cue("archive-seal", 180, 0.78), cue("stardust", 250, 0.72)],
  },
} satisfies Record<Rank, RevealProfile>

const PATRON_HERO_EFFECTS = new Map<string, Cue>([
  ["seven", cue("lightning", 600, 0.53)],
  ["infernus", cue("embers", 460, 0.9)],
  ["haze", cue("smoke", 450, 0.77)],
  ["ivy", cue("shards", 390, 0.86)],
  ["abrams", cue("sigil", 390, 0.77)],
  ["wraith", cue("spiral", 430, 0.84)],
])

export function revealProfile(card: Pick<Card, "rank" | "hero" | "hero_name">): RevealProfile {
  const base = REVEAL_PROFILES[card.rank]
  if (card.rank !== "SSS") return base
  const hero = card.hero.replace(/^hero_/, "").toLowerCase()
  const effect =
    PATRON_HERO_EFFECTS.get(hero) ?? PATRON_HERO_EFFECTS.get(card.hero_name.toLowerCase())
  return effect ? { ...base, reveal: [...base.reveal, effect] } : base
}

export const PACK_REVEAL_PROFILE: RevealProfile = {
  ...REVEAL_PROFILES.EX,
  intensity: 0.82,
  reveal: [cue("flare", 0, 0.55), cue("sparks", 35, 0.82), cue("dust", 60, 0.75)],
  liteReveal: [cue("sparks", 30, 0.65)],
}
