import { LIGHT_EFFECTS } from "./light-effects"
import { PARTICLE_EFFECTS } from "./particle-effects"
import { SCREEN_EFFECTS } from "./screen-effects"
import { type Effect, figure, part } from "./stage"
import { WAVE_EFFECTS } from "./wave-effects"

const ARCHIVE_EFFECTS = [
  {
    name: "patron-seal",
    // The same Ritual pentagram rotates through the charge, turn, and outward pulse.
    seconds: 1.3,
    play(stage, tl) {
      const seal = part(stage, "patron-seal")
      const turn = stage.chargeSeconds ?? 0.8
      const appear = Math.min(0.56, turn * 0.59)
      const crest = turn + 0.34
      tl.fromTo(
        seal,
        { opacity: 0, scale: 0.75, rotate: -24 },
        { opacity: 0.83, scale: 1, rotate: -11, duration: appear, ease: "power2.out" },
        0,
      )
      tl.to(seal, { rotate: 9, duration: turn - appear, ease: "none" }, appear)
      tl.to(
        seal,
        { opacity: 0.96, scale: 1.055, rotate: 21, duration: 0.34, ease: "power2.in" },
        turn,
      )
      tl.to(seal, { opacity: 0, scale: 1.17, rotate: 37, duration: 0.61, ease: "power1.in" }, crest)
    },
  },
  {
    name: "archive-seal",
    // An archival impression that frames the wide exhibit.
    seconds: 1.25,
    play(stage, tl) {
      const seal = figure(
        stage,
        "archive-seal",
        `<g class="rco-fx-archive-seal-line" fill="none" transform="scale(1 ${Math.min(1.28, stage.ratio / 0.68)})">
           <ellipse rx="97" ry="66"/><ellipse rx="91" ry="60" stroke-dasharray="2 5"/>
           <path d="M-88-38V-52H-75M75-52H88V-38M88 38V52H75M-75 52H-88V38"/>
         </g>`,
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
