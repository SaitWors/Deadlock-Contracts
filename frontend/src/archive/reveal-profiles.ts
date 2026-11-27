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
  readonly background: boolean
  readonly hum: readonly Cue[]
  readonly reveal: readonly Cue[]
  readonly liteHum: readonly Cue[]
  readonly liteReveal: readonly Cue[]
}

const cue = (name: EffectName, delayMs = 0, intensity = 1): Cue => ({ name, delayMs, intensity })

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
    background: false,
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
    background: false,
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
    background: false,
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
    background: false,
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
    background: false,
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
    background: false,
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
    background: false,
    hum: [cue("halo", 0, 0.7)],
    reveal: [
      cue("sunburst", 120, 0.7),
      cue("pillar", 140, 0.7),
      cue("starburst", 255, 0.6),
      cue("embers", 295),
      cue("beams", 430, 0.48),
    ],
    liteHum: [cue("halo", 0, 0.65)],
    liteReveal: [cue("sunburst", 120, 0.6), cue("embers", 180)],
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
    background: true,
    hum: [cue("converge", 0, 0.65), cue("implosion", 245, 0.85)],
    reveal: [
      cue("cracks", 135, 0.78),
      cue("chroma", 170, 0.49),
      cue("echo", 235, 0.75),
      cue("nova", 320, 0.68),
      cue("shards", 390),
    ],
    liteHum: [cue("implosion", 10, 0.72)],
    liteReveal: [cue("cracks", 100, 0.9), cue("shards", 195)],
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
    background: true,
    hum: [
      cue("vignette", 0, 0.64),
      cue("converge", 210, 0.78),
      cue("patron-seal", 240, 0.92),
      cue("implosion", 660, 0.95),
    ],
    reveal: [
      cue("nova", 105, 0.92),
      cue("pillar", 140, 0.65),
      cue("lightning", 215, 0.55),
      cue("cracks", 275, 0.75),
      cue("shockwave", 340, 0.76),
      cue("comets", 415, 0.83),
      cue("smoke", 630, 0.56),
    ],
    liteHum: [cue("patron-seal", 30, 0.7), cue("converge", 100, 0.75)],
    liteReveal: [cue("nova", 85, 0.8), cue("shockwave", 130, 0.6), cue("comets", 180, 0.65)],
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
    background: false,
    hum: [cue("halo", 0, 0.43), cue("spotlight", 110, 0.5)],
    reveal: [
      cue("rays", 120, 0.68),
      cue("stardust", 210, 0.9),
      cue("flare", 315, 0.53),
      cue("archive-seal", 360, 0.8),
    ],
    liteHum: [cue("halo", 0, 0.43)],
    liteReveal: [cue("rays", 115, 0.63), cue("stardust", 150, 0.7)],
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
