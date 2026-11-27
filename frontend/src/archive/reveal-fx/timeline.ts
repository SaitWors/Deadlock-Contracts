type EffectNode = HTMLElement | SVGElement
type Targets = EffectNode | readonly EffectNode[]
type Ease = (progress: number) => number

type TweenValues = {
  duration?: number
  ease?: string
  repeat?: number
  yoyo?: boolean
  keyframes?: readonly TweenValues[]
  [key: string]: string | number | boolean | readonly TweenValues[] | undefined
}

export type EffectTimeline = {
  set: (targets: Targets, values: TweenValues, at: number) => void
  to: (targets: Targets, values: TweenValues, at: number) => void
  fromTo: (targets: Targets, from: TweenValues, to: TweenValues, at: number) => void
  call: (callback: () => void, params: undefined, at: number) => void
}

type Tween = {
  at: number
  duration: number
  cycles: number
  yoyo: boolean
  from: number
  to: number
  ease: Ease
}

const TWEEN_OPTIONS = new Set(["duration", "ease", "repeat", "yoyo", "keyframes"])
const IDENTITY = (progress: number) => progress

function easing(name = "power1.out"): Ease {
  if (name === "none") return IDENTITY
  if (name === "expo.out") return (progress) => (progress === 1 ? 1 : 1 - 2 ** (-10 * progress))
  if (name === "sine.inOut") return (progress) => (1 - Math.cos(progress * Math.PI)) / 2
  const back = /back\.out\(([^)]+)\)/.exec(name)
  if (back) {
    const overshoot = Number(back[1])
    return (progress) => 1 + (progress - 1) ** 2 * ((overshoot + 1) * (progress - 1) + overshoot)
  }
  const power = /power([1-4])\.(in|out)/.exec(name)
  if (!power) return IDENTITY
  const exponent = Number(power[1]) + 1
  return power[2] === "in"
    ? (progress) => progress ** exponent
    : (progress) => 1 - (1 - progress) ** exponent
}

function valueAt(track: readonly Tween[], at: number): number | undefined {
  let index = track.length - 1
  while (index >= 0 && track[index].at > at) index--
  const tween = track[index]
  if (!tween) return undefined
  const elapsed = at - tween.at
  const cycle = tween.duration
    ? Math.min(tween.cycles - 1, Math.floor(elapsed / tween.duration))
    : 0
  const progress = tween.duration
    ? Math.min(1, (elapsed - cycle * tween.duration) / tween.duration)
    : 1
  const weight = tween.ease(tween.yoyo && cycle % 2 === 1 ? 1 - progress : progress)
  return tween.from + (tween.to - tween.from) * weight
}

function initialValue(node: EffectNode, property: string): number {
  if (property.startsWith("scale")) return 1
  if (property === "opacity") {
    return Number.parseFloat(getComputedStyle(node).opacity) || 0
  }
  return 0
}

// A small numeric timeline for the subset used by the selected BetterTyped effects. The source
// effects still control their geometry, keyframes, easing, repeats, and simultaneous property tracks.
export function runTimeline(
  build: (tl: EffectTimeline) => void,
  seconds: number,
  timeScale: number,
  onComplete: () => void,
): () => void {
  const targets = new Map<EffectNode, Map<string, Tween[]>>()
  const calls: { at: number; callback: () => void }[] = []
  let end = seconds
  const enqueue = (nodes: Targets, from: TweenValues, to: TweenValues, at: number) => {
    if (to.keyframes) {
      let start = at
      for (const [index, keyframe] of to.keyframes.entries()) {
        enqueue(nodes, index === 0 ? from : {}, keyframe, start)
        start += keyframe.duration ?? 0
      }
      return
    }
    const duration = to.duration ?? 0
    const cycles = (to.repeat ?? 0) + 1
    const ease = easing(to.ease)
    end = Math.max(end, at + duration * cycles)
    for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
      const properties = targets.get(node) ?? new Map<string, Tween[]>()
      targets.set(node, properties)
      for (const property of new Set([...Object.keys(from), ...Object.keys(to)])) {
        if (TWEEN_OPTIONS.has(property)) continue
        const track = properties.get(property) ?? []
        properties.set(property, track)
        const start = from[property] ?? valueAt(track, at) ?? initialValue(node, property)
        const finish = to[property] ?? start
        if (typeof start !== "number" || typeof finish !== "number") continue
        track.push({ at, duration, cycles, yoyo: to.yoyo ?? false, from: start, to: finish, ease })
      }
    }
  }

  build({
    set: (nodes, values, at) => enqueue(nodes, values, values, at),
    to: (nodes, values, at) => enqueue(nodes, {}, values, at),
    fromTo: enqueue,
    call: (callback, _params, at) => {
      calls.push({ at, callback })
      end = Math.max(end, at)
    },
  })

  calls.sort((left, right) => left.at - right.at)
  let callIndex = 0
  let frame = 0
  const started = performance.now()
  const draw = (now: number) => {
    const at = (now - started) / (1000 * timeScale)
    while (callIndex < calls.length && calls[callIndex].at <= at) calls[callIndex++].callback()
    for (const [node, tracks] of targets) {
      const get = (name: string) => valueAt(tracks.get(name) ?? [], at)
      const opacity = get("opacity")
      const scale = get("scale") ?? 1
      if (opacity !== undefined) node.style.opacity = String(opacity)
      node.style.transform = `translate(${get("x") ?? 0}px, ${get("y") ?? 0}px) rotate(${get("rotate") ?? 0}deg) scale(${scale * (get("scaleX") ?? 1)}, ${scale * (get("scaleY") ?? 1)})`
      for (const [property, track] of tracks) {
        if (!property.startsWith("--")) continue
        const value = valueAt(track, at)
        if (value !== undefined) node.style.setProperty(property, String(value))
      }
    }
    if (at < end) frame = requestAnimationFrame(draw)
    else onComplete()
  }
  frame = requestAnimationFrame(draw)
  return () => cancelAnimationFrame(frame)
}
