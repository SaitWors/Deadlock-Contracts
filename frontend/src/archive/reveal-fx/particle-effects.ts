// Adapted from BetterTyped react-cards-opening (MIT). See LICENSE.txt in this directory.

import { type Effect, type EffectStage, emit, onEdge, shade, tint } from "./stage"

// Effects made of particles. Each is written for a card 300 pixels wide, in pixels and pixels a second, and the
// stage scales it. Angles are in radians: zero points right, a quarter turn points down, so `UP` is negative.

const TAU = Math.PI * 2
const UP = -Math.PI / 2

/** The layer's edges, seen from the effect's centre, in design pixels: for what falls across the whole stage. */
const edges = (stage: EffectStage) => ({
  left: -stage.x / stage.scale,
  right: (stage.width - stage.x) / stage.scale,
  top: -stage.y / stage.scale,
  bottom: (stage.height - stage.y) / stage.scale,
})

const between = (low: number, high: number, random: () => number) => low + (high - low) * random()

/** A place on the card's outline picked at random, pushed out from it by between `near` and `far` of its size. */
const around =
  (stage: EffectStage, near: number, far: number) =>
  (_index: number, _count: number, random: () => number) =>
    onEdge(random() * TAU, stage.ratio, between(near, far, random))

export const PARTICLE_EFFECTS = [
  {
    name: "sparks",
    // A ring of lit squares thrown hard and slowing fast, the way the card's own burst does.
    seconds: 1.3,
    play: (stage, tl) => {
      emit(stage, tl, {
        count: 56,
        shape: "square",
        colours: [stage.tone, stage.tone, tint(stage.tone, 0.5), tint(stage.tone, 0.85)],
        from: "edge",
        speed: [260, 1150],
        drag: 0.03,
        gravity: 160,
        life: [0.6, 1.25],
        size: [5, 11],
        spin: [-7, 7],
        glow: 0.75,
        fadeOut: 0.55,
      })
    },
  },
  {
    name: "embers",
    // Small hot lights lifting off the card, drifting and flickering out on the way up.
    seconds: 3.4,
    play: (stage, tl) => {
      emit(stage, tl, {
        count: 96,
        shape: "mote",
        colours: [stage.tone, tint(stage.tone, 0.35), tint(stage.tone, 0.75)],
        from: around(stage, 0.9, 1.25),
        angle: [UP - 0.25, UP + 0.25],
        speed: [50, 190],
        gravity: -36,
        life: [1.5, 2.6],
        delay: [0, 1.5],
        size: [4, 8.5],
        grow: 0.4,
        twinkle: [3, 8],
        sway: [18, 55],
        swayHz: [0.5, 1.4],
        fadeIn: 0.15,
        fadeOut: 0.55,
        glow: 1,
      })
    },
  },
  {
    name: "stardust",
    // Four-pointed stars easing outward and twinkling as they slow.
    seconds: 2.6,
    play: (stage, tl) => {
      emit(stage, tl, {
        count: 64,
        shape: ["star", "star", "mote"],
        colours: [tint(stage.tone, 0.6), tint(stage.tone, 0.9), stage.tone],
        from: "edge",
        speed: [40, 420],
        drag: 0.22,
        life: [1.3, 2.5],
        delay: [0, 0.25],
        size: [4, 11],
        spin: [-1.2, 1.2],
        twinkle: [2, 5],
        fadeIn: 0.12,
        fadeOut: 0.5,
        glow: 0.6,
      })
    },
  },
  {
    name: "shards",
    // Splinters of glass with one lit facet each, spinning as they fall.
    seconds: 1.7,
    play: (stage, tl) => {
      emit(stage, tl, {
        count: 30,
        shape: "shard",
        colours: [stage.tone, tint(stage.tone, 0.35), tint(stage.tone, 0.7)],
        from: "edge",
        speed: [280, 820],
        gravity: 720,
        drag: 0.28,
        life: [0.9, 1.6],
        size: [9, 21],
        spin: [-11, 11],
        flip: [0.8, 2.6],
        fadeOut: 0.25,
      })
    },
  },
  {
    name: "comets",
    // A handful of bright heads with tapering tails, fired outward.
    seconds: 1.1,
    play: (stage, tl) => {
      emit(stage, tl, {
        count: 16,
        shape: "streak",
        colours: [tint(stage.tone, 0.3), stage.tone],
        from: "edge",
        speed: [900, 1500],
        drag: 0.1,
        life: [0.5, 0.95],
        size: [5, 8.5],
        trail: 0.14,
        glow: 0.9,
        fadeOut: 0.5,
      })
    },
  },
  {
    name: "spiral",
    // Three arms of light winding out from behind the card like a small galaxy.
    seconds: 2.2,
    play: (stage, tl) => {
      emit(stage, tl, {
        count: 96,
        shape: "mote",
        colours: [stage.tone, tint(stage.tone, 0.5), tint(stage.tone, 0.75)],
        delay: [0, 0.02],
        life: [1.2, 1.9],
        size: [4, 8],
        grow: 0.5,
        glow: 0.9,
        fadeIn: 0.1,
        fadeOut: 0.5,
        polar: (index) => {
          // Three arms. Along an arm each light starts a little further out and a little further round.
          const along = Math.floor(index / 3)
          return {
            radius: 150 + along * 7,
            angle: (index % 3) * (TAU / 3) + along * 0.13,
            radial: 150,
            turn: 2.8,
            squash: 1,
          }
        },
        drag: 0.45,
      })
    },
  },
  {
    name: "fireflies",
    // Slow lights wandering around the card, each pulsing at its own pace.
    seconds: 3.8,
    play: (stage, tl) => {
      emit(stage, tl, {
        count: 36,
        shape: "mote",
        colours: [stage.tone, tint(stage.tone, 0.4)],
        from: (_index, _count, random) => [between(-260, 260, random), between(-280, 280, random)],
        speed: [8, 46],
        life: [2.4, 3.6],
        delay: [0, 0.5],
        size: [4, 7.5],
        twinkle: [0.5, 1.3],
        sway: [26, 64],
        swayHz: [0.25, 0.7],
        fadeIn: 0.2,
        fadeOut: 0.35,
        glow: 1,
      })
    },
  },
  {
    name: "orbit",
    // Lights circling the card on a tilted ring, tightening as they fade.
    seconds: 2.6,
    play: (stage, tl) => {
      emit(stage, tl, {
        count: 36,
        shape: "mote",
        colours: [stage.tone, tint(stage.tone, 0.55), tint(stage.tone, 0.75)],
        delay: [0, 0.06],
        life: [2, 2.5],
        size: [5, 9.5],
        glow: 1,
        fadeIn: 0.12,
        fadeOut: 0.3,
        polar: (index, count) => ({
          radius: 250 + (index % 3) * 18,
          angle: (index / count) * TAU,
          radial: -22,
          turn: 3.4,
          squash: 0.62,
        }),
      })
    },
  },
  {
    name: "implosion",
    // Streaks drawn in from all around to the card's middle. A charge, best before something louder.
    seconds: 0.95,
    play: (stage, tl) => {
      const life = 0.62
      emit(stage, tl, {
        count: 56,
        shape: "streak",
        colours: [stage.tone, tint(stage.tone, 0.5)],
        from: (index, count) => {
          const angle = (index / count) * TAU
          const far = 300 + (index % 5) * 34
          return [Math.cos(angle) * far, Math.sin(angle) * far]
        },
        // Each one flies back down the line it was placed on, and gets to the middle as its life runs out.
        angle: (index, count) => (index / count) * TAU + Math.PI,
        speed: [470, 560],
        drag: 1.9,
        life,
        delay: [0, 0.26],
        size: [3, 5.5],
        grow: 0.3,
        trail: 0.1,
        glow: 0.7,
        fadeIn: 0.3,
        fadeOut: 0.12,
      })
    },
  },
  {
    name: "smoke",
    // Soft puffs in the tier's colour swelling and thinning out behind the card.
    seconds: 2.4,
    play: (stage, tl) => {
      emit(stage, tl, {
        count: 22,
        shape: "puff",
        colours: [stage.tone, shade(stage.tone, 0.3), tint(stage.tone, 0.3)],
        from: around(stage, 0.75, 1.1),
        speed: [50, 210],
        drag: 0.3,
        gravity: -46,
        life: [1.4, 2.3],
        delay: [0, 0.2],
        size: [90, 170],
        grow: 2.1,
        alpha: [0.4, 0.7],
        fadeIn: 0.14,
        fadeOut: 0.6,
      })
    },
  },
  {
    name: "dust",
    // A low cloud kicked out sideways from the card's foot, as if it had landed hard.
    seconds: 1.5,
    play: (stage, tl) => {
      emit(stage, tl, {
        count: 30,
        shape: "puff",
        colours: [tint(stage.tone, 0.5), tint(stage.tone, 0.75)],
        from: (_index, _count, random) => [between(-120, 120, random), 196],
        angle: (index, _count, random) =>
          (index % 2 === 0 ? 0 : Math.PI) +
          between(-0.2, 0.2, random) * (index % 2 === 0 ? -1 : 1) -
          0.12,
        speed: [160, 620],
        drag: 0.05,
        gravity: -30,
        life: [0.8, 1.4],
        size: [30, 70],
        grow: 2.2,
        alpha: [0.4, 0.75],
        fadeIn: 0.1,
        fadeOut: 0.7,
      })
    },
  },
] as const satisfies readonly Effect[]
