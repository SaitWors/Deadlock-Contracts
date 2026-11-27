// Adapted from BetterTyped react-cards-opening (MIT). See LICENSE.txt in this directory.

import { type Effect, part, piece } from "./stage"

// Effects that act on the whole stage: they move it, wash it, or lay something across all of it.

export const SCREEN_EFFECTS = [
  {
    name: "vignette",
    // The edges of the stage close in with the tier's colour and open again.
    seconds: 1.5,
    play: (stage, tl) => {
      const edge = part(stage, "vignette", true)
      tl.fromTo(
        edge,
        { opacity: 0, scale: 1.2 },
        { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" },
        0,
      )
      tl.to(edge, { opacity: 0, scale: 1.15, duration: 0.95, ease: "power1.in" }, 0.55)
    },
  },
  {
    name: "chroma",
    // Two flashes, one in the tier's colour and one in the accent, thrown apart and pulled back into one.
    seconds: 0.6,
    play: (stage, tl) => {
      const split = part(stage, "chroma", true)
      const left = piece(split, "chroma-half")
      const right = piece(split, "chroma-half rco-fx-chroma-other")
      const far = stage.unit * 0.55
      tl.set(split, { opacity: 1 }, 0)
      tl.fromTo(left, { x: -far }, { x: 0, duration: 0.6, ease: "expo.out" }, 0)
      tl.fromTo(right, { x: far }, { x: 0, duration: 0.6, ease: "expo.out" }, 0)
      tl.fromTo([left, right], { opacity: 1 }, { opacity: 0, duration: 0.6, ease: "power1.in" }, 0)
    },
  },
] as const satisfies readonly Effect[]
