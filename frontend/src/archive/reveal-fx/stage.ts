// Adapted from BetterTyped react-cards-opening (MIT). See LICENSE.txt in this directory.

import type { EffectTimeline } from "./timeline"
import type { Particle, ParticleField, ParticleShape, Polar } from "./particles"

// What an effect is given to work with, and the two ways it has of drawing: particles on the layer's canvas, and
// parts, which are plain elements styled by the stylesheet and moved by a timeline.

export interface EffectStage {
  /** The element every part of this play is put in. It is taken away when the play is over. */
  root: HTMLElement
  emit: ParticleField["emit"]
  /** Where the effect is centred, in pixels from the layer's top left corner. */
  x: number
  y: number
  /** `size / 300`: what a design pixel is worth here. */
  scale: number
  /** `size * render`: the width of what is celebrated in the parts' own pixels. What a part moves by. */
  unit: number
  /** Height over width of what is celebrated. */
  ratio: number
  /** The layer's own size. */
  width: number
  height: number
  tone: string
  /** Time remaining before the card turns, when this cue starts during charge. */
  chargeSeconds?: number
  random: () => number
}

export interface Effect<Name extends string = string> {
  name: Name
  /** How long it plays. */
  seconds: number
  /** Adds what the effect does to `timeline`, starting at zero. */
  play: (stage: EffectStage, timeline: EffectTimeline) => void
}

/** Rank palettes are six-digit hexadecimal colors. */
export const channels = (hex: string): number[] => {
  const value = Number.parseInt(hex.slice(1), 16)
  return [value >> 16, (value >> 8) & 255, value & 255]
}

