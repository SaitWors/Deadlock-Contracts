import { LIGHT_EFFECTS } from "./light-effects"
import { PARTICLE_EFFECTS } from "./particle-effects"
import { SCREEN_EFFECTS } from "./screen-effects"
import { type Effect, figure, part } from "./stage"
import { WAVE_EFFECTS } from "./wave-effects"

const ARCHIVE_EFFECTS = [
  {
    name: "patron-seal",
    kind: "light",
    // The project’s Ritual pentagram appears behind the card and dissolves into the turn.
    seconds: 1.4,
    play(stage, tl) {
      const seal = part(stage, "patron-seal")
      tl.fromTo(
        seal,
        { opacity: 0, scale: 0.72, rotate: -12 },
        { opacity: 0.88, scale: 1, rotate: 0, duration: 0.72, ease: "power2.out" },
        0,
      )
      tl.to(seal, { opacity: 0, scale: 1.12, duration: 0.52, ease: "power1.in" }, 0.86)
    },
  },
  {
    name: "archive-seal",
    kind: "light",
    // An archival impression that frames the wide exhibit.
    seconds: 1.25,
    play(stage, tl) {
      const seal = figure(
        stage,
        "archive-seal",
        '<ellipse cx="0" cy="0" rx="97" ry="66"/><ellipse cx="0" cy="0" rx="91" ry="60" stroke-dasharray="2 5"/><path d="M-88-38V-52H-75M75-52H88V-38M88 38V52H75M-75 52H-88V38"/>',
      )
      tl.fromTo(
        seal,
        { opacity: 0, scale: 1.15, rotate: -5 },
        { opacity: 0.65, scale: 1, rotate: 0, duration: 0.24, ease: "back.out(1.6)" },
        0,
      )
      tl.to(seal, { opacity: 0, duration: 0.7, ease: "power1.in" }, 0.55)
    },
  },
] as const satisfies readonly Effect[]

const EFFECTS = [
  ...LIGHT_EFFECTS,
  ...PARTICLE_EFFECTS,
  ...SCREEN_EFFECTS,
  ...WAVE_EFFECTS,
  ...ARCHIVE_EFFECTS,
] as const

export type EffectName = (typeof EFFECTS)[number]["name"]

export const effectLibrary = new Map<EffectName, Effect>(
  EFFECTS.map((effect) => [effect.name, effect]),
)