/** Mix a rank color towards black or white by a share between 0 and 1. */
function mixBrightness(from: string, target: number, amount: number): string {
  return `#${channels(from)
    .map((channel) =>
      Math.round(channel + (target - channel) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

export const tint = (colour: string, amount: number) => mixBrightness(colour, 255, amount)
export const shade = (colour: string, amount: number) => mixBrightness(colour, 0, amount)

/* ---------- particles ---------- */

type Range = number | readonly [low: number, high: number]

export interface Spawn {
  /** The moment of the effect they are let go at, in seconds. Its start unless told otherwise. */
  at?: number
  count: number
  shape?: ParticleShape | readonly ParticleShape[]
  colours?: readonly string[]
  /**
   * Where each one is born, from the effect's centre, in design pixels. `edge` is the outline of what is
   * celebrated, at the point each one flies out through: an effect plays behind the card, so what starts at the
   * middle spends its best moment hidden. The centre unless told otherwise.
   */
  from?:
    | "edge"
    | ((index: number, count: number, random: () => number) => readonly [x: number, y: number])
  /**
   * The way each one flies, in radians, zero pointing right and a quarter turn pointing down. A pair spreads them
   * evenly between two angles, with a little jitter. Everywhere, unless told otherwise.
   */
  angle?:
    | readonly [from: number, to: number]
    | ((index: number, count: number, random: () => number) => number)
  /** Design pixels a second. */
  speed?: Range
  life?: Range
  /** Seconds before it appears. */
  delay?: Range
  size?: Range
  grow?: number
  spin?: Range
  /** Its turn at birth, or `heading` to point the way it flies. */
  rotation?: Range | "heading"
  gravity?: number
  drag?: number
  alpha?: Range
  fadeIn?: number
  fadeOut?: number
  twinkle?: Range
  sway?: Range
  swayHz?: Range
  flip?: Range
  glow?: number
  trail?: number
  /** Circles the centre instead of flying: its radius, how fast that grows, how fast it turns, and the squash. */
  polar?: (index: number, count: number, random: () => number) => Omit<Polar, "cx" | "cy">
}

const TAU = Math.PI * 2
const FULL = [0, TAU] as const

/**
 * The point where a line from the middle at `angle` crosses the outline of what is celebrated, in design pixels.
 * `share` pulls it in (under one) or pushes it out (over one).
 */
export function onEdge(angle: number, ratio: number, share = 1): readonly [x: number, y: number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const reach =
    Math.min(150 / Math.max(Math.abs(cos), 1e-6), (150 * ratio) / Math.max(Math.abs(sin), 1e-6)) *
    share
  return [cos * reach, sin * reach]
}

/** Makes the particles an effect asked for, scaled to the stage and placed on it. */
export function spawn(stage: EffectStage, spec: Spawn): Particle[] {
  const { random, scale } = stage
  const pick = (range: Range | undefined, fallback: number) => {
    if (range === undefined) return fallback
    if (typeof range === "number") return range
    return range[0] + (range[1] - range[0]) * random()
  }
  const shapes = typeof spec.shape === "string" ? [spec.shape] : (spec.shape ?? ["square"])
  const colours = spec.colours ?? [stage.tone]

  return Array.from({ length: spec.count }, (_unused, index) => {
    const spread = spec.angle ?? FULL
    const angle =
      typeof spread === "function"
        ? spread(index, spec.count, random)
        : spread[0] + ((index + random() * 0.9) / spec.count) * (spread[1] - spread[0])
    let fromX = 0
    let fromY = 0
    if (spec.from === "edge") [fromX, fromY] = onEdge(angle, stage.ratio, 0.92)
    else if (spec.from) [fromX, fromY] = spec.from(index, spec.count, random)
    const speed = pick(spec.speed, 0) * scale
    const orbit = spec.polar?.(index, spec.count, random)
    const x = stage.x + fromX * scale
    const y = stage.y + fromY * scale
    const rotation = spec.rotation === "heading" ? angle : pick(spec.rotation, random() * TAU)

    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: (spec.gravity ?? 0) * scale,
      drag: spec.drag ?? 1,
      age: -pick(spec.delay, 0),
      life: pick(spec.life, 1),
      size: pick(spec.size, 6) * scale,
      grow: spec.grow ?? 1,
      rotation,
      spin: pick(spec.spin, 0),
      colour: colours[Math.floor(random() * colours.length)] ?? stage.tone,
      shape: shapes[Math.floor(random() * shapes.length)] ?? "square",
      alpha: pick(spec.alpha, 1),
      fadeIn: spec.fadeIn ?? 0.04,
      fadeOut: spec.fadeOut ?? 0.4,
      twinkle: pick(spec.twinkle, 0),
      phase: random() * TAU,
      sway: pick(spec.sway, 0) * scale,
      swayHz: pick(spec.swayHz, 1),
      flip: pick(spec.flip, 0),
      glow: spec.glow ?? 0,
      trail: spec.trail ?? 0.08,
      polar: orbit
        ? { ...orbit, cx: x, cy: y, radius: orbit.radius * scale, radial: orbit.radial * scale }
        : null,
    } satisfies Particle
  })
}

/** Lets particles go at their moment of the timeline. */
export function emit(stage: EffectStage, timeline: EffectTimeline, spec: Spawn): void {
  timeline.call(() => stage.emit(spawn(stage, spec)), spec.at ?? 0)
}

/* ---------- parts ---------- */

/**
 * An element of the effect, on the stage. A part sits on the effect's centre and is sized by the stylesheet in
 * `--rco-fx-u`, the width of what is celebrated. A cover fills the whole layer instead.
 */
export function part(stage: EffectStage, name: string, cover = false): HTMLElement {
  return appendPiece(stage.root, `${cover ? "rco-fx-cover" : "rco-fx"} rco-fx-${name}`)
}

/** A part inside another part: a ring's second line, a flare's ghost. */
export function piece(parent: HTMLElement, name: string): HTMLElement {
  return appendPiece(parent, `rco-fx-${name}`)
}

function appendPiece(parent: HTMLElement, className: string): HTMLElement {
  const element = document.createElement("i")
  element.className = className
  parent.append(element)
  return element
}

const SVG = "http://www.w3.org/2000/svg"

/** Every drawn part's lines are kept under a name of their own, so the copies of them can point at it. */
let drawn = 0

/**
 * The sheet a drawn part is on, and the group its lines go in. The lines are drawn four times over: three times
 * wide and faint, in the tier's colour, and once as themselves. That is their glow. A blur filter would give the
 * same light, and would have the browser blur a picture several screens wide again on every frame; lines drawn
 * wider cost what lines cost. The copies follow the lines: change a line's points and its glow has moved too.
 */
function sheet(stage: EffectStage, name: string): { svg: SVGSVGElement; ink: SVGGElement } {
  const svg = document.createElementNS(SVG, "svg")
  svg.setAttribute("class", `rco-fx rco-fx-${name}`)
  svg.setAttribute("viewBox", "-100 -100 200 200")
  drawn += 1
  const id = `rco-fx-ink-${drawn}`
  const kept = document.createElementNS(SVG, "defs")
  const ink = document.createElementNS(SVG, "g")
  ink.setAttribute("id", id)
  kept.append(ink)
  svg.append(kept)
  for (const layer of ["glow-far", "glow-mid", "glow-near", "ink"]) {
    const copy = document.createElementNS(SVG, "use")
    copy.setAttribute("href", `#${id}`)
    copy.setAttribute("class", `rco-fx-${layer}`)
    svg.append(copy)
  }
  stage.root.append(svg)
  return { svg, ink }
}

/**
 * A drawn part: outlines that stay one line thick however far they are stretched. The part itself, the thing to
 * move and fade, is each line's `ownerSVGElement`.
 */
export function drawing(
  stage: EffectStage,
  name: string,
  { tag, count = 1 }: { tag: "polygon" | "polyline"; count?: number },
): SVGElement[] {
  const { ink } = sheet(stage, name)
  return Array.from({ length: count }, () => {
    const line = document.createElementNS(SVG, tag)
    line.setAttribute("class", `rco-fx-${name.split(" ")[0]}-line`)
    line.setAttribute("vector-effect", "non-scaling-stroke")
    ink.append(line)
    return line
  })
}

/**
 * A drawn part made of more than outlines: circles, dashes, whatever the markup says. The markup is the effect's
 * own, written in the library, never anything a page passed in.
 */
export function figure(stage: EffectStage, name: string, markup: string): SVGElement {
  const { svg, ink } = sheet(stage, name)
  ink.innerHTML = markup
  return svg
}

/** The corners of a shape with this many sides, as SVG points, its first corner straight up. */
export function corners(sides: number, radius = 100): string {
  return Array.from({ length: sides }, (_unused, index) => {
    const angle = (index / sides) * TAU - Math.PI / 2
    return `${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`
  }).join(" ")
}
